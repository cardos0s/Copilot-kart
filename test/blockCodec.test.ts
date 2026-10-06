/**
 * Codec de bloco: ida e volta exata (TF-22 AC 5, parte do codec), payload
 * desalinhado, coluna toda NaN omitida, orçamento de 5 MB por 20 min (TF-10)
 * e BlockError para bloco ilegível.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BlockError, concatSeries, decodeBlock, encodeBlock } from '../src/telemetry/blockCodec';
import type {
  ChannelSeries,
  GpsSeries,
  ImuSeries,
  Series,
  SeriesKind,
  SeriesMeta,
} from '../src/telemetry/frame';

const meta = (kind: SeriesKind, extra: Partial<SeriesMeta> = {}): SeriesMeta => ({
  id: `s-${kind}`,
  owner: { kind: 'session', id: 'session_x' },
  source: 'PHONE',
  kind,
  t0Utc: 1.79e12,
  legacy: false,
  ...extra,
});

/** Gerador determinístico (mulberry32), para a falha ser reproduzível. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function f64(n: number, gen: (i: number) => number): Float64Array {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = gen(i);
  return a;
}

/** Valor aleatório com ~20% de NaN (ausente). */
const maybe = (r: () => number, scale: number) => () => (r() < 0.2 ? NaN : (r() - 0.5) * scale);

function gpsSeries(n: number, seed = 1, allPresent = false): GpsSeries {
  const r = rng(seed);
  const v = (scale: number) => (allPresent ? () => (r() - 0.5) * scale : maybe(r, scale));
  return {
    meta: meta('gps'),
    n,
    t: f64(n, (i) => i * 100 + r()),
    lat: f64(n, () => -25 + r() * 1e-3),
    lng: f64(n, () => -49 + r() * 1e-3),
    speed: f64(n, () => r() * 40),
    heading: f64(n, v(720)),
    altitude: f64(n, v(2000)),
    accuracy: f64(n, v(80)),
    altitudeAccuracy: f64(n, v(80)),
    gnssTime: f64(n, v(4e12)),
    fix: Uint8Array.from({ length: n }, () => Math.floor(r() * 4)),
    flags: Uint8Array.from({ length: n }, () => Math.floor(r() * 4)),
  };
}

function imuSeries(n: number, seed = 2, allPresent = false): ImuSeries {
  const r = rng(seed);
  const v = (scale: number) => (allPresent ? () => (r() - 0.5) * scale : maybe(r, scale));
  return {
    meta: meta('imu'),
    n,
    t: f64(n, (i) => i * 20 + r()),
    ax: f64(n, v(40)),
    ay: f64(n, v(40)),
    az: f64(n, v(40)),
    gx: f64(n, v(10)),
    gy: f64(n, v(10)),
    gz: f64(n, v(10)),
  };
}

function channelSeries(n: number, seed = 3): ChannelSeries {
  const r = rng(seed);
  return {
    meta: meta('channel', { source: 'MYCHRON', channel: 'RPM', unit: 'rpm' }),
    n,
    t: f64(n, (i) => i * 40 + r()),
    v: f64(n, maybe(r, 30000)),
  };
}

const bytes = (a: Float64Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

const COLUMNS: Record<SeriesKind, string[]> = {
  gps: ['t', 'lat', 'lng', 'speed', 'heading', 'altitude', 'accuracy', 'altitudeAccuracy', 'gnssTime', 'fix', 'flags'],
  imu: ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'],
  channel: ['t', 'v'],
};

/** Igualdade bit a bit de cada coluna, inclusive NaN, no recorte [from, to). */
function assertSameBits(got: Series, want: Series, from = 0, to = want.n) {
  assert.equal(got.n, to - from);
  assert.deepEqual(got.meta, want.meta);
  for (const c of COLUMNS[want.meta.kind]) {
    const g = (got as unknown as Record<string, Float64Array | Uint8Array>)[c];
    const w = (want as unknown as Record<string, Float64Array | Uint8Array>)[c];
    assert.equal(g.constructor, w.constructor, `tipo da coluna ${c}`);
    assert.deepEqual(bytes(g), bytes(w.subarray(from, to)), `coluna ${c}`);
  }
}

test('ida e volta de uma GpsSeries aleatória é bit a bit igual, inclusive NaN', () => {
  const s = gpsSeries(500);
  assert.ok(Number.isNaN(s.heading[s.heading.findIndex((x) => Number.isNaN(x))]));
  assertSameBits(decodeBlock(s.meta, encodeBlock(s, 0, s.n)), s);
  // um recorte [from, to) do meio vira um bloco só com esses pontos
  assertSameBits(decodeBlock(s.meta, encodeBlock(s, 120, 170)), s, 120, 170);
});

test('ida e volta de uma ImuSeries aleatória é bit a bit igual, inclusive NaN', () => {
  const s = imuSeries(2500);
  assertSameBits(decodeBlock(s.meta, encodeBlock(s, 0, s.n)), s);
});

test('ida e volta de uma ChannelSeries aleatória é bit a bit igual, inclusive NaN', () => {
  const s = channelSeries(777);
  assertSameBits(decodeBlock(s.meta, encodeBlock(s, 0, s.n)), s);
});

test('decodifica um payload deslocado em 3 bytes dentro de um Uint8Array maior', () => {
  const s = gpsSeries(64, 9);
  const payload = encodeBlock(s, 0, s.n);
  const big = new Uint8Array(payload.length + 11);
  big.set(payload, 3);
  const view = big.subarray(3, 3 + payload.length);
  assert.equal(view.byteOffset % 8, 3);
  assertSameBits(decodeBlock(s.meta, view), s);
});

test('uma coluna toda NaN não ocupa bytes no payload', () => {
  const n = 50;
  const full = gpsSeries(n, 4, true);
  const noAlt: GpsSeries = { ...full, altitude: new Float64Array(n).fill(NaN) };
  const a = encodeBlock(full, 0, n);
  const b = encodeBlock(noAlt, 0, n);
  // cabeçalho 8 B + 9 colunas Float64 + fix e flags em u8
  assert.equal(a.length, 8 + 9 * 8 * n + 2 * n);
  assert.equal(a.length - b.length, 8 * n);
  const back = decodeBlock(noAlt.meta, b) as GpsSeries;
  assert.equal(back.altitude.length, n);
  assert.ok(back.altitude.every((x) => Number.isNaN(x)));
  assertSameBits(back, noAlt);
});

test('TF-10: 20 min de GPS a 10 Hz e IMU a 50 Hz em blocos de 5 s somam ≤ 5.000.000 bytes', () => {
  // Pior caso: todas as colunas presentes.
  const gps = gpsSeries(20 * 60 * 10, 5, true);
  const imu = imuSeries(20 * 60 * 50, 6, true);
  let total = 0;
  let blocks = 0;
  for (const [s, perBlock] of [[gps, 50], [imu, 250]] as const) {
    for (let from = 0; from < s.n; from += perBlock) {
      total += encodeBlock(s, from, Math.min(s.n, from + perBlock)).length;
      blocks++;
    }
  }
  assert.equal(blocks, 480);
  assert.ok(total <= 5_000_000, `payload de ${total} bytes`);
});

test('concatSeries junta blocos decodificados na série original', () => {
  const s = imuSeries(1000, 7);
  const parts = [0, 250, 500, 750].map((f) => decodeBlock(s.meta, encodeBlock(s, f, f + 250)));
  assertSameBits(concatSeries(parts), s);
});

test('versão desconhecida lança BlockError', () => {
  const s = channelSeries(10);
  const p = encodeBlock(s, 0, s.n).slice();
  p[0] = 2;
  assert.throws(() => decodeBlock(s.meta, p), BlockError);
});

test('tamanho inconsistente lança BlockError (faltando, sobrando, só meio cabeçalho)', () => {
  const s = gpsSeries(20, 8);
  const p = encodeBlock(s, 0, s.n);
  assert.throws(() => decodeBlock(s.meta, p.subarray(0, p.length - 1)), BlockError);
  const longer = new Uint8Array(p.length + 1);
  longer.set(p);
  assert.throws(() => decodeBlock(s.meta, longer), BlockError);
  assert.throws(() => decodeBlock(s.meta, p.subarray(0, 5)), BlockError);
});

test('bloco de outro tipo de série lança BlockError', () => {
  const s = imuSeries(10);
  assert.throws(() => decodeBlock(meta('gps'), encodeBlock(s, 0, s.n)), BlockError);
});
