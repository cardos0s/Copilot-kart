/**
 * Fila simples (em memória, módulo singleton) pra passar payload de celebração
 * de uma tela pra outra sem poluir a URL/query params.
 *
 * Fluxo:
 *   1. `recording.tsx` termina de salvar a sessão, processa milestones, e
 *      chama `setPendingCelebration(payload)` antes de navegar.
 *   2. `session/[id].tsx` ao montar chama `consumePendingCelebration()`. Se
 *      tiver payload, abre os modais em sequência (PB → Level Up → ...).
 *
 * Trade-off: se o app crashar entre o set e o consume, a celebração é perdida.
 * Aceitável — o usuário ainda vê o PB salvo na tela de sessão normalmente.
 */

import { Achievement, Milestone } from './gamification';

export type PendingCelebration = {
  sessionId: string;
  milestones: Milestone[];
  xpGained: number;
  newXp: number;
  /** Conquistas recém-desbloqueadas pra encadear modais. */
  achievements: Achievement[];
  /** Tempos S1/S2/S3 da volta PB pra mostrar no modal. */
  pbSectorTimes?: Array<{ label: string; ms: number }>;
};

let pending: PendingCelebration | null = null;

export function setPendingCelebration(payload: PendingCelebration): void {
  pending = payload;
}

export function consumePendingCelebration(forSessionId: string): PendingCelebration | null {
  if (!pending) return null;
  if (pending.sessionId !== forSessionId) return null;
  const out = pending;
  pending = null;
  return out;
}
