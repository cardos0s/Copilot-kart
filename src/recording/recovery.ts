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
import {
  saveRecordedSession,
  saveReferenceLayout,
  sliceLaps,
  type LayoutRepo,
  type SavedSession,
  type SessionRepo,
} from './finishSession';
import type { ActiveRecording, JournalChunk, JournalStore, RecordingMeta } from './journal';

export type RecoverySummary = {
  recordingId: string;
  mode: RecordingMeta['mode'];
  trackName: string;
  startedAt: number;
  /** Voltas completas pelo `detectLaps`. Zero: a tela oferece só "Descartar". */
  laps: number;
};

type ParsedJournal = { meta: RecordingMeta; gps: GpsSample[]; imu: ImuSample[] };

function parseJournal(active: ActiveRecording, chunks: JournalChunk[]): ParsedJournal | 'unreadable' {
  try {
    const meta = JSON.parse(active.metaJson) as RecordingMeta;
    if (!meta || meta.version !== 1) return 'unreadable';
    if (meta.mode !== 'race' && meta.mode !== 'reference') return 'unreadable';
    const gps: GpsSample[] = [];
    const imu: ImuSample[] = [];
    for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
      const g = JSON.parse(c.gpsJson);
      const i = JSON.parse(c.imuJson);
      if (!Array.isArray(g) || !Array.isArray(i)) return 'unreadable';
      gps.push(...g);
      imu.push(...i);
    }
    return { meta, gps, imu };
  } catch {
    return 'unreadable';
  }
}

export function summarize(
  active: ActiveRecording,
  chunks: JournalChunk[]
): RecoverySummary | 'unreadable' {
  const parsed = parseJournal(active, chunks);
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
  const parsed = parseJournal(active, await deps.store.readChunks(recordingId));
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

  await deps.store.deleteRecording(recordingId);
  return result;
}

/** "Descartar": apaga o registro ativo e os pedaços. */
export async function discard(recordingId: string, deps: Pick<RecoveryDeps, 'store'>): Promise<void> {
  await deps.store.deleteRecording(recordingId);
}
