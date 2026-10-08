/**
 * Efeitos pós-salvamento: REC-03 AC 3 (sessão recuperada ganha XP, PB,
 * conquistas e desafios, sem IA nem leaderboard) e o comportamento atual do
 * "Encerrar" preservado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LapRecord } from '../src/lib/analysis';
import { runPostSaveEffects, type PostSaveDeps } from '../src/recording/postSave';

const SESSION = {
  id: 'session_rec_1',
  trackName: 'Kartódromo',
  trackId: 'track_1' as string | null,
  layoutId: 'layout_1' as string | null,
};

const LAPS: LapRecord[] = [
  { id: 'session_rec_1_lap_1', sessionId: 'session_rec_1', gps: [], startedAt: 0, durationMs: 56_000 },
  { id: 'session_rec_1_lap_2', sessionId: 'session_rec_1', gps: [], startedAt: 56_000, durationMs: 54_321 },
  { id: 'session_rec_1_lap_3', sessionId: 'session_rec_1', gps: [], startedAt: 110_321, durationMs: 55_000 },
];

type Call = { name: string; args: unknown[] };

function fakeDeps(opts: { isNewPb?: boolean; failGamification?: boolean } = {}) {
  const calls: Call[] = [];
  const rec =
    <T>(name: string, ret: (...a: any[]) => T) =>
    (...args: any[]) => {
      calls.push({ name, args });
      return ret(...args);
    };
  const deps = {
    getCurrentPb: rec('getCurrentPb', async () => null),
    savePbRecord: rec('savePbRecord', async () => {}),
    getGamificationState: rec('getGamificationState', async () => {
      if (opts.failGamification) throw new Error('SQLITE_BUSY');
      return { xp: 100, level: 1, seasonStartedAt: 0, updatedAt: 0 };
    }),
    saveGamificationState: rec('saveGamificationState', async () => {}),
    computePreviousStreak: rec('computePreviousStreak', async () => 2),
    processSessionMilestones: rec('processSessionMilestones', () => ({
      milestones: opts.isNewPb === false ? [] : [{ kind: 'pb' }],
      xpGained: 300,
      newXp: 400,
      isNewPb: opts.isNewPb ?? true,
      subThresholdsHit: [],
    })),
    getStatsForAchievements: rec('getStatsForAchievements', async () => ({
      totalLaps: 10,
      totalSessions: 3,
      sessionsOnTrack: 2,
    })),
    levelForXp: rec('levelForXp', (xp: number) => ({ level: xp >= 400 ? 2 : 1 })),
    processAchievementsAfterSession: rec('processAchievementsAfterSession', async () => []),
    setPendingCelebration: rec('setPendingCelebration', () => {}),
    refreshTodayChallenges: rec('refreshTodayChallenges', async () => {}),
    getProfile: rec('getProfile', async () => ({ name: 'Julia' })),
    requestQuickInsight: rec('requestQuickInsight', async () => ({ title: 'Freia depois', body: 'Na curva 3.' })),
    pushCoachInsight: rec('pushCoachInsight', () => 'ci_1'),
    ensurePilot: rec('ensurePilot', async () => 'pilot_1'),
    publishLeaderboardEntry: rec('publishLeaderboardEntry', async () => {}),
  } as unknown as PostSaveDeps;
  const called = (name: string) => calls.filter((c) => c.name === name);
  return { deps, calls, called };
}

const GAME = [
  'getCurrentPb',
  'computePreviousStreak',
  'getGamificationState',
  'processSessionMilestones',
  'saveGamificationState',
  'savePbRecord',
  'getStatsForAchievements',
  'processAchievementsAfterSession',
  'setPendingCelebration',
  'refreshTodayChallenges',
];

test('runPostSaveEffects (fromRecovery: false): gamificação, PB, conquistas, desafios, IA e leaderboard', async () => {
  const { deps, called } = fakeDeps({ isNewPb: true });
  const { background } = await runPostSaveEffects(SESSION, LAPS, { fromRecovery: false }, deps);
  await background;

  for (const name of GAME) assert.equal(called(name).length, 1, name);

  // A melhor volta é a mais rápida.
  const pb = called('savePbRecord')[0].args[0] as any;
  assert.equal(pb.lapId, 'session_rec_1_lap_2');
  assert.equal(pb.durationMs, 54_321);
  assert.equal(pb.trackId, 'track_1');
  assert.equal(pb.layoutId, 'layout_1');
  assert.equal(pb.sessionId, 'session_rec_1');
  assert.equal((called('saveGamificationState')[0].args[0] as any).xp, 400);
  const ach = called('processAchievementsAfterSession')[0].args[0] as any;
  assert.equal(ach.newStreak, 3);
  assert.equal(ach.totalSessionsAfter, 3);

  const insight = called('requestQuickInsight')[0].args[0] as any;
  assert.equal(insight.trackName, 'Kartódromo');
  assert.equal(insight.bestLapMs, 54_321);
  assert.equal(insight.lapCount, 3);
  assert.equal(insight.pilotName, 'Julia');
  assert.deepEqual(called('pushCoachInsight')[0].args[0], {
    title: 'Freia depois',
    body: 'Na curva 3.',
    metric: undefined,
    sessionId: 'session_rec_1',
  });
  assert.deepEqual(called('publishLeaderboardEntry')[0].args[0], {
    pilotId: 'pilot_1',
    trackId: 'track_1',
    layoutId: 'layout_1',
    bestLapMs: 54_321,
    sessionId: 'session_rec_1',
  });
});

test('runPostSaveEffects: o leaderboard só recebe PB nova com trackId', async () => {
  const semPb = fakeDeps({ isNewPb: false });
  await (await runPostSaveEffects(SESSION, LAPS, { fromRecovery: false }, semPb.deps)).background;
  assert.equal(semPb.called('requestQuickInsight').length, 1);
  assert.equal(semPb.called('publishLeaderboardEntry').length, 0);

  const semPista = fakeDeps({ isNewPb: true });
  const session = { ...SESSION, trackId: null };
  await (await runPostSaveEffects(session, LAPS, { fromRecovery: false }, semPista.deps)).background;
  assert.equal(semPista.called('requestQuickInsight').length, 1);
  assert.equal(semPista.called('publishLeaderboardEntry').length, 0);
});

test('runPostSaveEffects (fromRecovery: true): gamificação, PB, conquistas e desafios, sem IA nem leaderboard', async () => {
  const { deps, called } = fakeDeps({ isNewPb: true });
  const { background } = await runPostSaveEffects(SESSION, LAPS, { fromRecovery: true }, deps);
  await background;

  for (const name of GAME) assert.equal(called(name).length, 1, name);
  assert.equal(called('getProfile').length, 0);
  assert.equal(called('requestQuickInsight').length, 0);
  assert.equal(called('pushCoachInsight').length, 0);
  assert.equal(called('ensurePilot').length, 0);
  assert.equal(called('publishLeaderboardEntry').length, 0);
});

test('runPostSaveEffects: erro na gamificação é engolido e a função retorna', async () => {
  const { deps, called } = fakeDeps({ failGamification: true });
  const r = await runPostSaveEffects(SESSION, LAPS, { fromRecovery: false }, deps);
  await r.background;

  assert.equal(called('getGamificationState').length, 1);
  // Como hoje: o resto do bloco, IA e leaderboard incluídos, não roda.
  assert.equal(called('saveGamificationState').length, 0);
  assert.equal(called('refreshTodayChallenges').length, 0);
  assert.equal(called('requestQuickInsight').length, 0);
  assert.equal(called('publishLeaderboardEntry').length, 0);
});

// --- TMP-11 AC 3: o prompt do coach recebe o pico honesto ---

/** Volta com `n` pontos a `kmh`, com a precisão dada. */
function lapAt(id: string, durationMs: number, kmh: number, accuracy: number, n = 500): LapRecord {
  const samples = Array.from({ length: n }, (_, i) => ({
    kind: 'gps' as const,
    source: 'PHONE' as const,
    fix: 'unknown' as const,
    t: i * 100,
    lat: -14.86 + i * 1e-6,
    lng: -40.84,
    speed: kmh / 3.6,
    accuracy,
  }));
  return { id, sessionId: 'session_rec_1', gps: samples, startedAt: 0, durationMs };
}

test('runPostSaveEffects: volta sem nenhum ponto de até 10 m manda peakKmh: null ao coach', async () => {
  const { deps, called } = fakeDeps();
  const laps = [lapAt('session_rec_1_lap_1', 54_000, 80, 12), lapAt('session_rec_1_lap_2', 55_000, 80, 4)];
  const { background } = await runPostSaveEffects(SESSION, laps, { fromRecovery: false }, deps);
  await background;
  const insight = called('requestQuickInsight')[0].args[0] as any;
  assert.equal(insight.bestLapMs, 54_000);
  assert.equal(insight.peakKmh, null);
});

test('runPostSaveEffects: um ponto isolado a 150 km/h não passa para o coach (pico < 81 km/h)', async () => {
  const { deps, called } = fakeDeps();
  const best = lapAt('session_rec_1_lap_1', 54_000, 80, 4);
  best.gps[250] = { ...best.gps[250], speed: 150 / 3.6 };
  const { background } = await runPostSaveEffects(SESSION, [best], { fromRecovery: false }, deps);
  await background;
  const insight = called('requestQuickInsight')[0].args[0] as any;
  assert.equal(typeof insight.peakKmh, 'number');
  assert.ok(insight.peakKmh < 81, `pico ${insight.peakKmh} km/h`);
  assert.ok(insight.peakKmh > 79, `pico ${insight.peakKmh} km/h`);
});
