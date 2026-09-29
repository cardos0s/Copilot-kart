/**
 * Invariante estática de `app/track-map.tsx`, lendo o fonte: TMP-07 (AC 1) e
 * AD-006. S1/S2/S3 do mapa detalhado saem da régua única (`sectorSplits`), e
 * não de uma interpolação própria sobre os terços.
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
