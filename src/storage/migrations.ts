/**
 * Migrações do SQLite com o executor injetado, para rodar em teste sem o
 * módulo nativo. A v4 roda inteira dentro de uma transação exclusiva: ou tudo
 * entra, ou nada muda e a próxima abertura tenta de novo.
 */
import { TELEMETRY_SCHEMA } from '../telemetry/telemetryStore';
import type { SqlConn } from './sqlConn';

export type MigrationTx = {
  exec(sql: string): Promise<void>;
};

export type MigrationExecutor<Tx extends MigrationTx = MigrationTx> = {
  getUserVersion(): Promise<number>;
  /** Transação exclusiva. Um erro dentro do callback desfaz tudo e sobe. */
  transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
};

const V4_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS recording_active (
    id TEXT PRIMARY KEY,
    meta_json TEXT NOT NULL,
    started_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recording_chunks (
    recording_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    gps_json TEXT NOT NULL,
    imu_json TEXT NOT NULL,
    PRIMARY KEY (recording_id, seq)
  )`,
  'ALTER TABLE sessions ADD COLUMN recovered INTEGER NOT NULL DEFAULT 0',
  "UPDATE sessions SET layout_id = NULL WHERE layout_id = ''",
  "UPDATE sessions SET kart_setup_id = NULL WHERE kart_setup_id = ''",
  "UPDATE pb_records SET layout_id = NULL WHERE layout_id = ''",
  'PRAGMA user_version = 4',
];

/** v3 → v4: diário de gravação, sessão recuperada e string vazia vira null. */
export async function migrateV4(executor: MigrationExecutor): Promise<void> {
  if ((await executor.getUserVersion()) >= 4) return;
  await executor.transaction(async (tx) => {
    for (const sql of V4_STATEMENTS) await tx.exec(sql);
  });
}

/** Transação da v5: além de executar, consulta se uma coluna já existe. */
export type V5SchemaTx = MigrationTx & {
  hasColumn(table: string, column: string): Promise<boolean>;
};

/** Executor da v5 sobre um `SqlConn`: o mesmo código no aparelho (expo-sqlite) e nos testes (sql.js). */
export function migrationExecutorFrom(conn: SqlConn): MigrationExecutor<V5SchemaTx> {
  return {
    getUserVersion: async () =>
      (await conn.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0,
    transaction: (fn) =>
      conn.withExclusiveTransactionAsync((tx) =>
        fn({
          exec: (sql) => tx.execAsync(sql),
          hasColumn: async (table, column) =>
            (await tx.getFirstAsync('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', table, column)) !== null,
        })
      ),
  };
}

const WINDOW_COLUMNS = [
  'window_kind TEXT',
  'from_idx INTEGER',
  'to_idx INTEGER',
  ...['start', 'end'].flatMap((p) => ['t', 'lat', 'lng', 'speed', 'acc'].map((c) => `${p}_${c} REAL`)),
];

const V5A_STATEMENTS = [
  ...TELEMETRY_SCHEMA,
  ...['laps', 'track_layouts'].flatMap((table) =>
    WINDOW_COLUMNS.map((col) => `ALTER TABLE ${table} ADD COLUMN ${col}`)
  ),
  // Por último: é a marca de que a v5a inteira já entrou.
  'ALTER TABLE sessions ADD COLUMN frames_version INTEGER NOT NULL DEFAULT 0',
];

/**
 * v5a: tabelas das séries, colunas de janela em `laps` e `track_layouts` e
 * `sessions.frames_version`, numa transação. Não grava `user_version = 5`: isso é
 * da v5c, quando todas as sessões e traçados estiverem convertidos.
 *
 * "Já aplicada" = `sessions.frames_version` existe. Como a v5a é uma transação só
 * (o DDL do SQLite é transacional), essa coluna só existe se todo o resto existe,
 * e ela continua existindo depois da v5c.
 */
export async function migrateV5Schema(executor: MigrationExecutor<V5SchemaTx>): Promise<void> {
  await executor.transaction(async (tx) => {
    if (await tx.hasColumn('sessions', 'frames_version')) return;
    for (const sql of V5A_STATEMENTS) await tx.exec(sql);
  });
}
