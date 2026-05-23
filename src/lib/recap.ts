/**
 * Gera dados do Weekly Recap a partir das sessões dos últimos 7 dias.
 * Função pura sobre o storage — agrega numa estrutura pronta pros slides
 * do carrossel.
 */

import { getLapsForSession, listSessions, listUnlockedAchievements } from '../storage/db';

export type RecapData = {
  weekLabel: string; // "Semana de 14/05 a 20/05"
  sessionsCount: number;
  lapsCount: number;
  totalDistanceM: number;
  bestLapMs: number | null;
  bestTrackName: string | null;
  /** Comparação com semana anterior. */
  bestLapDelta: number | null; // negativo = melhor
  totalDeltaMs: number; // tempo total rodado
  topTracks: Array<{ name: string; sessions: number }>;
  achievementsThisWeek: number;
  /** "Você foi mais rápido nas tardes" — insight casual. */
  insight: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildWeeklyRecap(): Promise<RecapData | null> {
  const now = Date.now();
  const weekStart = now - 7 * DAY_MS;
  const prevWeekStart = now - 14 * DAY_MS;

  const sessions = await listSessions();
  const thisWeek = sessions.filter((s) => s.startedAt >= weekStart);
  const prevWeek = sessions.filter(
    (s) => s.startedAt >= prevWeekStart && s.startedAt < weekStart
  );

  if (thisWeek.length === 0) {
    return null; // sem dados na semana
  }

  let lapsCount = 0;
  let bestLapMs: number | null = null;
  let bestTrackName: string | null = null;
  const tracksMap = new Map<string, number>();

  for (const s of thisWeek) {
    const laps = await getLapsForSession(s.id);
    lapsCount += laps.length;
    for (const l of laps) {
      if (bestLapMs == null || l.durationMs < bestLapMs) {
        bestLapMs = l.durationMs;
        bestTrackName = s.trackName;
      }
    }
    tracksMap.set(s.trackName, (tracksMap.get(s.trackName) ?? 0) + 1);
  }

  // Best lap da semana anterior pra comparar
  let prevBest: number | null = null;
  for (const s of prevWeek) {
    const laps = await getLapsForSession(s.id);
    for (const l of laps) {
      if (prevBest == null || l.durationMs < prevBest) prevBest = l.durationMs;
    }
  }

  // Achievements desbloqueados nessa semana
  const unlocked = await listUnlockedAchievements();
  const achievementsThisWeek = unlocked.filter((u) => u.unlockedAt >= weekStart).length;

  const topTracks = [...tracksMap.entries()]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 3);

  // Estimativa de distância: 600m de pista média × voltas
  const totalDistanceM = lapsCount * 600;

  const totalDeltaMs = thisWeek.reduce((sum) => sum, 0);

  const fmtDate = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Insight casual baseado em horários — agrupa por turno (manhã/tarde/noite)
  const turnsCount: Record<string, number> = { manhã: 0, tarde: 0, noite: 0 };
  for (const s of thisWeek) {
    const h = new Date(s.startedAt).getHours();
    if (h < 12) turnsCount.manhã++;
    else if (h < 18) turnsCount.tarde++;
    else turnsCount.noite++;
  }
  const topTurn = Object.entries(turnsCount).sort((a, b) => b[1] - a[1])[0];
  const insight =
    topTurn[1] > 0
      ? `Você correu mais à ${topTurn[0]} (${topTurn[1]} sessões)`
      : 'Sessões espalhadas pela semana';

  return {
    weekLabel: `${fmtDate(weekStart)} a ${fmtDate(now)}`,
    sessionsCount: thisWeek.length,
    lapsCount,
    totalDistanceM,
    bestLapMs,
    bestTrackName,
    bestLapDelta: bestLapMs != null && prevBest != null ? bestLapMs - prevBest : null,
    totalDeltaMs,
    topTracks,
    achievementsThisWeek,
    insight,
  };
}
