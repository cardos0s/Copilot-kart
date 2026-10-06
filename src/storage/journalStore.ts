/**
 * `JournalStore` do diário de gravação sobre o SQLite do app: o registro ativo
 * em `recording_active` e os frames nas séries da sessão (v5a).
 *
 * A escrita do diário concorre com a transação exclusiva do "Encerrar". O
 * `busy_timeout` de 2 s faz a escrita esperar o lock em vez de falhar na hora;
 * se ainda assim falhar, o diário guarda o pendente e tenta de novo.
 */
import { once } from '../lib/once';
import type { JournalStore } from '../recording/journal';
import { db } from './db';
import { expoSqlConn } from './sqlConn';
import { sqlJournalStore } from './sqlJournalStore';

const conn = once(async () => {
  const d = await db();
  await d.execAsync('PRAGMA busy_timeout = 2000');
  return expoSqlConn(d);
});

export const sqliteJournalStore: JournalStore = sqlJournalStore(conn);
