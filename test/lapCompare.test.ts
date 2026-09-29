/**
 * "Comparar voltas" pela régua única: TMP-07 (AC 1, 3) e AD-006.
 * S1/S2/S3 da comparação saem de `sectorSplits`, e não da soma 7/7/6 dos
 * mini-setores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LapRecord } from '../src/lib/analysis';
import type { GpsSample } from '../src/lib/geometry';
import { compareLaps } from '../src/lib/lapCompare';
import { referenceFromLap, referenceFromLayout, sectorSplits } from '../src/lib/sectors';
import { lineFromLayout } from '../src/lib/startLine';
import { sliceLaps, toLapRecord } from '../src/recording/finishSession';
import { generateTimedLaps } from './helpers/syntheticTrack';

/** Duração real da volta da pista sintética: 120 m de raio a 20 m/s. */
const D = 37_699;
const KEYS = ['s1Ms', 's2Ms', 's3Ms'] as const;

/** Traçado como o app o salva: a melhor volta de uma sessão, com fronteiras na linha. */
function layoutSamples(): GpsSample[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 });
  return sliceLaps(samples, [])[0].samples;
}

/** Duas voltas salvas de uma sessão com traçado, começando andando (pontos de fronteira, AD-006). */
function savedLaps(line: ReturnType<typeof lineFromLayout>): LapRecord[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.5, laps: 3 });
  const laps = sliceLaps(samples, [], line).map((l, i) => toLapRecord(l, 'ses', i));
  assert.ok(laps.length >= 2, `${laps.length} voltas`);
  return laps.slice(0, 2);
}

test('compareLaps: S1/S2/S3 são os de sectorSplits (± 1 ms) contra o traçado e somam a duração', () => {
  const layout = layoutSamples();
  const ref = referenceFromLayout(layout);
  assert.ok(ref);
  const [a, b] = savedLaps(lineFromLayout(layout));

  const res = compareLaps(a, b, ref, []);
  const sa = sectorSplits(a.samples, ref);
  const sb = sectorSplits(b.samples, ref);
  assert.equal(res.sectors.length, 3);
  KEYS.forEach((k, i) => {
    const row = res.sectors[i];
    const ea = sa[k];
    const eb = sb[k];
    assert.ok(row.aMs !== null && row.bMs !== null && ea !== null && eb !== null, `S${i + 1}`);
    assert.ok(Math.abs(row.aMs - ea) <= 1, `S${i + 1} de A: ${row.aMs} × ${ea}`);
    assert.ok(Math.abs(row.bMs - eb) <= 1, `S${i + 1} de B: ${row.bMs} × ${eb}`);
    assert.equal(row.deltaMs, row.aMs - row.bMs);
  });
  const sumA = res.sectors.reduce((s, r) => s + (r.aMs ?? 0), 0);
  const sumB = res.sectors.reduce((s, r) => s + (r.bMs ?? 0), 0);
  assert.ok(Math.abs(sumA - a.durationMs) <= 1, `${sumA} × ${a.durationMs}`);
  assert.ok(Math.abs(sumB - b.durationMs) <= 1, `${sumB} × ${b.durationMs}`);
});

test('compareLaps: nenhum setor sai negativo', () => {
  const layout = layoutSamples();
  const ref = referenceFromLayout(layout);
  assert.ok(ref);
  const [a, b] = savedLaps(lineFromLayout(layout));
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const row of compareLaps(x, y, ref, []).sectors) {
      assert.ok(row.aMs !== null && row.aMs > 0, `S${row.index + 1} de A: ${row.aMs}`);
      assert.ok(row.bMs !== null && row.bMs > 0, `S${row.index + 1} de B: ${row.bMs}`);
    }
  }
});

test('compareLaps: sem traçado, a régua é a volta de referência da comparação (B)', () => {
  const [a, b] = savedLaps(null);
  const res = compareLaps(a, b, null, []);
  const ruler = referenceFromLap(b);
  const sa = sectorSplits(a.samples, ruler);
  const sb = sectorSplits(b.samples, ruler);
  assert.ok(Math.abs(res.trackLengthM - ruler.totalLength) < 1e-9);
  KEYS.forEach((k, i) => {
    assert.equal(res.sectors[i].aMs, sa[k], `S${i + 1} de A`);
    assert.equal(res.sectors[i].bMs, sb[k], `S${i + 1} de B`);
  });
});
