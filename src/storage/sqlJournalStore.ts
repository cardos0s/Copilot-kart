/**
 * `JournalStore` do diário de gravação sobre um `SqlConn`: o registro ativo em
 * `recording_active` e os frames nas séries da sessão (`telemetryStore`). Sem
 * nada nativo: no aparelho a conexão é o expo-sqlite (`journalStore.ts`), nos
 * testes é o sql.js.
 */
import type { ActiveRecording, JournalStore, RecordingMeta } from '../recording/journal';
import { recordingOwner } from '../recording/journal';
import type { SeriesMeta } from '../telemetry/frame';
import { appendBlocks, createSeries, deleteOwner, readSeries } from '../telemetry/telemetryStore';
import type { SqlConn } from './sqlConn';

export function sqlJournalStore(conn: () => Promise<SqlConn>): JournalStore {
  return {
    async createActive(meta: RecordingMeta, series: SeriesMeta[]) {
      await (await conn()).withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          'INSERT INTO recording_active (id, meta_json, started_at) VALUES (?, ?, ?)',
          meta.recordingId,
          JSON.stringify(meta),
          meta.startedAt
        );
        for (const s of series) await createSeries(tx, s);
      });
    },

    async appendBlocks(blocks) {
      await appendBlocks(await conn(), blocks);
    },

    async readActive(): Promise<ActiveRecording | null> {
      const row = await (await conn()).getFirstAsync<{ id: string; meta_json: string; started_at: number }>(
        'SELECT id, meta_json, started_at FROM recording_active ORDER BY started_at ASC LIMIT 1'
      );
      return row ? { id: row.id, metaJson: row.meta_json, startedAt: row.started_at } : null;
    },

    async readSeries(recordingId: string) {
      return readSeries(await conn(), recordingOwner(recordingId));
    },

    async deleteActive(recordingId: string) {
      await (await conn()).runAsync('DELETE FROM recording_active WHERE id = ?', recordingId);
    },

    async discardRecording(recordingId: string) {
      await (await conn()).withExclusiveTransactionAsync(async (tx) => {
        await deleteOwner(tx, recordingOwner(recordingId));
        await tx.runAsync('DELETE FROM recording_active WHERE id = ?', recordingId);
      });
    },
  };
}
