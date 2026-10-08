/**
 * Traçados sobre séries (T23) em SQL real (sql.js): TF-19 (o traçado tem frames
 * próprios, com dono `layout:<id>`, e dá a mesma linha de chegada que a volta de
 * origem) e a leitura de `track_references` pelo dono `reference:<track_id>`.
 * O traçado ou a referência que a v5b ainda não converteu sai pela mesma conversão.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineFromLayout } from '../src/lib/startLine';
import { saveReferenceLayout, type RecordedLap } from '../src/recording/finishSession';
import { sessionOwner } from '../src/storage/lapRepo';
import {
  deleteLayout,
  getLayout,
  getTrackReference,
  listAllLayoutsGrouped,
  listTrackReferences,
  saveLayout,
  sqlLayoutRepo,
  type TrackLayout,
} from '../src/storage/layoutRepo';
import type { GpsFrame } from '../src/telemetry/frame';
import { gpsSeriesOf } from '../src/telemetry/series';
import { encodeBlock } from '../src/telemetry/blockCodec';
import { appendBlocks, createSeries, deleteOwner } from '../src/telemetry/telemetryStore';
import { stopResult } from './helpers/recordingResult';
import { imuFrames, sessionOnDb, trackFrames } from './helpers/sessionOnDb';
import { insertOldLayout, oldPoint, type OldPoint } from './helpers/v4Database';
import { openV5Database, rowsOf } from './helpers/v5Database';

const T0 = 1_790_000_000_000;

/** Uma sessão salva (séries + janelas) e as voltas como o `stop()` as devolve. */
async function recordedSession() {
  const db = await openV5Database();
  const gps = trackFrames(4);
  const imu = imuFrames(gps);
  const session = await sessionOnDb(db.conn, { recordingId: 'rec_1', gps, imu, t0Utc: T0 });
  const laps: RecordedLap[] = stopResult(gps, imu, T0).laps;
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const layout = await saveReferenceLayout(
    { recordingId: 'rec_1', trackId: 'track_1', layoutName: null, laps, recordedAt: T0 + 300_000 },
    sqlLayoutRepo(async () => db.conn)
  );
  return { ...db, session, laps, best, layout };
}

test('saveReferenceLayout (sql.js): o traçado salvo a partir de uma volta devolve os frames dela, com frames[0] sintético, e lineFromLayout dá a mesma linha da volta', async () => {
  const r = await recordedSession();
  const read = (await getLayout(r.conn, r.layout.id))!;

  assert.equal(read.gps![0].synthetic, true);
  assert.equal(read.gps![read.gps!.length - 1].synthetic, true);
  assert.deepEqual(read.gps, r.best.gps);
  assert.deepEqual(read.window, r.best.window);
  // Migrado na T46: era `read.samples === read.gps` (o alias de transição); o alias saiu.
  assert.equal('samples' in read, false);
  assert.deepEqual(lineFromLayout(read.gps), lineFromLayout(r.best.gps));
  assert.ok(lineFromLayout(read.gps));

  // Frames próprios: a série gps do dono layout:<id>, só com os frames internos (as
  // fronteiras saem da janela), e nenhum JSON de amostra.
  const inner = r.best.gps!.filter((f) => !f.synthetic).length;
  assert.deepEqual(
    rowsOf(r.conn, `SELECT s.kind, SUM(b.n) AS n FROM telemetry_series s JOIN telemetry_blocks b ON b.series_id = s.id
                    WHERE s.owner_kind = 'layout' AND s.owner_id = ? GROUP BY s.kind`, [r.layout.id]),
    [{ kind: 'gps', n: inner }]
  );
  assert.deepEqual(rowsOf(r.conn, 'SELECT samples_json, window_kind FROM track_layouts WHERE id = ?', [r.layout.id]), [
    { samples_json: '[]', window_kind: 'cross' },
  ]);

  // As silhuetas leem a mesma série.
  const grouped = await listAllLayoutsGrouped(r.conn);
  assert.deepEqual(grouped.get('track_1')!.map((l) => l.gps), [r.best.gps]);
});

test('layoutRepo (sql.js): excluir a sessão de origem (voltas, séries e blocos) não muda os frames do traçado', async () => {
  const r = await recordedSession();
  const before = (await getLayout(r.conn, r.layout.id))!;

  await r.conn.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM laps WHERE session_id = ?', r.session.sessionId);
    await deleteOwner(tx, sessionOwner(r.session.sessionId));
    await tx.runAsync('DELETE FROM sessions WHERE id = ?', r.session.sessionId);
  });
  assert.deepEqual(rowsOf(r.conn, "SELECT id FROM telemetry_series WHERE owner_kind = 'session'"), []);

  const after = (await getLayout(r.conn, r.layout.id))!;
  assert.deepEqual(after.gps, before.gps);
  assert.ok(after.gps!.length > 300);
});

test('deleteLayout (sql.js): apaga o traçado e a série dele, e o de outra pista fica', async () => {
  const r = await recordedSession();
  const other: TrackLayout = { ...r.layout, id: 'layout_other', trackId: 'track_2' };
  await saveLayout(r.conn, other);

  await deleteLayout(r.conn, r.layout.id);
  assert.equal(await getLayout(r.conn, r.layout.id), null);
  assert.deepEqual(rowsOf(r.conn, "SELECT owner_id FROM telemetry_series WHERE owner_kind = 'layout'"), [{ owner_id: 'layout_other' }]);
  assert.deepEqual((await getLayout(r.conn, 'layout_other'))!.gps, r.best.gps);
});

/**
 * Migrado na T44: substitui "traçado sem janela (ainda em JSON, até a v5b) é gravado e
 * lido pelo JSON, como antes". O traçado que a v5b ainda não converteu é lido pela
 * mesma conversão, com os mesmos pontos; gravar um traçado sem janela não existe mais.
 */
test('layoutRepo (sql.js): traçado que a v5b ainda não converteu (JSON, sem janela) sai com os mesmos pontos pela conversão; gravar sem janela é recusado', async () => {
  const { conn } = await openV5Database();
  const samples: OldPoint[] = [
    { t: T0 + 1000, lat: -14.86, lng: -40.84, speed: 10, accuracy: 4, synthetic: true },
    { t: T0 + 1100, lat: -14.8601, lng: -40.8401, speed: 11, accuracy: 5 },
    { t: T0 + 1200, lat: -14.8602, lng: -40.8402, speed: 12, accuracy: 4, synthetic: true },
  ];
  await insertOldLayout(conn, {
    id: 'layout_old',
    trackId: 'track_1',
    samples,
    durationMs: 38_000,
    lengthM: 500,
    recordedAt: T0,
    sourceSessionId: 'session_old',
    sourceLapId: 'session_old_lap_2',
  });

  const read = (await getLayout(conn, 'layout_old'))!;
  assert.deepEqual(
    [read.name, read.durationMs, read.lengthM, read.recordedAt, read.sourceSessionId, read.sourceLapId, read.isDefault],
    ['Layout principal', 38_000, 500, T0, 'session_old', 'session_old_lap_2', true]
  );
  assert.equal(read.window!.kind, 'cross');
  assert.deepEqual(read.gps!.map((f) => oldPoint(f, 0)), samples);
  // Migrado na T46: era `read.samples === read.gps` (o alias de transição); o alias saiu.
  assert.equal('samples' in read, false);
  assert.deepEqual(rowsOf(conn, 'SELECT COUNT(*) AS c FROM telemetry_series'), [{ c: 0 }]);

  // O tipo exige janela e frames; o repositório recusa também quem chega sem eles em tempo de execução.
  const { window: _w, gps: _g, ...withoutWindow } = read;
  await assert.rejects(saveLayout(conn, { ...withoutWindow, id: 'layout_sem_janela' } as unknown as TrackLayout), /sem a janela/);
  assert.equal(await getLayout(conn, 'layout_sem_janela'), null);
});

test('saveLayout (sql.js, TF-19): a janela por índice de uma volta vale sobre a série do traçado, que só tem os frames dela', async () => {
  const { conn } = await openV5Database();
  const frames: GpsFrame[] = trackFrames(1).slice(20, 25).map((f) => ({ ...f, accuracy: 4, legacy: true }));
  const layout: TrackLayout = {
    id: 'layout_index',
    trackId: 'track_1',
    name: 'Layout principal',
    gps: frames,
    window: { kind: 'index', from: 120, to: 124 },
    durationMs: 400,
    lengthM: 40,
    recordedAt: T0,
    isDefault: true,
  };
  await saveLayout(conn, layout);
  const read = (await getLayout(conn, 'layout_index'))!;
  assert.deepEqual(read.window, { kind: 'index', from: 0, to: 4 });
  assert.deepEqual(read.gps, frames);
});

const REFERENCES = `CREATE TABLE track_references (
  track_id TEXT PRIMARY KEY, track_name TEXT NOT NULL, samples_json TEXT NOT NULL, duration_ms INTEGER NOT NULL,
  length_m REAL NOT NULL, recorded_at INTEGER NOT NULL, source_session_id TEXT, source_lap_id TEXT
)`;

/**
 * Migrado na T44: a referência sem série (que a v5b ainda não converteu) saía do JSON
 * cru; agora sai pela mesma conversão, com os mesmos pontos em frames.
 */
test('track_references (sql.js): a referência é lida da série do dono reference:<track_id>; sem série, pela conversão da v5b', async () => {
  const { conn } = await openV5Database();
  await conn.execAsync(REFERENCES);
  const oldSamples = [{ t: T0, lat: -14.9, lng: -40.9, speed: 9, accuracy: 6 }];
  await conn.runAsync(
    `INSERT INTO track_references VALUES ('track_a', 'Pista A', ?, 40000, 600, ?, NULL, NULL),
                                          ('track_b', 'Pista B', '[]', 41000, 610, ?, 's_b', 'l_b')`,
    JSON.stringify(oldSamples),
    T0 + 1,
    T0 + 2
  );
  const frames: GpsFrame[] = trackFrames(1).slice(0, 40).map((f) => ({ ...f, legacy: true }));
  const meta = { id: 'ref_b_gps', owner: { kind: 'reference' as const, id: 'track_b' }, source: 'PHONE' as const, kind: 'gps' as const, t0Utc: T0, legacy: true };
  const series = gpsSeriesOf(meta, frames);
  await conn.withExclusiveTransactionAsync((tx) => createSeries(tx, meta));
  await appendBlocks(conn, [{ seriesId: meta.id, seq: 0, n: series.n, tFirst: series.t[0], tLast: series.t[series.n - 1], payload: encodeBlock(series, 0, series.n) }]);

  const b = (await getTrackReference(conn, 'track_b'))!;
  assert.deepEqual(b.gps, frames);
  // Migrado na T46: era `b.samples === b.gps` (o alias de transição); o alias saiu.
  assert.equal('samples' in b, false);
  assert.deepEqual([b.trackName, b.durationMs, b.lengthM, b.sourceSessionId, b.sourceLapId], ['Pista B', 41000, 610, 's_b', 'l_b']);

  const a = (await getTrackReference(conn, 'track_a'))!;
  assert.deepEqual(a.gps!.map((f) => oldPoint(f, 0)), oldSamples);
  // Migrado na T46: era `a.samples === a.gps` (o alias de transição); o alias saiu.
  assert.equal('samples' in a, false);

  assert.deepEqual((await listTrackReferences(conn)).map((x) => [x.trackId, x.gps.length]), [['track_b', 40], ['track_a', 1]]);
});
