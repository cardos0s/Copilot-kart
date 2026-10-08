/**
 * Pico de velocidade: TMP-11 (AC 1, 2, 4). O pico é o percentil 99
 * (nearest-rank) da velocidade dos pontos com precisão de até 10 m.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LapRecord } from '../src/lib/analysis';
import type { GpsFrame } from '../src/telemetry/frame';
import { msToKmh, peakSpeedMs, peakSpeedMsOfLaps } from '../src/lib/speed';

const T0 = 1_700_000_000_000;

function pt(i: number, speed: number, accuracy = 4): GpsFrame {
  return { kind: 'gps', source: 'PHONE', fix: 'unknown', t: T0 + i * 100, lat: -14.86, lng: -40.84, speed, accuracy };
}

function lap(samples: GpsFrame[], id = 'l1'): LapRecord {
  return { id, sessionId: 's1', gps: samples, startedAt: samples[0]?.t ?? T0, durationMs: 50_000 };
}

/** ~500 pontos entre 79,5 e 80,5 km/h e um único ponto a 150 km/h. */
function lapWithSpike(): GpsFrame[] {
  const samples: GpsFrame[] = [];
  for (let i = 0; i < 500; i++) samples.push(pt(i, (80 + 0.5 * Math.sin(i / 7)) / 3.6));
  samples.splice(250, 0, pt(250, 150 / 3.6));
  return samples;
}

test('peakSpeedMs: volta a ~80 km/h com um único ponto a 150 km/h dá pico abaixo de 81 km/h', () => {
  const peak = peakSpeedMs(lapWithSpike());
  assert.ok(peak !== null);
  assert.ok(msToKmh(peak) < 81, `pico de ${msToKmh(peak).toFixed(2)} km/h`);
});

test('peakSpeedMs: o p99 é o nearest-rank calculado à mão', () => {
  // 200 velocidades de 1 a 200 m/s, fora de ordem: posto ceil(0,99 × 200) = 198.
  const scrambled = Array.from({ length: 200 }, (_, i) => ((i * 77) % 200) + 1);
  assert.equal(peakSpeedMs(scrambled.map((v, i) => pt(i, v))), 198);
  // 150 velocidades de 1 a 150: posto ceil(0,99 × 150) = ceil(148,5) = 149.
  assert.equal(peakSpeedMs(Array.from({ length: 150 }, (_, i) => pt(i, 150 - i))), 149);
});

test('peakSpeedMs: pontos com precisão acima de 10 m são ignorados; sem ponto bom, é null', () => {
  // 100 pontos a 20 m/s com precisão de exatamente 10 m, e 50 a 50 m/s com 10,5 m.
  const mixed = [
    ...Array.from({ length: 100 }, (_, i) => pt(i, 20, 10)),
    ...Array.from({ length: 50 }, (_, i) => pt(100 + i, 50, 10.5)),
  ];
  assert.equal(peakSpeedMs(mixed), 20);
  assert.equal(peakSpeedMs(Array.from({ length: 50 }, (_, i) => pt(i, 30, 12))), null);
  assert.equal(peakSpeedMs([]), null);
});

test('peakSpeedMsOfLaps: mesma regra por volta, e null quando nenhuma volta tem ponto bom', () => {
  const noGood = lap(Array.from({ length: 50 }, (_, i) => pt(i, 30, 12)), 'l2');
  const peak = peakSpeedMsOfLaps([lap(lapWithSpike()), noGood]);
  assert.ok(peak !== null);
  assert.ok(msToKmh(peak) < 81, `pico de ${msToKmh(peak).toFixed(2)} km/h`);
  assert.equal(peakSpeedMsOfLaps([noGood]), null);
  assert.equal(peakSpeedMsOfLaps([]), null);
});
