/**
 * Contrato multi-fonte (TF-21, TF-22): uma sessão sintética de MyChron, com canais
 * em quatro taxas, rpm, temperatura e GPS com trecho sem fix, é gravada pelo
 * telemetryStore (SQL real no sql.js) e lida de volta sem diferença.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBlock } from '../src/telemetry/blockCodec';
import { UnitError, type FixState, type GpsSeries, type Owner, type Series } from '../src/telemetry/frame';
import { channelSeries, fixState, gpsSeriesFrom } from '../src/telemetry/series';
import {
  appendBlocks,
  createSeries,
  readSeries,
  TELEMETRY_SCHEMA,
  type BlockRow,
} from '../src/telemetry/telemetryStore';
import { openSqlJsConn } from './helpers/sqlJsConn';

const owner: Owner = { kind: 'session', id: 'session_mychron' };
const T0 = 1790000000000;
const DURATION_S = 60;

const base = (id: string) => ({ id, owner, source: 'MYCHRON' as const, t0Utc: T0, legacy: false });

/** Instantes de uma taxa em Hz, com um deslocamento próprio (o logger não alinha os canais). */
const times = (hz: number, offsetMs: number) =>
  Array.from({ length: DURATION_S * hz }, (_, i) => offsetMs + (i * 1000) / hz);

/** Blocos de 5 s, como o diário grava. */
function blocks5s(s: Series): BlockRow[] {
  const out: BlockRow[] = [];
  let from = 0;
  for (let seq = 0; from < s.n; seq++) {
    let to = from;
    while (to < s.n && s.t[to] < (seq + 1) * 5000) to++;
    if (to === from) continue;
    out.push({ seriesId: s.meta.id, seq, payload: encodeBlock(s, from, to), n: to - from, tFirst: s.t[from], tLast: s.t[to - 1] });
    from = to;
  }
  return out;
}

const bytes = (a: Float64Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

test('sessão MYCHRON com canais a 1, 20, 25 e 50 Hz, rpm, °C e GPS sem fix volta igual', async () => {
  const temp = times(1, 3);
  const throttle = times(20, 7);
  const steering = times(25, 11);
  const rpm = times(50, 1);
  const channels = [
    channelSeries({ ...base('ch-temp'), channel: 'Water Temp', unit: '°C' }, temp, temp.map((t) => 60 + t / 10000)),
    channelSeries({ ...base('ch-thr'), channel: 'Throttle', unit: '%' }, throttle, throttle.map((t) => (t / 37) % 100)),
    channelSeries({ ...base('ch-steer'), channel: 'Steering', unit: 'deg' }, steering, steering.map((t) => Math.sin(t / 900) * 90)),
    channelSeries({ ...base('ch-rpm'), channel: 'RPM', unit: 'rpm' }, rpm, rpm.map((t, i) => (i % 13 === 0 ? NaN : 8000 + Math.cos(t / 500) * 6000))),
  ];

  // GPS a 10 Hz: os pontos 200 a 249 estão sem fix (túnel, perda de sinal).
  const gt = times(10, 5);
  const fix: FixState[] = gt.map((_, i) => (i >= 200 && i < 250 ? 'none' : '3d'));
  const gps = gpsSeriesFrom(base('gps'), {
    t: gt,
    lat: gt.map((t) => -25.45 + t * 1e-9),
    lng: gt.map((t) => -49.25 - t * 1e-9),
    speed: gt.map((t) => 20 + Math.sin(t / 3000) * 10),
    heading: gt.map((t) => (t / 100) % 360),
    accuracy: gt.map((_, i) => (fix[i] === 'none' ? NaN : 1.5)),
    fix,
  });

  const conn = await openSqlJsConn();
  for (const sql of TELEMETRY_SCHEMA) await conn.execAsync(sql);
  const all: Series[] = [...channels, gps];
  for (const s of all) await createSeries(conn, s.meta);
  await appendBlocks(conn, all.flatMap(blocks5s));

  const { series, skipped } = await readSeries(conn, owner);
  assert.equal(skipped, 0);
  assert.deepEqual(series.map((s) => s.meta), all.map((s) => s.meta));

  // Cada série mantém a própria taxa e todos os valores, bit a bit.
  assert.deepEqual(series.slice(0, 4).map((s) => s.n), [60, 1200, 1500, 3000]);
  for (let k = 0; k < all.length; k++) {
    const want = all[k] as unknown as Record<string, unknown>;
    const got = series[k] as unknown as Record<string, unknown>;
    for (const [col, v] of Object.entries(want)) {
      if (v instanceof Float64Array || v instanceof Uint8Array) {
        assert.deepEqual(bytes(got[col] as Float64Array), bytes(v), `${all[k].meta.id}.${col}`);
      }
    }
  }
  assert.deepEqual(Array.from(series[3].t), rpm);
  assert.deepEqual(Array.from(series[0].t), temp);

  // As unidades e os nomes dos canais voltam como entraram.
  assert.deepEqual(series.slice(0, 4).map((s) => [s.meta.channel, s.meta.unit, s.meta.source]), [
    ['Water Temp', '°C', 'MYCHRON'],
    ['Throttle', '%', 'MYCHRON'],
    ['Steering', 'deg', 'MYCHRON'],
    ['RPM', 'rpm', 'MYCHRON'],
  ]);

  // TF-22 AC 4: os 50 pontos sem fix voltam com fix `none`, os demais com `3d`.
  const back = series[4] as GpsSeries;
  const states = Array.from(back.fix, fixState);
  assert.equal(states.filter((s) => s === 'none').length, 50);
  assert.deepEqual(states, fix);
  conn.close();
});

test("um canal em 'bar' é recusado com UnitError que nomeia o canal", () => {
  assert.throws(
    () => channelSeries({ ...base('ch-brk'), channel: 'Brake Press', unit: 'bar' }, [0, 50], [1.2, 3.4]),
    (e: unknown) => e instanceof UnitError && e.channel === 'Brake Press' && e.unit === 'bar' && /Brake Press/.test(e.message)
  );
});
