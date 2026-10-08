/**
 * O caminho único para transformar pontos gravados em sessão salva. Usado
 * pelo "Encerrar", pela confirmação de saída e pela recuperação.
 *
 * Puro: o armazenamento entra pela interface `SessionRepo`, implementada
 * sobre o SQLite em outro arquivo. Nada aqui importa módulo nativo.
 */
import type { LapRecord } from '../lib/analysis';
import { polylineLength, type GpsSample, type ImuSample } from '../lib/geometry';
import { detectLaps } from '../lib/lapDetector';
import type { CrossPoint, StartLine } from '../lib/startLine';
import type { Session, SessionMode, TrackLayout } from '../storage/db';
import type { GpsFrame, GpsSeries, ImuFrame, ImuSeries } from '../telemetry/frame';
import { lapFrames, type AnalysisGpsFrame, type CrossWindow, type LapWindowRecord } from '../telemetry/laps';

export type RecordedLap = {
  samples: GpsSample[];
  /** IMU recortada para a mesma janela de tempo da volta. Vazia se a IMU falhou. */
  imuSamples: ImuSample[];
  durationMs: number;
  /** Início da volta, em epoch ms. */
  startedAt: number;
  /**
   * A janela sobre o bruto da sessão (AD-007) e os frames dela (`lapFrames`).
   * Ausentes só no recorte antigo (`sliceLaps`), que a recuperação usa até a T21.
   * Transição: `samples` e `imuSamples` apontam para os mesmos arrays de `gps` e `imu`.
   */
  window?: CrossWindow;
  gps?: GpsFrame[];
  imu?: ImuFrame[];
};

/**
 * As voltas detectadas como `RecordedLap`: a janela, os frames dela com as
 * fronteiras geradas na leitura e o início em epoch ms (`t0Utc + startT`).
 */
export function recordedLaps(
  windows: LapWindowRecord[],
  gps: GpsSeries,
  imu: ImuSeries | undefined,
  t0Utc: number
): RecordedLap[] {
  return windows.map((w) => {
    const frames = lapFrames(w.window, gps, imu);
    return {
      window: w.window,
      gps: frames.gps,
      imu: frames.imu,
      // Transição (até a T46): a janela por cruzamento só tem frames com precisão
      // (≤ 30 m e as fronteiras). O frame de IMU sem par não tem um dos sensores;
      // o `spinDetector` passa a ler `imu` na T30.
      samples: frames.gps as AnalysisGpsFrame[],
      imuSamples: frames.imu as unknown as ImuSample[],
      durationMs: w.durationMs,
      startedAt: t0Utc + w.startT,
    };
  });
}

/**
 * Ponto de fronteira da volta, no cruzamento interpolado da linha. `idx` é o
 * 1º ponto cru depois do cruzamento; a precisão é a pior do par interpolado.
 */
function boundaryPoint(cross: CrossPoint, samples: AnalysisGpsFrame[], idx: number): AnalysisGpsFrame {
  const b = samples[idx];
  const a = samples[idx - 1];
  const accuracy = a && cross.t < b.t ? Math.max(a.accuracy, b.accuracy) : b.accuracy;
  return { kind: 'gps', source: b.source, fix: 'unknown', t: cross.t, lat: cross.lat, lng: cross.lng, speed: cross.speed, accuracy, synthetic: true };
}

/**
 * Detecta as voltas e recorta cada uma. A volta começa e termina em pontos
 * sintéticos na linha (AD-006): `[startCross, pontos crus entre os dois
 * cruzamentos, endCross]`. A IMU é recortada por timestamp, não por índice
 * (50 Hz contra 10 Hz do GPS): entra tudo em [startCross.t, endCross.t].
 */
export function sliceLaps(samples: AnalysisGpsFrame[], imu: ImuFrame[], line?: StartLine | null): RecordedLap[] {
  return detectLaps(samples, { line }).laps.map((lap) => {
    const t0 = lap.startCross.t;
    const t1 = lap.endCross.t;
    const inner = samples.slice(lap.startIdx, lap.endIdx + 1).filter((s) => s.t > t0 && s.t < t1);
    return {
      samples: [
        boundaryPoint(lap.startCross, samples, lap.startIdx),
        ...inner,
        boundaryPoint(lap.endCross, samples, lap.endIdx),
      ],
      imuSamples: imu.filter((s) => s.t >= t0 && s.t <= t1),
      durationMs: lap.durationMs,
      startedAt: lap.startedAt,
    };
  });
}

/** `''` e `undefined` viram `null`: sessão sem traçado ou setup nunca grava string vazia. */
export function normalizeId(v: string | null | undefined): string | null {
  return v ? v : null;
}

/**
 * A volta como vai para o banco: a janela sobre o bruto (o que `laps` guarda),
 * mais os frames dela para quem consome a volta logo depois do "Encerrar"
 * (pós-salvamento, traçado). Os frames não são copiados: as séries já são da sessão.
 */
export function toLapRecord(lap: RecordedLap, sessionId: string, index: number): LapRecord {
  const record: LapRecord = {
    id: `${sessionId}_lap_${index + 1}`,
    sessionId,
    // Transição (até a T46): o recorte antigo (`sliceLaps`) não tem `gps`; os dois apontam para o mesmo array.
    gps: lap.gps ?? lap.samples,
    samples: lap.samples,
    startedAt: lap.startedAt,
    durationMs: lap.durationMs,
    // IMU vazia (sensor falhou, app sem foreground) fica de fora.
    imuSamples: lap.imuSamples.length > 0 ? lap.imuSamples : undefined,
  };
  if (lap.window) record.window = lap.window;
  const imu = lap.imu ?? lap.imuSamples;
  if (imu.length > 0) record.imu = imu;
  return record;
}

export type RecordedSessionRow = Session & { recovered: boolean };

export type SessionRepoTx = {
  sessionExists(id: string): Promise<boolean>;
  insertSession(row: RecordedSessionRow): Promise<void>;
  insertLap(lap: LapRecord): Promise<void>;
};

export type SessionRepo = SessionRepoTx & {
  /** Transação exclusiva: um erro dentro do callback desfaz tudo e sobe. */
  transaction(fn: (tx: SessionRepoTx) => Promise<void>): Promise<void>;
};

export type RecordedSessionInput = {
  recordingId: string;
  trackName: string;
  trackId: string | null | undefined;
  layoutId: string | null | undefined;
  kartSetupId: string | null | undefined;
  mode: SessionMode;
  startedAt: number;
  laps: RecordedLap[];
  recovered?: boolean;
};

export type SavedSession = { session: RecordedSessionRow; laps: LapRecord[] };

export function sessionIdFor(recordingId: string): string {
  return `session_${recordingId}`;
}

/**
 * Grava a sessão e todas as voltas numa transação só. O id é
 * `session_<recordingId>`, e se ele já existe nada é gravado: salvar de novo
 * (crash entre o commit e a limpeza do diário) não duplica.
 */
export async function saveRecordedSession(
  input: RecordedSessionInput,
  repo: SessionRepo
): Promise<SavedSession> {
  const id = sessionIdFor(input.recordingId);
  const session: RecordedSessionRow = {
    id,
    trackName: input.trackName,
    kart: null,
    notes: null,
    startedAt: input.startedAt,
    weather: 'dry',
    trackId: normalizeId(input.trackId),
    mode: input.mode,
    layoutId: normalizeId(input.layoutId),
    kartSetupId: normalizeId(input.kartSetupId),
    recovered: input.recovered ?? false,
  };
  const laps = input.laps.map((lap, i) => toLapRecord(lap, id, i));

  await repo.transaction(async (tx) => {
    if (await tx.sessionExists(id)) return;
    await tx.insertSession(session);
    for (const lap of laps) await tx.insertLap(lap);
  });
  return { session, laps };
}

export type LayoutRepo = {
  listLayoutsForTrack(trackId: string): Promise<TrackLayout[]>;
  saveLayout(layout: TrackLayout): Promise<void>;
};

export type ReferenceLayoutInput = {
  recordingId: string;
  trackId: string;
  /** Nome escolhido pelo piloto. Vazio usa "Layout principal" ou "Layout N". */
  layoutName: string | null | undefined;
  laps: RecordedLap[];
  recordedAt: number;
};

/**
 * Cria o layout de referência a partir da melhor volta. O id é
 * `layout_<recordingId>`; se ele já existe, devolve o existente sem regravar,
 * para uma segunda tentativa não trocar o nome nem o default.
 */
export async function saveReferenceLayout(
  input: ReferenceLayoutInput,
  repo: LayoutRepo
): Promise<TrackLayout> {
  if (input.laps.length === 0) throw new Error('Nenhuma volta completa para o traçado.');
  const id = `layout_${input.recordingId}`;
  const existing = await repo.listLayoutsForTrack(input.trackId);
  const already = existing.find((l) => l.id === id);
  if (already) return already;

  // Melhor volta = a mais rápida: traçado limpo serve melhor de referência.
  const best = input.laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), input.laps[0]);
  const isFirst = existing.length === 0;
  const layout: TrackLayout = {
    id,
    trackId: input.trackId,
    name:
      input.layoutName?.trim() || (isFirst ? 'Layout principal' : `Layout ${existing.length + 1}`),
    samples: best.samples,
    durationMs: best.durationMs,
    lengthM: polylineLength(best.samples),
    recordedAt: input.recordedAt,
    isDefault: isFirst,
  };
  // A janela e os frames da volta: o repositório copia os frames para a série do traçado (TF-19).
  if (best.window && best.gps) {
    layout.window = best.window;
    layout.gps = best.gps;
  }
  await repo.saveLayout(layout);
  return layout;
}
