/**
 * Repositório de voltas (T22) sobre SQL real (sql.js): TF-11 (a volta lida é a
 * janela sobre o bruto, com as fronteiras geradas na leitura, AD-006), TF-16 (a
 * sessão de 20 min é lida e montada em até 200 ms no Node) e a leitura sem bruto
 * para listas e agregados (`loadLapSummaries`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LapRecord } from '../src/lib/analysis';
import { loadLapSummaries, loadLaps } from '../src/storage/lapRepo';
import type { SqlTx, SqlValue } from '../src/storage/sqlConn';
import type { GpsFrame, ImuFrame } from '../src/telemetry/frame';
import { sessionOnDb } from './helpers/sessionOnDb';
import { generateTimedLaps } from './helpers/syntheticTrack';
import { openV5Database } from './helpers/v5Database';

const T0 = 1_790_000_000_000;

/**
 * Pista sintética em frames (t desde T0), GPS a 10 Hz: fixes boas de 3 a 7 m, uma
 * a cada 9 com 45 m (deslocada 40 m) e uma a cada 13 sem precisão.
 */
function trackFrames(laps: number, lapDurationMs = 37_699): GpsFrame[] {
  const { samples } = generateTimedLaps({ lapDurationMs, sampleRateHz: 10, startPhase: 0.37, laps, warmupS: 3, t0: T0 });
  return samples.map((s, i) => {
    const f: GpsFrame = { kind: 'gps', source: 'PHONE', t: s.t - T0, lat: s.lat, lng: s.lng, speed: s.speed, fix: 'unknown' };
    if (i % 9 === 4) {
      f.accuracy = 45;
      f.lat += 0.00036;
    } else if (i % 13 !== 6) {
      f.accuracy = 3 + (i % 5);
    }
    return f;
  });
}

/** IMU a 50 Hz do primeiro ao último instante do GPS. */
function imuFrames(gps: GpsFrame[]): ImuFrame[] {
  const out: ImuFrame[] = [];
  for (let t = 0; t <= gps[gps.length - 1].t; t += 20) {
    out.push({ kind: 'imu', source: 'PHONE', t, accel: { x: 0.1, y: -0.2, z: 9.8 }, gyro: { x: 0, y: 0, z: t / 1e6 } });
  }
  return out;
}

/** O `SqlTx` com o registro de cada consulta (SQL e parâmetros). */
function spied(conn: SqlTx): { conn: SqlTx; queries: { sql: string; params: SqlValue[] }[] } {
  const queries: { sql: string; params: SqlValue[] }[] = [];
  return {
    queries,
    conn: {
      ...conn,
      getAllAsync: (sql, ...params) => {
        queries.push({ sql, params });
        return conn.getAllAsync(sql, ...params);
      },
      getFirstAsync: (sql, ...params) => {
        queries.push({ sql, params });
        return conn.getFirstAsync(sql, ...params);
      },
    },
  };
}

const blockReadsOf = (queries: { sql: string; params: SqlValue[] }[], seriesId: string) =>
  queries.filter((q) => q.sql.includes('telemetry_blocks') && q.params.includes(seriesId));

test('loadLaps (sql.js): cada volta lida tem as fronteiras geradas nos cruzamentos e os frames internos ≤ 30 m da janela, e a IMU de start.t a end.t', async () => {
  const { conn } = await openV5Database();
  const gps = trackFrames(4);
  const imu = imuFrames(gps);
  const s = await sessionOnDb(conn, { recordingId: 'rec_1', gps, imu, t0Utc: T0 });
  assert.equal(s.windows.length, 4);

  const laps = await loadLaps(conn, s.sessionId, { imu: true });
  assert.equal(laps.length, 4);
  laps.forEach((lap, i) => {
    const { window, durationMs, startT } = s.windows[i];
    const { start, end } = window;
    assert.equal(lap.id, `${s.sessionId}_lap_${i + 1}`);
    assert.equal(lap.sessionId, s.sessionId);
    assert.equal(lap.startedAt, T0 + startT);
    assert.equal(lap.durationMs, durationMs);
    assert.deepEqual(lap.window, window);

    const boundary = (c: typeof start): GpsFrame => ({
      kind: 'gps', source: 'PHONE', t: c.t, lat: c.lat, lng: c.lng, speed: c.speed, accuracy: c.accuracy, fix: 'unknown', synthetic: true,
    });
    const inner = gps.filter((f) => f.accuracy !== undefined && f.accuracy <= 30 && f.t > start.t && f.t < end.t);
    assert.ok(inner.length > 300, `volta ${i + 1}: ${inner.length} frames internos`);
    assert.deepEqual(lap.gps, [boundary(start), ...inner, boundary(end)]);
    assert.deepEqual(lap.imu, imu.filter((f) => f.t >= start.t && f.t <= end.t));
    // Transição (até a T46): as propriedades antigas são os mesmos arrays.
    assert.equal(lap.samples, lap.gps);
    assert.equal(lap.imuSamples, lap.imu);
  });
});

test('loadLaps (sql.js): sem imu: true, nenhum bloco de IMU é lido nem decodificado, e as voltas saem sem IMU', async () => {
  const { conn } = await openV5Database();
  const gps = trackFrames(4);
  const s = await sessionOnDb(conn, { recordingId: 'rec_1', gps, imu: imuFrames(gps), t0Utc: T0 });

  const without = spied(conn);
  const laps = await loadLaps(without.conn, s.sessionId);
  assert.equal(laps.length, 4);
  assert.deepEqual(blockReadsOf(without.queries, s.imuSeriesId), []);
  assert.ok(blockReadsOf(without.queries, s.gpsSeriesId).length > 0);
  for (const lap of laps) {
    assert.equal(lap.imu, undefined);
    assert.equal(lap.imuSamples, undefined);
    assert.ok(lap.gps!.length > 300);
  }

  // Com imu: true, a mesma leitura passa pelos blocos de IMU.
  const withImu = spied(conn);
  await loadLaps(withImu.conn, s.sessionId, { imu: true });
  assert.ok(blockReadsOf(withImu.queries, s.imuSeriesId).length > 0);
});

test('loadLaps (TF-16): sessão de 20 min (GPS 10 Hz, IMU 50 Hz, 20 voltas) lida com imu: true e montada em ≤ 200 ms (mediana de 5, depois de 1 aquecimento)', async (t) => {
  const { conn } = await openV5Database();
  const gps = trackFrames(20, 59_700);
  const imu = imuFrames(gps);
  const durationS = gps[gps.length - 1].t / 1000;
  assert.ok(durationS >= 1195 && durationS <= 1205, `sessão de ${durationS} s`);
  assert.ok(gps.length >= 11_950 && imu.length >= 59_750, `${gps.length} GPS, ${imu.length} IMU`);
  const s = await sessionOnDb(conn, { recordingId: 'rec_20min', gps, imu, t0Utc: T0 });
  assert.equal(s.windows.length, 20);

  let laps: LapRecord[] = await loadLaps(conn, s.sessionId, { imu: true });
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    laps = await loadLaps(conn, s.sessionId, { imu: true });
    runs.push(performance.now() - start);
  }
  const median = [...runs].sort((a, b) => a - b)[2];
  t.diagnostic(`TF-16: mediana ${median.toFixed(1)} ms (${runs.map((r) => r.toFixed(1)).join(', ')})`);

  assert.equal(laps.length, 20);
  assert.ok(laps.every((l) => l.gps!.length > 450 && l.imu!.length > 2_800));
  assert.ok(median <= 200, `mediana de ${median.toFixed(1)} ms`);
});

test('loadLapSummaries (sql.js): devolve id, startedAt e durationMs de cada volta, em ordem, sem ler nenhum bloco', async () => {
  const { conn } = await openV5Database();
  const gps = trackFrames(4);
  const s = await sessionOnDb(conn, { recordingId: 'rec_1', gps, imu: imuFrames(gps), t0Utc: T0 });

  const spy = spied(conn);
  const summaries = await loadLapSummaries(spy.conn, s.sessionId);
  assert.deepEqual(
    summaries,
    s.windows.map((w, i) => ({ id: `${s.sessionId}_lap_${i + 1}`, startedAt: T0 + w.startT, durationMs: w.durationMs }))
  );
  assert.deepEqual(spy.queries.filter((q) => q.sql.includes('telemetry_blocks') || q.sql.includes('telemetry_series')), []);
});

test('loadLaps (sql.js): volta ainda não convertida (sem janela, só o JSON) sai como saía antes, até a v5b', async () => {
  const { conn } = await openV5Database();
  await conn.runAsync(
    `INSERT INTO sessions (id, track_name, started_at) VALUES ('session_old', 'Antiga', ?)`,
    T0
  );
  const samples = [
    { t: T0 + 1000, lat: -14.86, lng: -40.84, speed: 10, accuracy: 4, synthetic: true },
    { t: T0 + 1100, lat: -14.861, lng: -40.841, speed: 11, accuracy: 5 },
  ];
  const imuSamples = [{ t: T0 + 1000, accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0.1 } }];
  await conn.runAsync(
    `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json)
     VALUES ('old_lap_1', 'session_old', ?, 100, ?, ?)`,
    T0 + 1000,
    JSON.stringify(samples),
    JSON.stringify(imuSamples)
  );

  const old = { id: 'old_lap_1', sessionId: 'session_old', startedAt: T0 + 1000, durationMs: 100, samples };
  assert.deepEqual(await loadLaps(conn, 'session_old', { imu: true }), [{ ...old, imuSamples }]);
  assert.deepEqual(await loadLaps(conn, 'session_old'), [{ ...old, imuSamples: undefined }]);
});

test('getLapsForSession (db.ts, estático): delega para loadLaps com a IMU e não lê mais o JSON de amostras', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'storage', 'db.ts'), 'utf8');
  const m = /export async function getLapsForSession\(sessionId: string\): Promise<LapRecord\[\]> \{([\s\S]*?)\n\}\n/.exec(src);
  assert.ok(m, 'db.ts exporta getLapsForSession');
  assert.equal(m[1].trim(), 'return loadLaps(await appSqlConn(), sessionId, { imu: true });');
});
