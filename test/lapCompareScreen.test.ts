/**
 * Invariante estática de `app/lap-compare.tsx`, lendo o fonte: TMP-07 (AC 3) e
 * AD-006. Os S1/S2/S3 da comparação saem dos pontos salvos das duas voltas,
 * como na sessão, e não dos pontos limpos por `cleanSamples`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'lap-compare.tsx'), 'utf8');

test('comparação: passa as voltas salvas, sem cleanSamples, para os setores', () => {
  assert.ok(
    /compareLaps\(\s*lapARec,\s*lapBRec,\s*refLap,\s*corners,\s*\{\s*a:\s*savedA,\s*b:\s*savedB\s*\}\s*\)/.test(SRC),
    'compareLaps recebe as voltas salvas',
  );
  // As voltas salvas são as do banco, como vieram.
  assert.ok(/const savedA = lapsA\.find\(\(l\) => l\.id === lapA\)/.test(SRC));
  assert.ok(/const savedB = lapsB\.find\(\(l\) => l\.id === lapB\)/.test(SRC));
  // O cleanSamples só prepara o traço do delta.
  assert.equal(/cleanSamples\(\s*saved[AB]\b/.test(SRC), false);
});
