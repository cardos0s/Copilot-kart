/**
 * Régua única de S1/S2/S3: TMP-07 (AC 1–3) e TMP-09.
 * S1, S2 e S3 são os terços do comprimento do traçado, a partir da linha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { referenceFromLap, referenceFromLayout, sectorSplits } from '../src/lib/sectors';
import { lineFromLayout } from '../src/lib/startLine';
import { sliceLaps } from '../src/recording/finishSession';
import { generateTimedLaps, sampleTrack } from './helpers/syntheticTrack';

/** Duração real da volta da pista sintética: 120 m de raio a 20 m/s. */
const D = 37_699;
const TOL_MS = 20;

function near(actual: number | null, expected: number, label: string) {
  assert.ok(actual !== null, `${label}: devia ser número`);
  assert.ok(Math.abs(actual - expected) <= TOL_MS, `${label}: ${actual} ms, esperado ${expected} ms`);
}

/**
 * Traçado de referência como o app o salva: a melhor volta de uma sessão, com
 * os pontos de fronteira na linha (AD-006).
 */
function layoutSamples(): GpsSample[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 });
  return sliceLaps(samples, [])[0].samples;
}

/** Voltas fechadas (com pontos de fronteira) numa sessão com traçado, começando andando. */
function closedLaps(hz: number) {
  const layout = layoutSamples();
  const line = lineFromLayout(layout);
  assert.ok(line);
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: hz, startPhase: 0.5, laps: 4 });
  return { samples, line, laps: sliceLaps(samples, [], line), detected: detectLaps(samples, { line }).laps };
}

test('sectorSplits: em velocidade constante, S1, S2 e S3 são os terços do traçado (D/3 ± 20 ms cada)', () => {
  const ref = referenceFromLayout(layoutSamples());
  assert.ok(ref);
  for (const hz of [10, 5]) {
    const { laps } = closedLaps(hz);
    assert.equal(laps.length, 3);
    for (const [i, lap] of laps.entries()) {
      const s = sectorSplits(lap.samples, ref);
      near(s.s1Ms, D / 3, `${hz} Hz, volta ${i + 1}, S1`);
      near(s.s2Ms, D / 3, `${hz} Hz, volta ${i + 1}, S2`);
      near(s.s3Ms, D / 3, `${hz} Hz, volta ${i + 1}, S3`);
    }
  }
});

test('sectorSplits: numa volta fechada, s1 + s2 + s3 === durationMs (± 1 ms)', () => {
  const ref = referenceFromLayout(layoutSamples());
  assert.ok(ref);
  for (const hz of [10, 5]) {
    for (const lap of closedLaps(hz).laps) {
      const { s1Ms, s2Ms, s3Ms } = sectorSplits(lap.samples, ref);
      assert.ok(s1Ms !== null && s2Ms !== null && s3Ms !== null);
      assert.ok(Math.abs(s1Ms + s2Ms + s3Ms - lap.durationMs) <= 1, `${s1Ms + s2Ms + s3Ms} × ${lap.durationMs}`);
    }
  }
});

test('sectorSplits: na volta em curso, o setor ainda não alcançado fica null', () => {
  const ref = referenceFromLayout(layoutSamples());
  assert.ok(ref);
  const lap = closedLaps(10).laps[0];
  const t0 = lap.samples[0].t;

  // Em curso, a meio caminho: passou de 1/3, não chegou a 2/3.
  const half = sectorSplits(lap.samples.filter((s) => s.t < t0 + 0.5 * D), ref);
  near(half.s1Ms, D / 3, 'S1 em curso');
  assert.equal(half.s2Ms, null);
  assert.equal(half.s3Ms, null);

  // Em curso, a 90%: passou de 2/3, não chegou à linha.
  const almost = sectorSplits(lap.samples.filter((s) => s.t < t0 + 0.9 * D), ref);
  near(almost.s1Ms, D / 3, 'S1 a 90%');
  near(almost.s2Ms, D / 3, 'S2 a 90%');
  assert.equal(almost.s3Ms, null);
});

test('sectorSplits: a volta calculada "em curso" no fechamento e depois "fechada" dá os mesmos S1/S2/S3 (≤ 20 ms)', () => {
  const ref = referenceFromLayout(layoutSamples());
  assert.ok(ref);
  for (const hz of [10, 5]) {
    const { samples, laps, detected } = closedLaps(hz);
    laps.forEach((lap, i) => {
      // No poll em que a volta fecha, o hook vê a volta em curso até o 1º ponto cru depois da linha.
      const live = [...lap.samples.slice(0, -1), samples[detected[i].endIdx]];
      const a = sectorSplits(live, ref);
      const b = sectorSplits(lap.samples, ref);
      for (const k of ['s1Ms', 's2Ms', 's3Ms'] as const) {
        const va = a[k];
        const vb = b[k];
        assert.ok(va !== null && vb !== null, `${hz} Hz, volta ${i + 1}, ${k}`);
        assert.ok(Math.abs(va - vb) <= TOL_MS, `${hz} Hz, volta ${i + 1}, ${k}: ${va} × ${vb}`);
      }
    });
  }
});

test('sem traçado, referenceFromLap(melhor volta) dá a régua, e os terços saem do comprimento dessa volta', () => {
  // Velocidade variável: a 1ª metade da pista leva 25 s e a 2ª, 15 s. Pelos
  // terços do comprimento, S1 = 16.667 ms, S2 = 13.333 ms e S3 = 10.000 ms
  // (os terços do tempo dariam 13.333 ms cada).
  const T0 = 1_700_000_000_000;
  const LAP = 40_000;
  const progressAt = (t: number) => {
    const e = t - T0 - 3_000;
    if (e < 0) return 0;
    const n = Math.floor(e / LAP);
    const r = e - n * LAP;
    return n + (r < 25_000 ? (0.5 * r) / 25_000 : 0.5 + (0.5 * (r - 25_000)) / 15_000);
  };
  const warm = sampleTrack(() => 0, T0, T0 + 2_900, 10, 0);
  const moving = sampleTrack(progressAt, T0 + 3_000, T0 + 3_000 + 3 * LAP + 2_000, 10, 20);
  const laps = sliceLaps([...warm, ...moving], []);
  assert.equal(laps.length, 3);

  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const ref = referenceFromLap(best);
  // A régua é o comprimento da própria volta: uma volta no círculo de 120 m de raio (± 1 %).
  assert.ok(Math.abs(ref.totalLength / (2 * Math.PI * 120) - 1) < 0.01, `comprimento ${ref.totalLength}`);
  for (const [i, lap] of laps.entries()) {
    const s = sectorSplits(lap.samples, ref);
    near(s.s1Ms, 16_667, `volta ${i + 1}, S1`);
    near(s.s2Ms, 13_333, `volta ${i + 1}, S2`);
    near(s.s3Ms, 10_000, `volta ${i + 1}, S3`);
  }
});

test('referenceFromLayout: traçado com menos de 5 pontos não dá régua (sessão sem traçado)', () => {
  assert.equal(referenceFromLayout(layoutSamples().slice(0, 4)), null);
});
