/**
 * Comparador do golden (TF-14, T5), pela regra "Mesmos números" da spec:
 * inteiros e textos iguais; tempo (`t`, `*Ms`, `*_ms`, `*At`, `tMs`) até 0,001; os
 * demais reais até max(1e-9, 1e-5 × |esperado|) (parte relativa aprovada em 08/10).
 * A falha traz o caminho da primeira diferença.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { goldenCompare } from './helpers/goldenCompare';

test('goldenCompare: tempo de volta aceita até 0,001 ms e falha acima, no caminho lapMs', () => {
  assert.equal(goldenCompare({ lapMs: 1000 }, { lapMs: 1000.0009 }), null);
  const diff = goldenCompare({ lapMs: 1000 }, { lapMs: 1000.0011 });
  assert.ok(diff);
  assert.equal(diff.path, 'lapMs');
});

test('goldenCompare: as chaves t, tMs e *At também são tempo', () => {
  assert.equal(goldenCompare({ t: 1_790_000_000_000.25 }, { t: 1_790_000_000_000.2509 }), null);
  assert.equal(goldenCompare({ p: { tMs: 5 } }, { p: { tMs: 5.0008 } }), null);
  assert.equal(goldenCompare({ startedAt: 10 }, { startedAt: 10.001 }), null);
  assert.equal(goldenCompare({ startedAt: 10 }, { startedAt: 10.0012 })?.path, 'startedAt');
  // Elemento de array herda a chave do array.
  assert.equal(goldenCompare({ lapsMs: [1, 2] }, { lapsMs: [1, 2.0005] }), null);
  assert.equal(goldenCompare({ lapsMs: [1, 2] }, { lapsMs: [1, 2.002] })?.path, 'lapsMs[1]');
});

test('goldenCompare: coluna snake_case terminada em _ms (live_samples) também é tempo', () => {
  assert.equal(goldenCompare({ lap_elapsed_ms: 1000 }, { lap_elapsed_ms: 1000.0009 }), null);
  const diff = goldenCompare({ row: { lap_elapsed_ms: 1000 } }, { row: { lap_elapsed_ms: 1000.0011 } });
  assert.ok(diff);
  assert.equal(diff.path, 'row.lap_elapsed_ms');
});

// Substitui a asserção do piso fixo de 1e-9 (`{speed: 1}` contra `1 + 2e-9` falhava): pela regra
// aprovada em 08/10, o piso de 1e-9 vale perto de zero e, longe dele, vale 1e-5 relativo.
test('goldenCompare: real que não é tempo aceita até max(1e-9, 1e-5 × |esperado|)', () => {
  // A desaceleração da frenagem B da T27: 8,6e-7 relativo passa.
  assert.equal(goldenCompare({ speed: 99.43913820676195 }, { speed: 99.43922374313716 }), null);
  // 1,1e-5 relativo falha, com o caminho.
  const rel = goldenCompare({ s: { speed: 100 } }, { s: { speed: 100.0011 } });
  assert.ok(rel);
  assert.equal(rel.path, 's.speed');
  // Com o esperado em zero, vale o piso absoluto de 1e-9.
  assert.equal(goldenCompare({ speed: 0 }, { speed: 5e-10 }), null);
  assert.equal(goldenCompare({ speed: 0 }, { speed: 2e-9 })?.path, 'speed');
  // Uma chave que só contém "t" no meio (`total`) não é tempo.
  assert.equal(goldenCompare({ total: 3 }, { total: 3.0005 })?.path, 'total');
});

test('goldenCompare: inteiro, texto e tamanho de array diferentes falham, cada um com o caminho', () => {
  assert.equal(goldenCompare({ laps: [{ count: 6 }] }, { laps: [{ count: 7 }] })?.path, 'laps[0].count');
  assert.equal(goldenCompare({ s: { source: 'imu' } }, { s: { source: 'gps' } })?.path, 's.source');
  assert.equal(goldenCompare({ spins: [1, 2] }, { spins: [1, 2, 3] })?.path, 'spins');
  // E a diferença de tipo, de null e de chave ausente também.
  assert.equal(goldenCompare({ v: null }, { v: 0 })?.path, 'v');
  assert.equal(goldenCompare({ a: 1, b: 2 }, { a: 1 })?.path, 'b');
  assert.equal(goldenCompare({ a: 1 }, { a: 1, extra: 0 })?.path, 'extra');
});

test('goldenCompare: a primeira diferença é a que volta, e iguais dão null', () => {
  const exp = { laps: [{ durationMs: 35_000, peak: 19.1 }, { durationMs: 35_500, peak: 18.7 }] };
  assert.equal(goldenCompare(exp, structuredClone(exp)), null);
  const act = { laps: [{ durationMs: 35_000, peak: 19.2 }, { durationMs: 36_000, peak: 18.7 }] };
  assert.equal(goldenCompare(exp, act)?.path, 'laps[0].peak');
});
