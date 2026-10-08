/**
 * Payload do ao vivo a partir de frames (T18, TF-15): o `live_samples` sai
 * igual ao que `app/recording.tsx` montava para o `GpsSample` equivalente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LiveFrame, LiveSample, LiveSampleInfo } from '../src/lib/liveSession';
import type { GpsFrame } from '../src/telemetry/frame';

// `publishSample` real, com o Supabase trocado por um que guarda a linha.
const rows: Record<string, unknown>[] = [];
function stub(path: string, exports: Record<string, unknown>): void {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
}
stub('../src/lib/supabase', {
  getSupabase: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
    }),
  }),
});
stub('../src/lib/deviceId', { getDeviceId: async () => 'device' });
stub('../src/storage/profile', { getProfile: async () => null });
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
const { publishSample, toLiveSample } = require('../src/lib/liveSession') as typeof import('../src/lib/liveSession');

const T0_UTC = 1_790_000_000_000;

/** O objeto que `recording.tsx` montava antes da T18, para um `GpsSample` com tempo absoluto. */
function todayPayload(s: LiveFrame, info: LiveSampleInfo): LiveSample {
  return {
    t: s.t,
    lat: s.lat,
    lng: s.lng,
    speed: s.speed,
    heading: s.heading,
    accuracy: s.accuracy,
    lapNumber: info.lapsCompleted,
    lapElapsedMs: info.currentLapElapsedMs ?? undefined,
    bestLapMs: info.bestLapMs ?? null,
    deltaVsRefMs: info.liveDeltaMs,
    currentSectorIdx: info.currentSectorIdx,
    currentSectorElapsedMs: info.currentSectorElapsedMs,
    s1Ms: info.currentSectors.s1Ms,
    s2Ms: info.currentSectors.s2Ms,
    s3Ms: info.currentSectors.s3Ms,
    altitude: s.altitude ?? null,
    altitudeAccuracy: s.altitudeAccuracy ?? null,
  };
}

async function row(sample: LiveSample): Promise<Record<string, unknown>> {
  rows.length = 0;
  await publishSample('live_1', sample);
  assert.equal(rows.length, 1);
  return rows[0];
}

const INFO: LiveSampleInfo = {
  lapsCompleted: 3,
  currentLapElapsedMs: 12_345.6,
  bestLapMs: 38_001,
  liveDeltaMs: -120.5,
  currentSectorIdx: 1,
  currentSectorElapsedMs: 4_000.25,
  currentSectors: { s1Ms: 9_100, s2Ms: null, s3Ms: null },
};

test('toLiveSample: o payload do frame é o mesmo de hoje para o GpsSample equivalente, com o t em ISO absoluto', async () => {
  const frame: GpsFrame = {
    kind: 'gps',
    source: 'PHONE',
    t: 61_234,
    lat: -25.43,
    lng: -49.27,
    speed: 18.5,
    heading: 91,
    accuracy: 4,
    altitude: 912,
    altitudeAccuracy: 3,
    fix: 'unknown',
    gnssTime: T0_UTC + 61_234,
  };
  const sample: LiveFrame = { t: T0_UTC + 61_234, lat: -25.43, lng: -49.27, speed: 18.5, heading: 91, accuracy: 4, altitude: 912, altitudeAccuracy: 3 };

  const got = await row(toLiveSample(frame, INFO, T0_UTC));
  assert.deepEqual(got, await row(todayPayload(sample, INFO)));
  assert.equal(got.t, new Date(1_790_000_061_234).toISOString());
  assert.equal(got.lap_elapsed_ms, 12_345.6);
  assert.equal(got.s1_ms, 9_100);
});

// Substitui o regex `lapElapsedMs: info.currentLapElapsedMs ?? undefined` de
// `recordingScreen.test.ts`: o payload agora é montado aqui (TMP-05 AC 3).
test('toLiveSample: antes do 1º cruzamento, o tempo da volta vai null, e sem rumo nem altitude também', async () => {
  const frame: GpsFrame = { kind: 'gps', source: 'PHONE', t: 500, lat: -25.43, lng: -49.27, speed: 0, accuracy: 6, fix: 'unknown' };
  const sample: LiveFrame = { t: T0_UTC + 500, lat: -25.43, lng: -49.27, speed: 0, accuracy: 6 };
  const info: LiveSampleInfo = { ...INFO, lapsCompleted: 0, currentLapElapsedMs: null, currentSectorIdx: null, currentSectorElapsedMs: null };

  const got = await row(toLiveSample(frame, info, T0_UTC));
  assert.deepEqual(got, await row(todayPayload(sample, info)));
  assert.equal(got.lap_elapsed_ms, null);
  assert.equal(got.heading, null);
  assert.equal(got.altitude, null);
  assert.equal(got.t, new Date(T0_UTC + 500).toISOString());
});

test('recording.tsx: o ponto publicado é montado por toLiveSample(', () => {
  const src = readFileSync(join(__dirname, '..', 'app', 'recording.tsx'), 'utf8');
  assert.ok(src.includes('publishSample(live.id, toLiveSample('));
  assert.equal(/lapElapsedMs:\s*info\./.test(src), false, 'a tela não monta mais o payload à mão');
});
