/**
 * Invariantes estáticas de `app/recording-reference.tsx`, lendo o fonte:
 * REC-08 AC 1 (nenhum alerta nativo na tela presa em paisagem) e REC-11 AC 1
 * (a cronometragem logo depois do reconhecimento usa o traçado recém-gravado).
 * Desde a T40 (TF-07, TF-09, TF-13): o bruto do reconhecimento não vira sessão, então
 * todo caminho que encerra a gravação chama `journal.discard`; o traçado é salvo pelo
 * `layoutRepo`, e o mínimo de pontos é o `MIN_SAMPLES` compartilhado.
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

test('recording-reference.tsx (T40): poucos pontos, nenhuma volta, traçado salvo e "Descartar" chamam journal.discard; nenhum journal.end', () => {
  // Substitui os quatro `journal.end(recordingId)`, que deixavam séries órfãs de
  // `session:session_<rec>` sem linha de sessão.
  const discards = SRC.match(/journal\s*\.\s*discard\(recordingId\)/g) ?? [];
  assert.equal(discards.length, 4);
  assert.equal(/journal\s*\.\s*end\(/.test(SRC), false);
  // Os caminhos, em ordem: poucos pontos, nenhuma volta, depois de salvar o traçado.
  assert.ok(
    /if \(result\.allSamples\.length < MIN_SAMPLES\) \{\s*await journal\.discard\(recordingId\)[\s\S]*?if \(result\.laps\.length === 0\) \{\s*await journal\.discard\(recordingId\)[\s\S]*?layout = await saveReferenceLayout\([\s\S]*?await journal\s*\.discard\(recordingId\)/.test(SRC),
  );
  const discard = SRC.match(/const discardRecording = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(discard, 'a tela define discardRecording');
  assert.ok(discard[1].includes('await journal.discard(recordingId)'));
  // Falha ao salvar o traçado: o diário fica (a recuperação aparece na próxima abertura).
  const failure = SRC.match(/\} catch \(e\) \{\s*console\.warn\('\[recording-reference\] falha ao salvar o traçado:'[\s\S]*?return;\s*\}/);
  assert.ok(failure);
  assert.equal(failure[0].includes('journal'), false);
});

test('recording-reference.tsx (T40): o mínimo de pontos é o MIN_SAMPLES compartilhado, e o traçado é salvo pelo layoutRepo', () => {
  assert.ok(SRC.includes("import { MIN_SAMPLES } from '../src/recording/finishRecording';"));
  // Substitui o literal `result.allSamples.length < 30`.
  assert.equal(/allSamples\.length\s*<\s*\d/.test(SRC), false);
  assert.ok(SRC.includes("import { sqlLayoutRepo } from '../src/storage/layoutRepo';"));
  assert.ok(/saveReferenceLayout\([\s\S]*?sqlLayoutRepo\(appSqlConn\)\s*\)/.test(SRC));
  assert.equal(SRC.includes('sqliteLayoutRepo'), false);
});

test('recording-reference.tsx (T40): o radar recebe GpsFrame, sem os tipos antigos', () => {
  assert.ok(/function LiveRadar\(\{ samples \}: \{ samples: GpsFrame\[\] \}\)/.test(SRC));
  assert.equal(/\b(GpsSample|ImuSample)\b/.test(SRC), false);
});
