/**
 * `SessionRepo` do salvamento da sessão sobre um `SqlConn`, sem nada nativo:
 * no aparelho a conexão é o expo-sqlite (`sessionRepo.ts`), nos testes o sql.js.
 *
 * A volta é gravada como janela sobre o bruto da sessão (TF-11): as colunas
 * `window_kind`, `from_idx`/`to_idx` e `start_*`/`end_*` (o `t` no relógio da
 * série). Os frames não são copiados: as séries do diário já são da sessão (TF-07).
 * A sessão nova sai com `frames_version = 5`, e a migração v5b a pula.
 */
import type { LapRecord } from '../lib/analysis';
import type { RecordedSessionRow, SessionRepo, SessionRepoTx } from '../recording/finishSession';
import type { BoundaryCross, LapWindow } from '../telemetry/frame';
import { deleteOwner } from '../telemetry/telemetryStore';
import { sessionOwner } from './lapRepo';
import type { SqlConn, SqlTx, SqlValue } from './sqlConn';

/** Versão do formato das voltas que a sessão gravada aqui já tem (v5: janelas). */
export const FRAMES_VERSION = 5;

/**
 * `laps.samples_json` é NOT NULL até a v5c (T44) remover a coluna: a volta nova
 * leva um array vazio, e o bruto fica nas séries.
 */
const NO_SAMPLES_JSON = '[]';

function crossColumns(c: BoundaryCross | null): SqlValue[] {
  return c ? [c.t, c.lat, c.lng, c.speed, c.accuracy] : [null, null, null, null, null];
}

/** As colunas de janela (`window_kind` … `end_acc`), na ordem de `laps` e `track_layouts`. Sem janela, tudo nulo. */
export function windowColumns(w: LapWindow | undefined): SqlValue[] {
  if (!w) return [null, null, null, ...crossColumns(null), ...crossColumns(null)];
  if (w.kind === 'cross') return ['cross', null, null, ...crossColumns(w.start), ...crossColumns(w.end)];
  if (w.kind === 'index') return ['index', w.from, w.to, ...crossColumns(null), ...crossColumns(null)];
  return ['none', null, null, ...crossColumns(null), ...crossColumns(null)];
}

function sessionOps(conn: () => Promise<SqlTx>): SessionRepoTx {
  return {
    async sessionExists(id: string) {
      return (await (await conn()).getFirstAsync('SELECT id FROM sessions WHERE id = ?', id)) !== null;
    },
    async insertSession(row: RecordedSessionRow) {
      await (await conn()).runAsync(
        `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode, layout_id, kart_setup_id, recovered, frames_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.recovered ? 1 : 0,
        FRAMES_VERSION
      );
    },
    async insertLap(lap: LapRecord) {
      await insertLapOn(await conn(), lap);
    },
  };
}

/** A volta como janela, sem JSON de amostra, dentro da transação de quem chama (ou fora dela). */
export async function insertLapOn(
  tx: SqlTx,
  lap: Pick<LapRecord, 'id' | 'sessionId' | 'startedAt' | 'durationMs' | 'window'>
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json,
       window_kind, from_idx, to_idx,
       start_t, start_lat, start_lng, start_speed, start_acc,
       end_t, end_lat, end_lng, end_speed, end_acc)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lap.id,
    lap.sessionId,
    lap.startedAt,
    lap.durationMs,
    NO_SAMPLES_JSON,
    ...windowColumns(lap.window)
  );
}

export function sqlSessionRepo(conn: () => Promise<SqlConn>): SessionRepo {
  return {
    ...sessionOps(conn),
    async transaction(fn) {
      await (await conn()).withExclusiveTransactionAsync(async (tx) => {
        await fn(sessionOps(async () => tx));
      });
    },
  };
}

/**
 * Exclui a sessão com o bruto dela (TF-09): voltas, séries e blocos, e a própria
 * sessão, numa transação exclusiva. As foreign keys estão desligadas neste banco,
 * então nada sai em cascata: cada tabela é apagada aqui. PB, chat e conquistas
 * referenciam a sessão por texto e ficam, como antes.
 */
export async function deleteSessionOn(conn: SqlConn, sessionId: string): Promise<void> {
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM laps WHERE session_id = ?', sessionId);
    await deleteOwner(tx, sessionOwner(sessionId));
    await tx.runAsync('DELETE FROM sessions WHERE id = ?', sessionId);
  });
}
