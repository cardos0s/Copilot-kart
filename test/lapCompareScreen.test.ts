/**
 * Invariante estática de `app/lap-compare.tsx`, lendo o fonte: TMP-07 (AC 3) e
 * AD-006. Os S1/S2/S3 da comparação saem dos pontos salvos das duas voltas,
 * como na sessão, e não dos pontos limpos por `cleanSamples`. Desde a T37 (TF-13):
 * a tela lê `LapRecord.gps` e os frames do traçado por `layoutGps`, com o mesmo
 * caminho de limpeza (o traço limpa e repara; o traçado só é reparado).
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

test('comparação (T37): lê frames — nenhum GpsSample e nenhuma leitura de .samples da volta ou do traçado', () => {
  assert.equal(/\bGpsSample\b/.test(SRC), false);
  assert.equal(/\b(raw|saved[AB]|lap[AB]Rec|layout)\.samples\b/.test(SRC), false);
  assert.ok(SRC.includes("import { layoutGps } from '../src/storage/layoutRepo';"));
});

test('comparação (T37): o traço limpa e repara a volta; o traçado só é reparado, sem cleanSamples', () => {
  // Substitui `cleanSamples(raw.samples, 10)`.
  assert.ok(
    /const cleaned = cleanSamples\(raw\.gps, 10\);\s*const \{ samples \} = repairDegenerateTimestamps\(cleaned, raw\.durationMs, raw\.startedAt\);\s*return \{ \.\.\.raw, gps: samples \};/.test(SRC), // T46: sem o alias `samples`
  );
  assert.ok(/const lapARec = forTrace\(savedA\);/.test(SRC));
  assert.ok(/const lapBRec = forTrace\(savedB\);/.test(SRC));
  // Substitui `repairDegenerateTimestamps(layout.samples, layout.durationMs)`.
  assert.ok(/repairDegenerateTimestamps\(\s*layoutGps\(layout\),\s*layout\.durationMs\s*\)/.test(SRC));
  assert.equal(/cleanSamples\(\s*layoutGps\(/.test(SRC), false, 'o traçado não passa por cleanSamples');
  assert.equal(SRC.match(/cleanSamples\(/g)?.length, 1, 'um único cleanSamples, o do traço');
});
