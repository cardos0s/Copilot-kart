/**
 * Invariantes estáticas de `src/hooks/useLapRecorder.ts`, lendo o fonte:
 * TMP-06 (a mesma linha no ao vivo, no diário e no "Encerrar") e TMP-07/08
 * (S1/S2/S3 ao vivo e publicados pela régua única, sem marcar limite pelo poll).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useLapRecorder.ts'), 'utf8');

function importsFrom(module: string): string[] {
  const m = SRC.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${module.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '')) : [];
}

test('useLapRecorder: importa sectorSplits e lineFromLayout, e não tem mais sectorBoundaryTsRef', () => {
  assert.ok(importsFrom('../lib/sectors').includes('sectorSplits'));
  assert.ok(importsFrom('../lib/startLine').includes('lineFromLayout'));
  assert.equal(SRC.includes('sectorBoundaryTsRef'), false);
});

test('useLapRecorder: o poll e o stop() usam a linha da gravação', () => {
  assert.equal(/detectLaps\(all\)/.test(SRC), false, 'o poll não pode detectar sem a linha');
  assert.ok(/detectLaps\(all,\s*\{\s*line\b/.test(SRC), 'o poll chama detectLaps(all, { line })');
  assert.ok(/sliceLaps\(allSamples,\s*allImuSamples,\s*line\)/.test(SRC), 'o stop() chama sliceLaps(…, line)');
});

test('useLapRecorder: a meta do diário leva a linha', () => {
  assert.ok(/journal\.begin\(\{\s*\.\.\.startOpts\.meta,\s*line\b/.test(SRC));
});
