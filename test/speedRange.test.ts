/**
 * Faixa de cor por velocidade (TF-14, T3): os percentis 5/95 que estavam
 * inline em `app/session/[id].tsx`, agora em `speedColorRange`. O percentil é
 * o valor ordenado no índice floor(p × (n − 1)); sem ponto, a faixa é 0..0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { speedColorRange } from '../src/lib/speedRange';

function pts(speeds: number[]): GpsSample[] {
  return speeds.map((speed, i) => ({ t: 1_790_000_000_000 + i * 100, lat: -14.86, lng: -40.84, speed, accuracy: 4 }));
}

test('speedColorRange: 100 velocidades de 1 a 100, fora de ordem, dão p5 = 5 e p95 = 95', () => {
  // floor(0,05 × 99) = 4 → 5; floor(0,95 × 99) = 94 → 95.
  const scrambled = Array.from({ length: 100 }, (_, i) => ((i * 37) % 100) + 1);
  const samples = pts(scrambled);
  assert.deepEqual(speedColorRange(samples), { minS: 5, maxS: 95 });
  // Não muda a ordem dos pontos de entrada.
  assert.deepEqual(samples.map((p) => p.speed), scrambled);
});

test('speedColorRange: sem ponto a faixa é 0..0; com um ponto, é a velocidade dele', () => {
  assert.deepEqual(speedColorRange([]), { minS: 0, maxS: 0 });
  assert.deepEqual(speedColorRange(pts([12.5])), { minS: 12.5, maxS: 12.5 });
});
