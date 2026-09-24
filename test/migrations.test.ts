/**
 * Migração v4: REC-01 (tabelas do diário) e REC-12 AC 3 (vazio vira null).
 * A v4 roda inteira dentro de uma transação exclusiva.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrateV4, type MigrationExecutor } from '../src/storage/migrations';

type Fake = MigrationExecutor & {
  inTx: string[];
  /** Instruções que chegaram depois de o callback da transação terminar. */
  outsideTx: string[];
  txOpened: number;
};

function fakeExecutor(userVersion: number, failOn?: RegExp): Fake {
  const f: Fake = {
    inTx: [],
    outsideTx: [],
    txOpened: 0,
    getUserVersion: async () => userVersion,
    transaction: async (fn) => {
      f.txOpened++;
      let open = true;
      // Uma falha dentro do callback sobe; o SQLite real faz o rollback.
      try {
        await fn({
          exec: async (sql) => {
            if (!open) {
              f.outsideTx.push(sql.trim());
              return;
            }
            if (failOn && failOn.test(sql)) throw new Error(`falhou: ${sql}`);
            f.inTx.push(sql.trim());
          },
        });
      } finally {
        open = false;
      }
    },
  };
  return f;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

test('migrateV4 com user_version = 3: tudo roda dentro da transação e a última instrução é user_version = 4', async () => {
  const f = fakeExecutor(3);
  await migrateV4(f);

  assert.equal(f.txOpened, 1);
  assert.deepEqual(f.outsideTx, []);
  assert.ok(f.inTx.length > 1);
  assert.equal(norm(f.inTx[f.inTx.length - 1]), 'PRAGMA user_version = 4');

  const all = f.inTx.map(norm).join('\n');
  assert.match(all, /CREATE TABLE IF NOT EXISTS recording_active \(/);
  assert.match(all, /CREATE TABLE IF NOT EXISTS recording_chunks \(/);
  assert.match(all, /PRIMARY KEY \(recording_id, seq\)/);
  assert.match(all, /ALTER TABLE sessions ADD COLUMN recovered INTEGER NOT NULL DEFAULT 0/);
});

test('migrateV4 com user_version = 4: nenhuma instrução roda', async () => {
  const f = fakeExecutor(4);
  await migrateV4(f);
  assert.equal(f.txOpened, 0);
  assert.deepEqual(f.inTx, []);
});

test("migrateV4: os três UPDATE que trocam '' por NULL estão presentes", async () => {
  const f = fakeExecutor(3);
  await migrateV4(f);
  const stmts = f.inTx.map(norm);
  assert.ok(stmts.includes("UPDATE sessions SET layout_id = NULL WHERE layout_id = ''"));
  assert.ok(stmts.includes("UPDATE sessions SET kart_setup_id = NULL WHERE kart_setup_id = ''"));
  assert.ok(stmts.includes("UPDATE pb_records SET layout_id = NULL WHERE layout_id = ''"));
});

test('migrateV4: se uma instrução falha, o erro sobe e user_version = 4 não roda', async () => {
  const f = fakeExecutor(3, /ALTER TABLE sessions ADD COLUMN recovered/);
  await assert.rejects(migrateV4(f), /falhou: ALTER TABLE sessions ADD COLUMN recovered/);
  assert.equal(f.txOpened, 1);
  assert.ok(!f.inTx.map(norm).includes('PRAGMA user_version = 4'));
});
