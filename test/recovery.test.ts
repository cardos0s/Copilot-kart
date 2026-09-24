/**
 * Recuperação: REC-02 (oferta, zero voltas, ilegível), REC-03 (recuperar
 * com a meta original, sem duplicar) e REC-04 (descartar apaga).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TrackLayout } from '../src/storage/db';
import { sliceLaps, type LayoutRepo } from '../src/recording/finishSession';
import { RecordingJournal, type RecordingMetaInput } from '../src/recording/journal';
import { discard, recover, summarize, type RecoveryDeps } from '../src/recording/recovery';
import { fakeJournalStore, persistedGps, type FakeJournalStore } from './helpers/fakeJournalStore';
import { fakeSessionRepo, type FakeSessionRepo } from './helpers/fakeSessionRepo';
import { generateLapSamples } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

const RACE: RecordingMetaInput = {
  mode: 'race',
  trackId: 'track_1',
  trackName: 'Kartódromo de Conquista',
  layoutId: 'layout_7',
  layoutName: null,
  kartSetupId: 'setup_3',
};

const REFERENCE: RecordingMetaInput = {
  mode: 'reference',
  trackId: 'track_1',
  trackName: 'Kartódromo de Conquista',
  layoutId: null,
  layoutName: 'Traçado invertido',
  kartSetupId: null,
};

function fakeLayouts(): LayoutRepo & { layouts: TrackLayout[] } {
  const r = {
    layouts: [] as TrackLayout[],
    listLayoutsForTrack: async (trackId: string) => r.layouts.filter((l) => l.trackId === trackId),
    saveLayout: async (layout: TrackLayout) => {
      r.layouts = r.layouts.filter((l) => l.id !== layout.id).concat(layout);
    },
  };
  return r;
}

/** Grava pelo próprio diário, como no app: pedaços a cada 5 s. */
async function journalWith(meta: RecordingMetaInput, numLaps: number) {
  const store = fakeJournalStore();
  const journal = new RecordingJournal(store, () => T0);
  const id = await journal.begin(meta);
  const samples = generateLapSamples({ numLaps, warmupS: 5, cooldownS: 10, startTimestamp: T0 });
  for (let i = 0; i < samples.length; i += 25) {
    const batch = samples.slice(i, i + 25);
    journal.appendGps(batch);
    await journal.flushIfDue(batch[batch.length - 1].t);
  }
  await journal.flush();
  return { store, id, samples };
}

function deps(store: FakeJournalStore, sessions: FakeSessionRepo = fakeSessionRepo(), layouts = fakeLayouts()) {
  const d: RecoveryDeps = { store, sessions, layouts, now: () => T0 + 999_000 };
  return { d, sessions, layouts };
}

test('summarize: diário com 3 voltas dá a pista, o startedAt e laps = 3', async () => {
  const { store, id } = await journalWith(RACE, 3);
  const s = summarize(store.active!, await store.readChunks(id));
  assert.notEqual(s, 'unreadable');
  if (s === 'unreadable') return;
  assert.equal(s.trackName, 'Kartódromo de Conquista');
  assert.equal(s.startedAt, T0);
  assert.equal(s.laps, 3);
  assert.equal(s.recordingId, id);
  assert.equal(s.mode, 'race');
});

test('recover (corrida): cria a sessão com pista, traçado, setup e modo da meta, recovered e 3 voltas, e apaga o diário', async () => {
  const { store, id, samples } = await journalWith(RACE, 3);
  const { d, sessions } = deps(store);

  const r = await recover(id, d);

  assert.equal(sessions.sessions.length, 1);
  const s = sessions.sessions[0];
  assert.equal(s.id, `session_${id}`);
  assert.equal(s.trackId, 'track_1');
  assert.equal(s.trackName, 'Kartódromo de Conquista');
  assert.equal(s.layoutId, 'layout_7');
  assert.equal(s.kartSetupId, 'setup_3');
  assert.equal(s.mode, 'race');
  assert.equal(s.startedAt, T0);
  assert.equal(s.recovered, true);
  assert.equal(sessions.laps.length, 3);
  // As voltas são as que o detectLaps acha nos pontos persistidos.
  assert.deepEqual(
    sessions.laps.map((l) => l.durationMs),
    sliceLaps(samples, []).map((l) => l.durationMs),
  );
  assert.ok('sessionId' in r && r.sessionId === `session_${id}`);

  assert.equal(store.active, null);
  assert.equal(store.chunks.has(id), false);
});

test('recover: se morre depois do commit e antes de apagar, rodar de novo não duplica', async () => {
  const { store, id } = await journalWith(RACE, 3);
  const { d, sessions } = deps(store);

  const realDelete = store.deleteRecording;
  store.deleteRecording = async () => {
    throw new Error('processo morto');
  };
  await assert.rejects(recover(id, d), /processo morto/);
  assert.equal(sessions.sessions.length, 1);
  assert.notEqual(store.active, null); // o diário continua lá

  store.deleteRecording = realDelete;
  await recover(id, d);
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.laps.length, 3);
  assert.equal(store.active, null);
});

test('recover (reconhecimento): cria o layout com o nome da meta a partir da melhor volta', async () => {
  const { store, id, samples } = await journalWith(REFERENCE, 3);
  const { d, sessions, layouts } = deps(store);

  const r = await recover(id, d);

  const laps = sliceLaps(samples, []);
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  assert.equal(sessions.sessions.length, 0);
  assert.equal(layouts.layouts.length, 1);
  const layout = layouts.layouts[0];
  assert.equal(layout.name, 'Traçado invertido');
  assert.equal(layout.trackId, 'track_1');
  assert.equal(layout.durationMs, best.durationMs);
  assert.deepEqual(layout.samples, best.samples);
  assert.ok('layoutId' in r && r.layoutId === layout.id);
  assert.equal(store.active, null);
});

test('summarize: sem volta completa dá laps = 0', async () => {
  const { store, id } = await journalWith(RACE, 0);
  assert.ok(persistedGps(store, id).length > 0);
  const s = summarize(store.active!, await store.readChunks(id));
  assert.notEqual(s, 'unreadable');
  assert.equal(s !== 'unreadable' && s.laps, 0);
});

test('summarize: version 2 ou JSON quebrado dá unreadable', async () => {
  const { store, id } = await journalWith(RACE, 1);
  const chunks = await store.readChunks(id);
  const active = store.active!;

  const v2 = { ...active, metaJson: JSON.stringify({ ...JSON.parse(active.metaJson), version: 2 }) };
  assert.equal(summarize(v2, chunks), 'unreadable');

  assert.equal(summarize({ ...active, metaJson: '{"version":1,' }, chunks), 'unreadable');

  const brokenChunk = [{ ...chunks[0], gpsJson: '[{"t":1' }, ...chunks.slice(1)];
  assert.equal(summarize(active, brokenChunk), 'unreadable');
});

test('discard: apaga o diário', async () => {
  const { store, id } = await journalWith(RACE, 2);
  await discard(id, { store });
  assert.equal(store.active, null);
  assert.equal(store.chunks.has(id), false);
});
