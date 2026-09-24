/**
 * O caminho único para transformar pontos gravados em sessão salva. Usado
 * pelo "Encerrar", pela confirmação de saída e pela recuperação.
 *
 * Puro: o armazenamento entra pela interface `SessionRepo`, implementada
 * sobre o SQLite em outro arquivo. Nada aqui importa módulo nativo.
 */
import type { LapRecord } from '../lib/analysis';
import type { GpsSample, ImuSample } from '../lib/geometry';
import { detectLaps } from '../lib/lapDetector';
import type { Session, SessionMode } from '../storage/db';

export type RecordedLap = {
  samples: GpsSample[];
  /** IMU recortada para a mesma janela de tempo da volta. Vazia se a IMU falhou. */
  imuSamples: ImuSample[];
  durationMs: number;
  startedAt: number;
};

/**
 * Detecta as voltas e recorta cada uma. A IMU é recortada por timestamp, não
 * por índice (50 Hz contra 10 Hz do GPS): entra tudo em [início, início + duração].
 */
export function sliceLaps(samples: GpsSample[], imu: ImuSample[]): RecordedLap[] {
  return detectLaps(samples).laps.map((lap) => {
    const lapEndT = lap.startedAt + lap.durationMs;
    return {
      samples: samples.slice(lap.startIdx, lap.endIdx + 1),
      imuSamples: imu.filter((s) => s.t >= lap.startedAt && s.t <= lapEndT),
      durationMs: lap.durationMs,
      startedAt: lap.startedAt,
    };
  });
}

/** `''` e `undefined` viram `null`: sessão sem traçado ou setup nunca grava string vazia. */
export function normalizeId(v: string | null | undefined): string | null {
  return v ? v : null;
}

export function toLapRecord(lap: RecordedLap, sessionId: string, index: number): LapRecord {
  return {
    id: `${sessionId}_lap_${index + 1}`,
    sessionId,
    samples: lap.samples,
    startedAt: lap.startedAt,
    durationMs: lap.durationMs,
    // IMU vazia (sensor falhou, app sem foreground) não é gravada.
    imuSamples: lap.imuSamples.length > 0 ? lap.imuSamples : undefined,
  };
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
