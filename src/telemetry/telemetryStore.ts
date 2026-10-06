/**
 * O único código que lê e grava `telemetry_series` e `telemetry_blocks` (AD-007).
 * Uma série pertence a um dono (sessão, traçado ou referência) e é guardada em
 * blocos do codec, cada um com a faixa `[t_first, t_last]` dos seus instantes.
 */
import type { SqlConn, SqlTx } from '../storage/sqlConn';
import { BlockError, concatSeries, decodeBlock, emptySeries } from './blockCodec';
import type { Owner, Series, SeriesKind, SeriesMeta, Source, Unit } from './frame';

/** Schema das séries. A migração v5a roda estas instruções; os testes também. */
export const TELEMETRY_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS telemetry_series (
    id TEXT PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    channel TEXT,
    unit TEXT,
    t0_utc REAL,
    legacy INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_series_owner ON telemetry_series(owner_kind, owner_id)',
  `CREATE TABLE IF NOT EXISTS telemetry_blocks (
    series_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    n INTEGER NOT NULL,
    t_first REAL NOT NULL,
    t_last REAL NOT NULL,
    payload BLOB NOT NULL,
    PRIMARY KEY (series_id, seq)
  )`,
];

export type BlockRow = {
  seriesId: string;
  seq: number;
  payload: Uint8Array;
  n: number;
  tFirst: number;
  tLast: number;
};

export type ReadOptions = { kinds?: SeriesKind[]; tFrom?: number; tTo?: number };

// SPEC_DEVIATION: a design tem `readSeries(...): Promise<Series[]>`; aqui volta `{ series, skipped }`.
// Reason: a Error Handling Strategy pede que a leitura pule o bloco ilegível e conte quantos pulou.
export type ReadResult = { series: Series[]; skipped: number };

export async function createSeries(conn: SqlTx, meta: SeriesMeta): Promise<void> {
  await conn.runAsync(
    `INSERT INTO telemetry_series (id, owner_kind, owner_id, source, kind, channel, unit, t0_utc, legacy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    meta.id,
    meta.owner.kind,
    meta.owner.id,
    meta.source,
    meta.kind,
    meta.channel ?? null,
    meta.unit ?? null,
    meta.t0Utc,
    meta.legacy ? 1 : 0
  );
}

/** Grava os blocos numa transação só: ou entram todos, ou nenhum. */
export async function appendBlocks(conn: SqlConn, blocks: BlockRow[]): Promise<void> {
  await conn.withExclusiveTransactionAsync(async (tx) => {
    for (const b of blocks) {
      await tx.runAsync(
        'INSERT INTO telemetry_blocks (series_id, seq, n, t_first, t_last, payload) VALUES (?, ?, ?, ?, ?, ?)',
        b.seriesId,
        b.seq,
        b.n,
        b.tFirst,
        b.tLast,
        b.payload
      );
    }
  });
}

type SeriesRow = {
  id: string;
  owner_kind: Owner['kind'];
  owner_id: string;
  source: Source;
  kind: SeriesKind;
  channel: string | null;
  unit: Unit | null;
  t0_utc: number | null;
  legacy: number;
};

function metaFrom(row: SeriesRow): SeriesMeta {
  const meta: SeriesMeta = {
    id: row.id,
    owner: { kind: row.owner_kind, id: row.owner_id },
    source: row.source,
    kind: row.kind,
    t0Utc: row.t0_utc,
    legacy: row.legacy === 1,
  };
  if (row.channel !== null) meta.channel = row.channel;
  if (row.unit !== null) meta.unit = row.unit;
  return meta;
}

/**
 * Lê as séries do dono, em ordem de criação. Com `tFrom`/`tTo`, lê só os blocos cuja
 * faixa `[t_first, t_last]` cruza a janela; o recorte fino fica com quem chama.
 * Um bloco ilegível (`BlockError`) é pulado e contado.
 */
export async function readSeries(conn: SqlTx, owner: Owner, opts: ReadOptions = {}): Promise<ReadResult> {
  let rows = await conn.getAllAsync<SeriesRow>(
    'SELECT * FROM telemetry_series WHERE owner_kind = ? AND owner_id = ? ORDER BY rowid',
    owner.kind,
    owner.id
  );
  if (opts.kinds) rows = rows.filter((r) => opts.kinds!.includes(r.kind));

  let where = 'series_id = ?';
  const window: number[] = [];
  if (opts.tFrom !== undefined) {
    where += ' AND t_last >= ?';
    window.push(opts.tFrom);
  }
  if (opts.tTo !== undefined) {
    where += ' AND t_first <= ?';
    window.push(opts.tTo);
  }

  const series: Series[] = [];
  let skipped = 0;
  for (const row of rows) {
    const meta = metaFrom(row);
    const blocks = await conn.getAllAsync<{ payload: Uint8Array }>(
      `SELECT payload FROM telemetry_blocks WHERE ${where} ORDER BY seq`,
      row.id,
      ...window
    );
    const parts: Series[] = [];
    for (const b of blocks) {
      try {
        parts.push(decodeBlock(meta, b.payload));
      } catch (e) {
        if (!(e instanceof BlockError)) throw e;
        skipped++;
      }
    }
    series.push(parts.length > 0 ? concatSeries(parts) : emptySeries(meta));
  }
  return { series, skipped };
}

/** Apaga as séries e os blocos do dono. Roda dentro da transação de quem chama. */
export async function deleteOwner(conn: SqlTx, owner: Owner): Promise<void> {
  await conn.runAsync(
    `DELETE FROM telemetry_blocks WHERE series_id IN
       (SELECT id FROM telemetry_series WHERE owner_kind = ? AND owner_id = ?)`,
    owner.kind,
    owner.id
  );
  await conn.runAsync('DELETE FROM telemetry_series WHERE owner_kind = ? AND owner_id = ?', owner.kind, owner.id);
}
