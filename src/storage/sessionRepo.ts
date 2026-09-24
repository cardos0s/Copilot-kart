/**
 * Repositórios do salvamento da sessão sobre o expo-sqlite: o `SessionRepo`
 * de `finishSession.ts` (sessão e voltas numa transação exclusiva) e o
 * `LayoutRepo` do layout de referência.
 *
 * Dentro de `withExclusiveTransactionAsync`, toda query usa o `txn`: uma query
 * na conexão principal ficaria fora da transação.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { LapRecord } from '../lib/analysis';
import type {
  LayoutRepo,
  RecordedSessionRow,
  SessionRepo,
  SessionRepoTx,
} from '../recording/finishSession';
import { db, listLayoutsForTrack, saveLayout } from './db';

function sessionOps(conn: () => Promise<SQLiteDatabase>): SessionRepoTx {
  return {
    async sessionExists(id: string) {
      const row = await (await conn()).getFirstAsync<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ?',
        id
      );
      return row != null;
    },
    async insertSession(row: RecordedSessionRow) {
      await (await conn()).runAsync(
        `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode, layout_id, kart_setup_id, recovered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.trackName,
        row.kart,
        row.notes,
        row.startedAt,
        row.weather,
        row.trackId,
        row.mode,
        row.layoutId,
        row.kartSetupId,
        row.recovered ? 1 : 0
      );
    },
    async insertLap(lap: LapRecord) {
      // Mesma gravação do `saveLap` de db.ts: IMU vazia vira NULL.
      const imuJson =
        lap.imuSamples && lap.imuSamples.length > 0 ? JSON.stringify(lap.imuSamples) : null;
      await (await conn()).runAsync(
        `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        lap.id,
        lap.sessionId,
        lap.startedAt,
        lap.durationMs,
        JSON.stringify(lap.samples),
        imuJson
      );
    },
  };
}

export const sqliteSessionRepo: SessionRepo = {
  ...sessionOps(db),
  async transaction(fn) {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (txn) => {
      await fn(sessionOps(async () => txn));
    });
  },
};

export const sqliteLayoutRepo: LayoutRepo = { listLayoutsForTrack, saveLayout };
