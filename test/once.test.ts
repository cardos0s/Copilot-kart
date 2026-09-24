/**
 * REC-06: o schema e as migrações terminam antes de qualquer leitura ou escrita,
 * inclusive com chamadas simultâneas na abertura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { once } from '../src/lib/once';

test('once: duas chamadas simultâneas rodam o init uma vez e recebem o mesmo resultado', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const conn = { ready: false };
  const get = once(async () => {
    calls++;
    await gate; // simula schema + migrações demorando
    conn.ready = true;
    return conn;
  });

  const a = get();
  const b = get();
  release();
  const [ra, rb] = await Promise.all([a, b]);

  assert.equal(calls, 1);
  assert.equal(ra, conn);
  assert.equal(rb, conn);
  // Nenhuma das duas recebe o banco antes do init terminar.
  assert.equal(ra.ready, true);
  assert.equal(rb.ready, true);
});

test('once: se o init rejeita, a chamada seguinte tenta de novo', async () => {
  let calls = 0;
  const get = once(async () => {
    calls++;
    if (calls === 1) throw new Error('falhou a migração');
    return 'ok';
  });

  await assert.rejects(get(), /falhou a migração/);
  assert.equal(await get(), 'ok');
  assert.equal(calls, 2);
});
