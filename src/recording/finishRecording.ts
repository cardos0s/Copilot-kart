/**
 * O "Encerrar" da tela de gravação, sem a tela: decide entre poucos dados,
 * salvar ou falhar, e só apaga o diário depois do commit (REC-01 AC 9,
 * REC-05 AC 2). Diálogos, navegação e a sessão ao vivo ficam na tela.
 *
 * Puro: o diário, o armazenamento e os efeitos pós-salvamento são injetados.
 */
import type { LapRecord } from '../lib/analysis';
import {
  saveRecordedSession,
  type RecordedLap,
  type RecordedSessionInput,
  type RecordedSessionRow,
  type SavedSession,
  type SessionRepo,
} from './finishSession';
import type { GpsFrame } from '../telemetry/frame';
import type { RecordingJournal } from './journal';

/**
 * Pontos de GPS (os de análise, ≤ 30 m) abaixo dos quais não houve dado para uma
 * sessão: a gravação, inclusive a sem nenhuma fix e só com IMU, é descartada com
 * todo o bruto, como antes desta feature (edge ajustado em 07/10).
 */
export const MIN_SAMPLES = 30;

export type FinishRecordingMeta = Omit<RecordedSessionInput, 'laps' | 'recovered'>;

export type FinishRecordingDeps = {
  journal: Pick<RecordingJournal, 'end' | 'discard'>;
  repo: SessionRepo;
  /** XP, PB, conquistas e desafios. Roda só depois de salvar, com voltas. */
  postSave(session: RecordedSessionRow, laps: LapRecord[]): Promise<unknown>;
};

export type FinishRecordingOutcome =
  | { kind: 'too-few' }
  | { kind: 'saved'; saved: SavedSession }
  | { kind: 'save-failed'; error: unknown };

export async function finishRecording(
  result: { allSamples: GpsFrame[]; laps: RecordedLap[] },
  meta: FinishRecordingMeta,
  deps: FinishRecordingDeps
): Promise<FinishRecordingOutcome> {
  if (result.allSamples.length < MIN_SAMPLES) {
    // Sem sessão, as séries não têm dono: saem com o registro ativo (TF-09).
    await deps.journal.discard(meta.recordingId).catch(() => {});
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
  // Só depois do commit. O `end` apaga só o registro ativo: as séries do
  // diário são o bruto da sessão (TF-07). Se falhar aqui, a abertura seguinte
  // vê a sessão já salva e limpa o registro em silêncio.
  await deps.journal
    .end(meta.recordingId)
    .catch((e) => console.warn('[recording] journal.end:', e));

  if (saved.laps.length > 0) await deps.postSave(saved.session, saved.laps);
  return { kind: 'saved', saved };
}
