/**
 * Diário da gravação: acumula os pontos novos em memória e os grava no
 * armazenamento durável a cada 5 s, em pedaços só de append. Se o processo
 * morre, perde-se no máximo o que chegou desde a última escrita.
 *
 * Puro: o armazenamento (`JournalStore`) e o relógio são injetados. Uma
 * escrita que falha nunca trava a gravação: o pendente fica guardado para a
 * próxima tentativa e `failed` liga o aviso do HUD.
 */
import type { GpsSample, ImuSample } from '../lib/geometry';

export const FLUSH_INTERVAL_MS = 5000;

/** Formato versionado da meta. Outra `version` é tratada como ilegível. */
export type RecordingMeta = {
  version: 1;
  recordingId: string; // rec_<ts>_<rand>
  mode: 'race' | 'reference';
  startedAt: number;
  trackId: string | null;
  trackName: string;
  layoutId: string | null; // race
  layoutName: string | null; // reference
  kartSetupId: string | null;
};

export type RecordingMetaInput = Omit<RecordingMeta, 'version' | 'recordingId' | 'startedAt'>;

/** O registro ativo como está no armazenamento: a meta ainda em JSON. */
export type ActiveRecording = { id: string; metaJson: string; startedAt: number };

/** Um pedaço como está no armazenamento: os pontos ainda em JSON. */
export type JournalChunk = { seq: number; gpsJson: string; imuJson: string };

export type JournalStore = {
  createActive(meta: RecordingMeta): Promise<void>;
  appendChunk(id: string, seq: number, gps: GpsSample[], imu: ImuSample[]): Promise<void>;
  readActive(): Promise<ActiveRecording | null>;
  /** Pedaços em ordem de `seq`. */
  readChunks(id: string): Promise<JournalChunk[]>;
  deleteRecording(id: string): Promise<void>;
};

/** Já existe uma gravação interrompida: recuperar ou descartar antes de começar outra. */
export class UnresolvedRecordingError extends Error {
  constructor(public readonly recordingId: string) {
    super('Existe uma gravação interrompida para recuperar ou descartar.');
    this.name = 'UnresolvedRecordingError';
  }
}

export class RecordingJournal {
  private id: string | null = null;
  private seq = 0;
  private pendingGps: GpsSample[] = [];
  private pendingImu: ImuSample[] = [];
  private lastFlushAt = 0;
  private inflight: Promise<void> | null = null;
  private _failed = false;

  constructor(
    private readonly store: JournalStore,
    private readonly clock: () => number = Date.now
  ) {}

  /** Id da gravação em andamento neste processo, ou null. */
  get recordingId(): string | null {
    return this.id;
  }

  /** Verdadeiro se a última escrita falhou. */
  get failed(): boolean {
    return this._failed;
  }

  async begin(input: RecordingMetaInput): Promise<string> {
    const existing = await this.store.readActive();
    if (existing) throw new UnresolvedRecordingError(existing.id);

    const startedAt = this.clock();
    const recordingId = `rec_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
    await this.store.createActive({ version: 1, recordingId, startedAt, ...input });

    this.id = recordingId;
    this.seq = 0;
    this.pendingGps = [];
    this.pendingImu = [];
    this.lastFlushAt = startedAt;
    this._failed = false;
    return recordingId;
  }

  appendGps(samples: GpsSample[]): void {
    if (this.id) this.pendingGps.push(...samples);
  }

  appendImu(samples: ImuSample[]): void {
    if (this.id) this.pendingImu.push(...samples);
  }

  /** Grava o pendente se já passaram 5 s desde a última escrita. */
  async flushIfDue(now: number): Promise<void> {
    if (!this.id || this.inflight) return;
    if (now - this.lastFlushAt < FLUSH_INTERVAL_MS) return;
    this.lastFlushAt = now;
    await this.flush();
  }

  /** Grava o pendente agora. Nunca lança: uma falha liga `failed`. */
  async flush(): Promise<void> {
    while (this.inflight) await this.inflight;
    const id = this.id;
    if (!id || (this.pendingGps.length === 0 && this.pendingImu.length === 0)) return;

    const gps = this.pendingGps;
    const imu = this.pendingImu;
    this.pendingGps = [];
    this.pendingImu = [];
    this.inflight = (async () => {
      try {
        await this.store.appendChunk(id, this.seq, gps, imu);
        this.seq++;
        this._failed = false;
      } catch {
        // O pendente volta para a frente da fila e entra na próxima tentativa.
        this.pendingGps = gps.concat(this.pendingGps);
        this.pendingImu = imu.concat(this.pendingImu);
        this._failed = true;
      } finally {
        this.inflight = null;
      }
    })();
    await this.inflight;
  }

  /** Apaga o registro ativo e os pedaços da gravação. */
  async end(recordingId: string): Promise<void> {
    while (this.inflight) await this.inflight;
    await this.store.deleteRecording(recordingId);
    if (this.id === recordingId) {
      this.id = null;
      this.pendingGps = [];
      this.pendingImu = [];
      this._failed = false;
    }
  }
}
