/**
 * Invariante estática de `app/track-map.tsx`, lendo o fonte: TMP-07 (AC 1) e
 * AD-006. S1/S2/S3 do mapa detalhado saem da régua única (`sectorSplits`), e
 * não de uma interpolação própria sobre os terços. Desde a T37 (TF-13): a tela lê
 * `LapRecord.gps` e os frames do traçado por `layoutGps`, com o mesmo caminho de
 * limpeza (o mapa limpa e repara o traçado e a volta).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'track-map.tsx'), 'utf8');

test('mapa detalhado: importa sectorSplits e não tem mais o cálculo próprio de setores', () => {
  const m = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/src\/lib\/sectors'/);
  assert.ok(m, 'importa de ../src/lib/sectors');
  assert.ok(m[1].split(',').map((x) => x.trim()).includes('sectorSplits'));
  assert.ok(/sectorSplits\(\s*savedSamples,\s*sectorRef\s*\)/.test(SRC), 'os setores saem de sectorSplits');
  // A régua própria: `interpolateT` local e a duração por `tEnd − tStart`.
  assert.equal(/function\s+interpolateT\b/.test(SRC), false);
  assert.equal(SRC.includes('interpolateT('), false);
  assert.equal(/tEnd\s*-\s*tStart/.test(SRC), false);
});

test('mapa detalhado: os setores são medidos sobre os pontos salvos (sectorLapSamples), sem cleanSamples', () => {
  const m = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/src\/lib\/sectors'/);
  assert.ok(m, 'importa de ../src/lib/sectors');
  assert.ok(m[1].split(',').map((x) => x.trim()).includes('sectorLapSamples'));
  assert.ok(/const savedSamples\s*=\s*sectorLapSamples\(\s*lap\s*\)\s*;/.test(SRC), 'savedSamples = sectorLapSamples(lap)');
  assert.equal(/sectorLapSamples\([^;]*cleanSamples/.test(SRC), false, 'nenhum cleanSamples no argumento');
});

test('mapa detalhado: a velocidade mínima por curva sai de minSpeedPerCorner, sem o laço inline (TF-14, T2)', () => {
  const m = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/src\/lib\/cornerSpeed'/);
  assert.ok(m, 'importa de ../src/lib/cornerSpeed');
  assert.ok(m[1].split(',').map((x) => x.trim()).includes('minSpeedPerCorner'));
  assert.ok(/const cornerSpeeds\s*=\s*minSpeedPerCorner\(\s*corners,\s*matched\s*\)/.test(SRC));
  // O laço antigo: `let minMs = Infinity` e o `bestCornerKmh`.
  assert.equal(/let\s+minMs\s*=\s*Infinity/.test(SRC), false);
  assert.equal(/\bbestCornerKmh\b/.test(SRC), false);
});

test('mapa detalhado (T37): lê frames — nenhum GpsSample e nenhuma leitura de .samples da volta ou do traçado', () => {
  assert.equal(/\bGpsSample\b/.test(SRC), false);
  assert.equal(/\b(lap|layout)\.samples\b/.test(SRC), false);
  assert.ok(SRC.includes("import { layoutGps } from '../src/storage/layoutRepo';"));
});

test('mapa detalhado (T37): mantém o caminho de limpeza — cleanSamples + reparo no traçado e na volta', () => {
  // Substitui `cleanSamples(layout.samples, 10)` e `cleanSamples(lap.samples, 10)`.
  assert.ok(
    /const cleanedRef = cleanSamples\(layoutGps\(layout\), 10\);\s*const \{ samples: refSamples \} = repairDegenerateTimestamps\(cleanedRef, layout\.durationMs\);/.test(SRC),
  );
  assert.ok(
    /const cleanedLap = cleanSamples\(lap\.gps, 10\);\s*const \{ samples: lapSamples \} = repairDegenerateTimestamps\(\s*cleanedLap,\s*lap\.durationMs,\s*lap\.startedAt\s*\);/.test(SRC),
  );
  // Migrado na T46: a volta reparada não leva mais o alias `samples: lapSamples`.
  assert.ok(/matchLapToReference\(\s*\{ \.\.\.lap, gps: lapSamples \},\s*refLap\s*\)/.test(SRC));
  // A régua dos setores é a do traçado como foi salvo (substitui `referenceFromLayout(layout.samples)`).
  assert.ok(SRC.includes('const sectorRef = referenceFromLayout(layoutGps(layout));'));
});
