/**
 * Checagem na abertura: REC-09 AC 1 (tarefa de GPS órfã) e REC-02 (gravação
 * interrompida vira oferta de recuperação). Desde a T21 o diário fica nas séries
 * da sessão: a sessão já salva mantém o bruto (TF-07, TF-08).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBootCheck, type BootCheckDeps } from '../src/recording/bootCheck';
import { RecordingJournal, type RecordingMetaInput } from '../src/recording/journal';
import { asFrames, fakeJournalStore, persistedGps, persistedSeries, type FakeJournalStore } from './helpers/fakeJournalStore';
import { generateLapSamples } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

const META: RecordingMetaInput = {
  mode: 'race',
  trackId: 'track_1',
  trackName: 'Kartódromo',
  layoutId: null,
  layoutName: null,
  kartSetupId: null,
};

function bootDeps(store: FakeJournalStore, opts: { taskRunning: boolean; savedSessions?: string[] }) {
  const calls = { stop: 0 };
  let running = opts.taskRunning;
  const d: BootCheckDeps = {
    store,
    isLocationTaskRunning: async () => running,
    stopLocationUpdates: async () => {
      calls.stop++;
      running = false;
    },
    sessionExists: async (id) => (opts.savedSessions ?? []).includes(id),
  };
  return { d, calls, isRunning: () => running };
}

async function activeJournal(store: FakeJournalStore) {
  const journal = new RecordingJournal(store, () => T0);
  const id = await journal.begin(META);
  journal.appendGps(asFrames(generateLapSamples({ numLaps: 2, warmupS: 5, cooldownS: 5, startTimestamp: T0 }), T0));
  await journal.flush();
  return id;
}

test('bootCheck: tarefa registrada e sem diário para a tarefa e devolve none', async () => {
  const store = await fakeJournalStore();
  const { d, calls, isRunning } = bootDeps(store, { taskRunning: true });
  const r = await runBootCheck(d);
  assert.deepEqual(r, { kind: 'none' });
  assert.equal(calls.stop, 1);
  assert.equal(isRunning(), false);
});

test('bootCheck: tarefa registrada e diário ativo para a tarefa e devolve interrupted com o resumo', async () => {
  const store = await fakeJournalStore();
  const id = await activeJournal(store);
  const { d, calls, isRunning } = bootDeps(store, { taskRunning: true });

  const r = await runBootCheck(d);

  assert.equal(calls.stop, 1);
  assert.equal(isRunning(), false);
  assert.equal(r.kind, 'interrupted');
  if (r.kind !== 'interrupted') return;
  assert.equal(r.summary.recordingId, id);
  assert.equal(r.summary.trackName, 'Kartódromo');
  assert.equal(r.summary.startedAt, T0);
  assert.equal(r.summary.laps, 2);
  assert.notEqual(store.active, null); // o diário fica até o piloto decidir
});

// Desde a T21 a sessão já salva é dona das séries (TF-07): a abertura apaga só o
// registro ativo e mantém o bruto. Substitui "apaga o diário" (séries vazias).
test('bootCheck: sessão já salva devolve already-saved, apaga o registro ativo e mantém as séries', async () => {
  const store = await fakeJournalStore();
  const id = await activeJournal(store);
  const before = persistedGps(store, id);
  assert.ok(before.length > 0);
  const { d } = bootDeps(store, { taskRunning: false, savedSessions: [`session_${id}`] });

  const r = await runBootCheck(d);

  assert.deepEqual(r, { kind: 'already-saved' });
  assert.equal(store.active, null);
  assert.deepEqual(persistedSeries(store, id).map((m) => m.kind), ['gps', 'imu']);
  assert.deepEqual(persistedGps(store, id), before);
});

test('bootCheck: diário ilegível devolve unreadable e apaga', async () => {
  const store = await fakeJournalStore();
  const id = await activeJournal(store);
  store.active = { ...store.active!, metaJson: JSON.stringify({ version: 2 }) };
  const { d } = bootDeps(store, { taskRunning: false });

  const r = await runBootCheck(d);

  assert.deepEqual(r, { kind: 'unreadable' });
  assert.equal(store.active, null);
  assert.deepEqual(persistedSeries(store, id), []);
});
