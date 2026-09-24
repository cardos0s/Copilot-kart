/**
 * O "Encerrar" da tela de gravação, sem a tela: decide entre poucos dados,
 * salvar ou falhar, e só apaga o diário depois do commit (REC-01 AC 9,
 * REC-05 AC 2). Diálogos, navegação e a sessão ao vivo ficam na tela.
 *
 * Puro: o diário, o armazenamento e os efeitos pós-salvamento são injetados.
 */
import type { LapRecord } from '../lib/analysis';
import type { GpsSample } from '../lib/geometry';
import {
  saveRecordedSession,
  type RecordedLap,
  type RecordedSessionInput,
  type RecordedSessionRow,
  type SavedSession,
  type SessionRepo,
} from './finishSession';
import type { RecordingJournal } from './journal';

/** Abaixo disso não houve dado para uma sessão, e o diário é apagado. */
export const MIN_SAMPLES = 30;

export type FinishRecordingMeta = Omit<RecordedSessionInput, 'laps' | 'recovered'>;

export type FinishRecordingDeps = {
  journal: Pick<RecordingJournal, 'end'>;
  repo: SessionRepo;
  /** XP, PB, conquistas e desafios. Roda só depois de salvar, com voltas. */
  postSave(session: RecordedSessionRow, laps: LapRecord[]): Promise<unknown>;
};

export type FinishRecordingOutcome =
  | { kind: 'too-few' }
  | { kind: 'saved'; saved: SavedSession }
  | { kind: 'save-failed'; error: unknown };

export async function finishRecording(
  result: { allSamples: GpsSample[]; laps: RecordedLap[] },
  meta: FinishRecordingMeta,
  deps: FinishRecordingDeps
): Promise<FinishRecordingOutcome> {
  if (result.allSamples.length < MIN_SAMPLES) {
    await deps.journal.end(meta.recordingId).catch(() => {});
    return { kind: 'too-few' };
  }

  // Sessão e voltas numa transação só. Se falhar, o diário fica e a
  // recuperação aparece na próxima abertura (REC-05).
  let saved: SavedSession;
  try {
    saved = await saveRecordedSession({ ...meta, laps: result.laps }, deps.repo);
  } catch (error) {
    return { kind: 'save-failed', error };
  }
  // Só depois do commit. Se falhar aqui, a abertura seguinte vê a sessão
  // já salva e limpa o diário em silêncio.
  await deps.journal
    .end(meta.recordingId)
    .catch((e) => console.warn('[recording] journal.end:', e));

  if (saved.laps.length > 0) await deps.postSave(saved.session, saved.laps);
  return { kind: 'saved', saved };
}
