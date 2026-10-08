/**
 * Ponto de frenagem B (TF-14, T1): a regra que estava inline em
 * `app/session/[id].tsx`, agora em `hardestBraking`. Maior desaceleração entre
 * pontos consecutivos, com intervalo entre 0,05 s e 5 s, e só acima de 3 m/s².
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsFrame } from '../src/telemetry/frame';
import { hardestBraking } from '../src/lib/brakingPoint';

const T0 = 1_790_000_000_000;

function pt(t: number, speed: number, i: number): GpsFrame {
  return { kind: 'gps', source: 'PHONE', fix: 'unknown', t: T0 + t, lat: -14.86 + i * 1e-5, lng: -40.84 - i * 1e-5, speed, accuracy: 4 };
}

/**
 * Reta a 25 m/s a cada 200 ms, uma frenagem de 25 para 10 m/s em 1 s (pontos
 * 5 → 6), retomada e uma frenagem mais leve, de 20 para 15 m/s em 1 s (5 m/s²).
 */
function lapWithKnownBraking(): GpsFrame[] {
  const out: GpsFrame[] = [];
  let t = 0;
  const speeds = [25, 25, 25, 25, 25, 25];
  speeds.forEach((v) => {
    out.push(pt(t, v, out.length));
    t += 200;
  });
  t += 800; // o ponto seguinte vem 1 s depois do anterior
  out.push(pt(t, 10, out.length)); // índice 6: 25 → 10 em 1 s = 15 m/s²
  for (const v of [12, 15, 18, 20]) {
    t += 200;
    out.push(pt(t, v, out.length));
  }
  t += 1000;
  out.push(pt(t, 15, out.length)); // índice 11: 20 → 15 em 1 s = 5 m/s²
  return out;
}

test('hardestBraking: a frenagem de 25 para 10 m/s em 1 s dá o ponto 6 e 15 m/s²', () => {
  const samples = lapWithKnownBraking();
  const b = hardestBraking(samples);
  assert.ok(b);
  assert.equal(b.index, 6);
  assert.equal(b.decelMs2, 15);
  assert.equal(b.lat, samples[6].lat);
  assert.equal(b.lng, samples[6].lng);
});

test('hardestBraking: intervalos de até 0,05 s e de 5 s ou mais não contam', () => {
  // 30 → 0 em 0,05 s (600 m/s²) e 30 → 0 em 5 s (6 m/s²) ficam de fora; vale 20 → 10 em 2 s.
  const samples = [
    pt(0, 30, 0),
    pt(50, 0, 1),
    pt(1050, 30, 2),
    pt(6050, 0, 3),
    pt(7050, 20, 4),
    pt(9050, 10, 5),
  ];
  const b = hardestBraking(samples);
  assert.ok(b);
  assert.equal(b.index, 5);
  assert.equal(b.decelMs2, 5);
});

test('hardestBraking: desaceleração de até 3 m/s² não marca ponto', () => {
  // 20 → 17 em 1 s = 3 m/s² exatos: o corte é estrito.
  assert.equal(hardestBraking([pt(0, 20, 0), pt(1000, 17, 1)]), null);
  assert.equal(hardestBraking([pt(0, 20, 0)]), null);
  assert.equal(hardestBraking([]), null);
});
