/**
 * Repositórios do salvamento da sessão sobre o expo-sqlite: o `SessionRepo`
 * de `finishSession.ts` (sessão e voltas numa transação exclusiva, em
 * `sqlSessionRepo.ts`) e o `LayoutRepo` do layout de referência.
 *
 * Dentro de `withExclusiveTransactionAsync`, toda query usa o `txn`: uma query
 * na conexão principal ficaria fora da transação.
 */
import { once } from '../lib/once';
import type { LayoutRepo, SessionRepo } from '../recording/finishSession';
import { db, listLayoutsForTrack, saveLayout } from './db';
import { expoSqlConn } from './sqlConn';
import { sqlSessionRepo } from './sqlSessionRepo';

const conn = once(async () => expoSqlConn(await db()));

export const sqliteSessionRepo: SessionRepo = sqlSessionRepo(conn);

export const sqliteLayoutRepo: LayoutRepo = { listLayoutsForTrack, saveLayout };
