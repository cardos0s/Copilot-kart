/**
 * Composição das peças puras da gravação com o armazenamento real (SQLite).
 * As telas e o hook importam daqui; os testes montam as mesmas peças com
 * armazenamento falso.
 */
import * as Location from 'expo-location';
import { requestQuickInsight } from '../lib/aiAnalysis';
import { setPendingCelebration } from '../lib/celebrationQueue';
import { refreshTodayChallenges } from '../lib/challenges';
import { pushCoachInsight } from '../lib/coachInsights';
import {
  computePreviousStreak,
  getStatsForAchievements,
  levelForXp,
  processAchievementsAfterSession,
  processSessionMilestones,
} from '../lib/gamification';
import { publishLeaderboardEntry } from '../lib/leaderboard';
import { ensurePilot } from '../lib/liveSession';
import { once } from '../lib/once';
import {
  getCurrentPb,
  getGamificationState,
  saveGamificationState,
  savePbRecord,
} from '../storage/db';
import { sqliteJournalStore } from '../storage/journalStore';
import { getProfile } from '../storage/profile';
import { sqliteLayoutRepo, sqliteSessionRepo } from '../storage/sessionRepo';
import { runBootCheck, type BootCheckDeps, type BootResult } from './bootCheck';
import { RecordingJournal } from './journal';
import { BG_TASK } from './locationTask';
import type { PostSaveDeps } from './postSave';
import type { RecoveryDeps } from './recovery';

/** Diário único do processo: há no máximo uma gravação por vez. */
export const journal = new RecordingJournal(sqliteJournalStore);

/** XP, PB, conquistas, desafios, IA e leaderboard, com as funções reais. */
export const postSaveDeps: PostSaveDeps = {
  getCurrentPb,
  savePbRecord,
  getGamificationState,
  saveGamificationState,
  computePreviousStreak,
  processSessionMilestones,
  getStatsForAchievements,
  levelForXp,
  processAchievementsAfterSession,
  setPendingCelebration,
  refreshTodayChallenges,
  getProfile,
  requestQuickInsight,
  pushCoachInsight,
  ensurePilot,
  publishLeaderboardEntry,
};

/** Tarefa de localização real e o armazenamento em SQLite. */
export const bootCheckDeps: BootCheckDeps = {
  store: sqliteJournalStore,
  isLocationTaskRunning: () => Location.hasStartedLocationUpdatesAsync(BG_TASK),
  stopLocationUpdates: () => Location.stopLocationUpdatesAsync(BG_TASK),
  sessionExists: (id) => sqliteSessionRepo.sessionExists(id),
};

/**
 * Checagem da abertura, uma vez por processo: para a tarefa de localização
 * órfã e descobre a gravação interrompida. O layout raiz espera o resultado
 * antes de sair da splash.
 */
export const bootCheck = once((): Promise<BootResult> => runBootCheck(bootCheckDeps));

/** "Recuperar" e "Descartar" sobre o SQLite. */
export const recoveryDeps: RecoveryDeps = {
  store: sqliteJournalStore,
  sessions: sqliteSessionRepo,
  layouts: sqliteLayoutRepo,
  now: Date.now,
};
