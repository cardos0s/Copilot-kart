/**
 * Repositório de séries sobre SQL real (sql.js): gravação em blocos, leitura por
 * janela, transação única no append, exclusão por dono (TF-09) e bloco corrompido
 * pulado na leitura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBlock } from '../src/telemetry/blockCodec';
import type { GpsSeries, ImuSeries, Owner, Series, SeriesMeta } from '../src/telemetry/frame';
import {
  appendBlocks,
  createSeries,
  deleteOwner,
  readSeries,
  TELEMETRY_SCHEMA,
  type BlockRow,
} from '../src/telemetry/telemetryStore';
import { openSqlJsConn } from './helpers/sqlJsConn';

async function freshConn() {
  const conn = await openSqlJsConn();
  for (const sql of TELEMETRY_SCHEMA) await conn.execAsync(sql);
  return conn;
}

const session: Owner = { kind: 'session', id: 'session_a' };

const gpsMeta = (id: string, owner: Owner = session): SeriesMeta => ({
  id,
  owner,
  source: 'PHONE',
  kind: 'gps',
  t0Utc: 1790000000123,
  legacy: false,
});

function gps(meta: SeriesMeta, n: number): GpsSeries {
  const f = (g: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => g(i));
  return {
    meta,
    n,
    t: f((i) => i * 100 + 0.25),
    lat: f((i) => -25.4 + i * 1e-6),
    lng: f((i) => -49.2 - i * 1e-6),
    speed: f((i) => (i % 37) * 0.7),
    heading: f((i) => (i % 5 === 0 ? NaN : (i * 7) % 360)),
    altitude: new Float64Array(n).fill(NaN),
    accuracy: f((i) => 3 + (i % 40)),
    altitudeAccuracy: new Float64Array(n).fill(NaN),
    gnssTime: f((i) => 1790000000123 + i * 100),
    fix: new Uint8Array(n).fill(3),
    flags: Uint8Array.from({ length: n }, (_, i) => (i % 9 === 0 ? 1 : 0)),
  };
}

function imu(meta: SeriesMeta, n: number): ImuSeries {
  const f = (g: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => g(i));
  return {
    meta,
    n,
    t: f((i) => i * 20 + 0.5),
    ax: f((i) => Math.sin(i)),
    ay: f((i) => Math.cos(i)),
    az: f(() => 9.80665),
    gx: f((i) => (i % 3 === 0 ? NaN : i * 0.001)),
    gy: f(() => 0),
    gz: f((i) => -i * 0.002),
  };
}

/** Os blocos de `perBlock` amostras da série, com seq a partir de 0. */
function blocksOf(s: Series, perBlock: number): BlockRow[] {
  const out: BlockRow[] = [];
  for (let from = 0, seq = 0; from < s.n; from += perBlock, seq++) {
    const to = Math.min(s.n, from + perBlock);
    out.push({
      seriesId: s.meta.id,
      seq,
      payload: encodeBlock(s, from, to),
      n: to - from,
      tFirst: s.t[from],
      tLast: s.t[to - 1],
    });
  }
  return out;
}

const bytes = (a: Float64Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

function assertSameSeries(got: Series, want: Series) {
  assert.deepEqual(got.meta, want.meta);
  assert.equal(got.n, want.n);
  for (const [k, v] of Object.entries(want)) {
    if (v instanceof Float64Array || v instanceof Uint8Array) {
      const g = (got as unknown as Record<string, Float64Array | Uint8Array>)[k];
      assert.deepEqual(bytes(g), bytes(v), `coluna ${k}`);
    }
  }
}

test('grava uma série em 10 blocos e lê de volta igual', async () => {
  const conn = await freshConn();
  const s = gps(gpsMeta('gps-1'), 500);
  await createSeries(conn, s.meta);
  const blocks = blocksOf(s, 50);
  assert.equal(blocks.length, 10);
  await appendBlocks(conn, blocks);

  const { series, skipped } = await readSeries(conn, session);
  assert.equal(skipped, 0);
  assert.equal(series.length, 1);
  assertSameSeries(series[0], s);
});

test('com janela [tFrom, tTo], só os blocos que cruzam a janela são lidos', async () => {
  const conn = await freshConn();
  const s = gps(gpsMeta('gps-1'), 100); // t = i·100 + 0,25; blocos de 10 → bloco k cobre [k·1000 + 0,25, k·1000 + 900,25]
  await createSeries(conn, s.meta);
  const blocks = blocksOf(s, 10);
  // Um bloco ilegível fora da janela: se fosse decodificado, contaria como pulado.
  blocks[9] = { ...blocks[9], payload: new Uint8Array([9, 9, 9]) };
  await appendBlocks(conn, blocks);

  // Janela de 2850 a 4100 cruza os blocos 2, 3 e 4.
  const { series, skipped } = await readSeries(conn, session, { tFrom: 2850, tTo: 4100 });
  assert.equal(skipped, 0);
  assert.equal(series[0].n, 30);
  assert.equal(series[0].t[0], 2000.25);
  assert.equal(series[0].t[29], 4900.25);

  // Janela que toca só a ponta de um bloco (t_last do bloco 5 = 5900,25).
  const edge = await readSeries(conn, session, { tFrom: 5900.25, tTo: 5950 });
  assert.equal(edge.series[0].n, 10);
  assert.equal(edge.series[0].t[0], 5000.25);
});

test('filtro por tipo devolve só as séries pedidas', async () => {
  const conn = await freshConn();
  const g = gps(gpsMeta('gps-1'), 30);
  const i = imu({ ...gpsMeta('imu-1'), kind: 'imu' }, 120);
  await createSeries(conn, g.meta);
  await createSeries(conn, i.meta);
  await appendBlocks(conn, [...blocksOf(g, 10), ...blocksOf(i, 50)]);

  const onlyImu = await readSeries(conn, session, { kinds: ['imu'] });
  assert.equal(onlyImu.series.length, 1);
  assertSameSeries(onlyImu.series[0], i);

  const both = await readSeries(conn, session);
  assert.deepEqual(both.series.map((s) => s.meta.kind), ['gps', 'imu']);
});

test('uma falha no 2º bloco de um appendBlocks não deixa o 1º gravado', async () => {
  const conn = await freshConn();
  const s = gps(gpsMeta('gps-1'), 40);
  await createSeries(conn, s.meta);
  const [b0, b1, b2, b3] = blocksOf(s, 10);
  await appendBlocks(conn, [b0]);

  // O 2º bloco repete o seq 0, que já existe: a chave primária recusa.
  await assert.rejects(appendBlocks(conn, [b1, { ...b2, seq: 0 }, b3]));

  const rows = await conn.getAllAsync<{ seq: number }>(
    'SELECT seq FROM telemetry_blocks WHERE series_id = ? ORDER BY seq',
    'gps-1'
  );
  assert.deepEqual(rows.map((r) => r.seq), [0]);
});

test('deleteOwner apaga séries e blocos daquele dono e não toca nos de outro', async () => {
  const conn = await freshConn();
  const other: Owner = { kind: 'session', id: 'session_b' };
  const layout: Owner = { kind: 'layout', id: 'session_a' }; // mesmo id, outro tipo de dono
  const a = gps(gpsMeta('a-gps'), 30);
  const ai = imu({ ...gpsMeta('a-imu'), kind: 'imu' }, 50);
  const b = gps(gpsMeta('b-gps', other), 30);
  const l = gps(gpsMeta('l-gps', layout), 20);
  for (const s of [a, ai, b, l]) {
    await createSeries(conn, s.meta);
    await appendBlocks(conn, blocksOf(s, 10));
  }

  await conn.withExclusiveTransactionAsync((tx) => deleteOwner(tx, session));

  assert.deepEqual((await readSeries(conn, session)).series, []);
  const series = await conn.getAllAsync<{ id: string }>('SELECT id FROM telemetry_series ORDER BY id');
  assert.deepEqual(series.map((r) => r.id), ['b-gps', 'l-gps']);
  const blocks = await conn.getAllAsync<{ series_id: string; c: number }>(
    'SELECT series_id, COUNT(*) AS c FROM telemetry_blocks GROUP BY series_id ORDER BY series_id'
  );
  assert.deepEqual(blocks, [
    { series_id: 'b-gps', c: 3 },
    { series_id: 'l-gps', c: 2 },
  ]);
  assertSameSeries((await readSeries(conn, other)).series[0], b);
  assertSameSeries((await readSeries(conn, layout)).series[0], l);
});

test('um bloco corrompido é pulado na leitura e a contagem de pulados é devolvida', async () => {
  const conn = await freshConn();
  const s = gps(gpsMeta('gps-1'), 50);
  await createSeries(conn, s.meta);
  const blocks = blocksOf(s, 10);
  const truncated = blocks[2].payload.subarray(0, blocks[2].payload.length - 8);
  const badVersion = blocks[3].payload.slice();
  badVersion[0] = 7;
  blocks[2] = { ...blocks[2], payload: truncated };
  blocks[3] = { ...blocks[3], payload: badVersion };
  await appendBlocks(conn, blocks);

  const { series, skipped } = await readSeries(conn, session);
  assert.equal(skipped, 2);
  assert.equal(series[0].n, 30);
  assert.deepEqual(
    Array.from(series[0].t),
    [...Array.from(s.t.subarray(0, 20)), ...Array.from(s.t.subarray(40, 50))]
  );
});
