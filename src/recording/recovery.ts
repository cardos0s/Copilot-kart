/**
 * Recuperação de uma gravação interrompida: resumo para a tela, "Recuperar"
 * e "Descartar". Puro, com o armazenamento injetado.
 *
 * - corrida vira sessão com `recovered: true`, pelo mesmo `saveRecordedSession`
 *   do "Encerrar", então rodar de novo não duplica;
 * - reconhecimento vira layout de referência;
 * - meta com `version` desconhecida ou JSON quebrado é `unreadable`.
 */
import type { GpsSample, ImuSample } from '../lib/geometry';
import { detectLaps } from '../lib/lapDetector';
import type { GpsSeries, ImuSeries } from '../telemetry/frame';
import { gpsFramesOf, imuFramesOf } from '../telemetry/series';
import type { ReadResult } from '../telemetry/telemetryStore';
import {
  saveRecordedSession,
  saveReferenceLayout,
  sliceLaps,
  type LayoutRepo,
  type SavedSession,
  type SessionRepo,
} from './finishSession';
import type { ActiveRecording, JournalStore, RecordingMeta } from './journal';

export type RecoverySummary = {
  recordingId: string;
  mode: RecordingMeta['mode'];
  trackName: string;
  startedAt: number;
  /** Voltas completas pelo `detectLaps`. Zero: a tela oferece só "Descartar". */
  laps: number;
};

type ParsedJournal = { meta: RecordingMeta; gps: GpsSample[]; imu: ImuSample[] };

/**
 * Meta e frames do diário. Bloco ilegível torna o diário `unreadable`, como o
 * pedaço de JSON quebrado tornava.
 *
 * Transição (T16 → T21): os frames voltam à visão de antes (`t` absoluto, só as
 * fixes com precisão ≤ 30 m) para o recorte por `sliceLaps`. A T21 troca isso
 * pelas janelas sobre as séries.
 */
function parseJournal(active: ActiveRecording, read: ReadResult): ParsedJournal | 'unreadable' {
  try {
    const meta = JSON.parse(active.metaJson) as RecordingMeta;
    if (!meta || meta.version !== 1) return 'unreadable';
    if (meta.mode !== 'race' && meta.mode !== 'reference') return 'unreadable';
    if (read.skipped > 0) return 'unreadable';
    const gpsSeries = read.series.find((s) => s.meta.kind === 'gps') as GpsSeries | undefined;
    const imuSeries = read.series.find((s) => s.meta.kind === 'imu') as ImuSeries | undefined;
    const t0 = gpsSeries?.meta.t0Utc ?? meta.startedAt;
    const gps: GpsSample[] = (gpsSeries ? gpsFramesOf(gpsSeries) : [])
      .filter((f) => f.accuracy !== undefined && f.accuracy <= 30)
      .map((f) => {
        const g: GpsSample = { t: t0 + f.t, lat: f.lat, lng: f.lng, speed: f.speed, accuracy: f.accuracy! };
        if (f.heading !== undefined) g.heading = f.heading;
        if (f.altitude !== undefined) g.altitude = f.altitude;
        if (f.altitudeAccuracy !== undefined) g.altitudeAccuracy = f.altitudeAccuracy;
        return g;
      });
    const imu: ImuSample[] = (imuSeries ? imuFramesOf(imuSeries) : [])
      .filter((f) => f.accel && f.gyro)
      .map((f) => ({ t: t0 + f.t, accel: f.accel!, gyro: f.gyro! }));
    return { meta, gps, imu };
  } catch {
    return 'unreadable';
  }
}

export function summarize(active: ActiveRecording, read: ReadResult): RecoverySummary | 'unreadable' {
  const parsed = parseJournal(active, read);
  if (parsed === 'unreadable') return parsed;
  return {
    recordingId: parsed.meta.recordingId,
    mode: parsed.meta.mode,
    trackName: parsed.meta.trackName,
    startedAt: parsed.meta.startedAt,
    laps: detectLaps(parsed.gps, { line: parsed.meta.line ?? null }).laps.length,
  };
}

export type RecoveryDeps = {
  store: JournalStore;
  sessions: SessionRepo;
  layouts: LayoutRepo;
  now: () => number;
};

export type RecoverResult = { sessionId: string; saved: SavedSession } | { layoutId: string };

/**
 * "Recuperar": grava a sessão (ou o layout) e só depois apaga o diário. Se o
 * app morre entre as duas coisas, a próxima tentativa acha a sessão pelo id e
 * não duplica.
 */
export async function recover(recordingId: string, deps: RecoveryDeps): Promise<RecoverResult> {
  const active = await deps.store.readActive();
  if (!active || active.id !== recordingId) {
    throw new Error(`Gravação ${recordingId} não está mais no diário.`);
  }
  const parsed = parseJournal(active, await deps.store.readSeries(recordingId));
  if (parsed === 'unreadable') throw new Error('Não consegui ler a gravação interrompida');

  const { meta } = parsed;
  // A mesma linha da gravação (TMP-06); sem ela (diário antigo), a inferida.
  const laps = sliceLaps(parsed.gps, parsed.imu, meta.line ?? null);
  if (laps.length === 0) throw new Error('Nenhuma volta completa para recuperar');

  let result: RecoverResult;
  if (meta.mode === 'reference') {
    if (!meta.trackId) throw new Error('Reconhecimento sem pista.');
    const layout = await saveReferenceLayout(
      {
        recordingId,
        trackId: meta.trackId,
        layoutName: meta.layoutName,
        laps,
        recordedAt: deps.now(),
      },
      deps.layouts
    );
    result = { layoutId: layout.id };
  } else {
    const saved = await saveRecordedSession(
      {
        recordingId,
        trackName: meta.trackName,
        trackId: meta.trackId,
        layoutId: meta.layoutId,
        kartSetupId: meta.kartSetupId,
        mode: 'race',
        startedAt: meta.startedAt,
        laps,
        recovered: true,
      },
      deps.sessions
    );
    result = { sessionId: saved.session.id, saved };
  }

  // Transição (T16 → T21): as voltas foram salvas com os pontos, então o diário
  // sai inteiro, como antes. A T21 mantém as séries da sessão recuperada.
  await deps.store.discardRecording(recordingId);
  return result;
}

/** "Descartar": apaga o registro ativo e as séries. */
export async function discard(recordingId: string, deps: Pick<RecoveryDeps, 'store'>): Promise<void> {
  await deps.store.discardRecording(recordingId);
}
