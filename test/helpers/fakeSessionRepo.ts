/**
 * SessionRepo em memória com transação de verdade: o que é escrito pelo `tx`
 * só aparece no estado depois do commit, e some se o callback lança.
 * Escritas feitas fora do `tx` vão direto para o estado.
 */
import type { LapRecord } from '../../src/lib/analysis';
import type {
  RecordedSessionRow,
  SessionRepo,
  SessionRepoTx,
} from '../../src/recording/finishSession';

export type FakeSessionRepo = SessionRepo & {
  sessions: RecordedSessionRow[];
  laps: LapRecord[];
  /** Falha ao inserir a volta de número N (1-based) dentro desta transação. */
  failOnLap: number | null;
};

export function fakeSessionRepo(): FakeSessionRepo {
  const repo: FakeSessionRepo = {
    sessions: [],
    laps: [],
    failOnLap: null,
    sessionExists: async (id) => repo.sessions.some((s) => s.id === id),
    insertSession: async (row) => {
      repo.sessions.push(row);
    },
    insertLap: async (lap) => {
      repo.laps.push(lap);
    },
    transaction: async (fn) => {
      const staged = { sessions: [...repo.sessions], laps: [...repo.laps] };
      let lapCount = 0;
      const tx: SessionRepoTx = {
        sessionExists: async (id) => staged.sessions.some((s) => s.id === id),
        insertSession: async (row) => {
          if (staged.sessions.some((s) => s.id === row.id)) {
            throw new Error(`UNIQUE constraint failed: sessions.id (${row.id})`);
          }
          staged.sessions.push(row);
        },
        insertLap: async (lap) => {
          lapCount++;
          if (repo.failOnLap === lapCount) throw new Error(`disk I/O error na volta ${lapCount}`);
          staged.laps.push(lap);
        },
      };
      await fn(tx); // se lança, `staged` é descartado: rollback
      repo.sessions = staged.sessions;
      repo.laps = staged.laps;
    },
  };
  return repo;
}
