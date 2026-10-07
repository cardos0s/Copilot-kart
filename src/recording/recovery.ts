/**
 * Recuperação de uma gravação interrompida: resumo para a tela, "Recuperar"
 * e "Descartar". Puro, com o armazenamento injetado.
 *
 * O bruto da gravação já está nas séries da sessão (`session:session_<id>`),
 * até o último bloco gravado (TF-08):
 * - corrida vira sessão com `recovered: true`, pelo mesmo `saveRecordedSession`
 *   do "Encerrar" (rodar de novo não duplica). As voltas são janelas sobre
 *   essas séries, sem copiar frames, e só o registro ativo sai;
 * - reconhecimento vira layout de referência, e o diário sai inteiro (nenhuma
 *   sessão fica dona das séries);
 * - meta com `version` desconhecida, JSON quebrado ou bloco ilegível é `unreadable`.
 */
import type { GpsFrame, GpsSeries, ImuSeries } from '../telemetry/frame';
import { sliceLapWindows } from '../telemetry/laps';
import { gpsFramesOf, gpsSeriesOf } from '../telemetry/series';
import type { ReadResult } from '../telemetry/telemetryStore';
import {
  recordedLaps,
  saveRecordedSession,
  saveReferenceLayout,
  type LayoutRepo,
  type SavedSession,
  type SessionRepo,
} from './finishSession';
import { recordingSeries, type ActiveRecording, type JournalStore, type RecordingMeta } from './journal';

export type RecoverySummary = {
  recordingId: string;
  mode: RecordingMeta['mode'];
  trackName: string;
  startedAt: number;
  /** Voltas completas pelo `detectLaps`. Zero: a tela oferece só "Descartar". */
  laps: number;
};

type ParsedJournal = {
  meta: RecordingMeta;
  t0Utc: number;
  gpsSeries: GpsSeries;
  imuSeries: ImuSeries | undefined;
  gps: GpsFrame[];
};

/** Meta e séries do diário. Bloco ilegível torna o diário `unreadable`, como o pedaço de JSON quebrado tornava. */
function parseJournal(active: ActiveRecording, read: ReadResult): ParsedJournal | 'unreadable' {
  try {
    const meta = JSON.parse(active.metaJson) as RecordingMeta;
    if (!meta || meta.version !== 1) return 'unreadable';
    if (meta.mode !== 'race' && meta.mode !== 'reference') return 'unreadable';
    if (read.skipped > 0) return 'unreadable';
    const found = read.series.find((s) => s.meta.kind === 'gps') as GpsSeries | undefined;
    const imuSeries = read.series.find((s) => s.meta.kind === 'imu') as ImuSeries | undefined;
    const t0Utc = found?.meta.t0Utc ?? meta.startedAt;
    const gpsSeries = found ?? gpsSeriesOf(recordingSeries(meta.recordingId, t0Utc).gps, []);
    return { meta, t0Utc, gpsSeries, imuSeries, gps: gpsFramesOf(gpsSeries) };
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
    laps: sliceLapWindows(parsed.gps, parsed.meta.line ?? null).length,
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
  // As voltas são janelas sobre as séries do diário, sobre os frames ≤ 30 m (TF-12).
  const windows = sliceLapWindows(parsed.gps, meta.line ?? null);
  if (windows.length === 0) throw new Error('Nenhuma volta completa para recuperar');
  const laps = recordedLaps(windows, parsed.gpsSeries, parsed.imuSeries, parsed.t0Utc);

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
    // O traçado guarda os pontos dele; nenhuma sessão fica dona das séries.
    await deps.store.discardRecording(recordingId);
    return result;
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

  // As séries são o bruto da sessão recuperada (edge "sessão recuperada"): só o
  // registro ativo sai.
  await deps.store.deleteActive(recordingId);
  return result;
}

/** "Descartar": apaga o registro ativo e as séries. */
export async function discard(recordingId: string, deps: Pick<RecoveryDeps, 'store'>): Promise<void> {
  await deps.store.discardRecording(recordingId);
}
