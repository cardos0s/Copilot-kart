/**
 * Invariantes estáticas de `app/_layout.tsx`, lendo o fonte:
 * REC-07 AC 1 (sem gesto de voltar do iOS nas duas telas de gravação) e
 * REC-09 (a tarefa de localização é definida na abertura do app, mesmo quando
 * o sistema o relança em segundo plano).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');

function screenOptions(name: string): string {
  const m = SRC.match(new RegExp(`<Stack\\.Screen\\s+name="${name}"\\s+options=\\{\\{([^}]*)\\}\\}`));
  assert.ok(m, `Stack.Screen "${name}" com options`);
  return m[1];
}

test('_layout.tsx: recording e recording-reference têm gestureEnabled: false', () => {
  assert.match(screenOptions('recording'), /gestureEnabled:\s*false/);
  assert.match(screenOptions('recording-reference'), /gestureEnabled:\s*false/);
});

test('_layout.tsx: importa a tarefa de localização', () => {
  assert.match(SRC, /import\s+'\.\.\/src\/recording\/locationTask';/);
});
