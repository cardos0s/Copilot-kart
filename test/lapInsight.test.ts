/**
 * Insights "Sua volta": TMP-12 (AC 1, 2) e TMP-13. Mesma limpeza da análise
 * (cleanSamples(10) e repairDegenerateTimestamps), média de cada curva só com
 * as voltas válidas nela, e só sessões do mesmo traçado da âncora.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LapRecord } from '../src/lib/analysis';
import { makeLocalProjector, type GpsSample, type XY } from '../src/lib/geometry';
import { buildLapInsight, lapsForInsight } from '../src/lib/lapInsight';
import type { Session } from '../src/storage/db';

// Pista de retângulo com cantos arredondados (raio 15 m): 4 curvas nítidas.
const R = 15;
const STRAIGHT_X = 120;
const STRAIGHT_Y = 30;
const ARC = (Math.PI / 2) * R;
const P = 2 * STRAIGHT_X + 2 * STRAIGHT_Y + 4 * ARC;
/** Trecho da curva 2 (a segunda da volta), em metros desde a linha. */
const C2_START = STRAIGHT_X + ARC + STRAIGHT_Y;
const C2_END = C2_START + ARC;

function xyAt(sRaw: number): XY {
  let s = ((sRaw % P) + P) % P;
  const arc = (cx: number, cy: number, a0: number, d: number): XY => {
    const a = a0 + d / R;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  };
  if (s < STRAIGHT_X) return { x: s, y: 0 };
  s -= STRAIGHT_X;
  if (s < ARC) return arc(STRAIGHT_X, R, -Math.PI / 2, s);
  s -= ARC;
  if (s < STRAIGHT_Y) return { x: STRAIGHT_X + R, y: R + s };
  s -= STRAIGHT_Y;
  if (s < ARC) return arc(STRAIGHT_X, R + STRAIGHT_Y, 0, s);
  s -= ARC;
  if (s < STRAIGHT_X) return { x: STRAIGHT_X - s, y: 2 * R + STRAIGHT_Y };
  s -= STRAIGHT_X;
  if (s < ARC) return arc(0, R + STRAIGHT_Y, Math.PI / 2, s);
  s -= ARC;
  if (s < STRAIGHT_Y) return { x: -R, y: R + STRAIGHT_Y - s };
  s -= STRAIGHT_Y;
  return arc(0, R, Math.PI, s);
}

const proj = makeLocalProjector({ lat: -14.8619, lng: -40.8444 });
let lapSeq = 0;

/**
 * Uma volta a 10 Hz: 15 m/s na pista toda e `c2Speed` na curva 2. Com
 * `stopS`, o kart fica parado 30 s dentro da curva 2 (tempo anômalo ali).
 */
function makeLap(c2Speed: number, stopS = 0): LapRecord {
  const t0 = 1_700_000_000_000 + lapSeq * 1_000_000;
  const id = `lap_${++lapSeq}`;
  const samples: GpsSample[] = [];
  let s = 0;
  let t = t0;
  let stopLeft = stopS;
  for (;;) {
    const inC2 = s >= C2_START && s < C2_END;
    const v = inC2 ? c2Speed : 15;
    const { lat, lng } = proj.toLatLng(xyAt(s));
    samples.push({ t, lat, lng, speed: v, accuracy: 4 });
    if (s >= P) break;
    if (stopLeft > 0 && s >= (C2_START + C2_END) / 2) stopLeft -= 0.1;
    else s += v * 0.1;
    t += 100;
  }
  return { id, sessionId: 's1', samples, startedAt: t0, durationMs: t - t0 };
}

const best = makeLap(15);
const g1 = makeLap(12);
const g2 = makeLap(11);
const g3 = makeLap(10);

function c2Loss(laps: LapRecord[]): number {
  const insight = buildLapInsight(laps);
  assert.ok(insight);
  assert.equal(insight.corners.length, 4, 'a pista sintética tem 4 curvas');
  return insight.corners[1].lossMs;
}

test('buildLapInsight: 3 voltas boas e 1 com a curva 2 inválida dão, na curva 2, a média exata das 3 boas', () => {
  const each = [g1, g2, g3].map((l) => c2Loss([best, l]));
  for (const l of each) assert.ok(l > 0, `cada volta boa perde tempo na curva 2 (${l} ms)`);
  // A volta parada 30 s na curva 2 não tem tempo válido ali.
  const stopped = makeLap(15, 30);
  const alone = buildLapInsight([best, stopped]);
  assert.ok(alone);
  assert.equal(alone.corners[1].lapsLosing, 0);

  const mean = (each[0] + each[1] + each[2]) / 3;
  const loss = c2Loss([best, g1, g2, stopped, g3]);
  assert.ok(Math.abs(loss - mean) < 1e-6, `curva 2: ${loss} ms, média das 3 boas ${mean} ms`);
});

test('buildLapInsight: volta com timestamps degenerados é reparada antes de entrar (± 20 ms na perda da curva)', () => {
  const degenerate: LapRecord = { ...g3, samples: g3.samples.map((p) => ({ ...p, t: g3.startedAt })) };
  const expected = c2Loss([best, g1, g2, g3]);
  const loss = c2Loss([best, g1, g2, degenerate]);
  assert.ok(Math.abs(loss - expected) <= 20, `curva 2: ${loss} ms com a volta reparada, ${expected} ms com a original`);
});

test('buildLapInsight: fixes com precisão acima de 10 m não entram', () => {
  // Cinco fixes ruins no meio da curva 2, jogados 60 m para dentro do retângulo.
  const bad = new Set<number>();
  const g2Bad: LapRecord = {
    ...g2,
    samples: g2.samples.map((p, i) => {
      const s = (i * 0.1 - (C2_START / 15)) * 11 + C2_START;
      if (s < C2_START + 5 || bad.size >= 5) return p;
      bad.add(i);
      const xy = proj.toXY(p);
      const { lat, lng } = proj.toLatLng({ x: xy.x - 60, y: xy.y - 10 });
      return { ...p, lat, lng, accuracy: 30 };
    }),
  };
  assert.equal(bad.size, 5);
  const g2Without: LapRecord = { ...g2, samples: g2.samples.filter((_, i) => !bad.has(i)) };

  const withBad = buildLapInsight([best, g1, g2Bad, g3]);
  const without = buildLapInsight([best, g1, g2Without, g3]);
  assert.ok(withBad && without);
  assert.deepEqual(
    withBad.corners.map((c) => c.lossMs),
    without.corners.map((c) => c.lossMs),
  );
});

function session(id: string, trackId: string | null, layoutId: string | null, trackName = 'Kartódromo'): Session {
  return {
    id, trackName, kart: null, notes: null, startedAt: 0, weather: 'dry',
    trackId, mode: 'race', layoutId, kartSetupId: null, recovered: false,
  };
}

test('lapsForInsight: com sessões de dois traçados na mesma pista, devolve só as do traçado da âncora', () => {
  const sessions = [
    session('a1', 'track_1', 'layout_curto'),
    session('b1', 'track_1', 'layout_longo'),
    session('a2', 'track_1', 'layout_curto'),
    session('x1', 'track_2', 'layout_outra'),
    session('b2', 'track_1', 'layout_longo'),
    session('n1', 'track_1', null),
  ];
  assert.deepEqual(lapsForInsight(sessions, sessions[0]).map((s) => s.id), ['a1', 'a2']);
  assert.deepEqual(lapsForInsight(sessions, sessions[1]).map((s) => s.id), ['b1', 'b2']);
  // Âncora sem traçado: só as sessões sem traçado da mesma pista.
  assert.deepEqual(lapsForInsight(sessions, sessions[5]).map((s) => s.id), ['n1']);
});

// --- TMP-11 AC 3: a escala de velocidade do "Sua volta" usa o pico honesto ---

test('buildLapInsight: numa melhor volta a ~80 km/h com um único ponto a 150 km/h, maxKmh fica abaixo de 81', () => {
  // 500 pontos a 10 Hz, na pista de retângulo, a 80 km/h (±0,5); o ponto 250 salta para 150 km/h.
  const v = 80 / 3.6;
  const t0 = 1_700_000_000_000 + 999 * 1_000_000;
  const samples: GpsSample[] = Array.from({ length: 500 }, (_, i) => {
    const { lat, lng } = proj.toLatLng(xyAt(i * v * 0.1));
    return { t: t0 + i * 100, lat, lng, speed: v + ((i % 3) - 1) * 0.1, accuracy: 4 };
  });
  samples[250] = { ...samples[250], speed: 150 / 3.6 };
  const best: LapRecord = { id: 'lap_pico', sessionId: 's_pico', samples, startedAt: t0, durationMs: 49_900 };

  const insight = buildLapInsight([best]);
  assert.ok(insight);
  assert.equal(insight.best.id, 'lap_pico');
  assert.ok(insight.maxKmh < 81, `maxKmh ${insight.maxKmh}`);
  assert.ok(insight.maxKmh > 79, `maxKmh ${insight.maxKmh}`);
});
