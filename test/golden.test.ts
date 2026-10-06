/**
 * Comparação de referência (TF-14, TF-15; T6): o harness roda o pipeline das
 * sessões brutas até cada consumidor e o resultado tem de bater com
 * `test/golden/expected.json` pela regra "Mesmos números" da spec. Nenhuma
 * tarefa muda o `expected.json`; quem muda a assinatura de um consumidor
 * atualiza a chamada em `test/golden/harness.ts`.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { goldenCompare } from './helpers/goldenCompare';
import { runGolden, toJson } from './golden/harness';

type Golden = Record<string, Record<string, unknown>>;

const expected = JSON.parse(readFileSync(join(__dirname, 'golden', 'expected.json'), 'utf8')) as Golden;
let actual: Golden;

before(async () => {
  actual = toJson(await runGolden()) as Golden;
});

/** As sessões gravadas (1 com e sem traçado, 2, a demo pelo seed) e a legada (4). */
const SESSIONS = ['s1', 's1Layout', 's2', 'demo', 's4'];

test('golden: o expected.json tem uma entrada por consumidor e por sessão', () => {
  const perSession = [
    'lapRecords',
    'sessionScreen',
    'peakSpeedMsOfLaps',
    'buildLapInsight',
    'detectSpins',
    'buildPilotDna',
    'coachContext',
    'countCorners',
    'samplesToSilhouette',
    'polylineLength',
  ];
  for (const c of perSession) {
    assert.deepEqual(Object.keys(expected[c]).filter((s) => SESSIONS.includes(s)).sort(), [...SESSIONS].sort(), c);
  }
  // Captura e detecção sobre as sessões gravadas; ao vivo sobre a 1 (com e sem traçado) e a 2.
  assert.deepEqual(Object.keys(expected.handleLocations).sort(), ['s1', 's1HeadTimesMs', 's2']);
  assert.deepEqual(Object.keys(expected.detectLaps).sort(), ['s1', 's1Layout', 's2']);
  assert.deepEqual(Object.keys(expected.livePoll).sort(), ['s1', 's1Layout', 's2']);
  assert.deepEqual(Object.keys(expected.imuPairing), ['s1']);
  // O traçado (sessão 3) e o que só existe com traçado.
  for (const c of ['lineFromLayout', 'referenceFromLayout', 'sectorSplits']) assert.deepEqual(Object.keys(expected[c]), ['s3'], c);
  assert.ok('s3' in expected.countCorners && 's3' in expected.samplesToSilhouette && 's3' in expected.polylineLength);
  assert.deepEqual(Object.keys(expected.saveReferenceLayout), ['s1']);
  assert.deepEqual(Object.keys(expected.trackMapScreen).sort(), ['s1Layout', 's4']);
  assert.deepEqual(Object.keys(expected.compareLaps).sort(), ['s1Layout', 's4']);
  assert.ok('all' in expected.buildPilotDna);
});

test('golden: o pipeline atual reproduz o expected.json pela regra de tolerância', () => {
  const diff = goldenCompare(expected, actual);
  assert.equal(diff, null, diff ? `${diff.path}: ${diff.reason}` : '');
});

test('golden: 1 ms a mais num tempo de volta faz a comparação falhar nesse caminho', () => {
  const copy = structuredClone(actual) as Golden;
  const laps = (copy.detectLaps.s1 as { laps: Array<{ durationMs: number }> }).laps;
  laps[2].durationMs += 1;
  const diff = goldenCompare(expected, copy);
  assert.ok(diff);
  assert.equal(diff.path, 'detectLaps.s1.laps[2].durationMs');
});
