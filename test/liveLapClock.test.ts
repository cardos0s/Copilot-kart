/**
 * Cronômetro e delta ao vivo a partir do cruzamento da linha (AD-006;
 * TMP-05 AC 3, TMP-10). A volta em curso começa no cruzamento interpolado,
 * e a referência do delta é a volta com os pontos de fronteira.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { lineFromLayout, type StartLine } from '../src/lib/startLine';
import { sliceLaps } from '../src/recording/finishSession';
import { deltaReferenceLap, liveLapClock } from '../src/recording/liveLapClock';
import { generateTimedLaps } from './helpers/syntheticTrack';

const D = 37_699;

function layoutLine(): StartLine {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 });
  const line = lineFromLayout(sliceLaps(samples, [])[0].samples);
  assert.ok(line);
  return line;
}

/** Gravação com traçado, começando andando no meio da pista. */
function movingStart() {
  const line = layoutLine();
  const { samples, crossingsT } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.5, laps: 4 });
  return { line, samples, crossingsT, full: detectLaps(samples, { line }) };
}

/** O que o poll vê quando o último ponto recebido é `samples[lastIdx]`. */
function pollAt(samples: GpsSample[], lastIdx: number, line: StartLine | null) {
  const all = samples.slice(0, lastIdx + 1);
  const detection = detectLaps(all, { line });
  return { all, detection, now: all[all.length - 1].t };
}

test('liveLapClock: com traçado e começando andando, antes do 1º cruzamento o relógio é null', () => {
  const { line, samples, crossingsT } = movingStart();
  const before = samples.findIndex((s) => s.t >= crossingsT[0]) - 1;
  for (const lastIdx of [12, Math.floor(before / 2), before]) {
    const { all, detection, now } = pollAt(samples, lastIdx, line);
    // Pré-condição: o piloto já está em ritmo; só falta cruzar a linha.
    assert.ok(detection.movingStartIdx >= 0);
    assert.equal(liveLapClock(detection, all, now, line), null, `ponto ${lastIdx}`);
  }
});

test('liveLapClock: depois do 1º cruzamento, elapsed = t_amostra − startCross.t exatamente', () => {
  const { line, samples, crossingsT, full } = movingStart();
  const startCross = full.laps[0].startCross;
  assert.ok(Math.abs(startCross.t - crossingsT[0]) <= 20);
  const firstAfter = samples.findIndex((s) => s.t > startCross.t);
  for (const lastIdx of [firstAfter, firstAfter + 1, firstAfter + 100]) {
    const { all, detection, now } = pollAt(samples, lastIdx, line);
    assert.equal(detection.laps.length, 0);
    const clock = liveLapClock(detection, all, now, line);
    assert.ok(clock, `ponto ${lastIdx}`);
    assert.equal(clock.lapStartT, startCross.t);
    assert.equal(clock.elapsedMs, now - startCross.t);
  }

  // Sem traçado, o 1º cruzamento é o ponto em que o ritmo começou (f = 0).
  const noLayout = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, laps: 2, warmupS: 3 }).samples;
  const first = detectLaps(noLayout, {}).laps[0].startCross;
  const idx = noLayout.findIndex((s) => s.t > first.t) + 50;
  const { all, detection, now } = pollAt(noLayout, idx, null);
  const clock = liveLapClock(detection, all, now, null);
  assert.ok(clock);
  assert.equal(clock.lapStartT, first.t);
  assert.equal(clock.elapsedMs, now - first.t);
});

test('liveLapClock: depois de fechar uma volta, o relógio recomeça no endCross.t dela, e não no ponto cru seguinte', () => {
  const { line, samples, full } = movingStart();
  for (const [n, lap] of full.laps.entries()) {
    for (const lastIdx of [lap.endIdx, lap.endIdx + 1, lap.endIdx + 30]) {
      const { all, detection, now } = pollAt(samples, lastIdx, line);
      assert.equal(detection.laps.length, n + 1);
      const clock = liveLapClock(detection, all, now, line);
      assert.ok(clock);
      assert.equal(clock.lapStartT, lap.endCross.t);
      assert.equal(clock.elapsedMs, now - lap.endCross.t);
      // O cruzamento fica antes do 1º ponto cru da volta nova.
      assert.ok(clock.lapStartT < samples[lap.endIdx].t);
    }
  }
});

test('deltaReferenceLap: a referência do delta começa e termina em pontos synthetic, nos cruzamentos da volta', () => {
  const { line, samples, full } = movingStart();
  assert.equal(full.laps.length, 3);
  for (const [i, lap] of full.laps.entries()) {
    const ref = deltaReferenceLap(samples, line, i);
    assert.ok(ref);
    const first = ref.samples[0];
    const last = ref.samples[ref.samples.length - 1];
    assert.equal(first.synthetic, true);
    assert.equal(last.synthetic, true);
    assert.equal(first.t, lap.startCross.t);
    assert.equal(last.t, lap.endCross.t);
    assert.equal(ref.durationMs, lap.durationMs);
  }
});

test('useLapRecorder: usa liveLapClock e deltaReferenceLap, e não calcula mais o início da volta por endIdx + 1', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useLapRecorder.ts'), 'utf8');
  assert.ok(/import\s*\{[^}]*\bliveLapClock\b[^}]*\}\s*from\s*'\.\.\/recording\/liveLapClock'/.test(src));
  assert.ok(/liveLapClock\(detection,\s*all,/.test(src), 'o poll chama liveLapClock');
  assert.ok(/deltaReferenceLap\(all,\s*line,/.test(src), 'a referência do tracker vem de deltaReferenceLap');
  assert.equal(/endIdx\s*\+\s*1/.test(src), false);
});
