/**
 * JournalStore em memória, guardando o JSON como o SQLite guardaria.
 */
import type { GpsSample, ImuSample } from '../../src/lib/geometry';
import type {
  ActiveRecording,
  JournalChunk,
  JournalStore,
  RecordingMeta,
} from '../../src/recording/journal';

export type FakeJournalStore = JournalStore & {
  active: ActiveRecording | null;
  chunks: Map<string, JournalChunk[]>;
  /** Quantas das próximas escritas de pedaço devem falhar. */
  failAppends: number;
};

export function fakeJournalStore(): FakeJournalStore {
  const s: FakeJournalStore = {
    active: null,
    chunks: new Map(),
    failAppends: 0,
    createActive: async (meta: RecordingMeta) => {
      s.active = { id: meta.recordingId, metaJson: JSON.stringify(meta), startedAt: meta.startedAt };
    },
    appendChunk: async (id: string, seq: number, gps: GpsSample[], imu: ImuSample[]) => {
      if (s.failAppends > 0) {
        s.failAppends--;
        throw new Error('database or disk is full');
      }
      const list = s.chunks.get(id) ?? [];
      if (list.some((c) => c.seq === seq)) throw new Error(`UNIQUE constraint failed: seq ${seq}`);
      list.push({ seq, gpsJson: JSON.stringify(gps), imuJson: JSON.stringify(imu) });
      s.chunks.set(id, list);
    },
    readActive: async () => s.active,
    readChunks: async (id: string) => [...(s.chunks.get(id) ?? [])].sort((a, b) => a.seq - b.seq),
    deleteRecording: async (id: string) => {
      if (s.active?.id === id) s.active = null;
      s.chunks.delete(id);
    },
  };
  return s;
}

/** Todos os pontos de GPS já gravados de uma gravação, na ordem dos pedaços. */
export function persistedGps(store: FakeJournalStore, id: string): GpsSample[] {
  return [...(store.chunks.get(id) ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((c) => JSON.parse(c.gpsJson) as GpsSample[]);
}
