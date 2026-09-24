/**
 * Gerador de pista sintética, portado de scripts/self-test-lap-detector.js.
 * Pista circular em lat/lng real, para reusar o haversine sem mock.
 */
import type { GpsSample } from '../../src/lib/geometry';

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
}: LapSamplesOptions): GpsSample[] {
  const track = makeCircularTrack(baseLat, baseLng, radiusMeters);
  const samples: GpsSample[] = [];
  const dt = 1000 / sampleRateHz;
  let t = startTimestamp;

  const warmupSamples = Math.floor(warmupS * sampleRateHz);
  const startPt = track(0);
  for (let i = 0; i < warmupSamples; i++) {
    samples.push({
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
