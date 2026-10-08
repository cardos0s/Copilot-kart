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
import { runGolden, runGoldenLegacy, runGoldenNewPipeline, toJson } from './golden/harness';

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

/**
 * O `expected.json` restrito às chaves que um caminho produz. Toda chave do caminho
 * tem de existir no `expected.json`, e o caminho tem de cobrir o que se espera dele.
 */
function expectedFor(output: Golden): Golden {
  const out: Golden = {};
  for (const [consumer, bySession] of Object.entries(output)) {
    assert.ok(consumer in expected, `consumidor ${consumer} fora do expected.json`);
    out[consumer] = {};
    for (const session of Object.keys(bySession)) {
      assert.ok(session in expected[consumer], `${consumer}.${session} fora do expected.json`);
      out[consumer][session] = expected[consumer][session];
    }
  }
  return out;
}

const PER_SESSION = [
  'lapRecords', 'sessionScreen', 'peakSpeedMsOfLaps', 'buildLapInsight', 'detectSpins',
  'buildPilotDna', 'coachContext', 'countCorners', 'samplesToSilhouette', 'polylineLength',
];

test('golden (T45, TF-14): o pipeline novo de ponta a ponta (captura, diário no banco, "Encerrar", loadLaps) reproduz o expected.json', async () => {
  const output = toJson(await runGoldenNewPipeline()) as Golden;
  for (const c of PER_SESSION) assert.deepEqual(Object.keys(output[c]).sort(), ['s1', 's1Layout', 's2'], c);
  assert.ok('s1Layout' in output.trackMapScreen && 's1Layout' in output.compareLaps);
  const diff = goldenCompare(expectedFor(output), output);
  assert.equal(diff, null, diff ? `${diff.path}: ${diff.reason}` : '');
});

test('golden (T45, TF-14, TF-18): o JSON que o código antigo salvava, pela migração v5 inteira e pelo loadLaps, reproduz o expected.json', async () => {
  const output = toJson(await runGoldenLegacy()) as Golden;
  for (const c of PER_SESSION) assert.deepEqual(Object.keys(output[c]).filter((s) => SESSIONS.includes(s)).sort(), [...SESSIONS].sort(), c);
  for (const c of ['lineFromLayout', 'referenceFromLayout', 'sectorSplits']) assert.deepEqual(Object.keys(output[c]), ['s3'], c);
  assert.deepEqual(Object.keys(output.trackMapScreen).sort(), ['s1Layout', 's4']);
  assert.deepEqual(Object.keys(output.compareLaps).sort(), ['s1Layout', 's4']);
  assert.ok('all' in output.buildPilotDna);
  const diff = goldenCompare(expectedFor(output), output);
  assert.equal(diff, null, diff ? `${diff.path}: ${diff.reason}` : '');
});
