/**
 * `cleanSamples` e os pontos de fronteira da volta (AD-006; TMP-07 AC 3,
 * TMP-12 AC 1). A limpeza tira as fixes ruins, mas nunca os pontos
 * sintéticos na linha, que carregam o início e o fim da volta.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanSamples } from '../src/lib/analysis';
import type { GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { referenceFromLayout, sectorSplits } from '../src/lib/sectors';
import { lineFromLayout } from '../src/lib/startLine';
import { sliceLaps } from '../src/recording/finishSession';
import { generateTimedLaps } from './helpers/syntheticTrack';

const D = 37_699;
const BAD_M = 25;

function layoutSamples(): GpsSample[] {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 });
  return sliceLaps(samples, [])[0].samples;
}

/**
 * Voltas fechadas em que os pontos crus em volta de cada cruzamento têm
 * precisão de 25 m (os pontos de fronteira herdam a pior do par), e mais um
 * a cada 40 no meio da volta.
 */
function lapsWithBadFixesAtTheLine() {
  const layout = layoutSamples();
  const line = lineFromLayout(layout);
  assert.ok(line);
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.5, laps: 4 });
  const bad = samples.map((s) => ({ ...s }));
  for (const d of detectLaps(bad, { line }).laps) {
    for (const i of [d.startIdx - 1, d.startIdx, d.endIdx - 1, d.endIdx]) bad[i].accuracy = BAD_M;
  }
  bad.forEach((s, i) => {
    if (i % 40 === 0) s.accuracy = BAD_M;
  });
  const laps = sliceLaps(bad, [], line);
  assert.equal(laps.length, 3);
  return { laps, layout };
}

test('cleanSamples(10) mantém os pontos de fronteira com precisão herdada de 25 m e tira os crus acima de 10 m', () => {
  const { laps } = lapsWithBadFixesAtTheLine();
  for (const [n, lap] of laps.entries()) {
    const first = lap.samples[0];
    const last = lap.samples[lap.samples.length - 1];
    // Pré-condição: as fronteiras herdaram os 25 m, e há ponto cru ruim no meio.
    assert.equal(first.accuracy, BAD_M);
    assert.equal(last.accuracy, BAD_M);
    const inner = lap.samples.slice(1, -1);
    assert.ok(inner.some((s) => s.accuracy > 10), `volta ${n + 1} sem ponto cru ruim`);

    const cleaned = cleanSamples(lap.samples, 10);
    assert.deepEqual(cleaned[0], first);
    assert.equal(cleaned[0].synthetic, true);
    assert.deepEqual(cleaned[cleaned.length - 1], last);
    assert.equal(cleaned[cleaned.length - 1].synthetic, true);
    assert.deepEqual(cleaned.slice(1, -1), inner.filter((s) => s.accuracy <= 10));
  }
});

test('com a volta limpa, sectorSplits fecha s1 + s2 + s3 === durationMs (± 1 ms)', () => {
  const { laps, layout } = lapsWithBadFixesAtTheLine();
  const ref = referenceFromLayout(layout);
  assert.ok(ref);
  for (const [n, lap] of laps.entries()) {
    const { s1Ms, s2Ms, s3Ms } = sectorSplits(cleanSamples(lap.samples, 10), ref);
    assert.ok(s1Ms !== null && s2Ms !== null && s3Ms !== null, `volta ${n + 1}: ${s1Ms}/${s2Ms}/${s3Ms}`);
    assert.ok(
      Math.abs(s1Ms + s2Ms + s3Ms - lap.durationMs) <= 1,
      `volta ${n + 1}: ${s1Ms + s2Ms + s3Ms} × ${lap.durationMs}`
    );
  }
});
