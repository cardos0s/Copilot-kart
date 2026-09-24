/**
 * Efeitos depois de salvar uma sessão: XP, PB, conquistas, desafios, insight
 * de IA e leaderboard. Extraído de `app/recording.tsx` sem mudar o caminho do
 * "Encerrar". Numa sessão recuperada (`fromRecovery`), a IA e o leaderboard
 * ficam de fora: a IA gastaria a chave do usuário fora de contexto.
 *
 * As dependências são injetadas porque quase todas tocam o SQLite ou a rede.
 */
import type { LapRecord } from '../lib/analysis';
import { msToKmh, peakSpeedMs } from '../lib/speed';
import type { Session } from '../storage/db';

type Db = typeof import('../storage/db');
type Gamification = typeof import('../lib/gamification');

export type PostSaveDeps = {
  getCurrentPb: Db['getCurrentPb'];
  savePbRecord: Db['savePbRecord'];
  getGamificationState: Db['getGamificationState'];
  saveGamificationState: Db['saveGamificationState'];
  computePreviousStreak: Gamification['computePreviousStreak'];
  processSessionMilestones: Gamification['processSessionMilestones'];
  getStatsForAchievements: Gamification['getStatsForAchievements'];
  levelForXp: Gamification['levelForXp'];
  processAchievementsAfterSession: Gamification['processAchievementsAfterSession'];
  setPendingCelebration: typeof import('../lib/celebrationQueue')['setPendingCelebration'];
  refreshTodayChallenges: typeof import('../lib/challenges')['refreshTodayChallenges'];
  getProfile: typeof import('../storage/profile')['getProfile'];
  requestQuickInsight: typeof import('../lib/aiAnalysis')['requestQuickInsight'];
  pushCoachInsight: typeof import('../lib/coachInsights')['pushCoachInsight'];
  ensurePilot: typeof import('../lib/liveSession')['ensurePilot'];
  publishLeaderboardEntry: typeof import('../lib/leaderboard')['publishLeaderboardEntry'];
};

export type PostSaveOptions = { fromRecovery: boolean };

export type PostSaveResult = {
  /** IA e leaderboard, que rodam soltos e não seguram a navegação. */
  background: Promise<void>;
};

export async function runPostSaveEffects(
  session: Pick<Session, 'id' | 'trackName' | 'trackId' | 'layoutId'>,
  laps: LapRecord[],
  opts: PostSaveOptions,
  deps: PostSaveDeps
): Promise<PostSaveResult> {
  let background: Promise<void> = Promise.resolve();
  if (laps.length === 0) return { background };

  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);

  // ===== Gamification: processar milestones (PB, XP, level up) =====
  // Detecta se essa é nova PB, sub-threshold, streak, etc. Atualiza
  // estado de XP e cria PB record. Modal de celebração abre quando
  // session/[id] montar e ler a queue (não bloqueia navegação).
  try {
    const trackIdForGame = session.trackId;
    const layoutIdForGame = session.layoutId;
    const previousPb = trackIdForGame
      ? await deps.getCurrentPb(trackIdForGame, layoutIdForGame)
      : null;
    const previousStreak = await deps.computePreviousStreak(
      trackIdForGame,
      layoutIdForGame,
      session.id
    );
    const gameState = await deps.getGamificationState();

    const result = deps.processSessionMilestones({
      trackId: trackIdForGame,
      layoutId: layoutIdForGame,
      sessionId: session.id,
      bestLapMs: best.durationMs,
      bestLapId: best.id,
      previousPbMs: previousPb?.durationMs ?? null,
      previousStreakCount: previousStreak,
      currentXp: gameState.xp,
    });

    await deps.saveGamificationState({
      ...gameState,
      xp: result.newXp,
      level: gameState.level, // levelForXp recalcula na leitura
      updatedAt: Date.now(),
    });
    if (result.isNewPb && trackIdForGame) {
      await deps.savePbRecord({
        id: `pb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trackId: trackIdForGame,
        layoutId: layoutIdForGame,
        sessionId: session.id,
        lapId: best.id,
        durationMs: best.durationMs,
        celebrated: false,
        createdAt: Date.now(),
      });
    }
    // Achievements — processa só DEPOIS de salvar laps e ter
    // contagens corretas pra "10 sessões", "100 voltas", etc.
    const stats = await deps.getStatsForAchievements(trackIdForGame);
    const previousLevel = deps.levelForXp(gameState.xp);
    const newLevel = deps.levelForXp(result.newXp);
    const newStreak = result.isNewPb ? previousStreak + 1 : 0;
    const newAchievements = await deps.processAchievementsAfterSession({
      sessionId: session.id,
      trackId: trackIdForGame,
      bestLapMs: best.durationMs,
      isNewPb: result.isNewPb,
      newStreak,
      totalLapsAfter: stats.totalLaps,
      totalSessionsAfter: stats.totalSessions,
      sessionsOnSameTrack: stats.sessionsOnTrack,
      newLevel,
      previousLevel,
    });

    if (result.milestones.length > 0 || newAchievements.length > 0) {
      deps.setPendingCelebration({
        sessionId: session.id,
        milestones: result.milestones,
        xpGained: result.xpGained,
        newXp: result.newXp,
        achievements: newAchievements,
      });
    }

    // Refresh dos desafios diários — atualiza progresso de "X voltas",
    // "sub-50s", etc baseado na sessão recém salva.
    await deps.refreshTodayChallenges();

    // ===== Background (NÃO bloqueia a navegação) =====
    // IA (LLM) e publish no leaderboard são chamadas de REDE e podem
    // demorar/travar. Rodam soltos: o insight aparece no Coach flutuante
    // quando chegar; o leaderboard é best-effort. Sessão recuperada não
    // chama nenhum dos dois.
    if (!opts.fromRecovery) {
      const isNewPb = result.isNewPb;
      const xpGained = result.xpGained;
      background = (async () => {
        try {
          const peakKmh = msToKmh(peakSpeedMs(best.samples));
          const profileForInsight = await deps.getProfile().catch(() => null);
          const aiInsight = await deps.requestQuickInsight({
            trackName: session.trackName,
            bestLapMs: best.durationMs,
            previousPbMs: previousPb?.durationMs ?? null,
            lapCount: laps.length,
            peakKmh,
            pilotName: profileForInsight?.name ?? null,
          });

          if (aiInsight) {
            deps.pushCoachInsight({
              title: aiInsight.title,
              body: aiInsight.body,
              metric: aiInsight.metric,
              sessionId: session.id,
            });
          } else if (isNewPb) {
            // Fallback sem IA: mensagem genérica de PB
            deps.pushCoachInsight({
              title: 'Nova melhor volta',
              body: `Você bateu ${(best.durationMs / 1000).toFixed(3)}s. Tenta repetir nas próximas 3 voltas antes de empurrar mais.`,
              metric: `${(best.durationMs / 1000).toFixed(3)}s`,
              sessionId: session.id,
            });
          } else if (xpGained >= 50) {
            deps.pushCoachInsight({
              title: 'Sessão registrada',
              body: `Volta consistente. Pra próxima, foca em 1 curva específica — mais ganho que tentar a volta inteira.`,
              sessionId: session.id,
            });
          }
        } catch {
          // IA é opcional — engole qualquer erro.
        }

        // Publica PB no leaderboard público (Supabase) — opcional, falha
        // silenciosa se Supabase não configurado. Só publica novas PBs.
        if (isNewPb && trackIdForGame) {
          try {
            const pilotId = await deps.ensurePilot();
            if (pilotId) {
              await deps.publishLeaderboardEntry({
                pilotId,
                trackId: trackIdForGame,
                layoutId: layoutIdForGame,
                bestLapMs: best.durationMs,
                sessionId: session.id,
              });
            }
          } catch {
            // Sem Supabase / sem internet / RLS reject — engole.
          }
        }
      })();
    }
  } catch {
    // Gamification é "nice to have" — qualquer erro engole e não
    // bloqueia o fluxo principal de salvar a sessão.
  }

  return { background };
}
