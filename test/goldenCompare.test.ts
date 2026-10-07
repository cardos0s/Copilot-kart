/**
 * Comparador do golden (TF-14, T5), pela regra "Mesmos números" da spec:
 * inteiros e textos iguais; tempo (`t`, `*Ms`, `*_ms`, `*At`, `tMs`) até 0,001; os
 * demais reais até 1e-9. A falha traz o caminho da primeira diferença.
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

test('goldenCompare: real que não é tempo aceita até 1e-9', () => {
  const two = goldenCompare({ speed: 1 }, { speed: 1 + 2e-9 });
  assert.ok(two);
  assert.equal(two.path, 'speed');
  assert.equal(goldenCompare({ speed: 1 }, { speed: 1 + 5e-10 }), null);
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
