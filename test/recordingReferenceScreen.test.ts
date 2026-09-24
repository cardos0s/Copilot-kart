/**
 * Invariantes estáticas de `app/recording-reference.tsx`, lendo o fonte:
 * REC-08 AC 1 (nenhum alerta nativo na tela presa em paisagem) e REC-11 AC 1
 * (a cronometragem logo depois do reconhecimento usa o traçado recém-gravado).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'recording-reference.tsx'), 'utf8');

test('recording-reference.tsx: não chama Alert.alert nem importa Alert', () => {
  assert.equal(SRC.includes('Alert.alert'), false);
  const rnImport = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/);
  assert.ok(rnImport, 'a tela importa de react-native');
  assert.equal(/\bAlert\b/.test(rnImport[1]), false);
});

test('recording-reference.tsx: o router.replace para /recording inclui layoutId', () => {
  const calls = [...SRC.matchAll(/router\.replace\(\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  const toRecording = calls.filter((c) => /pathname:\s*'\/recording'/.test(c));
  assert.equal(toRecording.length, 1, 'uma transição para /recording');
  assert.match(toRecording[0], /params:\s*\{[^}]*\blayoutId\b/);
});

test('recording-reference.tsx: mostra "Salvamento automático falhou" sob info.autosaveFailed', () => {
  const cond = /\{info\.autosaveFailed && \(([\s\S]*?)\)\}/.exec(SRC);
  assert.ok(cond, 'há um bloco renderizado sob {info.autosaveFailed && (...)}');
  assert.ok(cond[1].includes('>Salvamento automático falhou<'));
});
