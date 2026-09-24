/**
 * Testes do detector de voltas, portados de scripts/self-test-lap-detector.js.
 * Mesmos 5 casos e mesmo gerador de pista sintética.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { generateLapSamples } from './helpers/syntheticTrack';

test('Caso 1: ritmo nunca atingido (só paddock)', () => {
  const samples = generateLapSamples({ numLaps: 0, warmupS: 30, cooldownS: 0 });
  const result = detectLaps(samples);
  assert.equal(result.movingStartIdx, -1, 'movingStartIdx deve ser -1');
  assert.equal(result.startFinishLine, null, 'linha de largada deve ser null');
  assert.equal(result.laps.length, 0, 'não deve detectar voltas');
});

test('Caso 2: entrou em ritmo mas não fechou volta (meia volta só)', () => {
  const allSamples = generateLapSamples({ numLaps: 1, warmupS: 3, cooldownS: 0 });
  const samples = allSamples.slice(0, Math.floor(allSamples.length / 2));
  const result = detectLaps(samples);
  assert.ok(result.movingStartIdx >= 0, 'movingStartIdx deve ser >= 0');
  assert.equal(result.laps.length, 0, 'não deve fechar volta');
});

test('Caso 3: duas voltas completas (caso feliz)', () => {
  const samples = generateLapSamples({ numLaps: 2, warmupS: 3, cooldownS: 2, lapDurationS: 55 });
  const result = detectLaps(samples);
  assert.ok(result.movingStartIdx >= 0);
  assert.equal(result.laps.length, 2, 'deve detectar exatamente 2 voltas');
  for (const lap of result.laps) {
    assert.ok(
      lap.durationMs >= 52_000 && lap.durationMs <= 58_000,
      `duração da volta fora da faixa: ${lap.durationMs}`,
    );
  }
});

test('Caso 4: rejeita "volta" curta demais (jitter na linha)', () => {
  const baseLat = -14.8619;
  const baseLng = -40.8444;
  const offsetLat = 16 / 111_320; // 16 m em latitude

  const samples: GpsSample[] = [];
  let t = Date.now();
  for (let i = 0; i < 30; i++) {
    samples.push({ t, lat: baseLat, lng: baseLng, speed: 10, accuracy: 4 });
    t += 200;
  }
  for (let i = 0; i < 10; i++) {
    samples.push({ t, lat: baseLat + offsetLat * (i / 10), lng: baseLng, speed: 10, accuracy: 4 });
    t += 200;
  }
  for (let i = 0; i < 10; i++) {
    samples.push({ t, lat: baseLat + offsetLat * (1 - i / 10), lng: baseLng, speed: 10, accuracy: 4 });
    t += 200;
  }

  const result = detectLaps(samples);
  assert.equal(result.laps.length, 0, 'não deve contar jitter na linha como volta');
});

test('Caso 5: três voltas + pit in (cenário real do teste em pista)', () => {
  const samples = generateLapSamples({ numLaps: 3, warmupS: 5, cooldownS: 10, lapDurationS: 55 });
  const result = detectLaps(samples);
  assert.equal(result.laps.length, 3, 'deve detectar exatamente 3 voltas');
  const lastLap = result.laps[result.laps.length - 1];
  const samplesAfterLastLap = samples.length - 1 - lastLap.endIdx;
  assert.ok(samplesAfterLastLap >= 30, 'deve sobrar samples de cooldown após última volta');
});
