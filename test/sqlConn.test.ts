/**
 * Infraestrutura de SQL real nos testes (TF-17 a TF-20): o `SqlConn` sobre o sql.js
 * guarda BLOB como `Uint8Array` e desfaz a transação que falha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openSqlJsConn } from './helpers/sqlJsConn';

test('sql.js: um BLOB Uint8Array gravado volta igual', async () => {
  const conn = await openSqlJsConn();
  await conn.execAsync('CREATE TABLE b (id TEXT PRIMARY KEY, payload BLOB NOT NULL)');
  const payload = new Uint8Array(256 + 8);
  for (let i = 0; i < 256; i++) payload[i] = i;
  new DataView(payload.buffer).setFloat64(256, NaN, true);
  await conn.runAsync('INSERT INTO b (id, payload) VALUES (?, ?)', 'x', payload);

  const row = await conn.getFirstAsync<{ payload: Uint8Array }>('SELECT payload FROM b WHERE id = ?', 'x');
  assert.ok(row?.payload instanceof Uint8Array);
  assert.deepEqual(row.payload, payload);
  conn.close();
});

test('sql.js: um erro dentro de withExclusiveTransactionAsync desfaz o que foi escrito nela', async () => {
  const conn = await openSqlJsConn();
  await conn.execAsync('CREATE TABLE r (id TEXT PRIMARY KEY)');
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO r (id) VALUES (?)', 'ok');
  });

  await assert.rejects(
    conn.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO r (id) VALUES (?)', 'a');
      await tx.runAsync('INSERT INTO r (id) VALUES (?)', 'b');
      throw new Error('falha no meio');
    }),
    /falha no meio/
  );

  const ids = (await conn.getAllAsync<{ id: string }>('SELECT id FROM r ORDER BY id')).map((r) => r.id);
  assert.deepEqual(ids, ['ok']);
  conn.close();
});

test('sql.js é devDependency e não aparece em dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.devDependencies['sql.js'], 'sql.js em devDependencies');
  assert.equal(pkg.dependencies['sql.js'], undefined);
});
