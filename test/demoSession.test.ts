/**
 * Sessão demo em frames (T25; edge "sessão demo" da spec, TF-14) em SQL real
 * (sql.js): o `seedDemoSession` grava o replay como a série GPS da sessão e as
 * voltas como janelas, sem JSON de amostra. As voltas, durações e `started_at`
 * são as de antes: as do `expected.json`, capturado pelo seed antigo com o mesmo
 * relógio congelado.
 *
 * O `db.ts` importa o expo-sqlite (nativo): entra um stub no `require.cache`
 * com a criação de sessão e a conexão sobre o sql.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEMO_LAP } from '../src/data/demoLap';
import type { Session } from '../src/storage/db';
import { loadLaps } from '../src/storage/lapRepo';
import { T0 } from './golden/sessions';
import { openV5Database, rowsOf } from './helpers/v5Database';

/** O mesmo relógio congelado do harness do golden. */
const DEMO_NOW = T0 + 20_000_000;

type LapSummary = { id: string; startedAt: number; durationMs: number; samples: { len: number } };
const expected = JSON.parse(readFileSync(join(__dirname, 'golden', 'expected.json'), 'utf8')) as {
  lapRecords: { demo: LapSummary[] };
};

const dbReady = openV5Database();
const dbPath = require.resolve('../src/storage/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    appSqlConn: async () => (await dbReady).conn,
    listSessions: async () => rowsOf((await dbReady).conn, 'SELECT id, notes FROM sessions'),
    createSession: async (input: Omit<Session, 'id' | 'startedAt' | 'recovered'>) => {
      const id = 'session_demo';
      await (await dbReady).conn.runAsync(
        'INSERT INTO sessions (id, track_name, kart, notes, started_at, mode) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        input.trackName,
        input.kart,
        input.notes,
        Date.now(),
        input.mode
      );
      return { ...input, id, startedAt: Date.now(), recovered: false };
    },
    deleteSession: async () => {},
  },
} as NodeJS.Module;
const { seedDemoSession } = require('../src/lib/demoSession') as typeof import('../src/lib/demoSession');

test('seedDemoSession (sql.js): a sessão demo tem as mesmas voltas, durações e started_at de antes, em série e janelas, sem JSON de amostra', async () => {
  const realNow = Date.now;
  Date.now = () => DEMO_NOW;
  let id: string;
  try {
    id = await seedDemoSession();
  } finally {
    Date.now = realNow;
  }
  const { conn } = await dbReady;

  const laps = await loadLaps(conn, id);
  assert.deepEqual(
    laps.map((l) => ({ id: l.id, startedAt: l.startedAt, durationMs: l.durationMs, n: l.gps!.length })),
    expected.lapRecords.demo.map((l) => ({ id: l.id, startedAt: l.startedAt, durationMs: l.durationMs, n: l.samples.len }))
  );
  assert.equal(laps.length, 3);

  // O replay inteiro é a série GPS da sessão, e cada volta é uma janela por índice sobre ela.
  assert.deepEqual(rowsOf(conn, "SELECT owner_id, kind, source FROM telemetry_series WHERE owner_kind = 'session'"), [
    { owner_id: id, kind: 'gps', source: 'PHONE' },
  ]);
  assert.deepEqual(rowsOf(conn, 'SELECT SUM(n) AS n FROM telemetry_blocks'), [{ n: DEMO_LAP.length }]);
  assert.deepEqual(
    rowsOf(conn, 'SELECT window_kind, samples_json, imu_samples_json FROM laps WHERE session_id = ?', [id]),
    laps.map(() => ({ window_kind: 'index', samples_json: '[]', imu_samples_json: null }))
  );
  assert.deepEqual(rowsOf(conn, 'SELECT frames_version FROM sessions WHERE id = ?', [id]), [{ frames_version: 5 }]);
  // A volta começa no ponto em que a anterior fechou, como antes.
  assert.deepEqual(laps[1].gps![0], laps[0].gps![laps[0].gps!.length - 1]);
});
