/**
 * Agregados sem bruto (TF-13, TF-16, T34): `recap`, `gamification` e `challenges`
 * só precisam da duração das voltas e passam a ler pelo `loadLapSummaries`, sem
 * tocar nas séries. Os valores são os da regra de antes, para 3 sessões conhecidas.
 *
 * O `db.ts` importa o expo-sqlite (nativo): entra um stub no `require.cache` com
 * um repositório falso (sql.js) de 3 sessões. O `getLapsForSession` do stub lança:
 * nenhum dos três pode ler a volta inteira.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DailyChallenge, Session } from '../src/storage/db';
import { openV5Database } from './helpers/v5Database';

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfToday = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

function session(id: string, startedAt: number): Session {
  return {
    id, trackName: 'Kartódromo X', kart: null, notes: null, startedAt, weather: 'dry',
    trackId: 't1', mode: 'race', layoutId: null, kartSetupId: null, recovered: false,
  };
}

// A: hoje; B: há 2 dias (mesma semana); C: há 10 dias (semana anterior). Cada uma melhora a anterior.
const SESSIONS = [session('A', startOfToday + 1), session('B', startOfToday - 2 * DAY_MS), session('C', startOfToday - 10 * DAY_MS)];
const LAPS_MS: Record<string, number[]> = { A: [41_000, 39_500, 40_200], B: [40_800, 42_000], C: [41_100, 41_500] };

const dbReady = (async () => {
  const { conn } = await openV5Database();
  for (const s of SESSIONS) {
    await conn.runAsync('INSERT INTO sessions (id, track_name, started_at, track_id) VALUES (?, ?, ?, ?)', s.id, s.trackName, s.startedAt, s.trackId);
    for (const [i, ms] of LAPS_MS[s.id].entries()) {
      // Sem janela e com JSON inválido: quem lesse o bruto quebraria.
      await conn.runAsync(
        `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json) VALUES (?, ?, ?, ?, 'não é JSON')`,
        `${s.id}_lap_${i + 1}`,
        s.id,
        s.startedAt + i * 60_000,
        ms
      );
    }
  }
  return conn;
})();

const saved: DailyChallenge[] = [];
const challenge = (templateId: string, target: number): DailyChallenge => ({
  id: `c_${templateId}`, date: '', templateId, target, progress: 0, completed: false, completedAt: null,
});

const dbPath = require.resolve('../src/storage/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    appSqlConn: () => dbReady,
    listSessions: async () => SESSIONS,
    getLapsForSession: async () => {
      throw new Error('getLapsForSession lê o bruto');
    },
    listUnlockedAchievements: async () => [],
    listDailyChallenges: async () => [challenge('laps_count', 3), challenge('sub_50', 50_000), challenge('consistency', 5)],
    saveDailyChallenge: async (c: DailyChallenge) => {
      saved.push(c);
    },
  },
} as NodeJS.Module;
const { buildWeeklyRecap } = require('../src/lib/recap') as typeof import('../src/lib/recap');
const { computePreviousStreak, getStatsForAchievements } =
  require('../src/lib/gamification') as typeof import('../src/lib/gamification');
const { refreshTodayChallenges } = require('../src/lib/challenges') as typeof import('../src/lib/challenges');

test('agregados (estático): recap, gamification e challenges não chamam getLapsForSession(', () => {
  for (const f of ['recap.ts', 'gamification.ts', 'challenges.ts']) {
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', f), 'utf8');
    assert.equal(/getLapsForSession\(/.test(src), false, f);
    assert.match(src, /loadLapSummaries\(/, f);
  }
});

test('recap: 2 sessões na semana com 5 voltas, melhor de 39.500 ms, 1.600 ms melhor que a semana anterior', async () => {
  const recap = await buildWeeklyRecap();
  assert.ok(recap);
  assert.equal(recap.sessionsCount, 2);
  assert.equal(recap.lapsCount, 5);
  assert.equal(recap.totalDistanceM, 5 * 600);
  assert.equal(recap.bestLapMs, 39_500);
  assert.equal(recap.bestTrackName, 'Kartódromo X');
  assert.equal(recap.bestLapDelta, 39_500 - 41_100);
});

test('gamification: a sequência de PB e a contagem de voltas saem das durações', async () => {
  // C (41.100) → B (40.800) → A (39.500): cada uma melhora a anterior.
  assert.equal(await computePreviousStreak('t1', null, 'nenhuma'), 3);
  assert.equal(await computePreviousStreak('t1', null, 'A'), 2);
  assert.deepEqual(await getStatsForAchievements('t1'), { totalLaps: 7, totalSessions: 3, sessionsOnTrack: 3 });
});

test('challenges: o progresso do dia sai das voltas de hoje (3 voltas, sub-50, 3 dentro de 1 s da média)', async () => {
  saved.length = 0;
  await refreshTodayChallenges();
  const byTemplate = Object.fromEntries(saved.map((c) => [c.templateId, { progress: c.progress, completed: c.completed }]));
  // O sub-50 marca progresso 1 contra o alvo 50.000 e nunca completa: é a regra de antes, mantida aqui.
  assert.deepEqual(byTemplate, {
    laps_count: { progress: 3, completed: true },
    sub_50: { progress: 1, completed: false },
    consistency: { progress: 3, completed: false },
  });
});
