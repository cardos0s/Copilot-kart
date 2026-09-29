/**
 * Testes do detector de voltas, portados de scripts/self-test-lap-detector.js.
 * Mesmos 5 casos e mesmo gerador de pista sintética.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

import type { GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { crossing, lineFromLayout, type StartLine } from '../src/lib/startLine';
import { generateLapSamples, generateTimedLaps, sampleTrack } from './helpers/syntheticTrack';

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

// ---------------------------------------------------------------------------
// Tempos honestos: a volta fecha no cruzamento interpolado da linha.
// TMP-01 (AC 1–3), TMP-02, TMP-03, TMP-04, TMP-05 e os edge cases.
// ---------------------------------------------------------------------------

/** Duração real da volta da pista sintética: 120 m de raio a 20 m/s. */
const D = 37_699;
const TOL_MS = 20;

/** Linha do traçado de referência: uma volta gravada a partir da linha. */
function layoutLine(hz = 10): StartLine {
  const layout = generateTimedLaps({ lapDurationMs: D, sampleRateHz: hz, laps: 1, tailS: 0 }).samples;
  const line = lineFromLayout(layout);
  assert.ok(line, 'o traçado sintético tem linha');
  return line;
}

function assertLapsWithin(durations: number[], expected: number, label: string) {
  for (const [i, d] of durations.entries()) {
    assert.ok(Math.abs(d - expected) <= TOL_MS, `${label}: volta ${i + 1} com ${d} ms, real ${expected} ms`);
  }
}

test('Precisão a 10 Hz: todas as voltas, inclusive a 1ª, a até 20 ms da duração real', () => {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.37, laps: 6, warmupS: 3 });
  const { laps } = detectLaps(samples);
  assert.equal(laps.length, 6);
  assertLapsWithin(laps.map((l) => l.durationMs), D, '10 Hz');
  assertLapsWithin(laps.map((l) => l.endCross.t - l.startCross.t), D, '10 Hz (cruzamentos)');
});

test('Precisão a 5 Hz: todas as voltas, inclusive a 1ª, a até 20 ms da duração real', () => {
  const { samples } = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 5, startPhase: 0.71, laps: 6, warmupS: 3 });
  const { laps } = detectLaps(samples);
  assert.equal(laps.length, 6);
  assertLapsWithin(laps.map((l) => l.durationMs), D, '5 Hz');
  assertLapsWithin(laps.map((l) => l.endCross.t - l.startCross.t), D, '5 Hz (cruzamentos)');
});

test('Com traçado e começando já andando no meio da pista, o trecho antes do 1º cruzamento não é volta', () => {
  const line = layoutLine();
  for (const hz of [10, 5]) {
    const { samples, crossingsT } = generateTimedLaps({
      lapDurationMs: D,
      sampleRateHz: hz,
      startPhase: 0.5,
      laps: 4,
    });
    const { laps } = detectLaps(samples, { line });
    // Do meio da pista, 4 passagens pela linha: 3 voltas, a 1ª começando na 1ª passagem.
    assert.equal(crossingsT.length, 4);
    assert.equal(laps.length, 3, `${hz} Hz`);
    assert.ok(
      Math.abs(laps[0].startCross.t - crossingsT[0]) <= TOL_MS,
      `${hz} Hz: 1ª volta começa em ${laps[0].startCross.t}, a linha é cruzada em ${crossingsT[0]}`,
    );
    assert.ok(laps[0].startedAt >= crossingsT[0] - TOL_MS);
    assertLapsWithin(laps.map((l) => l.durationMs), D, `${hz} Hz com traçado`);
  }
});

test('Duas gravações no mesmo traçado, começando em pontos diferentes, dão o mesmo tempo (± 20 ms)', () => {
  const line = layoutLine();
  const a = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.2, laps: 4, t0: 1_700_000_000_000 });
  const b = generateTimedLaps({ lapDurationMs: D, sampleRateHz: 10, startPhase: 0.7, laps: 4, t0: 1_700_000_500_037 });
  const la = detectLaps(a.samples, { line }).laps;
  const lb = detectLaps(b.samples, { line }).laps;
  assert.equal(la.length, 3);
  assert.equal(lb.length, 3);
  // O cruzamento cai no mesmo ponto da volta (a passagem pela linha) nas duas.
  la.forEach((l, i) => assert.ok(Math.abs(l.startCross.t - a.crossingsT[i]) <= TOL_MS));
  lb.forEach((l, i) => assert.ok(Math.abs(l.startCross.t - b.crossingsT[i]) <= TOL_MS));
  la.forEach((l, i) => {
    assert.ok(Math.abs(l.durationMs - lb[i].durationMs) <= TOL_MS, `${l.durationMs} × ${lb[i].durationMs}`);
  });
});

test('Parar na linha com jitter indo e voltando dá um cruzamento só, sem volta extra', () => {
  const line = layoutLine();
  const T0 = 1_700_000_000_000;
  const dt = 100;
  // Anda de 0,5 até chegar na linha (progresso 2)...
  const tArrive = T0 + 1.5 * D;
  const moving1 = sampleTrack((t) => 0.5 + (t - T0) / D, T0, tArrive, 10, 20);
  // ...fica 10 s parado na linha, com o GPS indo e voltando ±0,3 m...
  const tStop = moving1[moving1.length - 1].t + dt;
  const tLeave = tStop + 10_000;
  const stopped = sampleTrack((t) => 2 + 0.0004 * Math.sin((t - tStop) / 150), tStop, tLeave, 10, 0.3);
  // ...e sai para mais uma volta e um pouco.
  const tGo = tLeave + dt;
  const moving2 = sampleTrack((t) => 2 + (t - tGo) / D, tGo, tGo + 1.3 * D, 10, 20);
  const samples = [...moving1, ...stopped, ...moving2];

  // O jitter atravessa a linha no sentido dela mais de uma vez.
  let jitterCrossings = 0;
  for (let i = 1; i < stopped.length; i++) if (crossing(stopped[i - 1], stopped[i], line)) jitterCrossings++;
  assert.ok(jitterCrossings >= 2, `o jitter devia cruzar a linha, cruzou ${jitterCrossings}`);

  const { laps } = detectLaps(samples, { line });
  assert.equal(laps.length, 2, `voltas: ${laps.map((l) => l.durationMs).join(', ')}`);
  // A 2ª volta começa exatamente onde a 1ª terminou: na chegada à linha.
  assert.deepEqual(laps[1].startCross, laps[0].endCross);
  assert.ok(laps[0].endCross.t <= tStop, 'a 1ª volta fecha na chegada à linha');
  assert.ok(laps[1].durationMs >= D + 10_000 - TOL_MS, `a 2ª volta inclui a parada: ${laps[1].durationMs}`);
});

test('Trajeto na contramão sobre a linha não fecha volta', () => {
  const line = layoutLine();
  const { samples } = generateTimedLaps({
    lapDurationMs: D,
    sampleRateHz: 10,
    startPhase: 0.5,
    laps: 4,
    reverse: true,
  });
  assert.equal(detectLaps(samples, { line }).laps.length, 0);
});

test('Buraco de mais de 2 s exatamente no cruzamento não fecha a volta ali; a seguinte segue a regra dos 180 s', () => {
  const line = layoutLine();
  const { samples, crossingsT } = generateTimedLaps({
    lapDurationMs: D,
    sampleRateHz: 10,
    startPhase: 0.5,
    laps: 5,
  });
  const hole = crossingsT[1];
  const withHole = samples.filter((s) => Math.abs(s.t - hole) >= 1200);
  const { laps } = detectLaps(withHole, { line });

  for (const l of laps) {
    assert.ok(Math.abs(l.endCross.t - hole) > 1200, `volta fechou dentro do buraco (${l.endCross.t})`);
  }
  // A volta aberta no 1º cruzamento só fecha no 3º: 2 voltas reais, abaixo de 180 s.
  assert.equal(laps.length, 3);
  assert.ok(Math.abs(laps[0].startCross.t - crossingsT[0]) <= TOL_MS);
  assert.ok(Math.abs(laps[0].endCross.t - crossingsT[2]) <= TOL_MS);
  assertLapsWithin([laps[0].durationMs], 2 * D, 'volta sobre o buraco');
});

test('Regras de validade: volta de menos de 25 s ou de menos de 300 m não fecha', () => {
  // Pista de 60 m de raio (377 m) em 20 s: cada passagem pela linha dá menos de 25 s.
  const short = generateTimedLaps({ lapDurationMs: 20_000, sampleRateHz: 10, radiusMeters: 60, laps: 4, warmupS: 2 });
  const shortLaps = detectLaps(short.samples).laps;
  assert.ok(shortLaps.length > 0);
  for (const l of shortLaps) assert.ok(l.durationMs >= 25_000, `volta de ${l.durationMs} ms`);

  // Pista de 30 m de raio (188 m) em 30 s: cada passagem dá menos de 300 m.
  const small = generateTimedLaps({ lapDurationMs: 30_000, sampleRateHz: 10, radiusMeters: 30, laps: 4, warmupS: 2 });
  const smallLaps = detectLaps(small.samples).laps;
  assert.ok(smallLaps.length > 0);
  for (const l of smallLaps) {
    let dist = 0;
    for (let i = l.startIdx + 1; i <= l.endIdx; i++) {
      const a = small.samples[i - 1];
      const b = small.samples[i];
      dist += Math.hypot((b.lat - a.lat) * 111_320, (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
    }
    assert.ok(dist >= 300, `volta de ${dist.toFixed(0)} m`);
  }
});

test('GPX de bancada: 3 voltas, e os tempos deixam de ser múltiplos de 100 ms', () => {
  const xml = readFileSync(join(__dirname, '..', 'scripts', 'bench-leandro-melo-3laps.gpx'), 'utf8');
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml);
  const pts: { lat: string; lon: string; time: string; speed?: string }[] = doc.gpx.trk.trkseg.trkpt;
  const samples: GpsSample[] = pts.map((p) => ({
    lat: parseFloat(p.lat),
    lng: parseFloat(p.lon),
    t: new Date(p.time).getTime(),
    speed: p.speed ? parseFloat(p.speed) : 0,
    accuracy: 5,
  }));

  const { laps } = detectLaps(samples);
  assert.equal(laps.length, 3);
  assert.ok(
    laps.some((l) => l.durationMs % 100 !== 0),
    `tempos: ${laps.map((l) => l.durationMs).join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// T16: trava de saída. Um cruzamento só fecha volta se o piloto se afastou
// mais de 30 m (2 × lineRadius) da linha desde o cruzamento anterior.
// TMP-03 e o edge case "parar na linha e sair de novo".
// ---------------------------------------------------------------------------

/** Ruído determinístico em [-1, 1] (LCG), para o jitter ser igual em toda rodada. */
function seededNoise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return (s / 0xffff_ffff) * 2 - 1;
  };
}

test('Kart parado 60 s em cima da linha, com jitter de ±3 m que cruza para a frente e soma mais de 300 m, não fecha volta extra; a volta depois da parada sai a até 20 ms', () => {
  const line = layoutLine();
  const circumference = 2 * Math.PI * 120;
  const T0 = 1_700_000_000_000;
  const dt = 100;
  const speed = circumference / (D / 1000);

  // Anda de 0,5 até passar a linha (progresso 2) e para em cima dela...
  const tArrive = T0 + 1.5 * D;
  const moving1 = sampleTrack((t) => 0.5 + (t - T0) / D, T0, tArrive + dt, 10, speed);
  // ...fica 60 s parado ali, com o GPS pulando ±3 m ao longo da pista...
  const noise = seededNoise(219);
  const tStop = moving1[moving1.length - 1].t + dt;
  const tLeave = tStop + 60_000;
  const stopped = sampleTrack(() => 2 + (3 / circumference) * noise(), tStop, tLeave, 10, 0.5);
  // ...e sai da linha para duas voltas e um pouco.
  const tGo = tLeave + dt;
  const moving2 = sampleTrack((t) => 2 + (t - tGo) / D, tGo, tGo + 2.3 * D, 10, speed);
  const samples = [...moving1, ...stopped, ...moving2];

  // O jitter atravessa a linha para a frente várias vezes e soma mais de 300 m.
  let jitterCrossings = 0;
  let jitterDist = 0;
  for (let i = 1; i < stopped.length; i++) {
    if (crossing(stopped[i - 1], stopped[i], line)) jitterCrossings++;
    jitterDist += Math.hypot(
      (stopped[i].lat - stopped[i - 1].lat) * 111_320,
      (stopped[i].lng - stopped[i - 1].lng) * 111_320 * Math.cos((stopped[i].lat * Math.PI) / 180),
    );
  }
  assert.ok(jitterCrossings >= 5, `o jitter devia cruzar a linha várias vezes, cruzou ${jitterCrossings}`);
  assert.ok(jitterDist > 300, `o jitter devia somar mais de 300 m, somou ${jitterDist.toFixed(0)} m`);

  const { laps } = detectLaps(samples, { line });
  // Passagens reais: chegada (progresso 2), saída + 1 volta (3) e + 2 voltas (4).
  const tCross3 = tGo + D;
  const tCross4 = tGo + 2 * D;
  assert.equal(laps.length, 3, `voltas: ${laps.map((l) => l.durationMs).join(', ')}`);
  assertLapsWithin([laps[0].durationMs], D, 'volta antes da parada');
  // Nenhum cruzamento do jitter fecha volta.
  for (const l of laps) {
    assert.ok(l.endCross.t < tStop || l.endCross.t > tLeave, `volta fechou durante a parada (${l.endCross.t})`);
  }
  // A volta que contém a parada vai da chegada à linha até a passagem seguinte.
  assert.ok(Math.abs(laps[1].startCross.t - tArrive) <= TOL_MS);
  assert.ok(Math.abs(laps[1].durationMs - (tCross3 - tArrive)) <= TOL_MS, `volta com a parada: ${laps[1].durationMs}`);
  // Depois da parada, a volta normal sai a até 20 ms da duração real.
  assert.ok(Math.abs(laps[2].startCross.t - tCross3) <= TOL_MS);
  assert.ok(Math.abs(laps[2].endCross.t - tCross4) <= TOL_MS);
  assertLapsWithin([laps[2].durationMs], D, 'volta depois da parada');
});
