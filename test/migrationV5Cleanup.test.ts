/**
 * Migração v5c (T44) em SQL real (sql.js): TF-20 AC 8 (as colunas e a tabela
 * antigas só saem quando tudo converteu), TF-13 (sem `samples_json` depois dela)
 * e TF-18 AC 10 (a sessão convertida abre com os mesmos tempos e o mesmo PB).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadLaps } from '../src/storage/lapRepo';
import { getLayout, getTrackReference, saveLayout } from '../src/storage/layoutRepo';
import {
  migrateBaseSchema,
  migrateV4,
  migrateV5Cleanup,
  migrateV5Data,
  migrateV5Schema,
  migrationExecutorFrom,
} from '../src/storage/migrations';
import type { GpsFrame } from '../src/telemetry/frame';
import { imuFrames, sessionOnDb, trackFrames } from './helpers/sessionOnDb';
import { openSqlJsConn, type SqlJsConn } from './helpers/sqlJsConn';
import { insertOldLayout, insertOldSession, oldLaps, oldPoint, openV4Database, type OldLap } from './helpers/v4Database';
import { rowsOf } from './helpers/v5Database';

const T0 = 1_790_000_000_000;
const DAY = 86_400_000;
const noWarn = () => {};

const absolute = (laps: number, t0: number, lapMs?: number): GpsFrame[] =>
  trackFrames(laps, lapMs, t0).map((f) => ({ ...f, t: t0 + f.t }));

/** Banco v4 com 2 sessões (com e sem sintéticos), um traçado, uma referência, um PB e um diário pendente; depois a v5a. */
async function v4WithData(): Promise<{ conn: SqlJsConn; sessions: Array<{ id: string; laps: OldLap[] }> }> {
  const conn = await openV4Database();
  const a = { id: 'session_a', laps: oldLaps('session_a', absolute(3, T0), { synthetic: false }) };
  const b = { id: 'session_b', laps: oldLaps('session_b', absolute(3, T0 + DAY, 36_500), { synthetic: true }) };
  await insertOldSession(conn, { id: a.id, startedAt: T0, trackId: 'cwb', laps: a.laps });
  await insertOldSession(conn, { id: b.id, startedAt: T0 + DAY, trackId: 'cwb', laps: b.laps });
  const best = b.laps.reduce((x, l) => (l.durationMs < x.durationMs ? l : x));
  await insertOldLayout(conn, { id: 'layout_b', trackId: 'cwb', samples: best.samples, durationMs: best.durationMs, recordedAt: T0 + DAY });
  await conn.runAsync("INSERT INTO track_references VALUES ('cwb', 'Kart CWB', ?, ?, 800, ?, NULL, NULL)", JSON.stringify(best.samples), best.durationMs, T0);
  await conn.runAsync("INSERT INTO pb_records VALUES ('pb_1', 'cwb', 'layout_b', 'session_b', ?, ?, 1, ?)", best.id, best.durationMs, T0 + DAY);
  const rec = `rec_${T0 + 2 * DAY}_xyz`;
  await conn.runAsync('INSERT INTO recording_active VALUES (?, ?, ?)', rec, JSON.stringify({ version: 1, recordingId: rec, mode: 'race', startedAt: T0 + 2 * DAY, trackId: 'cwb', trackName: 'Kart CWB', layoutId: null, layoutName: null, kartSetupId: null }), T0 + 2 * DAY);
  await conn.runAsync(
    'INSERT INTO recording_chunks VALUES (?, 0, ?, ?)',
    rec,
    JSON.stringify(b.laps[0].samples.filter((p) => !p.synthetic).map((p) => ({ ...p, t: p.t + DAY }))),
    '[]'
  );
  await migrateV5Schema(migrationExecutorFrom(conn));
  return { conn, sessions: [a, b] };
}

const columnsOf = (conn: SqlJsConn, table: string) =>
  rowsOf<{ name: string }>(conn, `SELECT name FROM pragma_table_info('${table}')`).map((r) => r.name);
const legacyColumns = (conn: SqlJsConn) => ({
  laps: columnsOf(conn, 'laps').filter((c) => c.endsWith('_json')),
  track_layouts: columnsOf(conn, 'track_layouts').filter((c) => c.endsWith('_json')),
  track_references: columnsOf(conn, 'track_references').filter((c) => c.endsWith('_json')),
  recording_chunks: rowsOf(conn, "SELECT name FROM sqlite_master WHERE name = 'recording_chunks'").length,
});
const userVersion = (conn: SqlJsConn) => rowsOf<{ user_version: number }>(conn, 'PRAGMA user_version')[0].user_version;
const ALL_LEGACY = {
  laps: ['samples_json', 'imu_samples_json'],
  track_layouts: ['samples_json'],
  track_references: ['samples_json'],
  recording_chunks: 1,
};

/** Uma coisa que a v5b não converteu (ela falhou), deixada de propósito depois da v5b. */
const LEFTOVERS: Array<[string, (conn: SqlJsConn) => Promise<void>]> = [
  ['sessão sem frames_version = 5', (c) => c.runAsync("UPDATE sessions SET frames_version = 0 WHERE id = 'session_a'")],
  ['traçado sem janela', (c) => c.runAsync("UPDATE track_layouts SET window_kind = NULL WHERE id = 'layout_b'")],
  ['referência sem série', (c) => c.runAsync("DELETE FROM telemetry_series WHERE owner_kind = 'reference'")],
  ['diário v4 pendente', (c) => c.runAsync("INSERT INTO recording_chunks VALUES ('rec_x', 0, '[]', '[]')")],
];

test('v5c (sql.js, TF-20 AC 8): com qualquer item ainda sem conversão, não remove nada e não grava user_version = 5; a gravação de sessões e traçados novos continua funcionando', async () => {
  for (const [label, leave] of LEFTOVERS) {
    const { conn } = await v4WithData();
    await migrateV5Data(conn, noWarn);
    await leave(conn);

    assert.equal(await migrateV5Cleanup(migrationExecutorFrom(conn)), false, label);

    assert.deepEqual(legacyColumns(conn), ALL_LEGACY, label);
    assert.equal(userVersion(conn), 4, label);
    // A coluna antiga ainda é NOT NULL: a sessão e o traçado novos gravam sem ela no texto do app.
    const gps = trackFrames(3);
    const s = await sessionOnDb(conn, { recordingId: 'rec_new', gps, imu: imuFrames(gps), t0Utc: T0 + 5 * DAY });
    const laps = await loadLaps(conn, s.sessionId);
    assert.ok(laps.length >= 2 && laps.every((l) => l.window?.kind === 'cross'), label);
    const best = laps[0];
    await saveLayout(conn, {
      id: 'layout_new', trackId: 'cwb', name: 'Novo', gps: best.gps, window: best.window!,
      durationMs: best.durationMs, lengthM: 1, recordedAt: T0, isDefault: false,
    });
    assert.deepEqual((await getLayout(conn, 'layout_new'))!.gps, best.gps, label);
  }
});

test('v5c (sql.js, TF-18 AC 10): com tudo convertido, as colunas e a tabela antigas saem, user_version = 5, e as sessões abrem com os mesmos tempos e o mesmo PB', async () => {
  const { conn, sessions } = await v4WithData();
  const laps = rowsOf(conn, 'SELECT id, session_id, started_at, duration_ms FROM laps ORDER BY id');
  const pbs = rowsOf(conn, 'SELECT * FROM pb_records');
  const best = rowsOf(conn, 'SELECT MIN(duration_ms) AS best FROM laps');
  await migrateV5Data(conn, noWarn);
  const layoutBefore = (await getLayout(conn, 'layout_b'))!;
  const referenceBefore = (await getTrackReference(conn, 'cwb'))!;

  assert.equal(await migrateV5Cleanup(migrationExecutorFrom(conn)), true);

  assert.deepEqual(legacyColumns(conn), { laps: [], track_layouts: [], track_references: [], recording_chunks: 0 });
  assert.equal(userVersion(conn), 5);
  assert.deepEqual(rowsOf(conn, 'SELECT id, session_id, started_at, duration_ms FROM laps ORDER BY id'), laps);
  assert.deepEqual(rowsOf(conn, 'SELECT * FROM pb_records'), pbs);
  assert.deepEqual(rowsOf(conn, 'SELECT MIN(duration_ms) AS best FROM laps'), best);
  for (const s of sessions) {
    const read = await loadLaps(conn, s.id, { imu: true });
    assert.deepEqual(read.map((l) => [l.id, l.startedAt, l.durationMs]), s.laps.map((l) => [l.id, l.startedAt, l.durationMs]), s.id);
    const t0 = rowsOf<{ t0_utc: number }>(conn, "SELECT t0_utc FROM telemetry_series WHERE owner_id = ? AND kind = 'gps'", [s.id])[0].t0_utc;
    assert.deepEqual(read.map((l) => l.gps.map((f) => oldPoint(f, t0))), s.laps.map((l) => l.samples), s.id);
  }
  assert.deepEqual((await getLayout(conn, 'layout_b'))!.gps, layoutBefore.gps);
  assert.deepEqual((await getTrackReference(conn, 'cwb'))!.gps, referenceBefore.gps);

  // Sem as colunas, a sessão e o traçado novos gravam e abrem.
  const gps = trackFrames(3);
  const s = await sessionOnDb(conn, { recordingId: 'rec_after', gps, imu: imuFrames(gps), t0Utc: T0 + 6 * DAY });
  const fresh = await loadLaps(conn, s.sessionId);
  assert.deepEqual(fresh.map((l) => l.durationMs), s.windows.map((w) => w.durationMs));
  await saveLayout(conn, {
    id: 'layout_after', trackId: 'cwb', name: 'Depois', gps: fresh[0].gps, window: fresh[0].window!,
    durationMs: fresh[0].durationMs, lengthM: 1, recordedAt: T0, isDefault: false,
  });
  assert.deepEqual((await getLayout(conn, 'layout_after'))!.gps, fresh[0].gps);

  // Rodar de novo (e a v5b depois da v5c) não faz nada.
  assert.equal(await migrateV5Cleanup(migrationExecutorFrom(conn)), false);
  assert.deepEqual(await migrateV5Data(conn, noWarn), { sessions: 0, layouts: 0, references: 0, journals: 0, skippedLaps: 0, failed: [] });
});

test('banco novo (T46, TF-13): o schema base, a v4 e a v5 terminam em user_version = 5 sem as colunas de JSON nem recording_chunks, e reabrir não as recria', async () => {
  const conn = await openSqlJsConn();
  const open = async () => {
    await migrateBaseSchema(conn);
    await migrateV4(migrationExecutorFrom(conn));
    await migrateV5Schema(migrationExecutorFrom(conn));
    await migrateV5Data(conn, noWarn);
    return migrateV5Cleanup(migrationExecutorFrom(conn));
  };

  assert.equal(await open(), true);
  assert.deepEqual(legacyColumns(conn), { laps: [], track_layouts: [], track_references: [], recording_chunks: 0 });
  assert.equal(userVersion(conn), 5);

  assert.equal(await open(), false);
  assert.deepEqual(legacyColumns(conn), { laps: [], track_layouts: [], track_references: [], recording_chunks: 0 });
  const gps = trackFrames(3);
  const s = await sessionOnDb(conn, { recordingId: 'rec_fresh', gps, imu: imuFrames(gps), t0Utc: T0 });
  assert.deepEqual((await loadLaps(conn, s.sessionId)).map((l) => l.durationMs), s.windows.map((w) => w.durationMs));
});
