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
 * Transição (até a v5b/v5c, T43/T44): o traçado sem janela (ainda em JSON, ou salvo
 * a partir de uma volta que ainda não foi convertida) e a referência sem série
 * continuam lidos e gravados pelo `samples_json`.
 *
 * Sobre um `SqlConn`: no aparelho é o expo-sqlite (`db.ts`), nos testes o sql.js.
 */
import type { GpsSample } from '../lib/geometry';
import type { LayoutRepo } from '../recording/finishSession';
import { encodeBlock } from '../telemetry/blockCodec';
import type { GpsFrame, GpsSeries, LapWindow, Owner, SeriesMeta } from '../telemetry/frame';
import { lapFrames } from '../telemetry/laps';
import { gpsFramesOf, gpsSeriesOf } from '../telemetry/series';
import { createSeries, deleteOwner, insertBlocks, readSeries } from '../telemetry/telemetryStore';
import type { PbRecord, TrackReference } from './db';
import { windowOf, type WindowRow } from './lapRepo';
import type { SqlConn, SqlTx } from './sqlConn';
import { windowColumns } from './sqlSessionRepo';

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
  samples: GpsSample[];
  durationMs: number;
  lengthM: number;
  recordedAt: number;
  sourceSessionId?: string;
  sourceLapId?: string;
  isDefault: boolean;
  /**
   * A janela da volta de origem e os frames dela, com as fronteiras (AD-007).
   * Ausentes no traçado ainda em JSON (até a v5b). Transição (até a T46): `samples`
   * aponta para o mesmo array de `gps`.
   */
  window?: LapWindow;
  gps?: GpsFrame[];
};

type LayoutRow = WindowRow & {
  id: string;
  track_id: string;
  name: string;
  samples_json: string;
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

/** `samples_json` é NOT NULL até a v5c (T44) remover a coluna: o traçado com janela leva um array vazio. */
const NO_SAMPLES_JSON = '[]';

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
  const window = windowOf(row);
  // Transição (até a v5b): traçado sem janela sai do JSON, como antes.
  if (!window) return { ...base, samples: JSON.parse(row.samples_json) };
  const { series } = await readSeries(conn, layoutOwner(row.id), { kinds: ['gps'] });
  const gps = series[0] as GpsSeries | undefined;
  const frames = gps ? lapFrames(window, gps).gps : [];
  return { ...base, window, gps: frames, samples: frames as GpsSample[] };
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

/**
 * O traçado e a série dele, dentro da transação de quem chama. Com janela, os
 * frames da volta (sem as fronteiras, que saem da janela na leitura) são copiados
 * para a série `gps` do dono `layout:<id>`, no relógio da sessão de origem.
 */
export async function saveLayoutOn(tx: SqlTx, layout: TrackLayout): Promise<void> {
  const withFrames = layout.window !== undefined && layout.gps !== undefined;
  await tx.runAsync(
    `INSERT OR REPLACE INTO track_layouts
     (id, track_id, name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id, is_default,
      window_kind, from_idx, to_idx,
      start_t, start_lat, start_lng, start_speed, start_acc,
      end_t, end_lat, end_lng, end_speed, end_acc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    layout.id,
    layout.trackId,
    layout.name,
    withFrames ? NO_SAMPLES_JSON : JSON.stringify(layout.samples),
    layout.durationMs,
    layout.lengthM,
    layout.recordedAt,
    layout.sourceSessionId ?? null,
    layout.sourceLapId ?? null,
    layout.isDefault ? 1 : 0,
    ...windowColumns(withFrames ? layout.window : undefined)
  );
  const owner = layoutOwner(layout.id);
  await deleteOwner(tx, owner);
  if (!withFrames) return;

  const frames = layout.gps!.filter((f) => !f.synthetic);
  // O instante absoluto de cada fix fica no `gnssTime`; o traçado não tem início de sessão.
  const meta: SeriesMeta = {
    id: `${layout.id}_gps`,
    owner,
    source: frames[0]?.source ?? 'PHONE',
    kind: 'gps',
    t0Utc: null,
    legacy: false,
  };
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
  samples_json: string;
  duration_ms: number;
  length_m: number;
  recorded_at: number;
  source_session_id: string | null;
  source_lap_id: string | null;
};

/**
 * A referência com os frames da série dela. `track_references` não tem colunas
 * de janela: a série é lida inteira, na ordem. Transição (até a v5b): referência
 * sem série sai do JSON, como antes.
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
  if (series.length === 0) return { ...base, samples: JSON.parse(row.samples_json) };
  const frames = gpsFramesOf(series[0] as GpsSeries);
  return { ...base, gps: frames, samples: frames as GpsSample[] };
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
