/**
 * Sistema de gamification — XP, níveis, e detecção de marcos (PB, streaks).
 *
 * **Níveis** seguem progressão de kart real (Cadete → S1 → S2 → S3 → ...).
 * Cada nível exige mais XP que o anterior (crescimento exponencial suave
 * pra que avançar nos níveis altos seja achievement de verdade).
 *
 * **XP** vem de marcos concretos:
 *   - Sessão concluída: 50 XP
 *   - Nova PB pessoal: 250 XP
 *   - Streak de PB (2+ sessões com PB seguidas): bonus +50 XP por sessão extra
 *   - Sub-Xs (primeira vez batendo um threshold redondo, ex sub-50s): 500 XP
 *
 * **Marcos celebráveis** (mostram modal):
 *   - PB pessoal (sempre)
 *   - Sub-Xs (primeira vez)
 *   - Streak ≥ 3
 *   - Level up
 */

import {
  getLapsForSession,
  isAchievementUnlocked,
  listSessions,
  listUnlockedAchievements,
  unlockAchievement,
} from '../storage/db';

// ===== Níveis =====
// Threshold = soma de XP necessária pra estar NESTE nível.
// Nome é o tag visível (S1, S2, etc).

export type Level = {
  index: number; // 1, 2, 3...
  name: string;
  threshold: number;
  title: string;
};

export const LEVELS: Level[] = [
  { index: 1, name: 'Cadete', threshold: 0, title: 'Cadete' },
  { index: 2, name: 'S1', threshold: 500, title: 'Sênior 1' },
  { index: 3, name: 'S2', threshold: 1200, title: 'Sênior 2' },
  { index: 4, name: 'S3', threshold: 2500, title: 'Sênior 3 · Pro' },
  { index: 5, name: 'S4', threshold: 5000, title: 'Sênior 4 · Elite' },
  { index: 6, name: 'KZ', threshold: 10000, title: 'KZ · Lenda' },
];

export function levelForXp(xp: number): Level {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.threshold) current = lvl;
    else break;
  }
  return current;
}

export function nextLevel(xp: number): Level | null {
  const current = levelForXp(xp);
  return LEVELS.find((l) => l.index === current.index + 1) ?? null;
}

export function xpProgressInLevel(xp: number): { earned: number; needed: number; ratio: number } {
  const cur = levelForXp(xp);
  const nxt = nextLevel(xp);
  if (!nxt) {
    return { earned: xp - cur.threshold, needed: 0, ratio: 1 };
  }
  const earned = xp - cur.threshold;
  const needed = nxt.threshold - cur.threshold;
  return { earned, needed, ratio: Math.min(1, earned / needed) };
}

// ===== Detecção de marcos pós-sessão =====

export type Milestone =
  | { kind: 'pb'; deltaMs: number; previousMs: number | null; lapId: string; durationMs: number }
  | { kind: 'sub_threshold'; thresholdMs: number; durationMs: number }
  | { kind: 'streak'; count: number }
  | { kind: 'level_up'; from: Level; to: Level; xpEarned: number };

/**
 * Após salvar uma sessão, processa: calcula XP ganho, detecta PB/sub-threshold/
 * streak. Retorna lista de marcos pra UI celebrar.
 *
 * Não atualiza storage — caller faz isso depois (ver applyMilestones).
 */
export type ProcessOptions = {
  trackId: string | null;
  layoutId: string | null;
  sessionId: string;
  bestLapMs: number;
  bestLapId: string;
  /** PB anterior (do mesmo track+layout). Null se for a 1ª sessão dessa pista. */
  previousPbMs: number | null;
  /** Quantas sessões consecutivas anteriores também bateram PB nessa pista. */
  previousStreakCount: number;
  /** XP atual antes de aplicar a sessão. */
  currentXp: number;
};

export type ProcessResult = {
  milestones: Milestone[];
  xpGained: number;
  newXp: number;
  isNewPb: boolean;
  /** Lista de thresholds redondos (em segundos) cruzados pela primeira vez nessa sessão.
   *  Ex: se PB anterior era 50.8s e agora é 49.7s, cruzou "sub-50s". */
  subThresholdsHit: number[];
};

/** Thresholds redondos comuns em kart (em segundos). Inteiros descendentes. */
const SUB_THRESHOLDS_S = [60, 55, 50, 48, 46, 45, 44, 43, 42, 41, 40, 38, 35];

export function processSessionMilestones(opts: ProcessOptions): ProcessResult {
  const milestones: Milestone[] = [];
  let xpGained = 50; // base por sessão concluída

  const isNewPb =
    opts.previousPbMs == null || opts.bestLapMs < opts.previousPbMs;
  let subThresholdsHit: number[] = [];

  if (isNewPb) {
    xpGained += 250;
    milestones.push({
      kind: 'pb',
      deltaMs: opts.previousPbMs != null ? opts.bestLapMs - opts.previousPbMs : 0,
      previousMs: opts.previousPbMs,
      lapId: opts.bestLapId,
      durationMs: opts.bestLapMs,
    });

    // Sub-threshold: PB cruzou marca redonda pela 1ª vez
    const prevSec = (opts.previousPbMs ?? Infinity) / 1000;
    const curSec = opts.bestLapMs / 1000;
    for (const t of SUB_THRESHOLDS_S) {
      if (prevSec >= t && curSec < t) {
        subThresholdsHit.push(t);
        xpGained += 500;
        milestones.push({
          kind: 'sub_threshold',
          thresholdMs: t * 1000,
          durationMs: opts.bestLapMs,
        });
      }
    }

    // Streak: se já tinha sequência prévia E acabou de bater PB de novo
    const newStreak = opts.previousStreakCount + 1;
    if (newStreak >= 2) {
      const bonus = 50 * (newStreak - 1);
      xpGained += bonus;
      if (newStreak >= 3) {
        milestones.push({ kind: 'streak', count: newStreak });
      }
    }
  }

  const newXp = opts.currentXp + xpGained;
  const fromLevel = levelForXp(opts.currentXp);
  const toLevel = levelForXp(newXp);
  if (toLevel.index > fromLevel.index) {
    milestones.push({ kind: 'level_up', from: fromLevel, to: toLevel, xpEarned: xpGained });
  }

  return { milestones, xpGained, newXp, isNewPb, subThresholdsHit };
}

/**
 * Conta sessões consecutivas com PB pra mesma combinação track+layout, olhando
 * pra trás a partir da MAIS RECENTE (exclusiva da sessão atual).
 */
export async function computePreviousStreak(
  trackId: string | null,
  layoutId: string | null,
  excludeSessionId: string
): Promise<number> {
  if (!trackId) return 0;
  // Busca todas as sessões da pista em ordem cronológica DESC
  const sessions = await listSessions();
  const relevant = sessions
    .filter((s) => s.trackId === trackId && (layoutId ? s.layoutId === layoutId : true))
    .filter((s) => s.id !== excludeSessionId);

  let streak = 0;
  let lastBest = Infinity;
  // relevant tá DESC (mais nova primeiro). Pra "streak crescente", a gente
  // precisa caminhar do MAIS antigo pro MAIS novo, comparando best a best.
  const inOrder = relevant.slice().reverse();
  for (const s of inOrder) {
    const laps = await getLapsForSession(s.id);
    const best = laps.reduce(
      (b, l) => (l.durationMs < b ? l.durationMs : b),
      Infinity
    );
    if (!Number.isFinite(best)) continue;
    if (best < lastBest) {
      streak += 1;
    } else {
      streak = 0;
    }
    lastBest = best;
  }
  return streak;
}

// =========================
// Achievements
// =========================

export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string; // emoji ou caractere visual
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
};

/**
 * Catálogo de conquistas. Adicionar novas aqui automaticamente entra no
 * sistema — `processAchievementsAfterSession` checa cada uma.
 */
export const ACHIEVEMENTS: Achievement[] = [
  // Marcos de iniciante
  { id: 'first_session', title: 'Primeira corrida', description: 'Concluiu a primeira sessão', icon: '🏁', rarity: 'common' },
  { id: 'first_pb', title: 'Primeira PB', description: 'Bateu sua primeira melhor volta pessoal', icon: '⭐', rarity: 'common' },

  // Sub-tempos absolutos (qualquer pista)
  { id: 'sub_60_first', title: 'Sub-60s', description: 'Primeira volta abaixo de 60 segundos', icon: '⚡', rarity: 'common' },
  { id: 'sub_55_first', title: 'Sub-55s', description: 'Primeira volta abaixo de 55 segundos', icon: '⚡', rarity: 'rare' },
  { id: 'sub_50_first', title: 'Sub-50s', description: 'Primeira volta abaixo de 50 segundos', icon: '🔥', rarity: 'rare' },
  { id: 'sub_48_first', title: 'Sub-48s', description: 'Primeira volta abaixo de 48 segundos', icon: '🔥', rarity: 'epic' },
  { id: 'sub_45_first', title: 'Sub-45s', description: 'Primeira volta abaixo de 45 segundos', icon: '💎', rarity: 'epic' },
  { id: 'sub_42_first', title: 'Sub-42s', description: 'Primeira volta abaixo de 42 segundos', icon: '👑', rarity: 'legendary' },
  { id: 'sub_40_first', title: 'Sub-40s', description: 'Primeira volta abaixo de 40 segundos', icon: '👑', rarity: 'legendary' },

  // Streaks
  { id: 'streak_3', title: 'Trinca', description: '3 sessões seguidas batendo PB', icon: '🔥', rarity: 'rare' },
  { id: 'streak_5', title: 'Cinco em sequência', description: '5 sessões seguidas batendo PB', icon: '🔥', rarity: 'epic' },

  // Volume
  { id: 'sessions_10', title: 'Dedicado', description: '10 sessões concluídas', icon: '📈', rarity: 'common' },
  { id: 'sessions_50', title: 'Veterano', description: '50 sessões concluídas', icon: '📈', rarity: 'rare' },
  { id: 'laps_100', title: 'Centena', description: '100 voltas registradas', icon: '🎯', rarity: 'rare' },
  { id: 'laps_500', title: 'Milhar', description: '500 voltas registradas', icon: '🎯', rarity: 'epic' },

  // Foco em uma pista
  { id: 'same_track_5', title: 'Em casa', description: '5 sessões na mesma pista', icon: '🏠', rarity: 'common' },
  { id: 'same_track_20', title: 'Especialista', description: '20 sessões na mesma pista', icon: '🏆', rarity: 'rare' },

  // Níveis
  { id: 'level_s1', title: 'Sênior 1', description: 'Subiu pro nível S1', icon: '🥉', rarity: 'common' },
  { id: 'level_s2', title: 'Sênior 2', description: 'Subiu pro nível S2', icon: '🥈', rarity: 'rare' },
  { id: 'level_s3', title: 'Sênior 3 · Pro', description: 'Subiu pro nível Pro', icon: '🥇', rarity: 'epic' },
  { id: 'level_s4', title: 'Sênior 4 · Elite', description: 'Subiu pro nível Elite', icon: '💎', rarity: 'legendary' },
  { id: 'level_kz', title: 'KZ · Lenda', description: 'Atingiu o nível máximo', icon: '👑', rarity: 'legendary' },
];

export function getAchievement(id: string): Achievement | null {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? null;
}

/**
 * Após uma sessão ser salva (com nova PB ou não), checa todas as conquistas e
 * desbloqueia as que se tornaram verdadeiras. Idempotente — chama várias vezes
 * sem problema (achievements_unlocked tem PRIMARY KEY).
 *
 * Retorna a lista de conquistas RECÉM desbloqueadas pra UI celebrar.
 */
export type ProcessAchievementsArgs = {
  sessionId: string;
  trackId: string | null;
  bestLapMs: number;
  isNewPb: boolean;
  newStreak: number;
  totalLapsAfter: number;
  totalSessionsAfter: number;
  sessionsOnSameTrack: number;
  newLevel: Level;
  previousLevel: Level;
};

export async function processAchievementsAfterSession(
  args: ProcessAchievementsArgs
): Promise<Achievement[]> {
  const newlyUnlocked: Achievement[] = [];

  const tryUnlock = async (id: string) => {
    if (await isAchievementUnlocked(id)) return;
    const achievement = getAchievement(id);
    if (!achievement) return;
    await unlockAchievement(id, args.sessionId);
    newlyUnlocked.push(achievement);
  };

  // Marcos de iniciante
  if (args.totalSessionsAfter >= 1) await tryUnlock('first_session');
  if (args.isNewPb) await tryUnlock('first_pb');

  // Sub-tempos absolutos — desbloqueiam permanentemente quando a melhor volta
  // de TODAS as sessões cai abaixo do threshold. Como bestLapMs é dessa
  // sessão, basta checar; se outra sessão já tinha batido, o achievement
  // já tá unlocked.
  const subThresholdMap: Array<[number, string]> = [
    [60, 'sub_60_first'],
    [55, 'sub_55_first'],
    [50, 'sub_50_first'],
    [48, 'sub_48_first'],
    [45, 'sub_45_first'],
    [42, 'sub_42_first'],
    [40, 'sub_40_first'],
  ];
  for (const [secs, id] of subThresholdMap) {
    if (args.bestLapMs < secs * 1000) await tryUnlock(id);
  }

  // Streaks
  if (args.newStreak >= 3) await tryUnlock('streak_3');
  if (args.newStreak >= 5) await tryUnlock('streak_5');

  // Volume
  if (args.totalSessionsAfter >= 10) await tryUnlock('sessions_10');
  if (args.totalSessionsAfter >= 50) await tryUnlock('sessions_50');
  if (args.totalLapsAfter >= 100) await tryUnlock('laps_100');
  if (args.totalLapsAfter >= 500) await tryUnlock('laps_500');

  // Mesma pista
  if (args.sessionsOnSameTrack >= 5) await tryUnlock('same_track_5');
  if (args.sessionsOnSameTrack >= 20) await tryUnlock('same_track_20');

  // Níveis (só desbloqueia se acabou de subir)
  if (args.newLevel.index > args.previousLevel.index) {
    const levelAchievementMap: Record<string, string> = {
      S1: 'level_s1',
      S2: 'level_s2',
      S3: 'level_s3',
      S4: 'level_s4',
      KZ: 'level_kz',
    };
    const id = levelAchievementMap[args.newLevel.name];
    if (id) await tryUnlock(id);
  }

  return newlyUnlocked;
}

/** Helper: conta voltas e sessões pra uma pista específica + total. */
export async function getStatsForAchievements(
  trackId: string | null
): Promise<{
  totalLaps: number;
  totalSessions: number;
  sessionsOnTrack: number;
}> {
  const sessions = await listSessions();
  const totalSessions = sessions.length;
  const sessionsOnTrack = trackId
    ? sessions.filter((s) => s.trackId === trackId).length
    : 0;
  let totalLaps = 0;
  for (const s of sessions) {
    const laps = await getLapsForSession(s.id);
    totalLaps += laps.length;
  }
  return { totalLaps, totalSessions, sessionsOnTrack };
}
