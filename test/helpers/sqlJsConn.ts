/**
 * `SqlConn` sobre o sql.js (SQLite em WebAssembly), para os testes rodarem SQL real.
 * BLOB entra e sai como `Uint8Array`. É uma conexão só: dentro da transação, `tx` e a
 * própria conexão escrevem na mesma transação (no aparelho, o `tx` é outra conexão).
 */
import initSqlJs, { type Database, type SqlValue as SqlJsValue } from 'sql.js';

import type { SqlConn, SqlTx, SqlValue } from '../../src/storage/sqlConn';

let sqlJs: ReturnType<typeof initSqlJs> | null = null;

function all<T>(db: Database, sql: string, params: SqlValue[]): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params as SqlJsValue[]);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export type SqlJsConn = SqlConn & { db: Database; close(): void };

/** Banco novo, em memória. */
export async function openSqlJsConn(): Promise<SqlJsConn> {
  sqlJs ??= initSqlJs();
  const db = new (await sqlJs).Database();
  const tx: SqlTx = {
    runAsync: async (sql, ...params) => {
      db.run(sql, params as SqlJsValue[]);
    },
    getAllAsync: async (sql, ...params) => all(db, sql, params),
    getFirstAsync: async <T>(sql: string, ...params: SqlValue[]) => all<T>(db, sql, params)[0] ?? null,
    execAsync: async (sql) => {
      db.exec(sql);
    },
  };
  return {
    ...tx,
    db,
    close: () => db.close(),
    withExclusiveTransactionAsync: async (fn) => {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await fn(tx);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      db.exec('COMMIT');
    },
  };
}
