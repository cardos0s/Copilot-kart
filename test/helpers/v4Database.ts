/**
 * Banco do app no schema v4 (antes desta feature), em SQL real (sql.js), e o JSON
 * que o código antigo gravava: pontos com `t` em epoch ms, acelerômetro em g, e
 * as voltas pós-AD-006 com os pontos sintéticos nas pontas. É a entrada da
 * migração v5 nos testes (T43–T45).
 */
import type { GpsFrame, ImuFrame, SeriesMeta } from '../../src/telemetry/frame';
import { G } from '../../src/telemetry/frame';
import { analysisGps, lapFrames, sliceLapWindows } from '../../src/telemetry/laps';
import { gpsSeriesOf } from '../../src/telemetry/series';
import { openSqlJsConn, type SqlJsConn } from './sqlJsConn';

/** As tabelas que o `db()` deixava na v4, com as colunas de JSON. */
export const V4_SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, track_name TEXT NOT NULL, kart TEXT, notes TEXT,
    started_at INTEGER NOT NULL, weather TEXT, track_id TEXT, mode TEXT,
    layout_id TEXT, kart_setup_id TEXT, recovered INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE laps (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL, samples_json TEXT NOT NULL, imu_samples_json TEXT
  );
  CREATE INDEX idx_laps_session ON laps(session_id);
  CREATE TABLE track_references (
    track_id TEXT PRIMARY KEY, track_name TEXT NOT NULL, samples_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, length_m REAL NOT NULL, recorded_at INTEGER NOT NULL,
    source_session_id TEXT, source_lap_id TEXT
  );
  CREATE TABLE track_layouts (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, name TEXT NOT NULL, samples_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, length_m REAL NOT NULL, recorded_at INTEGER NOT NULL,
    source_session_id TEXT, source_lap_id TEXT, is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_layouts_track ON track_layouts(track_id);
  CREATE TABLE pb_records (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, layout_id TEXT, session_id TEXT NOT NULL,
    lap_id TEXT NOT NULL, duration_ms INTEGER NOT NULL, celebrated INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recording_active (id TEXT PRIMARY KEY, meta_json TEXT NOT NULL, started_at INTEGER NOT NULL);
  CREATE TABLE recording_chunks (
    recording_id TEXT NOT NULL, seq INTEGER NOT NULL, gps_json TEXT NOT NULL, imu_json TEXT NOT NULL,
    PRIMARY KEY (recording_id, seq)
  );
  PRAGMA user_version = 4;
`;

export async function openV4Database(): Promise<SqlJsConn> {
  const conn = await openSqlJsConn();
  await conn.execAsync(V4_SCHEMA);
  return conn;
}

/** Ponto de GPS como o JSON antigo guardava. */
export type OldPoint = {
  t: number;
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  heading?: number;
  altitude?: number;
  altitudeAccuracy?: number;
  synthetic?: true;
};
/** IMU como o JSON antigo guardava: accel em g. */
export type OldImu = { t: number; accel: { x: number; y: number; z: number }; gyro: { x: number; y: number; z: number } };

/** O frame na forma do JSON antigo, com `t` absoluto (`t0Utc + t`). */
export function oldPoint(f: GpsFrame, t0Utc: number): OldPoint {
  const p: OldPoint = { t: t0Utc + f.t, lat: f.lat, lng: f.lng, speed: f.speed, accuracy: f.accuracy! };
  if (f.heading !== undefined) p.heading = f.heading;
  if (f.altitude !== undefined) p.altitude = f.altitude;
  if (f.altitudeAccuracy !== undefined) p.altitudeAccuracy = f.altitudeAccuracy;
  if (f.synthetic) p.synthetic = true;
  return p;
}

/** A IMU na forma do JSON antigo: `t` absoluto e o acelerômetro em g. */
export function oldImu(f: ImuFrame, t0Utc: number): OldImu {
  return { t: t0Utc + f.t, accel: { x: f.accel!.x / G, y: f.accel!.y / G, z: f.accel!.z / G }, gyro: f.gyro! };
}

export type OldLap = { id: string; startedAt: number; durationMs: number; samples: OldPoint[]; imu?: OldImu[] };

const META: SeriesMeta = { id: 'old', owner: { kind: 'session', id: 'old' }, source: 'PHONE', kind: 'gps', t0Utc: 0, legacy: false };

/**
 * As voltas como o código antigo as salvava, a partir de frames com `t` absoluto:
 * com os pontos sintéticos (pós-AD-006) ou sem eles (pré-AD-006, com o ponto da
 * fronteira repetido no início da volta seguinte).
 */
export function oldLaps(
  sessionId: string,
  frames: GpsFrame[],
  opts: { synthetic: boolean; imu?: OldImu[] }
): OldLap[] {
  const gps = analysisGps(frames);
  const series = gpsSeriesOf(META, gps);
  const windows = sliceLapWindows(gps);
  const laps = windows.map((w) => lapFrames(w.window, series).gps.map((f) => oldPoint(f, 0)));
  return windows.map((w, i) => {
    let samples = laps[i];
    if (!opts.synthetic) {
      samples = samples.slice(1, -1);
      if (i > 0) samples = [laps[i - 1][laps[i - 1].length - 2], ...samples];
    }
    const first = samples[0].t;
    const last = samples[samples.length - 1].t;
    const lap: OldLap = { id: `${sessionId}_lap_${i + 1}`, startedAt: w.startT, durationMs: w.durationMs, samples };
    if (opts.imu) lap.imu = opts.imu.filter((s) => s.t >= first && s.t <= last);
    return lap;
  });
}

/** Grava a sessão e as voltas no formato v4. */
export async function insertOldSession(
  conn: SqlJsConn,
  s: { id: string; startedAt: number; trackId: string; trackName?: string; layoutId?: string | null; laps: OldLap[]; corrupt?: string[] }
): Promise<void> {
  await conn.runAsync(
    `INSERT INTO sessions (id, track_name, started_at, weather, track_id, mode, layout_id, recovered)
     VALUES (?, ?, ?, 'dry', ?, 'race', ?, 0)`,
    s.id,
    s.trackName ?? 'Kartódromo',
    s.startedAt,
    s.trackId,
    s.layoutId ?? null
  );
  for (const l of s.laps) {
    const json = s.corrupt?.includes(l.id) ? JSON.stringify(l.samples).slice(0, 40) : JSON.stringify(l.samples);
    await conn.runAsync(
      'INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json) VALUES (?, ?, ?, ?, ?, ?)',
      l.id,
      s.id,
      l.startedAt,
      l.durationMs,
      json,
      l.imu && l.imu.length > 0 ? JSON.stringify(l.imu) : null
    );
  }
}

/** Grava o traçado no formato v4. */
export async function insertOldLayout(
  conn: SqlJsConn,
  l: { id: string; trackId: string; name?: string; samples: OldPoint[]; durationMs: number; lengthM?: number; recordedAt: number; isDefault?: boolean; sourceSessionId?: string; sourceLapId?: string }
): Promise<void> {
  await conn.runAsync(
    `INSERT INTO track_layouts (id, track_id, name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    l.id,
    l.trackId,
    l.name ?? 'Layout principal',
    JSON.stringify(l.samples),
    l.durationMs,
    l.lengthM ?? 0,
    l.recordedAt,
    l.sourceSessionId ?? null,
    l.sourceLapId ?? null,
    l.isDefault === false ? 0 : 1
  );
}
