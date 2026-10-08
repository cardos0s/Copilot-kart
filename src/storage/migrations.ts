/**
 * Migrações do SQLite com o executor injetado, para rodar em teste sem o
 * módulo nativo. A v4 roda inteira dentro de uma transação exclusiva: ou tudo
 * entra, ou nada muda e a próxima abertura tenta de novo.
 */
import { recordingOwner, recordingSeries } from '../recording/journal';
import { encodeBlock } from '../telemetry/blockCodec';
import type { Owner, Series, SeriesMeta } from '../telemetry/frame';
import {
  convertJournal,
  convertLayout,
  convertReference,
  convertSessionLaps,
  type LegacyChunk,
  type LegacyLapRow,
} from '../telemetry/legacy';
import { gpsSeriesOf, imuSeriesOf } from '../telemetry/series';
import { createSeries, deleteOwner, insertBlocks, TELEMETRY_SCHEMA, type BlockRow } from '../telemetry/telemetryStore';
import { sessionOwner } from './lapRepo';
import { layoutOwner, referenceOwner } from './layoutRepo';
import type { SqlConn, SqlTx } from './sqlConn';
import { FRAMES_VERSION, windowColumns } from './sqlSessionRepo';

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

// ---------------------------------------------------------------------------
// v5b: conversão do formato antigo, uma transação por item, com retomada
// ---------------------------------------------------------------------------

/** O que a v5b fez nesta execução. `failed` volta a ser tentado na próxima abertura. */
export type V5DataReport = {
  sessions: number;
  layouts: number;
  references: number;
  journals: number;
  /** Voltas com o JSON ilegível: ficaram com a janela `none` (TF-20 AC 9). */
  skippedLaps: number;
  /** `session:<id>`, `layout:<id>`, `reference:<track_id>` ou `journal:<recording_id>`. */
  failed: string[];
};

/** Frames por bloco na série convertida. */
const LEGACY_BLOCK_FRAMES = 500;

async function hasTable(tx: SqlTx, name: string): Promise<boolean> {
  return (await tx.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name)) !== null;
}

async function hasSeries(tx: SqlTx, owner: Owner): Promise<boolean> {
  return (
    (await tx.getFirstAsync('SELECT 1 FROM telemetry_series WHERE owner_kind = ? AND owner_id = ? LIMIT 1', owner.kind, owner.id)) !==
    null
  );
}

/**
 * Cria a série e grava os frames em blocos. A faixa `[t_first, t_last]` de cada bloco é o
 * menor e o maior `t` dele: o `t` legado pode não ser crescente (timestamps degenerados).
 */
async function writeSeries(tx: SqlTx, series: Series): Promise<void> {
  await createSeries(tx, series.meta);
  const blocks: BlockRow[] = [];
  for (let from = 0; from < series.n; from += LEGACY_BLOCK_FRAMES) {
    const to = Math.min(from + LEGACY_BLOCK_FRAMES, series.n);
    let tFirst = Infinity;
    let tLast = -Infinity;
    for (let i = from; i < to; i++) {
      tFirst = Math.min(tFirst, series.t[i]);
      tLast = Math.max(tLast, series.t[i]);
    }
    blocks.push({ seriesId: series.meta.id, seq: blocks.length, n: to - from, tFirst, tLast, payload: encodeBlock(series, from, to) });
  }
  await insertBlocks(tx, blocks);
}

const legacyMeta = (id: string, owner: Owner, kind: 'gps' | 'imu', t0Utc: number | null): SeriesMeta => ({
  id,
  owner,
  source: 'PHONE',
  kind,
  t0Utc,
  legacy: true,
});

const WINDOW_UPDATE = `window_kind = ?, from_idx = ?, to_idx = ?,
  start_t = ?, start_lat = ?, start_lng = ?, start_speed = ?, start_acc = ?,
  end_t = ?, end_lat = ?, end_lng = ?, end_speed = ?, end_acc = ?`;

/** As voltas ainda sem janela viram a série da sessão e as janelas; a sessão sai com `frames_version = 5`. */
async function convertSessionOn(tx: SqlTx, sessionId: string): Promise<number> {
  const session = await tx.getFirstAsync<{ frames_version: number }>('SELECT frames_version FROM sessions WHERE id = ?', sessionId);
  if (!session || session.frames_version === FRAMES_VERSION) return 0;
  const rows = await tx.getAllAsync<LegacyLapRow>(
    'SELECT id, started_at, samples_json, imu_samples_json FROM laps WHERE session_id = ? AND window_kind IS NULL',
    sessionId
  );
  let skipped = 0;
  if (rows.length > 0) {
    const owner = sessionOwner(sessionId);
    if (await hasSeries(tx, owner)) throw new Error(`a sessão ${sessionId} já tem séries e ainda tem voltas sem janela`);
    const conv = convertSessionLaps(rows);
    if (conv.gps.length > 0) {
      await writeSeries(tx, gpsSeriesOf(legacyMeta(`${sessionId}_gps`, owner, 'gps', conv.t0Utc), conv.gps));
      if (conv.imu.length > 0) await writeSeries(tx, imuSeriesOf(legacyMeta(`${sessionId}_imu`, owner, 'imu', conv.t0Utc), conv.imu));
    }
    for (const r of rows) {
      await tx.runAsync(`UPDATE laps SET ${WINDOW_UPDATE} WHERE id = ?`, ...windowColumns(conv.windows.get(r.id)), r.id);
    }
    skipped = conv.skipped.length;
  }
  await tx.runAsync('UPDATE sessions SET frames_version = ? WHERE id = ?', FRAMES_VERSION, sessionId);
  return skipped;
}

/** O traçado ainda sem janela ganha a série dele (`layout:<id>`) e a janela da volta de origem. */
async function convertLayoutOn(tx: SqlTx, layoutId: string): Promise<void> {
  const row = await tx.getFirstAsync<{ samples_json: string | null }>(
    'SELECT samples_json FROM track_layouts WHERE id = ? AND window_kind IS NULL',
    layoutId
  );
  if (!row) return;
  const conv = convertLayout(row.samples_json);
  const owner = layoutOwner(layoutId);
  await deleteOwner(tx, owner);
  if (conv.window.kind !== 'none') await writeSeries(tx, gpsSeriesOf(legacyMeta(`${layoutId}_gps`, owner, 'gps', null), conv.gps));
  await tx.runAsync(`UPDATE track_layouts SET ${WINDOW_UPDATE} WHERE id = ?`, ...windowColumns(conv.window), layoutId);
}

/**
 * A referência sem série ganha a série `reference:<track_id>`. A série é criada mesmo
 * vazia (JSON ilegível): é ela que marca a referência como convertida.
 */
async function convertReferenceOn(tx: SqlTx, trackId: string): Promise<void> {
  const owner = referenceOwner(trackId);
  if (await hasSeries(tx, owner)) return;
  const row = await tx.getFirstAsync<{ samples_json: string | null }>('SELECT samples_json FROM track_references WHERE track_id = ?', trackId);
  if (!row) return;
  const conv = convertReference(row.samples_json);
  await writeSeries(tx, gpsSeriesOf(legacyMeta(`reference_${trackId}_gps`, owner, 'gps', null), conv.gps));
}

/**
 * O diário v4 pendente vira as séries da gravação (`session:session_<id>`), que a
 * recuperação lê. Se a sessão já foi salva (o v4 morreu entre salvar e limpar o diário)
 * ou não há registro ativo, os pedaços só saem. Os pedaços saem na mesma transação.
 */
async function convertJournalOn(tx: SqlTx, recordingId: string): Promise<void> {
  const chunks = await tx.getAllAsync<LegacyChunk>(
    'SELECT gps_json, imu_json FROM recording_chunks WHERE recording_id = ? ORDER BY seq',
    recordingId
  );
  if (chunks.length === 0) return;
  const owner = recordingOwner(recordingId);
  const saved = (await tx.getFirstAsync('SELECT 1 FROM sessions WHERE id = ?', owner.id)) !== null;
  const active = await tx.getFirstAsync<{ started_at: number }>('SELECT started_at FROM recording_active WHERE id = ?', recordingId);
  if (!saved && active && !(await hasSeries(tx, owner))) {
    const conv = convertJournal(active.started_at, chunks);
    const metas = recordingSeries(recordingId, conv.t0Utc);
    await writeSeries(tx, gpsSeriesOf({ ...metas.gps, legacy: true }, conv.gps));
    await writeSeries(tx, imuSeriesOf({ ...metas.imu, legacy: true }, conv.imu));
  }
  await tx.runAsync('DELETE FROM recording_chunks WHERE recording_id = ?', recordingId);
}

/**
 * v5b: converte o que ainda está em JSON, uma transação exclusiva por sessão, por
 * traçado, por referência e por diário pendente (TF-17 a TF-20). Uma falha desfaz só
 * aquele item, que continua legível no formato antigo (as colunas só saem na v5c) e
 * é tentado de novo na próxima abertura; os outros seguem. Rodar de novo não refaz
 * nada: a sessão convertida tem `frames_version = 5`, o traçado tem janela, a
 * referência tem série, e o diário convertido não tem mais pedaços.
 */
export async function migrateV5Data(conn: SqlConn, warn: (message: string) => void = console.warn): Promise<V5DataReport> {
  const report: V5DataReport = { sessions: 0, layouts: 0, references: 0, journals: 0, skippedLaps: 0, failed: [] };
  const version = await conn.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) >= 5) return report;

  const each = async (label: string, ids: string[], fn: (tx: SqlTx, id: string) => Promise<number | void>) => {
    let done = 0;
    for (const id of ids) {
      try {
        await conn.withExclusiveTransactionAsync(async (tx) => {
          report.skippedLaps += (await fn(tx, id)) ?? 0;
        });
        done++;
      } catch (e) {
        report.failed.push(`${label}:${id}`);
        warn(`migração v5: ${label} ${id} não converteu e fica para a próxima abertura (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return done;
  };
  const ids = async (sql: string) => (await conn.getAllAsync<{ id: string }>(sql)).map((r) => r.id);

  report.sessions = await each(
    'session',
    await ids(`SELECT id FROM sessions WHERE frames_version <> ${FRAMES_VERSION} ORDER BY started_at, id`),
    convertSessionOn
  );
  report.layouts = await each('layout', await ids('SELECT id FROM track_layouts WHERE window_kind IS NULL ORDER BY id'), convertLayoutOn);
  if (await hasTable(conn, 'track_references')) {
    report.references = await each(
      'reference',
      await ids(
        `SELECT track_id AS id FROM track_references WHERE track_id NOT IN
           (SELECT owner_id FROM telemetry_series WHERE owner_kind = 'reference') ORDER BY track_id`
      ),
      convertReferenceOn
    );
  }
  if (await hasTable(conn, 'recording_chunks')) {
    report.journals = await each(
      'journal',
      await ids('SELECT DISTINCT recording_id AS id FROM recording_chunks ORDER BY recording_id'),
      convertJournalOn
    );
  }
  if (report.skippedLaps > 0) warn(`migração v5: ${report.skippedLaps} volta(s) com JSON ilegível ficaram sem trajetória`);
  return report;
}
