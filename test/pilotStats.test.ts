/**
 * Estatísticas do piloto sobre o `LapRecord` novo (TF-13, T32): os km somam o
 * comprimento de cada volta pelos frames de GPS (`gps`), com os pontos de
 * fronteira, como somavam pelas amostras antes.
 *
 * O `db.ts` importa o expo-sqlite (nativo): entra um stub no `require.cache` com
 * um repositório falso de 3 sessões.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LapRecord } from '../src/lib/analysis';
import type { Session } from '../src/storage/db';
import type { GpsFrame } from '../src/telemetry/frame';

const R_EARTH = 6_371_000;
const DEG = Math.PI / 180;

/** Frames ao longo do meridiano 0, de `lat0` a `lat1` graus em `n` passos: o comprimento é R × Δlat. */
function meridian(lat0: number, lat1: number, n: number): GpsFrame[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    kind: 'gps' as const,
    source: 'PHONE' as const,
    fix: 'unknown' as const,
    t: i * 100,
    lat: lat0 + ((lat1 - lat0) * i) / n,
    lng: 0,
    speed: 10,
    accuracy: 4,
    ...(i === 0 || i === n ? { synthetic: true as const } : {}),
  }));
}

function lap(id: string, sessionId: string, durationMs: number, gps: GpsFrame[]): LapRecord {
  return { id, sessionId, startedAt: 0, durationMs, gps, samples: gps };
}

function session(id: string, startedAt: number): Session {
  return {
    id, trackName: 'Kartódromo', kart: null, notes: null, startedAt, weather: 'dry',
    trackId: null, mode: 'race', layoutId: null, kartSetupId: null, recovered: false,
  };
}

// 3 sessões: 2 voltas de 0,002° (≈ 222 m), 1 de 0,003° e 1 de 0,001°, e uma sessão sem volta.
const LAPS: Record<string, LapRecord[]> = {
  a: [lap('a1', 'a', 40_000, meridian(0, 0.002, 20)), lap('a2', 'a', 39_000, meridian(0.002, 0.004, 20))],
  b: [lap('b1', 'b', 41_000, meridian(-0.001, 0.002, 30)), lap('b2', 'b', 38_500, meridian(0, -0.001, 10))],
  c: [],
};
const SESSIONS = [session('c', 3_000), session('b', 2_000), session('a', 1_000)];

const dbPath = require.resolve('../src/storage/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    listSessions: async () => SESSIONS,
    getLapsForSession: async (id: string) => LAPS[id] ?? [],
  },
} as NodeJS.Module;
const { computePilotStats } = require('../src/lib/pilotStats') as typeof import('../src/lib/pilotStats');

test('computePilotStats: com 3 sessões, os km somam o comprimento dos frames de cada volta (R × Δlat no meridiano)', async () => {
  const stats = await computePilotStats();
  // 0,002 + 0,002 + 0,003 + 0,001 graus de latitude.
  const expectedKm = (R_EARTH * 0.008 * DEG) / 1000;
  assert.ok(Math.abs(stats.totalKm - expectedKm) <= 1e-9 * expectedKm, `${stats.totalKm} km, esperado ${expectedKm}`);
  assert.equal(stats.sessionCount, 3);
  assert.equal(stats.lapCount, 4);
  assert.equal(stats.bestLapMs, 38_500);
  assert.equal(stats.totalTimeMs, 40_000 + 39_000 + 41_000 + 38_500);
});
