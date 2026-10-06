/**
 * Janelas de volta (T17): TF-11 (a volta é uma janela por cruzamentos, e os
 * pontos de fronteira saem na leitura, AD-006) e TF-12 (o corte de 30 m é da
 * análise, e as voltas saem iguais às de antes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { sliceLaps } from '../src/recording/finishSession';
import type { GpsFrame, ImuFrame, SeriesMeta } from '../src/telemetry/frame';
import { analysisGps, lapFrames, sliceLapWindows } from '../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../src/telemetry/series';
import { generateTimedLaps } from './helpers/syntheticTrack';

const T0 = 1_790_000_000_000;
const OWNER = { kind: 'session' as const, id: 'session_rec_1' };
const GPS_META: SeriesMeta = { id: 'g', owner: OWNER, source: 'PHONE', kind: 'gps', t0Utc: T0, legacy: false };
const IMU_META: SeriesMeta = { id: 'i', owner: OWNER, source: 'PHONE', kind: 'imu', t0Utc: T0, legacy: false };

/**
 * Pista sintética em frames (t desde T0). As fixes boas têm precisão de 3 a 7 m.
 * Um a cada 9 pontos, e os 2 primeiros em movimento, são fixes de 45 m deslocadas
 * 40 m; um a cada 13 não tem precisão. Sem o corte, a linha inferida e os
 * cruzamentos mudariam.
 */
function trackFrames(): GpsFrame[] {
  const { samples } = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, startPhase: 0.37, laps: 4, warmupS: 3, t0: T0 });
  const firstMoving = samples.findIndex((s) => s.speed > 0);
  return samples.map((s, i) => {
    const f: GpsFrame = { kind: 'gps', source: 'PHONE', t: s.t - T0, lat: s.lat, lng: s.lng, speed: s.speed, fix: 'unknown' };
    if (i % 9 === 4 || i === firstMoving || i === firstMoving + 1) {
      f.accuracy = 45;
      f.lat += 0.00036;
    } else if (i % 13 === 6) {
      f.lat -= 0.00036;
    } else {
      f.accuracy = 3 + (i % 5);
    }
    return f;
  });
}

const good = (f: GpsFrame) => f.accuracy !== undefined && f.accuracy <= 30;

test('analysisGps: só os frames com precisão definida e ≤ 30 m, na ordem', () => {
  const frames = trackFrames();
  const kept = analysisGps(frames);
  assert.deepEqual(kept, frames.filter(good));
  assert.ok(kept.length < frames.length);

  // O limite é 30 m, inclusive; sem precisão (ou NaN) fica de fora.
  const at = (accuracy?: number): GpsFrame => ({ kind: 'gps', source: 'PHONE', t: 0, lat: 0, lng: 0, speed: 0, fix: 'unknown', accuracy });
  assert.deepEqual(analysisGps([at(30), at(30.0001), at(undefined), at(NaN), at(3)]).map((f) => f.accuracy), [30, 3]);
});

test('sliceLapWindows: com fixes de 45 m, dá as mesmas voltas e cruzamentos que o sliceLaps sobre os frames filtrados em 30 m', () => {
  const frames = trackFrames();
  const windows = sliceLapWindows(frames);
  const expected = sliceLaps(frames.filter(good) as GpsSample[], []);

  assert.ok(expected.length >= 3);
  assert.equal(windows.length, expected.length);
  windows.forEach((w, i) => {
    const first = expected[i].samples[0];
    const last = expected[i].samples[expected[i].samples.length - 1];
    assert.deepEqual(w.window.start, { t: first.t, lat: first.lat, lng: first.lng, speed: first.speed, accuracy: first.accuracy });
    assert.deepEqual(w.window.end, { t: last.t, lat: last.lat, lng: last.lng, speed: last.speed, accuracy: last.accuracy });
    assert.equal(w.durationMs, expected[i].durationMs);
    assert.equal(w.startT, expected[i].startedAt);
  });

  // Sem o corte, a mesma sessão daria outros cruzamentos: o teste distingue.
  const unfiltered = sliceLaps(frames.map((f) => ({ ...f, accuracy: f.accuracy ?? 999 })), []);
  assert.notDeepEqual(unfiltered.map((l) => l.samples[0].t), expected.map((l) => l.samples[0].t));
});

test('lapFrames: janela por cruzamento dá [fronteira, frames internos com ≤ 30 m, fronteira], com as fronteiras sintéticas e a precisão guardada', () => {
  const frames = trackFrames();
  const series = gpsSeriesOf(GPS_META, frames);
  const windows = sliceLapWindows(frames);
  const expected = sliceLaps(frames.filter(good) as GpsSample[], []);

  windows.forEach(({ window }, i) => {
    const { gps } = lapFrames(window, series);
    const { start, end } = window;
    assert.deepEqual(gps[0], { kind: 'gps', source: 'PHONE', fix: 'unknown', synthetic: true, ...start });
    assert.deepEqual(gps[gps.length - 1], { kind: 'gps', source: 'PHONE', fix: 'unknown', synthetic: true, ...end });
    const inner = gps.slice(1, -1);
    assert.deepEqual(inner, frames.filter((f) => good(f) && f.t > start.t && f.t < end.t));
    assert.ok(inner.every((f) => f.synthetic === undefined && f.accuracy! <= 30));
    // Os mesmos pontos que o sliceLaps salvava na volta.
    assert.deepEqual(
      gps.map((f) => [f.t, f.lat, f.lng, f.speed, f.accuracy, f.synthetic]),
      expected[i].samples.map((s) => [s.t, s.lat, s.lng, s.speed, s.accuracy, s.synthetic]),
    );
  });
});

test('lapFrames: a IMU da janela inclui os frames em start.t e em end.t, e nada fora', () => {
  const frames = trackFrames();
  const { window } = sliceLapWindows(frames)[1];
  const imu: ImuFrame[] = [];
  const last = frames[frames.length - 1].t;
  for (let t = 0; t <= last; t += 20) imu.push({ kind: 'imu', source: 'PHONE', t, gyro: { x: 0, y: 0, z: t } });
  // Leituras exatamente nos cruzamentos.
  for (const at of [window.start.t, window.end.t]) imu.push({ kind: 'imu', source: 'PHONE', t: at, gyro: { x: 0, y: 0, z: at } });
  imu.sort((a, b) => a.t - b.t);

  const out = lapFrames(window, gpsSeriesOf(GPS_META, frames), imuSeriesOf(IMU_META, imu)).imu;
  assert.equal(out[0].t, window.start.t);
  assert.equal(out[out.length - 1].t, window.end.t);
  assert.deepEqual(out, imu.filter((s) => s.t >= window.start.t && s.t <= window.end.t));
});

test('lapFrames: janela por índice devolve os frames from..to como estão; kind none devolve vazio', () => {
  const frames = trackFrames();
  const series = gpsSeriesOf(GPS_META, frames);
  const imu: ImuFrame[] = frames.map((f) => ({ kind: 'imu', source: 'PHONE', t: f.t + 1, gyro: { x: 0, y: 0, z: 1 } }));

  const out = lapFrames({ kind: 'index', from: 3, to: 14 }, series, imuSeriesOf(IMU_META, imu));
  // Inclusive a fix de 45 m (índice 4) e a sem precisão (índice 6): o legado vem como está.
  assert.deepEqual(out.gps, frames.slice(3, 15));
  assert.ok(out.gps.some((f) => f.accuracy === 45) && out.gps.some((f) => f.accuracy === undefined));
  assert.deepEqual(out.imu, imu.slice(3, 14));

  assert.deepEqual(lapFrames({ kind: 'none' }, series, imuSeriesOf(IMU_META, imu)), { gps: [], imu: [] });
});
