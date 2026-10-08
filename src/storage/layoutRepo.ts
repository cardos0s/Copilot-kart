/**
 * Traçados sobre séries (TF-19; design §7).
 *
 * O traçado tem frames próprios, com dono `layout:<id>`, e uma janela igual à da
 * volta de onde saiu. Salvar copia os frames da janela da volta para a série do
 * traçado: excluir a sessão de origem não muda o traçado. Ler gera os pontos de
 * fronteira a partir da janela (AD-006), então `frames[0]` continua sendo a
 * fronteira de início que o `lineFromLayout` usa.
 *
 * `track_references` (legado, ainda lido pela silhueta) é lido do dono
 * `reference:<track_id>`.
 *
 * O traçado sem janela e a referência sem série são os que a v5b ainda não
 * converteu (ela falhou e volta na próxima abertura): saem pela mesma conversão,
 * em memória (TF-20 AC 7).
 *
 * Sobre um `SqlConn`: no aparelho é o expo-sqlite (`db.ts`), nos testes o sql.js.
 */
import type { LayoutRepo } from '../recording/finishSession';
import { encodeBlock } from '../telemetry/blockCodec';
import type { GpsFrame, GpsSeries, LapWindow, Owner, SeriesMeta } from '../telemetry/frame';
import { lapFrames } from '../telemetry/laps';
import { legacyJsonPlaceholders, pendingLayout, pendingReference } from '../telemetry/legacy';
import { gpsFramesOf, gpsSeriesOf } from '../telemetry/series';
import { createSeries, deleteOwner, insertBlocks, readSeries } from '../telemetry/telemetryStore';
import type { PbRecord, TrackReference } from './db';
import { windowOf, type WindowRow } from './lapRepo';
import type { SqlConn, SqlTx } from './sqlConn';
import { WINDOW_COLUMN_NAMES, windowColumns } from './sqlSessionRepo';

/**
 * Cada layout é uma referência gravada da pista numa configuração específica
 * (ex: "Layout principal", "Layout curto", "Inverso", "Configuração corrida").
 *
 * Uma pista pode ter N layouts. Sessão referencia o layout escolhido via
 * `session.layoutId`. Quando o piloto cria sessão sem escolher (sessões
 * legadas ou app sem múltiplos layouts), usa o `is_default`.
 */
export type TrackLayout = {
  id: string;
  trackId: string;
  name: string;
  durationMs: number;
  lengthM: number;
  recordedAt: number;
  sourceSessionId?: string;
  sourceLapId?: string;
  isDefault: boolean;
  /** A janela da volta de origem e os frames dela, com as fronteiras (AD-007). */
  window: LapWindow;
  gps: GpsFrame[];
};

type LayoutRow = WindowRow & {
  id: string;
  track_id: string;
  name: string;
  duration_ms: number;
  length_m: number;
  recorded_at: number;
  source_session_id: string | null;
  source_lap_id: string | null;
  is_default: number;
};

export function layoutOwner(layoutId: string): Owner {
  return { kind: 'layout', id: layoutId };
}

export function referenceOwner(trackId: string): Owner {
  return { kind: 'reference', id: trackId };
}

/** Os frames de GPS de um traçado ou de uma referência, para quem desenha ou analisa. */
export function layoutGps(layout: { gps: GpsFrame[] }): GpsFrame[] {
  return layout.gps;
}

async function rowToLayout(conn: SqlTx, row: LayoutRow): Promise<TrackLayout> {
  const base = {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
    isDefault: Boolean(row.is_default),
  };
  const stored = windowOf(row);
  let window: LapWindow;
  let frames: GpsFrame[];
  if (stored) {
    window = stored;
    const { series } = await readSeries(conn, layoutOwner(row.id), { kinds: ['gps'] });
    const gps = series[0] as GpsSeries | undefined;
    frames = gps ? lapFrames(window, gps).gps : [];
  } else {
    const conv = pendingLayout(row);
    window = conv.window;
    frames = lapFrames(window, gpsSeriesOf(layoutMeta(row.id), conv.gps)).gps;
  }
  return { ...base, window, gps: frames };
}

async function rowsToLayouts(conn: SqlTx, rows: LayoutRow[]): Promise<TrackLayout[]> {
  const out: TrackLayout[] = [];
  for (const row of rows) out.push(await rowToLayout(conn, row));
  return out;
}

export async function listLayoutsForTrack(conn: SqlTx, trackId: string): Promise<TrackLayout[]> {
  const rows = await conn.getAllAsync<LayoutRow>(
    'SELECT * FROM track_layouts WHERE track_id = ? ORDER BY is_default DESC, recorded_at DESC',
    trackId
  );
  return rowsToLayouts(conn, rows);
}

export async function getLayout(conn: SqlTx, id: string): Promise<TrackLayout | null> {
  const row = await conn.getFirstAsync<LayoutRow>('SELECT * FROM track_layouts WHERE id = ?', id);
  return row ? rowToLayout(conn, row) : null;
}

export async function getDefaultLayoutForTrack(conn: SqlTx, trackId: string): Promise<TrackLayout | null> {
  // Tenta o default explícito; se ninguém tá marcado, pega o mais recente.
  const row =
    (await conn.getFirstAsync<LayoutRow>(
      'SELECT * FROM track_layouts WHERE track_id = ? AND is_default = 1 LIMIT 1',
      trackId
    )) ??
    (await conn.getFirstAsync<LayoutRow>(
      'SELECT * FROM track_layouts WHERE track_id = ? ORDER BY recorded_at DESC LIMIT 1',
      trackId
    ));
  return row ? rowToLayout(conn, row) : null;
}

/** A série GPS do traçado. O instante absoluto de cada fix fica no `gnssTime`: o traçado não tem início de sessão. */
function layoutMeta(layoutId: string, source: GpsFrame['source'] = 'PHONE', legacy = true): SeriesMeta {
  return { id: `${layoutId}_gps`, owner: layoutOwner(layoutId), source, kind: 'gps', t0Utc: null, legacy };
}

/**
 * O traçado e a série dele, dentro da transação de quem chama. Os frames da volta (sem
 * as fronteiras, que saem da janela na leitura) são copiados para a série `gps` do dono
 * `layout:<id>`, no relógio da sessão de origem. A janela por índice passa a valer sobre
 * essa série, que só tem os frames da volta.
 */
export async function saveLayoutOn(tx: SqlTx, layout: TrackLayout): Promise<void> {
  if (!layout.window || !layout.gps) throw new Error(`traçado ${layout.id} sem a janela e os frames da volta`);
  const frames = layout.gps.filter((f) => !f.synthetic);
  const window: LapWindow =
    layout.window.kind === 'index' ? { kind: 'index', from: 0, to: frames.length - 1 } : layout.window;
  const legacy = await legacyJsonPlaceholders(tx, 'track_layouts');
  const columns = [
    'id', 'track_id', 'name', 'duration_ms', 'length_m', 'recorded_at', 'source_session_id', 'source_lap_id', 'is_default',
    ...WINDOW_COLUMN_NAMES,
    ...legacy.columns,
  ];
  await tx.runAsync(
    `INSERT OR REPLACE INTO track_layouts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    layout.id,
    layout.trackId,
    layout.name,
    layout.durationMs,
    layout.lengthM,
    layout.recordedAt,
    layout.sourceSessionId ?? null,
    layout.sourceLapId ?? null,
    layout.isDefault ? 1 : 0,
    ...windowColumns(window),
    ...legacy.values
  );
  const owner = layoutOwner(layout.id);
  await deleteOwner(tx, owner);
  if (window.kind === 'none') return;

  const meta = layoutMeta(layout.id, frames[0]?.source, frames.some((f) => f.legacy));
  await createSeries(tx, meta);
  if (frames.length === 0) return;
  const series = gpsSeriesOf(meta, frames);
  await insertBlocks(tx, [
    { seriesId: meta.id, seq: 0, n: series.n, tFirst: series.t[0], tLast: series.t[series.n - 1], payload: encodeBlock(series, 0, series.n) },
  ]);
}

/** Grava o traçado e a série dele numa transação. */
export async function saveLayout(conn: SqlConn, layout: TrackLayout): Promise<void> {
  await conn.withExclusiveTransactionAsync((tx) => saveLayoutOn(tx, layout));
}

/** Apaga o traçado e a série dele numa transação. */
export async function deleteLayout(conn: SqlConn, id: string): Promise<void> {
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await deleteOwner(tx, layoutOwner(id));
    await tx.runAsync('DELETE FROM track_layouts WHERE id = ?', id);
  });
}

/** Torna o traçado o padrão da pista e desmarca os outros, dentro da transação de quem chama. */
export async function setDefaultLayoutOn(tx: SqlTx, trackId: string, layoutId: string): Promise<void> {
  await tx.runAsync('UPDATE track_layouts SET is_default = 0 WHERE track_id = ?', trackId);
  await tx.runAsync('UPDATE track_layouts SET is_default = 1 WHERE id = ?', layoutId);
}

/** Dois statements consecutivos, sem transação (risco baixo de race em app single-user). */
export async function setDefaultLayout(conn: SqlConn, trackId: string, layoutId: string): Promise<void> {
  await setDefaultLayoutOn(conn, trackId, layoutId);
}

/** O INSERT do PB, dentro da transação de quem chama. */
export async function insertPbRecord(tx: SqlTx, rec: PbRecord): Promise<void> {
  await tx.runAsync(
    `INSERT INTO pb_records (id, track_id, layout_id, session_id, lap_id, duration_ms, celebrated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    rec.id,
    rec.trackId,
    rec.layoutId,
    rec.sessionId,
    rec.lapId,
    rec.durationMs,
    rec.celebrated ? 1 : 0,
    rec.createdAt
  );
}

/**
 * "ATUALIZAR REFERÊNCIA": grava o traçado novo com a série dele, torna-o o padrão
 * da pista (desmarcando os outros) e grava o PB herdado, numa transação só. Se o
 * app morrer no meio, a pista não fica com dois padrões nem com o traçado novo
 * sem o recorde.
 */
export async function promoteReferenceLayout(conn: SqlConn, layout: TrackLayout, pb: PbRecord | null): Promise<void> {
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await saveLayoutOn(tx, layout);
    await setDefaultLayoutOn(tx, layout.trackId, layout.id);
    if (pb) await insertPbRecord(tx, pb);
  });
}

/**
 * Todos os layouts agrupados por trackId, cada um com a série GPS dele. Usado
 * pelo new-session e pelas silhuetas sem N+1 de JSON.
 */
export async function listAllLayoutsGrouped(conn: SqlTx): Promise<Map<string, TrackLayout[]>> {
  const rows = await conn.getAllAsync<LayoutRow>(
    'SELECT * FROM track_layouts ORDER BY track_id, is_default DESC, recorded_at DESC'
  );
  const out = new Map<string, TrackLayout[]>();
  for (const layout of await rowsToLayouts(conn, rows)) {
    const list = out.get(layout.trackId) ?? [];
    list.push(layout);
    out.set(layout.trackId, list);
  }
  return out;
}

/** O `LayoutRepo` do "Encerrar" de um reconhecimento e da recuperação. */
export function sqlLayoutRepo(conn: () => Promise<SqlConn>): LayoutRepo {
  return {
    listLayoutsForTrack: async (trackId) => listLayoutsForTrack(await conn(), trackId),
    saveLayout: async (layout) => saveLayout(await conn(), layout),
  };
}

// ---------------------------------------------------------------------------
// track_references (legado): lido do dono `reference:<track_id>`
// ---------------------------------------------------------------------------

type ReferenceRow = {
  track_id: string;
  track_name: string;
  duration_ms: number;
  length_m: number;
  recorded_at: number;
  source_session_id: string | null;
  source_lap_id: string | null;
};

/**
 * A referência com os frames da série dela. `track_references` não tem colunas
 * de janela: a série é lida inteira, na ordem. Sem série, é a referência que a v5b
 * ainda não converteu, e ela sai pela mesma conversão, em memória.
 */
async function rowToReference(conn: SqlTx, row: ReferenceRow): Promise<TrackReference> {
  const base = {
    trackId: row.track_id,
    trackName: row.track_name,
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
  };
  const { series } = await readSeries(conn, referenceOwner(row.track_id), { kinds: ['gps'] });
  const frames = series.length > 0 ? gpsFramesOf(series[0] as GpsSeries) : pendingReference(row).gps;
  return { ...base, gps: frames };
}

export async function getTrackReference(conn: SqlTx, trackId: string): Promise<TrackReference | null> {
  const row = await conn.getFirstAsync<ReferenceRow>('SELECT * FROM track_references WHERE track_id = ?', trackId);
  return row ? rowToReference(conn, row) : null;
}

export async function listTrackReferences(conn: SqlTx): Promise<TrackReference[]> {
  const rows = await conn.getAllAsync<ReferenceRow>('SELECT * FROM track_references ORDER BY recorded_at DESC');
  const out: TrackReference[] = [];
  for (const row of rows) out.push(await rowToReference(conn, row));
  return out;
}
