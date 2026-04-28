import * as SQLite from 'expo-sqlite';
import { GpsSample } from '../lib/geometry';
import { LapRecord } from '../lib/analysis';

let dbInstance: SQLite.SQLiteDatabase | null = null;

async function db() {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('kartlap.db');
    await dbInstance.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        track_name TEXT NOT NULL,
        kart TEXT,
        notes TEXT,
        started_at INTEGER NOT NULL,
        weather TEXT,
        track_id TEXT,
        mode TEXT
      );
      CREATE TABLE IF NOT EXISTS laps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        samples_json TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);

      CREATE TABLE IF NOT EXISTS track_references (
        track_id TEXT PRIMARY KEY,
        track_name TEXT NOT NULL,
        samples_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        length_m REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        source_session_id TEXT,
        source_lap_id TEXT
      );
    `);
  }
  return dbInstance;
}

// =========================
// Sessions
// =========================

export type SessionMode = 'reference' | 'race';

export type Session = {
  id: string;
  trackName: string;
  kart: string | null;
  notes: string | null;
  startedAt: number;
  weather: string | null;
  trackId: string | null;
  mode: SessionMode | null;
};

export async function createSession(
  data: Omit<Session, 'id' | 'startedAt'>
): Promise<Session> {
  const d = await db();
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  await d.runAsync(
    `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.trackName,
    data.kart,
    data.notes,
    startedAt,
    data.weather,
    data.trackId,
    data.mode
  );
  return { id, startedAt, ...data };
}

export async function listSessions(): Promise<Session[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT id,
            track_name as trackName,
            kart,
            notes,
            started_at as startedAt,
            weather,
            track_id as trackId,
            mode
     FROM sessions
     ORDER BY started_at DESC`
  );
  return rows;
}

export async function getSession(id: string): Promise<Session | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    `SELECT id,
            track_name as trackName,
            kart,
            notes,
            started_at as startedAt,
            weather,
            track_id as trackId,
            mode
     FROM sessions
     WHERE id = ?`,
    id
  );
  return row ?? null;
}

export async function deleteSession(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
}

// =========================
// Laps
// =========================

export async function saveLap(lap: LapRecord): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json)
     VALUES (?, ?, ?, ?, ?)`,
    lap.id,
    lap.sessionId,
    lap.startedAt,
    lap.durationMs,
    JSON.stringify(lap.samples)
  );
}

export async function getLapsForSession(sessionId: string): Promise<LapRecord[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT id,
            session_id as sessionId,
            started_at as startedAt,
            duration_ms as durationMs,
            samples_json
     FROM laps
     WHERE session_id = ?
     ORDER BY started_at ASC`,
    sessionId
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    samples: JSON.parse(r.samples_json) as GpsSample[],
  }));
}

// =========================
// Track references
// =========================

export type TrackReference = {
  trackId: string;
  trackName: string;
  samples: GpsSample[];
  durationMs: number;
  lengthM: number;
  recordedAt: number;
  sourceSessionId?: string;
  sourceLapId?: string;
};

export async function getTrackReference(
  trackId: string
): Promise<TrackReference | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    'SELECT * FROM track_references WHERE track_id = ?',
    trackId
  );
  if (!row) return null;
  return {
    trackId: row.track_id,
    trackName: row.track_name,
    samples: JSON.parse(row.samples_json),
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
  };
}

export async function saveTrackReference(ref: TrackReference): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO track_references
     (track_id, track_name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ref.trackId,
    ref.trackName,
    JSON.stringify(ref.samples),
    ref.durationMs,
    ref.lengthM,
    ref.recordedAt,
    ref.sourceSessionId ?? null,
    ref.sourceLapId ?? null
  );
}

export async function deleteTrackReference(trackId: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM track_references WHERE track_id = ?', trackId);
}

export async function listTrackReferences(): Promise<TrackReference[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM track_references ORDER BY recorded_at DESC'
  );
  return rows.map((row) => ({
    trackId: row.track_id,
    trackName: row.track_name,
    samples: JSON.parse(row.samples_json),
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
  }));
}