/**
 * Gerador de pista sintética, portado de scripts/self-test-lap-detector.js.
 * Pista circular em lat/lng real, para reusar o haversine sem mock.
 */
import type { AnalysisGpsFrame } from '../../src/telemetry/laps';

export function makeCircularTrack(baseLat: number, baseLng: number, radiusMeters = 120) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((baseLat * Math.PI) / 180);
  const radiusLat = radiusMeters / metersPerDegLat;
  const radiusLng = radiusMeters / metersPerDegLng;

  return function pointAt(progress: number) {
    const theta = progress * 2 * Math.PI;
    return {
      lat: baseLat + radiusLat * Math.sin(theta),
      lng: baseLng + radiusLng * Math.cos(theta) - radiusLng, // largada em (baseLat, baseLng)
    };
  };
}

export type LapSamplesOptions = {
  baseLat?: number;
  baseLng?: number;
  radiusMeters?: number;
  numLaps?: number;
  lapDurationS?: number;
  sampleRateHz?: number;
  warmupS?: number;
  cooldownS?: number;
  startTimestamp?: number;
};

/** Samples de GPS simulando N voltas: aquecimento parado, voltas em ritmo e pit in. */
export function generateLapSamples({
  baseLat = -14.8619,
  baseLng = -40.8444,
  radiusMeters = 120,
  numLaps = 2,
  lapDurationS = 55,
  sampleRateHz = 5,
  warmupS = 3,
  cooldownS = 0,
  startTimestamp = Date.now(),
}: LapSamplesOptions): AnalysisGpsFrame[] {
  const track = makeCircularTrack(baseLat, baseLng, radiusMeters);
  const samples: AnalysisGpsFrame[] = [];
  const dt = 1000 / sampleRateHz;
  let t = startTimestamp;

  const warmupSamples = Math.floor(warmupS * sampleRateHz);
  const startPt = track(0);
  for (let i = 0; i < warmupSamples; i++) {
    samples.push({
      kind: 'gps',
      source: 'PHONE',
      fix: 'unknown',
      t,
      lat: startPt.lat + (Math.random() - 0.5) * 0.00001,
      lng: startPt.lng + (Math.random() - 0.5) * 0.00001,
      speed: 0.5 + Math.random() * 0.5,
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  const samplesPerLap = Math.floor(lapDurationS * sampleRateHz);
  const totalRaceSamples = numLaps * samplesPerLap;
  const avgSpeed = (2 * Math.PI * radiusMeters) / lapDurationS;
  for (let i = 0; i < totalRaceSamples; i++) {
    const pt = track((i / samplesPerLap) % 1);
    samples.push({
      kind: 'gps',
      source: 'PHONE',
      fix: 'unknown',
      t,
      lat: pt.lat,
      lng: pt.lng,
      speed: avgSpeed + (Math.random() - 0.5) * 2,
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  const cooldownSamples = Math.floor(cooldownS * sampleRateHz);
  const pitPt = track(0.1);
  for (let i = 0; i < cooldownSamples; i++) {
    samples.push({
      kind: 'gps',
      source: 'PHONE',
      fix: 'unknown',
      t,
      lat: pitPt.lat + (Math.random() - 0.5) * 0.00001,
      lng: pitPt.lng + (Math.random() - 0.5) * 0.00001,
      speed: Math.max(0, 2 - i * 0.2),
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  return samples;
}

export type TrackShape = { baseLat?: number; baseLng?: number; radiusMeters?: number };

const DEFAULT_SHAPE = { baseLat: -14.8619, baseLng: -40.8444, radiusMeters: 120 };

/**
 * Amostra a pista circular a `hz`, de `fromT` a `toT` (inclusive), com o
 * progresso dado em função do tempo (1 = uma volta; a linha fica nos inteiros).
 * Sem ruído: o erro medido nos testes é só o do detector.
 */
export function sampleTrack(
  progressAt: (t: number) => number,
  fromT: number,
  toT: number,
  hz: number,
  speed: number,
  shape: TrackShape = {},
): AnalysisGpsFrame[] {
  const { baseLat, baseLng, radiusMeters } = { ...DEFAULT_SHAPE, ...shape };
  const track = makeCircularTrack(baseLat, baseLng, radiusMeters);
  const dt = 1000 / hz;
  const out: AnalysisGpsFrame[] = [];
  for (let k = 0; fromT + k * dt <= toT; k++) {
    const t = fromT + k * dt;
    const pt = track(progressAt(t));
    out.push({ kind: 'gps', source: 'PHONE', fix: 'unknown', t, lat: pt.lat, lng: pt.lng, speed, accuracy: 4 });
  }
  return out;
}

export type TimedLapsOptions = TrackShape & {
  /** Duração real de cada volta, em ms. */
  lapDurationMs: number;
  sampleRateHz: number;
  /** Fração da volta (0 = linha) em que o kart está no 1º ponto em movimento. */
  startPhase?: number;
  /** Quantas voltas (em progresso) o kart anda depois do 1º ponto em movimento. */
  laps: number;
  /** Tempo parado no ponto de partida antes de andar. */
  warmupS?: number;
  /** Tempo andando depois das voltas. */
  tailS?: number;
  t0?: number;
  /** Anda no sentido contrário ao da linha. */
  reverse?: boolean;
};

export type TimedLaps = {
  samples: AnalysisGpsFrame[];
  /** Instantes reais em que o kart passa pela linha (progresso inteiro), em ordem. */
  crossingsT: number[];
  /** Velocidade constante, m/s. */
  speed: number;
};

/**
 * Voltas com duração real conhecida, em velocidade constante, a `sampleRateHz`
 * e começando em `startPhase`. A amostragem não coincide com a linha: o erro do
 * tempo de volta contra `lapDurationMs` é o do detector.
 */
export function generateTimedLaps({
  lapDurationMs,
  sampleRateHz,
  startPhase = 0,
  laps,
  warmupS = 0,
  tailS = 2,
  t0 = 1_700_000_000_000,
  reverse = false,
  ...shape
}: TimedLapsOptions): TimedLaps {
  const { radiusMeters } = { ...DEFAULT_SHAPE, ...shape };
  const speed = (2 * Math.PI * radiusMeters) / (lapDurationMs / 1000);
  const dt = 1000 / sampleRateHz;
  const tStart = t0 + Math.round(warmupS * sampleRateHz) * dt;
  const tEnd = tStart + laps * lapDurationMs + tailS * 1000;
  const sign = reverse ? -1 : 1;
  const progressAt = (t: number) => startPhase + (sign * (t - tStart)) / lapDurationMs;

  const warmup = sampleTrack(() => startPhase, t0, tStart - dt / 2, sampleRateHz, 0, shape);
  const moving = sampleTrack(progressAt, tStart, tEnd, sampleRateHz, speed, shape);

  const crossingsT: number[] = [];
  if (!reverse) {
    for (let k = Math.ceil(startPhase); tStart + (k - startPhase) * lapDurationMs <= tEnd; k++) {
      crossingsT.push(tStart + (k - startPhase) * lapDurationMs);
    }
  }
  return { samples: [...warmup, ...moving], crossingsT, speed };
}
