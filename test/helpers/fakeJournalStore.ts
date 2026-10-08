/**
 * JournalStore dos testes: o `sqlJournalStore` do app sobre SQL real (sql.js),
 * com o registro ativo e as séries como o aparelho guarda, mais a falha de
 * escrita injetável. As leituras auxiliares são síncronas (o sql.js é).
 */
import type { ActiveRecording, JournalStore } from '../../src/recording/journal';
import { recordingOwner } from '../../src/recording/journal';
import { sqlJournalStore } from '../../src/storage/sqlJournalStore';
import { concatSeries, decodeBlock } from '../../src/telemetry/blockCodec';
import type { GpsFrame, GpsSeries, ImuFrame, ImuSeries, SeriesKind, SeriesMeta } from '../../src/telemetry/frame';
import { gpsFramesOf, imuFramesOf } from '../../src/telemetry/series';
import { TELEMETRY_SCHEMA } from '../../src/telemetry/telemetryStore';
import { openSqlJsConn, type SqlJsConn } from './sqlJsConn';

export type FakeJournalStore = JournalStore & {
  conn: SqlJsConn;
  /** Quantas das próximas escritas de blocos devem falhar. */
  failAppends: number;
  /** O registro ativo; atribuir troca (ou apaga, com null) a linha no banco. */
  active: ActiveRecording | null;
};

/** Schema que o diário usa: `recording_active` (v4) e as séries (v5a). */
export const JOURNAL_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS recording_active (id TEXT PRIMARY KEY, meta_json TEXT NOT NULL, started_at INTEGER NOT NULL)',
  ...TELEMETRY_SCHEMA,
];

function rows<T>(conn: SqlJsConn, sql: string, params: (string | number)[] = []): T[] {
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

/** Store sobre uma conexão já aberta (outro teste pode montar o resto do schema nela). */
export async function journalStoreOn(conn: SqlJsConn): Promise<FakeJournalStore> {
  for (const sql of JOURNAL_SCHEMA) await conn.execAsync(sql);
  const real = sqlJournalStore(async () => conn);
  const s = {
    ...real,
    conn,
    failAppends: 0,
    appendBlocks: async (blocks: Parameters<JournalStore['appendBlocks']>[0]) => {
      if (s.failAppends > 0) {
        s.failAppends--;
        throw new Error('database or disk is full');
      }
      await real.appendBlocks(blocks);
    },
  } as FakeJournalStore;
  Object.defineProperty(s, 'active', {
    get(): ActiveRecording | null {
      const r = rows<{ id: string; meta_json: string; started_at: number }>(
        conn,
        'SELECT id, meta_json, started_at FROM recording_active ORDER BY started_at ASC LIMIT 1'
      )[0];
      return r ? { id: r.id, metaJson: r.meta_json, startedAt: r.started_at } : null;
    },
    set(v: ActiveRecording | null) {
      conn.db.run('DELETE FROM recording_active');
      if (v) conn.db.run('INSERT INTO recording_active VALUES (?, ?, ?)', [v.id, v.metaJson, v.startedAt]);
    },
  });
  return s;
}

export async function fakeJournalStore(): Promise<FakeJournalStore> {
  return journalStoreOn(await openSqlJsConn());
}

type SeriesRow = { id: string; source: SeriesMeta['source']; kind: SeriesKind; t0_utc: number | null; legacy: number };

function seriesRows(store: FakeJournalStore, recordingId: string): SeriesRow[] {
  const owner = recordingOwner(recordingId);
  return rows<SeriesRow>(
    store.conn,
    'SELECT id, source, kind, t0_utc, legacy FROM telemetry_series WHERE owner_kind = ? AND owner_id = ? ORDER BY rowid',
    [owner.kind, owner.id]
  );
}

/** Metas das séries da gravação, como estão no banco. */
export function persistedSeries(store: FakeJournalStore, recordingId: string): SeriesMeta[] {
  const owner = recordingOwner(recordingId);
  return seriesRows(store, recordingId).map((r) => ({
    id: r.id,
    owner,
    source: r.source,
    kind: r.kind,
    t0Utc: r.t0_utc,
    legacy: r.legacy === 1,
  }));
}

/** Quantos blocos a gravação tem, por tipo de série. */
export function blockCounts(store: FakeJournalStore, recordingId: string): Partial<Record<SeriesKind, number>> {
  const out: Partial<Record<SeriesKind, number>> = {};
  for (const r of seriesRows(store, recordingId)) {
    out[r.kind] = rows<{ c: number }>(store.conn, 'SELECT COUNT(*) AS c FROM telemetry_blocks WHERE series_id = ?', [r.id])[0].c;
  }
  return out;
}

/** Quantos blocos existem no banco inteiro (de qualquer gravação). */
export function totalBlocks(store: FakeJournalStore): number {
  return rows<{ c: number }>(store.conn, 'SELECT COUNT(*) AS c FROM telemetry_blocks')[0].c;
}

function persisted(store: FakeJournalStore, recordingId: string, kind: 'gps' | 'imu') {
  const meta = persistedSeries(store, recordingId).find((m) => m.kind === kind);
  if (!meta) return null;
  const parts = rows<{ payload: Uint8Array }>(
    store.conn,
    'SELECT payload FROM telemetry_blocks WHERE series_id = ? ORDER BY seq',
    [meta.id]
  ).map((b) => decodeBlock(meta, b.payload));
  return parts.length > 0 ? concatSeries(parts) : null;
}

/** Todos os frames de GPS já gravados de uma gravação, na ordem dos blocos. */
export function persistedGps(store: FakeJournalStore, recordingId: string): GpsFrame[] {
  const s = persisted(store, recordingId, 'gps');
  return s ? gpsFramesOf(s as GpsSeries) : [];
}

/** Todos os frames de IMU já gravados de uma gravação, na ordem dos blocos. */
export function persistedImu(store: FakeJournalStore, recordingId: string): ImuFrame[] {
  const s = persisted(store, recordingId, 'imu');
  return s ? imuFramesOf(s as ImuSeries) : [];
}

/**
 * Os pontos de um gerador de pista (tempo absoluto) como os frames que a captura
 * entregaria ao diário de uma sessão que começou em `t0Utc`.
 */
export function asFrames(samples: GpsFrame[], t0Utc: number): GpsFrame[] {
  return samples.map((p) => {
    const f: GpsFrame = { kind: 'gps', source: 'PHONE', t: p.t - t0Utc, lat: p.lat, lng: p.lng, speed: p.speed, fix: 'unknown' };
    f.accuracy = p.accuracy;
    if (p.heading !== undefined) f.heading = p.heading;
    if (p.altitude !== undefined) f.altitude = p.altitude;
    if (p.altitudeAccuracy !== undefined) f.altitudeAccuracy = p.altitudeAccuracy;
    return f;
  });
}
