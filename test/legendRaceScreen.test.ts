/**
 * Invariante estática de `app/legend-race.tsx`, lendo o fonte: REC-08 AC 1
 * (a tela presa em paisagem mostra o erro num diálogo próprio, sem alerta
 * nativo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'legend-race.tsx'), 'utf8');

test('legend-race.tsx: não chama Alert.alert nem importa Alert; o erro do GPS vai ao CockpitDialog', () => {
  assert.equal(SRC.includes('Alert.alert'), false);
  const rnImport = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/);
  assert.ok(rnImport, 'a tela importa de react-native');
  assert.equal(/\bAlert\b/.test(rnImport[1]), false);
  assert.ok(SRC.includes('<CockpitDialog'));
  assert.ok(SRC.includes("'Falha ao iniciar GPS'"));
});
