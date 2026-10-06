/**
 * Migração v5a (schema) sobre SQL real (sql.js): cria as tabelas das séries, as
 * colunas de janela em `laps` e `track_layouts` e `sessions.frames_version`, numa
 * transação só, sem tocar nos dados v4 (TF-17 infraestrutura, TF-20).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateV5Schema, migrationExecutorFrom, type MigrationExecutor, type V5SchemaTx } from '../src/storage/migrations';
import type { SqlConn } from '../src/storage/sqlConn';
import { openSqlJsConn, type SqlJsConn } from './helpers/sqlJsConn';

/** Banco no schema v4, como o `db()` deixa antes desta feature, com dados. */
async function v4Database(): Promise<SqlJsConn> {
  const conn = await openSqlJsConn();
  await conn.execAsync(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, track_name TEXT NOT NULL, kart TEXT, notes TEXT,
      started_at INTEGER NOT NULL, weather TEXT, track_id TEXT, mode TEXT,
      layout_id TEXT, kart_setup_id TEXT, recovered INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE laps (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL, samples_json TEXT NOT NULL, imu_samples_json TEXT
    );
    CREATE TABLE track_references (
      track_id TEXT PRIMARY KEY, track_name TEXT NOT NULL, samples_json TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, length_m REAL NOT NULL, recorded_at INTEGER NOT NULL,
      source_session_id TEXT, source_lap_id TEXT
    );
    CREATE TABLE track_layouts (
      id TEXT PRIMARY KEY, track_id TEXT NOT NULL, name TEXT NOT NULL, samples_json TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, length_m REAL NOT NULL, recorded_at INTEGER NOT NULL,
      source_session_id TEXT, source_lap_id TEXT, is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE recording_active (id TEXT PRIMARY KEY, meta_json TEXT NOT NULL, started_at INTEGER NOT NULL);
    CREATE TABLE recording_chunks (
      recording_id TEXT NOT NULL, seq INTEGER NOT NULL, gps_json TEXT NOT NULL, imu_json TEXT NOT NULL,
      PRIMARY KEY (recording_id, seq)
    );
    INSERT INTO sessions (id, track_name, started_at, track_id, mode, recovered)
      VALUES ('session_1', 'Kart CWB', 1790000000000, 'cwb', 'race', 0);
    INSERT INTO laps VALUES ('lap_1', 'session_1', 1790000060000, 61234,
      '[{"t":1790000060000,"lat":-25.4,"lng":-49.2,"speed":10,"accuracy":4}]',
      '[{"t":1790000060000,"gyro":{"x":0,"y":0,"z":1}}]');
    INSERT INTO laps VALUES ('lap_2', 'session_1', 1790000121234, 60100, '[]', NULL);
    INSERT INTO track_layouts VALUES ('layout_1', 'cwb', 'Principal', '[{"t":1,"lat":-25.4,"lng":-49.2,"speed":0}]',
      61234, 812.5, 1790000200000, 'session_1', 'lap_1', 1);
    PRAGMA user_version = 4;
  `);
  return conn;
}

const WINDOW_COLUMNS = [
  'window_kind', 'from_idx', 'to_idx',
  'start_t', 'start_lat', 'start_lng', 'start_speed', 'start_acc',
  'end_t', 'end_lat', 'end_lng', 'end_speed', 'end_acc',
];

async function columns(conn: SqlConn, table: string) {
  return conn.getAllAsync<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
    `SELECT name, type, "notnull", dflt_value FROM pragma_table_info('${table}')`
  );
}

async function objects(conn: SqlConn) {
  return (
    await conn.getAllAsync<{ type: string; name: string }>(
      "SELECT type, name FROM sqlite_master WHERE name LIKE 'telemetry_%' OR name = 'idx_series_owner' ORDER BY name"
    )
  ).map((r) => `${r.type}:${r.name}`);
}

async function snapshot(conn: SqlConn) {
  return {
    sessions: await conn.getAllAsync('SELECT id, track_name, started_at, track_id, mode, recovered FROM sessions'),
    laps: await conn.getAllAsync('SELECT id, session_id, started_at, duration_ms, samples_json, imu_samples_json FROM laps ORDER BY id'),
    layouts: await conn.getAllAsync('SELECT id, track_id, samples_json, duration_ms, length_m, is_default FROM track_layouts'),
  };
}

const userVersion = async (conn: SqlConn) =>
  (await conn.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;

test('v5a sobre um banco v4 com dados cria tabelas e colunas, e os dados antigos continuam legíveis', async () => {
  const conn = await v4Database();
  const before = await snapshot(conn);

  await migrateV5Schema(migrationExecutorFrom(conn));

  assert.deepEqual(await objects(conn), [
    'index:idx_series_owner',
    'table:telemetry_blocks',
    'table:telemetry_series',
  ]);
  for (const table of ['laps', 'track_layouts']) {
    const cols = await columns(conn, table);
    const names = cols.map((c) => c.name);
    assert.deepEqual(names.slice(-WINDOW_COLUMNS.length), WINDOW_COLUMNS, table);
    const types = Object.fromEntries(cols.map((c) => [c.name, c.type]));
    assert.equal(types.window_kind, 'TEXT');
    assert.equal(types.from_idx, 'INTEGER');
    assert.equal(types.to_idx, 'INTEGER');
    for (const c of WINDOW_COLUMNS.slice(3)) assert.equal(types[c], 'REAL', `${table}.${c}`);
  }
  const fv = (await columns(conn, 'sessions')).find((c) => c.name === 'frames_version');
  assert.deepEqual(fv, { name: 'frames_version', type: 'INTEGER', notnull: 1, dflt_value: '0' });

  // Dados v4 intactos; as colunas antigas continuam (só saem na v5c).
  assert.deepEqual(await snapshot(conn), before);
  const lap = await conn.getFirstAsync<{ window_kind: string | null; frames_version: number }>(
    'SELECT l.window_kind, s.frames_version FROM laps l JOIN sessions s ON s.id = l.session_id WHERE l.id = ?',
    'lap_1'
  );
  assert.deepEqual(lap, { window_kind: null, frames_version: 0 });
  // A v5a não marca a versão 5: isso é da v5c, quando tudo estiver convertido.
  assert.equal(await userVersion(conn), 4);
  conn.close();
});

test('v5a rodada duas vezes não falha nem duplica nada', async () => {
  const conn = await v4Database();
  await migrateV5Schema(migrationExecutorFrom(conn));
  const objs = await objects(conn);
  const cols = { laps: await columns(conn, 'laps'), layouts: await columns(conn, 'track_layouts'), sessions: await columns(conn, 'sessions') };
  const data = await snapshot(conn);

  await migrateV5Schema(migrationExecutorFrom(conn));

  assert.deepEqual(await objects(conn), objs);
  assert.deepEqual(
    { laps: await columns(conn, 'laps'), layouts: await columns(conn, 'track_layouts'), sessions: await columns(conn, 'sessions') },
    cols
  );
  assert.deepEqual(await snapshot(conn), data);
  conn.close();
});

test('uma falha no meio da v5a desfaz tudo dela, e a próxima execução termina o trabalho', async () => {
  const conn = await v4Database();
  const real = migrationExecutorFrom(conn);
  // Falha na penúltima coluna de janela de track_layouts, depois de tabelas e colunas de laps.
  const failing: MigrationExecutor<V5SchemaTx> = {
    getUserVersion: real.getUserVersion,
    transaction: (fn) =>
      real.transaction((tx) =>
        fn({
          ...tx,
          exec: async (sql) => {
            if (/ALTER TABLE track_layouts ADD COLUMN end_speed/.test(sql)) throw new Error('falha injetada');
            await tx.exec(sql);
          },
        })
      ),
  };

  await assert.rejects(migrateV5Schema(failing), /falha injetada/);

  assert.deepEqual(await objects(conn), []);
  for (const table of ['laps', 'track_layouts']) {
    const names = (await columns(conn, table)).map((c) => c.name);
    assert.ok(!names.includes('window_kind'), `${table} sem window_kind`);
  }
  assert.ok(!(await columns(conn, 'sessions')).some((c) => c.name === 'frames_version'));

  await migrateV5Schema(real);
  assert.equal((await objects(conn)).length, 3);
  assert.ok((await columns(conn, 'sessions')).some((c) => c.name === 'frames_version'));
  conn.close();
});

test('db() roda a v5a depois da v4', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'storage', 'db.ts'), 'utf8');
  const v4 = src.indexOf('await migrateV4(');
  const v5a = src.indexOf('await migrateV5Schema(migrationExecutorFrom(expoSqlConn(dbInstance)))');
  assert.ok(v4 > 0, 'migrateV4 no db()');
  assert.ok(v5a > v4, 'migrateV5Schema depois da v4');
  assert.ok(v5a < src.indexOf('return dbInstance;'), 'antes de devolver o banco');
});
