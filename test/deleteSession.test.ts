/**
 * Excluir a sessão com o bruto (T24, TF-09) em SQL real (sql.js): voltas, séries
 * e blocos da sessão saem numa transação exclusiva, e os de outra sessão ficam.
 * As foreign keys estão desligadas neste banco: nada sai em cascata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deleteSessionOn } from '../src/storage/sqlSessionRepo';
import { imuFrames, sessionOnDb, trackFrames, type SessionOnDb } from './helpers/sessionOnDb';
import { openV5Database, rowsOf } from './helpers/v5Database';

const T0 = 1_790_000_000_000;

type Conn = Awaited<ReturnType<typeof openV5Database>>['conn'];

/** O que a sessão tem em cada tabela: voltas, séries, blocos e a linha da sessão. */
function footprint(conn: Conn, s: SessionOnDb) {
  const count = (sql: string, params: string[]) => rowsOf<{ c: number }>(conn, sql, params)[0].c;
  return {
    laps: count('SELECT COUNT(*) AS c FROM laps WHERE session_id = ?', [s.sessionId]),
    series: count("SELECT COUNT(*) AS c FROM telemetry_series WHERE owner_kind = 'session' AND owner_id = ?", [s.sessionId]),
    blocks: count('SELECT COUNT(*) AS c FROM telemetry_blocks WHERE series_id IN (?, ?)', [s.gpsSeriesId, s.imuSeriesId]),
    sessions: count('SELECT COUNT(*) AS c FROM sessions WHERE id = ?', [s.sessionId]),
  };
}

async function twoSessions() {
  const db = await openV5Database();
  const gps = trackFrames(3);
  const a = await sessionOnDb(db.conn, { recordingId: 'rec_a', gps, imu: imuFrames(gps), t0Utc: T0 });
  const b = await sessionOnDb(db.conn, { recordingId: 'rec_b', gps, imu: imuFrames(gps), t0Utc: T0 + 3_600_000 });
  return { ...db, a, b };
}

test('deleteSessionOn (sql.js): não sobra nenhuma linha em laps, telemetry_series nem telemetry_blocks da sessão, e a outra sessão fica intacta', async () => {
  const { conn, a, b } = await twoSessions();
  const before = footprint(conn, a);
  assert.ok(before.laps === 3 && before.series === 2 && before.blocks > 40 && before.sessions === 1, JSON.stringify(before));
  const other = footprint(conn, b);

  await deleteSessionOn(conn, a.sessionId);
  assert.deepEqual(footprint(conn, a), { laps: 0, series: 0, blocks: 0, sessions: 0 });
  assert.deepEqual(footprint(conn, b), other);
});

test('deleteSessionOn (sql.js): uma falha no meio desfaz a exclusão inteira', async () => {
  const { conn, a } = await twoSessions();
  const before = footprint(conn, a);
  // A última escrita (a linha da sessão) falha depois de voltas, séries e blocos.
  await conn.execAsync(
    "CREATE TRIGGER sessao_falha BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'database is locked'); END"
  );

  await assert.rejects(deleteSessionOn(conn, a.sessionId), /database is locked/);
  assert.deepEqual(footprint(conn, a), before);
});

test('deleteSession (db.ts, estático): delega para deleteSessionOn com o banco do app', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'storage', 'db.ts'), 'utf8');
  const m = /export async function deleteSession\(id: string\): Promise<void> \{([\s\S]*?)\n\}\n/.exec(src);
  assert.ok(m, 'db.ts exporta deleteSession');
  assert.equal(m[1].trim(), 'await deleteSessionOn(await appSqlConn(), id);');
});
