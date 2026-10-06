/**
 * Checagem na abertura do app, antes de decidir a rota.
 *
 * Na abertura nenhuma tela de gravação está montada, então uma tarefa de
 * localização registrada é órfã (o app morreu gravando) e todo diário ativo é
 * uma gravação interrompida. Puro, com as dependências injetadas.
 */
import { sessionIdFor } from './finishSession';
import type { JournalStore } from './journal';
import { summarize, type RecoverySummary } from './recovery';

export type BootCheckDeps = {
  store: JournalStore;
  isLocationTaskRunning(): Promise<boolean>;
  stopLocationUpdates(): Promise<void>;
  sessionExists(id: string): Promise<boolean>;
};

export type BootResult =
  | { kind: 'none' }
  | { kind: 'already-saved' }
  | { kind: 'interrupted'; summary: RecoverySummary }
  | { kind: 'unreadable' };

export async function runBootCheck(deps: BootCheckDeps): Promise<BootResult> {
  try {
    if (await deps.isLocationTaskRunning()) await deps.stopLocationUpdates();
  } catch (e) {
    // Não parar a tarefa não pode travar a abertura; o diário segue decidindo.
    console.warn('[bootCheck] falha ao parar a tarefa de localização:', e);
  }

  const active = await deps.store.readActive();
  if (!active) return { kind: 'none' };

  // Crash entre o commit da sessão e a limpeza: já está salva, só limpa.
  // Transição (T16 → T21): apaga o diário inteiro, como antes; a T21 mantém as séries.
  if (await deps.sessionExists(sessionIdFor(active.id))) {
    await deps.store.discardRecording(active.id);
    return { kind: 'already-saved' };
  }

  const summary = summarize(active, await deps.store.readSeries(active.id));
  if (summary === 'unreadable') {
    await deps.store.discardRecording(active.id);
    return { kind: 'unreadable' };
  }
  return { kind: 'interrupted', summary };
}
