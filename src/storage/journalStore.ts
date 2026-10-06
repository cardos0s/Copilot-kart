/**
 * `JournalStore` do diário de gravação sobre as tabelas da v4
 * (`recording_active` e `recording_chunks`).
 *
 * A escrita do diário concorre com a transação exclusiva do "Encerrar". O
 * `busy_timeout` de 2 s faz a escrita esperar o lock em vez de falhar na hora;
 * se ainda assim falhar, o diário guarda o pendente e tenta de novo.
 */
import type { ImuSample } from '../lib/geometry';
import type { GpsFrame } from '../telemetry/frame';
import { once } from '../lib/once';
import type {
  ActiveRecording,
  JournalChunk,
  JournalStore,
  RecordingMeta,
} from '../recording/journal';
import { db } from './db';

const conn = once(async () => {
  const d = await db();
  await d.execAsync('PRAGMA busy_timeout = 2000');
  return d;
});

export const sqliteJournalStore: JournalStore = {
  async createActive(meta: RecordingMeta) {
    await (await conn()).runAsync(
      'INSERT INTO recording_active (id, meta_json, started_at) VALUES (?, ?, ?)',
      meta.recordingId,
      JSON.stringify(meta),
      meta.startedAt
    );
  },

  async appendChunk(id: string, seq: number, gps: GpsFrame[], imu: ImuSample[]) {
    await (await conn()).runAsync(
      'INSERT INTO recording_chunks (recording_id, seq, gps_json, imu_json) VALUES (?, ?, ?, ?)',
      id,
      seq,
      JSON.stringify(gps),
      JSON.stringify(imu)
    );
  },

  async readActive(): Promise<ActiveRecording | null> {
    const row = await (await conn()).getFirstAsync<{
      id: string;
      meta_json: string;
      started_at: number;
    }>('SELECT id, meta_json, started_at FROM recording_active ORDER BY started_at ASC LIMIT 1');
    return row ? { id: row.id, metaJson: row.meta_json, startedAt: row.started_at } : null;
  },

  async readChunks(id: string): Promise<JournalChunk[]> {
    const rows = await (await conn()).getAllAsync<{
      seq: number;
      gps_json: string;
      imu_json: string;
    }>(
      'SELECT seq, gps_json, imu_json FROM recording_chunks WHERE recording_id = ? ORDER BY seq ASC',
      id
    );
    return rows.map((r) => ({ seq: r.seq, gpsJson: r.gps_json, imuJson: r.imu_json }));
  },

  async deleteRecording(id: string) {
    const d = await conn();
    await d.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM recording_chunks WHERE recording_id = ?', id);
      await txn.runAsync('DELETE FROM recording_active WHERE id = ?', id);
    });
  },
};
