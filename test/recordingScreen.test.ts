/**
 * Invariantes estáticas de `app/recording.tsx`, lendo o fonte:
 * REC-08 AC 1 (nenhum alerta nativo na tela presa em paisagem) e REC-07 AC 2
 * (o botão voltar do Android passa pela confirmação).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'recording.tsx'), 'utf8');

test('recording.tsx: não chama Alert.alert nem importa Alert', () => {
  assert.equal(SRC.includes('Alert.alert'), false);
  const rnImport = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/);
  assert.ok(rnImport, 'a tela importa de react-native');
  assert.equal(/\bAlert\b/.test(rnImport[1]), false);
});

test("recording.tsx: registra BackHandler.addEventListener('hardwareBackPress'", () => {
  assert.ok(SRC.includes("BackHandler.addEventListener('hardwareBackPress'"));
});

test('recording.tsx: o "Encerrar" passa por finishRecording, sem salvar direto', () => {
  assert.ok(SRC.includes("import { finishRecording } from '../src/recording/finishRecording'"));
  assert.ok(SRC.includes('await finishRecording('));
  assert.equal(SRC.includes('saveRecordedSession'), false);
});

test('recording.tsx: HUD mostra "Salvamento automático falhou" sob info.autosaveFailed', () => {
  const cond = /\{info\.autosaveFailed && \(([\s\S]*?)\)\}/.exec(SRC);
  assert.ok(cond, 'há um bloco renderizado sob {info.autosaveFailed && (...)}');
  assert.ok(cond[1].includes('>Salvamento automático falhou<'));
});
