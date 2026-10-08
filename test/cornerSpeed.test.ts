/**
 * Velocidade mínima por curva (TF-14, T2): a regra que estava inline em
 * `app/track-map.tsx`, agora em `minSpeedPerCorner`. Menor velocidade dos
 * pontos casados dentro de [sStart, sEnd], em km/h; curva sem ponto vale 0;
 * `deltaVsBest` é a diferença para a maior mínima.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchLapToReference, type LapRecord } from '../src/lib/analysis';
import type { Corner } from '../src/lib/corners';
import { buildReferenceLap } from '../src/lib/geometry';
import { minSpeedPerCorner } from '../src/lib/cornerSpeed';
import { sampleTrack } from './helpers/syntheticTrack';

const T0 = 1_790_000_000_000;
const LAP_MS = 40_000;

/**
 * Uma volta da pista circular a 10 Hz, a 20 m/s, com um vale de 8 m/s perto de
 * 15% da volta e outro de 12 m/s perto de 60%.
 */
function circularLap(): LapRecord {
  const samples = sampleTrack((t) => (t - T0) / LAP_MS, T0, T0 + LAP_MS, 10, 20).map((p, i, arr) => {
    const progress = i / (arr.length - 1);
    let speed = 20;
    if (Math.abs(progress - 0.15) < 0.02) speed = Math.abs(progress - 0.15) < 0.003 ? 8 : 10;
    if (Math.abs(progress - 0.6) < 0.02) speed = Math.abs(progress - 0.6) < 0.003 ? 12 : 14;
    return { ...p, speed };
  });
  return { id: 'l1', sessionId: 's1', gps: samples, samples, startedAt: T0, durationMs: LAP_MS };
}

function corner(index: number, sStart: number, sEnd: number): Corner {
  return { index, name: `Curva ${index + 1}`, sStart, sEnd, sApex: (sStart + sEnd) / 2 };
}

test('minSpeedPerCorner: duas curvas da pista circular dão a mínima de cada uma, em km/h', () => {
  const lap = circularLap();
  const ref = buildReferenceLap(lap.gps, lap.gps[0]);
  const matched = matchLapToReference(lap, ref);
  const L = ref.totalLength;
  const corners = [corner(0, 0.1 * L, 0.2 * L), corner(1, 0.55 * L, 0.65 * L)];

  const out = minSpeedPerCorner(corners, matched);

  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.index), [1, 2]);
  assert.ok(Math.abs(out[0].minKmh - 28.8) < 1e-9, `curva 1: ${out[0].minKmh}`);
  assert.ok(Math.abs(out[1].minKmh - 43.2) < 1e-9, `curva 2: ${out[1].minKmh}`);
  // A referência é a curva de mínima mais alta (a 2): 28,8 − 43,2 e 0.
  assert.ok(Math.abs(out[0].deltaVsBest - -14.4) < 1e-9, `delta 1: ${out[0].deltaVsBest}`);
  assert.equal(out[1].deltaVsBest, 0);
});

test('minSpeedPerCorner: curva sem ponto casado vale 0 km/h', () => {
  const lap = circularLap();
  const ref = buildReferenceLap(lap.gps, lap.gps[0]);
  const matched = matchLapToReference(lap, ref);
  const L = ref.totalLength;
  const out = minSpeedPerCorner([corner(0, 0.1 * L, 0.2 * L), corner(1, L + 10, L + 20)], matched);
  assert.equal(out[1].minKmh, 0);
  assert.equal(out[1].deltaVsBest, -out[0].minKmh);
  assert.equal(out[0].deltaVsBest, 0);
});
