/**
 * Gravação simulada (T19): TF-06 (o `t` é estritamente crescente, inclusive
 * quando o laço do GPX de bench reinicia) e TF-05 (frames no relógio da sessão).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_LAP } from '../src/data/demoLap';
import { createSessionClock } from '../src/recording/sessionClock';
import { createSimulation } from '../src/recording/simulation';
import type { GpsFrame } from '../src/telemetry/frame';

const T0_UTC = 1_790_000_000_000;

test('simulação: o gerador nunca repete t quando o laço reinicia', () => {
  // Três pontos de 100 ms: o laço fecha em t = 200 e o 1º ponto do laço novo
  // cai no mesmo instante do último do anterior.
  const points = [
    { t: 0, lat: -14.8619, lng: -40.8444, speed: 0 },
    { t: 100, lat: -14.8618, lng: -40.8444, speed: 5 },
    { t: 200, lat: -14.8617, lng: -40.8444, speed: 6 },
  ];
  const sim = createSimulation(points, createSessionClock(T0_UTC), 1, T0_UTC);
  const frames: GpsFrame[] = [];
  for (let now = T0_UTC; now <= T0_UTC + 1000; now += 100) frames.push(...sim.step(now));

  assert.ok(frames.length >= 9, `${frames.length} frames`);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].t > frames[i - 1].t, `t[${i}] = ${frames[i].t} não passa de ${frames[i - 1].t}`);
  }
  // O 1º ponto do 2º laço sairia em 200 (o mesmo do último do 1º): o relógio o empurra.
  assert.deepEqual(frames.slice(0, 5).map((f) => f.t), [0, 100, 200, 201, 300]);
  assert.deepEqual(frames.slice(0, 4).map((f) => f.lat), [-14.8619, -14.8618, -14.8617, -14.8619]);
});

test('simulação: o DEMO_LAP em laço sai em frames de GPS do celular, com t desde o início da sessão', () => {
  const sim = createSimulation(DEMO_LAP, createSessionClock(T0_UTC), 1, T0_UTC + 5_000);
  const frames: GpsFrame[] = [];
  const loopMs = DEMO_LAP[DEMO_LAP.length - 1].t;
  for (let now = T0_UTC + 5_000; now <= T0_UTC + 5_000 + 2 * loopMs + 1_000; now += 80) frames.push(...sim.step(now));

  assert.ok(frames.length > 2 * DEMO_LAP.length);
  assert.deepEqual(frames[0], {
    kind: 'gps',
    source: 'PHONE',
    t: 5_000,
    lat: DEMO_LAP[0].lat,
    lng: DEMO_LAP[0].lng,
    speed: DEMO_LAP[0].speed,
    accuracy: 3,
    fix: 'unknown',
  });
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].t > frames[i - 1].t, `t[${i}]`);
});
