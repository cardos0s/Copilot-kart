/**
 * Diário da gravação: acumula os frames novos em memória e os grava a cada 5 s,
 * um bloco por série (GPS e IMU) numa transação. As séries são as da sessão
 * (dono `session:session_<recordingId>`), e o que o diário grava já é o bruto
 * dela (TF-07): o "Encerrar" não copia nada. Se o processo morre, perde-se no
 * máximo o que chegou desde a última escrita.
 *
 * Puro: o armazenamento (`JournalStore`) e o relógio são injetados. Uma
 * escrita que falha nunca trava a gravação: o pendente fica guardado para a
 * próxima tentativa e `failed` liga o aviso do HUD.
 */
import type { StartLine } from '../lib/startLine';
import { encodeBlock } from '../telemetry/blockCodec';
import type { GpsFrame, ImuFrame, Owner, SeriesMeta } from '../telemetry/frame';
import { gpsSeriesOf, imuSeriesOf } from '../telemetry/series';
import type { BlockRow, ReadResult } from '../telemetry/telemetryStore';

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
  /**
   * Linha de chegada do traçado (race com traçado). Opcional e sem mudar a
   * `version`: um diário antigo sem ela usa a linha inferida.
   */
  line?: StartLine | null;
};

export type RecordingMetaInput = Omit<RecordingMeta, 'version' | 'recordingId' | 'startedAt'>;

/** O registro ativo como está no armazenamento: a meta ainda em JSON. */
export type ActiveRecording = { id: string; metaJson: string; startedAt: number };

/** Dono das séries da gravação: a sessão que ela vira (`session_<recordingId>`). */
export function recordingOwner(recordingId: string): Owner {
  return { kind: 'session', id: `session_${recordingId}` };
}

/** As duas séries do celular, com fonte `PHONE` e o `t0Utc` do início (TF-01). */
export function recordingSeries(recordingId: string, t0Utc: number): { gps: SeriesMeta; imu: SeriesMeta } {
  const owner = recordingOwner(recordingId);
  const meta = (kind: 'gps' | 'imu'): SeriesMeta => ({
    id: `${owner.id}_${kind}`,
    owner,
    source: 'PHONE',
    kind,
    t0Utc,
    legacy: false,
  });
  return { gps: meta('gps'), imu: meta('imu') };
}

export type JournalStore = {
  /** O registro ativo e as séries da gravação, numa transação. */
  createActive(meta: RecordingMeta, series: SeriesMeta[]): Promise<void>;
  /** Os blocos de um flush, numa transação: entram todos, ou nenhum. */
  appendBlocks(blocks: BlockRow[]): Promise<void>;
  readActive(): Promise<ActiveRecording | null>;
  /** As séries da gravação, com os blocos em ordem. */
  readSeries(recordingId: string): Promise<ReadResult>;
  /** Apaga só o registro ativo: as séries ficam, porque são a sessão (TF-07). */
  deleteActive(recordingId: string): Promise<void>;
  /** Apaga o registro ativo e as séries, numa transação. */
  discardRecording(recordingId: string): Promise<void>;
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
  private series: { gps: SeriesMeta; imu: SeriesMeta } | null = null;
  private seq = { gps: 0, imu: 0 };
  private pendingGps: GpsFrame[] = [];
  private pendingImu: ImuFrame[] = [];
  private lastFlushAt = 0;
  private startedAt = 0;
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

  /** Instante UTC do início da gravação em andamento: o `t` dos frames conta a partir dele. */
  get t0Utc(): number | null {
    return this.id ? this.startedAt : null;
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
    const series = recordingSeries(recordingId, startedAt);
    await this.store.createActive({ version: 1, recordingId, startedAt, ...input }, [series.gps, series.imu]);

    this.id = recordingId;
    this.series = series;
    this.seq = { gps: 0, imu: 0 };
    this.pendingGps = [];
    this.pendingImu = [];
    this.lastFlushAt = startedAt;
    this.startedAt = startedAt;
    this._failed = false;
    return recordingId;
  }

  appendGps(frames: GpsFrame[]): void {
    if (this.id) this.pendingGps.push(...frames);
  }

  appendImu(frames: ImuFrame[]): void {
    if (this.id) this.pendingImu.push(...frames);
  }

  /** Grava o pendente se já passaram 5 s desde a última escrita. */
  async flushIfDue(now: number): Promise<void> {
    if (!this.id || this.inflight) return;
    if (now - this.lastFlushAt < FLUSH_INTERVAL_MS) return;
    this.lastFlushAt = now;
    await this.flush();
  }

  /** Grava o pendente agora, um bloco por série. Nunca lança: uma falha liga `failed`. */
  async flush(): Promise<void> {
    while (this.inflight) await this.inflight;
    const series = this.series;
    if (!this.id || !series || (this.pendingGps.length === 0 && this.pendingImu.length === 0)) return;

    const gps = this.pendingGps;
    const imu = this.pendingImu;
    this.pendingGps = [];
    this.pendingImu = [];
    const blocks: BlockRow[] = [];
    if (gps.length > 0) blocks.push(block(gpsSeriesOf(series.gps, gps), this.seq.gps));
    if (imu.length > 0) blocks.push(block(imuSeriesOf(series.imu, imu), this.seq.imu));
    this.inflight = (async () => {
      try {
        await this.store.appendBlocks(blocks);
        if (gps.length > 0) this.seq.gps++;
        if (imu.length > 0) this.seq.imu++;
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

  /** Fim da gravação salva: apaga só o registro ativo. As séries ficam, são a sessão (TF-07). */
  async end(recordingId: string): Promise<void> {
    while (this.inflight) await this.inflight;
    await this.store.deleteActive(recordingId);
    this.forget(recordingId);
  }

  /** Descarte: apaga o registro ativo e as séries da gravação (TF-09). */
  async discard(recordingId: string): Promise<void> {
    while (this.inflight) await this.inflight;
    await this.store.discardRecording(recordingId);
    this.forget(recordingId);
  }

  private forget(recordingId: string): void {
    if (this.id !== recordingId) return;
    this.id = null;
    this.series = null;
    this.pendingGps = [];
    this.pendingImu = [];
    this._failed = false;
  }
}

/** Um bloco com a série inteira dada. */
function block(series: Parameters<typeof encodeBlock>[0], seq: number): BlockRow {
  return {
    seriesId: series.meta.id,
    seq,
    n: series.n,
    tFirst: series.t[0],
    tLast: series.t[series.n - 1],
    payload: encodeBlock(series, 0, series.n),
  };
}
