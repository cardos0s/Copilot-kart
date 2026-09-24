/**
 * Migrações do SQLite com o executor injetado, para rodar em teste sem o
 * módulo nativo. A v4 roda inteira dentro de uma transação exclusiva: ou tudo
 * entra, ou nada muda e a próxima abertura tenta de novo.
 */

export type MigrationTx = {
  exec(sql: string): Promise<void>;
};

export type MigrationExecutor = {
  getUserVersion(): Promise<number>;
  /** Transação exclusiva. Um erro dentro do callback desfaz tudo e sobe. */
  transaction(fn: (tx: MigrationTx) => Promise<void>): Promise<void>;
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
