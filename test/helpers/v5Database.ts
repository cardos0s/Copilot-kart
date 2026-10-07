/**
 * Banco do app em SQL real (sql.js) no schema que o `db()` deixa hoje: as tabelas
 * v4 que o salvamento e o diário usam e a migração v5a por cima. O diário
 * (`journalStoreOn`) e o `sqlSessionRepo` rodam sobre a mesma conexão.
 */
import { migrateV5Schema, migrationExecutorFrom } from '../../src/storage/migrations';
import { journalStoreOn, type FakeJournalStore } from './fakeJournalStore';
import { openSqlJsConn, type SqlJsConn } from './sqlJsConn';

const V4_TABLES = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, track_name TEXT NOT NULL, kart TEXT, notes TEXT,
    started_at INTEGER NOT NULL, weather TEXT, track_id TEXT, mode TEXT,
    layout_id TEXT, kart_setup_id TEXT, recovered INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE laps (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL, samples_json TEXT NOT NULL, imu_samples_json TEXT
  );
  CREATE TABLE track_layouts (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, name TEXT NOT NULL, samples_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, length_m REAL NOT NULL, recorded_at INTEGER NOT NULL,
    source_session_id TEXT, source_lap_id TEXT, is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE recording_active (id TEXT PRIMARY KEY, meta_json TEXT NOT NULL, started_at INTEGER NOT NULL);
`;

export type V5Database = { conn: SqlJsConn; store: FakeJournalStore };

export async function openV5Database(): Promise<V5Database> {
  const conn = await openSqlJsConn();
  await conn.execAsync(V4_TABLES);
  await migrateV5Schema(migrationExecutorFrom(conn));
  return { conn, store: await journalStoreOn(conn) };
}

/** Linhas de uma consulta, síncrono (o sql.js é). */
export function rowsOf<T>(conn: SqlJsConn, sql: string, params: (string | number)[] = []): T[] {
  const stmt = conn.db.prepare(sql);
  try {
    stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}
