/**
 * Invariantes estáticas de `src/hooks/useLapRecorder.ts` e do poll que ele usa
 * (`src/recording/livePoll.ts`), lendo o fonte: TMP-06 (a mesma linha no ao
 * vivo, no diário e no "Encerrar"), TMP-07/08 (S1/S2/S3 ao vivo e publicados
 * pela régua única, sem marcar limite pelo poll) e, desde a T19, TF-05/TF-12
 * (IMU pelo relógio do sensor e voltas sobre os frames de análise).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useLapRecorder.ts'), 'utf8');
/** Desde a T19 o poll de 500 ms está fora do hook, num módulo puro. */
const POLL = readFileSync(join(__dirname, '..', 'src', 'recording', 'livePoll.ts'), 'utf8');

function importsFrom(src: string, module: string): string[] {
  const m = src.match(new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*'${module.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '')) : [];
}

// O poll saiu do hook na T19: `sectorSplits` é importado pelo `livePoll.ts`, e o
// hook continua montando a linha com `lineFromLayout`.
test('useLapRecorder: o poll importa sectorSplits, o hook importa lineFromLayout, e não há mais sectorBoundaryTsRef', () => {
  assert.ok(importsFrom(POLL, '../lib/sectors').includes('sectorSplits'));
  assert.ok(importsFrom(SRC, '../lib/startLine').includes('lineFromLayout'));
  assert.equal(SRC.includes('sectorBoundaryTsRef'), false);
  assert.equal(POLL.includes('sectorBoundaryTsRef'), false);
});

test('useLapRecorder: o poll e o stop() usam a linha da gravação', () => {
  // O poll (no livePoll.ts desde a T19) detecta com a linha fixada no start().
  assert.equal(/detectLaps\(all\)/.test(POLL), false, 'o poll não pode detectar sem a linha');
  assert.ok(/detectLaps\(all,\s*\{\s*line\b/.test(POLL), 'o poll chama detectLaps(all, { line })');
  assert.ok(/createLivePoll\(recordingLineRef\.current,/.test(SRC), 'o hook cria o poll com a linha da gravação');
  // Substitui `sliceLaps(allSamples, allImuSamples, line)`: o stop() recorta as
  // janelas sobre os frames de análise (≤ 30 m), com a mesma linha (TF-12).
  assert.ok(/sliceLapWindows\(analysisGps\(gps\),\s*line\)/.test(SRC), 'o stop() chama sliceLapWindows(analysisGps(…), line)');
  assert.equal(/sliceLaps\(/.test(SRC), false);
});

test('useLapRecorder: a meta do diário leva a linha', () => {
  assert.ok(/journal\.begin\(\{\s*\.\.\.startOpts\.meta,\s*line\b/.test(SRC));
});

test('useLapRecorder: a IMU vem do createImuCapture no relógio da sessão, sem Date.now() no frame', () => {
  assert.ok(importsFrom(SRC, '../recording/imuCapture').includes('createImuCapture'));
  assert.ok(/createImuCapture\(clock,/.test(SRC));
  assert.equal(/t:\s*Date\.now\(\)/.test(SRC), false, 'nenhum frame recebe Date.now() como t');
  assert.equal(SRC.includes('pendingImu'), false, 'o pareamento inline saiu do hook');
});
