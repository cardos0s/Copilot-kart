/**
 * "Comparar voltas" pela régua única: TMP-07 (AC 1, 3) e AD-006.
 * S1/S2/S3 da comparação saem de `sectorSplits`, e não da soma 7/7/6 dos
 * mini-setores, sobre os pontos salvos da volta, como na sessão.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanSamples, repairDegenerateTimestamps, type LapRecord } from '../src/lib/analysis';
import type { GpsFrame } from '../src/telemetry/frame';
import { compareLaps } from '../src/lib/lapCompare';
import { referenceFromLap, referenceFromLayout, sectorSplits } from '../src/lib/sectors';
import { lineFromLayout } from '../src/lib/startLine';
import { sliceLaps, toLapRecord } from '../src/recording/finishSession';
import { generateTimedLaps, makeCircularTrack } from './helpers/syntheticTrack';

/** Duração real da volta da pista sintética: 120 m de raio a 20 m/s. */
const D = 37_699;
const KEYS = ['s1Ms', 's2Ms', 's3Ms'] as const;

/** Traçado como o app o salva: a melhor volta de uma sessão, com fronteiras na linha. */
function layoutSamples(): GpsFrame[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 });
  return sliceLaps(samples, [])[0].samples;
}

/** Duas voltas salvas de uma sessão com traçado, começando andando (pontos de fronteira, AD-006). */
function savedLaps(line: ReturnType<typeof lineFromLayout>, sampleRateHz = 10): LapRecord[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz, startPhase: 0.5, laps: 3 });
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
  const sa = sectorSplits(a.gps, ref);
  const sb = sectorSplits(b.gps, ref);
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
  const sa = sectorSplits(a.gps, ruler);
  const sb = sectorSplits(b.gps, ruler);
  assert.ok(Math.abs(res.trackLengthM - ruler.totalLength) < 1e-9);
  KEYS.forEach((k, i) => {
    assert.equal(res.sectors[i].aMs, sa[k], `S${i + 1} de A`);
    assert.equal(res.sectors[i].bMs, sb[k], `S${i + 1} de B`);
  });
});

/** Comprimento da pista sintética (120 m de raio) e o seu ponto em cada fração da volta. */
const TRACK_M = 2 * Math.PI * 120;
const trackAt = makeCircularTrack(-14.8619, -40.8444, 120);

/**
 * A volta salva com uma fix ruim perto de cada fração em `fracs`: precisão de
 * 15 m (o handler só descarta acima de 30 m) e posição deslocada `metros` à
 * frente ao longo da pista, como costuma vir a fix imprecisa.
 */
function withBadFixes(lap: LapRecord, fracs: number[], metros: number): LapRecord {
  const samples = lap.gps.map((p) => ({ ...p }));
  const t0 = samples[0].t;
  const frac = (i: number) => (samples[i].t - t0) / lap.durationMs;
  for (const f of fracs) {
    let k = 1;
    for (let i = 2; i < samples.length - 1; i++) {
      if (Math.abs(frac(i) - f) < Math.abs(frac(k) - f)) k = i;
    }
    const p = trackAt(frac(k) + metros / TRACK_M);
    samples[k] = { ...samples[k], lat: p.lat, lng: p.lng, accuracy: 15 };
  }
  return { ...lap, gps: samples, samples };
}

/** O traço do delta e o mapa da tela: pontos limpos por `cleanSamples(10)` e o reparo de timestamp. */
function cleanedForTrace(lap: LapRecord): LapRecord {
  const { samples } = repairDegenerateTimestamps(cleanSamples(lap.gps, 10), lap.durationMs, lap.startedAt);
  return { ...lap, gps: samples, samples };
}

/** S1/S2/S3 da comparação a no máximo 20 ms dos de `sectorSplits` sobre os pontos salvos. */
function assertSectorsFromSaved(sampleRateHz: number, metros: number) {
  const layout = layoutSamples();
  const ref = referenceFromLayout(layout);
  assert.ok(ref);
  const [a, b] = savedLaps(lineFromLayout(layout), sampleRateHz).map((l) => withBadFixes(l, [1 / 3, 2 / 3], metros));
  assert.equal(a.gps.filter((p) => p.accuracy === 15).length, 2);

  const res = compareLaps(cleanedForTrace(a), cleanedForTrace(b), ref, [], { a, b });
  const sa = sectorSplits(a.gps, ref);
  const sb = sectorSplits(b.gps, ref);
  KEYS.forEach((k, i) => {
    const row = res.sectors[i];
    const ea = sa[k];
    const eb = sb[k];
    assert.ok(row.aMs !== null && row.bMs !== null && ea !== null && eb !== null, `S${i + 1}`);
    assert.ok(Math.abs(row.aMs - ea) <= 20, `${sampleRateHz} Hz, S${i + 1} de A: comparação ${row.aMs} × sessão ${ea}`);
    assert.ok(Math.abs(row.bMs - eb) <= 20, `${sampleRateHz} Hz, S${i + 1} de B: comparação ${row.bMs} × sessão ${eb}`);
  });
}

test('compareLaps: 10 Hz com fix de 15 m deslocada 5 m perto de 1/3 e de 2/3, setores ≤ 20 ms dos da sessão', () => {
  assertSectorsFromSaved(10, 5);
});

test('compareLaps: 5 Hz com duas fixes deslocadas 8 m, setores ≤ 20 ms dos da sessão', () => {
  assertSectorsFromSaved(5, 8);
});
