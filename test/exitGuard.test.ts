/**
 * Exit guard: REC-07 AC 2 (confirmação com 3 opções), AC 3 ("Encerrar e
 * salvar" = botão "Encerrar") e AC 4 ("Descartar").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXIT_OPTIONS, exitGuard } from '../src/recording/exitGuard';

test('exitGuard: requestExit em recording vai para confirming com as 3 opções', () => {
  const r = exitGuard('recording', 'requestExit');
  assert.equal(r.state, 'confirming');
  assert.equal(r.effect, 'none');
  assert.deepEqual(
    EXIT_OPTIONS.map((o) => [o.action, o.label]),
    [
      ['continue', 'Continuar gravando'],
      ['finish', 'Encerrar e salvar'],
      ['discard', 'Descartar'],
    ],
  );
});

test('exitGuard: continue volta a recording sem efeito', () => {
  assert.deepEqual(exitGuard('confirming', 'continue'), { state: 'recording', effect: 'none' });
});

test('exitGuard: finish emite o efeito finish, o mesmo do botão Encerrar', () => {
  assert.deepEqual(exitGuard('confirming', 'finish'), { state: 'recording', effect: 'finish' });
});

test('exitGuard: discard emite o efeito discard', () => {
  assert.deepEqual(exitGuard('confirming', 'discard'), { state: 'recording', effect: 'discard' });
});
