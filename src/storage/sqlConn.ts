/**
 * Recorte injetável do SQLite que o armazenamento de telemetria usa. Em produção é o
 * expo-sqlite; nos testes, o sql.js (`test/helpers/sqlJsConn.ts`), com SQL real.
 *
 * BLOB entra e sai como `Uint8Array` nos dois.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export type SqlValue = string | number | null | Uint8Array;

/** O que se pode fazer dentro de uma transação (e fora dela). */
export type SqlTx = {
  runAsync(sql: string, ...params: SqlValue[]): Promise<void>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  /** Várias instruções, sem parâmetros. */
  execAsync(sql: string): Promise<void>;
};

export type SqlConn = SqlTx & {
  /**
   * Transação exclusiva: um erro dentro de `fn` desfaz tudo e sobe. Dentro dela, use só o `tx`
   * recebido. No expo-sqlite ele é outra conexão, e o que roda fora dele não entra na transação.
   * O `tx` não abre transação aninhada.
   */
  withExclusiveTransactionAsync(fn: (tx: SqlTx) => Promise<void>): Promise<void>;
};

type ExpoLike = Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'execAsync'>;

function txFrom(d: ExpoLike): SqlTx {
  return {
    runAsync: async (sql, ...params) => {
      await d.runAsync(sql, ...params);
    },
    getAllAsync: (sql, ...params) => d.getAllAsync(sql, ...params),
    getFirstAsync: (sql, ...params) => d.getFirstAsync(sql, ...params),
    execAsync: (sql) => d.execAsync(sql),
  };
}

/** Adaptador do expo-sqlite 16. */
export function expoSqlConn(d: SQLiteDatabase): SqlConn {
  return {
    ...txFrom(d),
    withExclusiveTransactionAsync: (fn) => d.withExclusiveTransactionAsync((txn) => fn(txFrom(txn))),
  };
}
