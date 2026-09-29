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
import { DeltaTracker } from '../src/lib/realtimeDelta';
import { deltaReferenceLap, lapOpened, liveLapClock } from '../src/recording/liveLapClock';
import { generateTimedLaps, sampleTrack } from './helpers/syntheticTrack';

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

/**
 * Duas voltas com traçado, depois o box: para 200 s no meio da pista e volta
 * passando pela linha. A passagem depois da parada fica a mais de 180 s da
 * anterior, então a volta do box é descartada e a contagem reabre ali.
 */
function boxSession() {
  const line = layoutLine();
  const T0 = 1_700_000_000_000;
  const dt = 100;
  const speed = 20;
  // Do meio da pista (0,5) até 3,4: passa pela linha em 1, 2 e 3.
  const moving1 = sampleTrack((t) => 0.5 + (t - T0) / D, T0, T0 + 2.9 * D, 10, speed);
  const tStop = moving1[moving1.length - 1].t + dt;
  const stopped = sampleTrack(() => 3.4, tStop, tStop + 200_000, 10, 0);
  const tGo = stopped[stopped.length - 1].t + dt;
  // Sai do box, passa pela linha em 4 e fecha mais uma volta em 5.
  const moving2 = sampleTrack((t) => 3.4 + (t - tGo) / D, tGo, tGo + 1.9 * D, 10, speed);
  const samples = [...moving1, ...stopped, ...moving2];
  const crossBeforeBox = T0 + 2.5 * D;
  const crossAfterBox = tGo + 0.6 * D;
  return { line, samples, tStop, tGo, crossBeforeBox, crossAfterBox, full: detectLaps(samples, { line }) };
}

test('Depois de um box de 200 s passando pela linha, openCross é o cruzamento depois da parada, e liveLapClock conta a partir dele', () => {
  const { line, samples, tGo, crossBeforeBox, crossAfterBox, full } = boxSession();
  // Regra dos 180 s: a volta do box é descartada e a contagem reabre no
  // cruzamento depois da parada.
  assert.equal(full.laps.length, 3, `voltas: ${full.laps.map((l) => l.durationMs).join(', ')}`);
  assert.ok(Math.abs(full.laps[1].endCross.t - crossBeforeBox) <= 20);
  assert.ok(Math.abs(full.laps[2].startCross.t - crossAfterBox) <= 20);
  assert.ok(Math.abs(full.laps[2].durationMs - D) <= 20);

  // Na volta depois do box, antes de ela fechar.
  const afterBoxIdx = samples.findIndex((s) => s.t > crossAfterBox);
  for (const lastIdx of [afterBoxIdx, afterBoxIdx + 1, afterBoxIdx + 150]) {
    const { all, detection, now } = pollAt(samples, lastIdx, line);
    assert.equal(detection.laps.length, 2, `ponto ${lastIdx}`);
    const open = detection.openCross;
    assert.ok(open);
    assert.equal(open.t, full.laps[2].startCross.t);
    assert.equal(open.idx, full.laps[2].startIdx);
    assert.ok(open.t > tGo, 'o cruzamento é o de depois da parada');
    assert.notEqual(open.t, detection.laps[1].endCross.t);

    const clock = liveLapClock(detection, all, now, line);
    assert.ok(clock);
    assert.equal(clock.lapStartT, open.t);
    assert.equal(clock.elapsedMs, now - open.t);
    assert.ok(clock.elapsedMs < D, `cronômetro com ${clock.elapsedMs} ms, e não desde antes do box`);
  }
});

test('useLapRecorder: currentLapSamples (setores ao vivo) usa openCross, e não o endCross da última volta fechada', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useLapRecorder.ts'), 'utf8');
  assert.ok(/function currentLapSamples\(\s*all: GpsSample\[\],\s*openCross: OpenCross \| null\s*\)/.test(src));
  assert.ok(/currentLapSamples\(all,\s*detection\.openCross\)/.test(src), 'o poll passa detection.openCross');
  assert.equal(/\.endCross\b/.test(src), false, 'o hook não abre a volta pelo endCross');
});

/**
 * Repete os polls do hook (a cada 500 ms, 5 pontos a 10 Hz) com um
 * `DeltaTracker`: `resetLap()` sob `lapOpened`, a referência pela melhor volta
 * (`deltaReferenceLap`) recarregada quando ela muda, e o delta no último ponto
 * com o relógio de `liveLapClock`.
 */
function runPolls(samples: GpsSample[], line: StartLine) {
  const tracker = new DeltaTracker();
  let prevOpen: ReturnType<typeof detectLaps>['openCross'] = null;
  let loadedIdx = -1;
  const polls = [];
  for (let lastIdx = 4; lastIdx < samples.length; lastIdx += 5) {
    const { all, detection, now } = pollAt(samples, lastIdx, line);
    const opened = lapOpened(prevOpen, detection.openCross);
    prevOpen = detection.openCross;
    if (opened) tracker.resetLap();

    let bestIdx = -1;
    detection.laps.forEach((l, i) => {
      if (bestIdx < 0 || l.durationMs < detection.laps[bestIdx].durationMs) bestIdx = i;
    });
    if (bestIdx >= 0 && bestIdx !== loadedIdx) {
      const ref = deltaReferenceLap(all, line, bestIdx);
      assert.ok(ref);
      tracker.setReference(ref.samples, ref.durationMs);
      loadedIdx = bestIdx;
    }

    const clock = liveLapClock(detection, all, now, line);
    const reading = clock && tracker.hasReference() ? tracker.compute(all[all.length - 1], clock.elapsedMs) : null;
    polls.push({ lastIdx, laps: detection.laps.length, openT: detection.openCross?.t ?? null, opened, reading });
  }
  return polls;
}

test('lapOpened: verdadeira só quando o openCross muda, inclusive na abertura depois do box', () => {
  const a = { t: 1_000 };
  assert.equal(lapOpened(null, null), false);
  assert.equal(lapOpened(null, a), true);
  assert.equal(lapOpened(a, { t: 1_000 }), false);
  assert.equal(lapOpened(a, { t: 2_000 }), true);

  const { line, samples, tGo, full } = boxSession();
  const polls = runPolls(samples, line);
  const afterBox = full.laps[2].startCross.t;
  const i = polls.findIndex((p) => p.openT === afterBox);
  assert.ok(i > 0);
  // É a abertura que o "volta fechou" não vê: nenhuma volta fecha nesse poll.
  assert.equal(polls[i].laps, 2);
  assert.equal(polls[i - 1].laps, 2);
  assert.equal(polls[i].opened, true, 'lapOpened na abertura depois do box');
  // Durante o box, o openCross não muda e lapOpened fica falsa.
  const boxPolls = polls.filter((p) => samples[p.lastIdx].t > tGo - 190_000 && samples[p.lastIdx].t < tGo);
  assert.ok(boxPolls.length > 100);
  assert.ok(boxPolls.every((p) => !p.opened));
  // Aberturas: o 1º cruzamento, o fim das voltas 1 e 2, o cruzamento depois
  // do box e o fim da volta 3.
  assert.equal(polls.filter((p) => p.opened).length, 5);
});

test('DeltaTracker nos polls do hook: o 1º poll depois da abertura pós-box casa no início do traçado (sNormalized < 0,05)', () => {
  const { line, samples, full } = boxSession();
  const polls = runPolls(samples, line);
  const afterBox = full.laps[2].startCross.t;
  const first = polls.find((p) => p.openT === afterBox);
  assert.ok(first && first.reading);
  const { sNormalized, sCurrent } = first.reading;
  assert.ok(sNormalized !== null, 'o ponto casou no traçado');
  assert.ok(sNormalized < 0.05, `s = ${sCurrent} m (${(sNormalized * 100).toFixed(1)} % da volta)`);
});

test('useLapRecorder: chama tracker.resetLap() sob lapOpened, e só ali', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useLapRecorder.ts'), 'utf8');
  assert.ok(/import\s*\{[^}]*\blapOpened\b[^}]*\}\s*from\s*'\.\.\/recording\/liveLapClock'/.test(src));
  assert.ok(/if\s*\(\s*lapOpened\([^)]*detection\.openCross\s*\)\s*\)\s*\{?\s*tracker\.resetLap\(\)/.test(src), 'resetLap sob lapOpened');
  assert.equal(src.match(/\.resetLap\(\)/g)?.length, 1, 'nenhum outro resetLap fora do lapOpened');
});
