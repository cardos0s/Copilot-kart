/**
 * Sistema de desafios diários — 3 desafios gerados por dia, focados em
 * marcos atingíveis numa sessão típica de kart amador.
 *
 * Templates ficam num catálogo fixo. A cada dia, sortia 3 dos templates pra
 * gerar a oferta. Sem hardware OBD, os desafios são todos baseados em
 * métricas que já calculamos das voltas (GPS).
 *
 * `getChallengesForToday()` é idempotente: retorna o do dia, ou gera se não
 * existe ainda.
 */

import {
  DailyChallenge,
  getLapsForSession,
  listDailyChallenges,
  listSessions,
  saveDailyChallenge,
} from '../storage/db';

export type ChallengeTemplate = {
  id: string;
  title: string;
  description: (target: number) => string;
  icon: string;
  /** Pra gerar o `target`, valor único ou random entre N1 e N2. */
  targets: number[];
  /** Como calcular o progresso atual baseado em sessões do dia. */
  evaluate: (
    target: number,
    sessionsToday: Array<{ session: any; laps: Array<{ durationMs: number }> }>
  ) => number;
};

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'laps_count',
    title: 'Mete bronca',
    description: (t) => `Complete ${t} voltas hoje`,
    icon: '🎯',
    targets: [10, 15, 20],
    evaluate: (_, sessions) =>
      sessions.reduce((sum, s) => sum + s.laps.length, 0),
  },
  {
    id: 'sessions_count',
    title: 'Pé no pedal',
    description: (t) => `Faça ${t} ${t === 1 ? 'sessão' : 'sessões'} hoje`,
    icon: '⛽',
    targets: [1, 2],
    evaluate: (_, sessions) => sessions.length,
  },
  {
    id: 'sub_50',
    title: 'Sub-50 segundos',
    description: (_) => 'Bata uma volta abaixo de 50s',
    icon: '⚡',
    targets: [50000],
    evaluate: (target, sessions) => {
      const best = bestLapMs(sessions);
      return best != null && best < target ? 1 : 0;
    },
  },
  {
    id: 'sub_60',
    title: 'Sub-60 segundos',
    description: (_) => 'Bata uma volta abaixo de 60s',
    icon: '⏱️',
    targets: [60000],
    evaluate: (target, sessions) => {
      const best = bestLapMs(sessions);
      return best != null && best < target ? 1 : 0;
    },
  },
  {
    id: 'consistency',
    title: 'Consistência',
    description: (t) => `Tenha ${t} voltas dentro de 1s da sua média do dia`,
    icon: '🎯',
    targets: [5, 8],
    evaluate: (_, sessions) => {
      const all = sessions.flatMap((s) => s.laps.map((l) => l.durationMs));
      if (all.length === 0) return 0;
      const avg = all.reduce((a, b) => a + b, 0) / all.length;
      return all.filter((ms) => Math.abs(ms - avg) <= 1000).length;
    },
  },
  {
    id: 'distance',
    title: 'Volume',
    description: (t) => `Acumule ${t} km de pista hoje (~600m por volta)`,
    icon: '📏',
    targets: [5, 10],
    evaluate: (_, sessions) =>
      Math.floor(sessions.reduce((sum, s) => sum + s.laps.length, 0) * 0.6),
  },
];

function bestLapMs(sessions: Array<{ laps: Array<{ durationMs: number }> }>): number | null {
  let best: number | null = null;
  for (const s of sessions) {
    for (const l of s.laps) {
      if (best == null || l.durationMs < best) best = l.durationMs;
    }
  }
  return best;
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Retorna os 3 desafios do dia. Se não existirem, sorteia 3 templates
 * diferentes e cria. Função idempotente.
 */
export async function getChallengesForToday(): Promise<DailyChallenge[]> {
  const date = todayKey();
  const existing = await listDailyChallenges(date);
  if (existing.length > 0) return existing;

  // Sorteia 3 templates distintos
  const shuffled = CHALLENGE_TEMPLATES.slice().sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3);
  const newChallenges: DailyChallenge[] = picked.map((t, i) => ({
    id: `${date}_${t.id}_${i}`,
    date,
    templateId: t.id,
    target: t.targets[Math.floor(Math.random() * t.targets.length)],
    progress: 0,
    completed: false,
    completedAt: null,
  }));
  for (const c of newChallenges) {
    await saveDailyChallenge(c);
  }
  return newChallenges;
}

export function getTemplate(id: string): ChallengeTemplate | null {
  return CHALLENGE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Recalcula o progresso de todos os desafios do dia baseado nas sessões
 * realizadas. Chamado pós-sessão.
 */
export async function refreshTodayChallenges(): Promise<void> {
  const date = todayKey();
  const challenges = await listDailyChallenges(date);
  if (challenges.length === 0) return;

  // Pega sessões de hoje
  const allSessions = await listSessions();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todaySessions = allSessions.filter((s) => s.startedAt >= startOfDay.getTime());

  // Pra cada sessão, carrega laps (em paralelo)
  const sessionsWithLaps = await Promise.all(
    todaySessions.map(async (session) => ({
      session,
      laps: await getLapsForSession(session.id),
    }))
  );

  for (const c of challenges) {
    const tpl = getTemplate(c.templateId);
    if (!tpl) continue;
    const progress = tpl.evaluate(c.target, sessionsWithLaps);
    const completed = progress >= c.target;
    if (progress !== c.progress || completed !== c.completed) {
      await saveDailyChallenge({
        ...c,
        progress,
        completed,
        completedAt: completed && !c.completed ? Date.now() : c.completedAt,
      });
    }
  }
}
