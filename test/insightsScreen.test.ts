/**
 * Invariantes estáticas de `app/(tabs)/insights.tsx`, lendo o fonte:
 * TMP-13 (o "Sua volta" usa só voltas do mesmo traçado da sessão âncora).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'insights.tsx'), 'utf8');

test('insights: monta o conjunto com lapsForInsight, sem o filtro só por trackId', () => {
  const m = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/src\/lib\/lapInsight'/);
  assert.ok(m && m[1].split(',').map((s) => s.trim()).includes('lapsForInsight'));
  assert.ok(/lapsForInsight\(sessions,\s*anchor\)/.test(SRC));
  assert.equal(/x\.trackId\s*===\s*anchor\.trackId/.test(SRC), false);
  assert.equal(/x\.trackName\s*===\s*anchor\.trackName/.test(SRC), false);
});
