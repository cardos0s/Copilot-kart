/**
 * "Encerrar": REC-05 AC 2 (falha ao salvar mantém o diário, sem efeitos) e
 * REC-01 AC 9 (sucesso apaga o diário, só depois do commit).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { sliceLaps, type RecordedSessionRow } from '../src/recording/finishSession';
import {
  finishRecording,
  type FinishRecordingDeps,
  type FinishRecordingMeta,
} from '../src/recording/finishRecording';
import { RecordingJournal } from '../src/recording/journal';
import { fakeJournalStore, persistedGps } from './helpers/fakeJournalStore';
import { fakeSessionRepo } from './helpers/fakeSessionRepo';
import { generateLapSamples } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

/** Grava pelo diário, como no app, e devolve o que o `stop()` devolveria. */
async function recorded(samples: GpsSample[]) {
  const store = fakeJournalStore();
  const journal = new RecordingJournal(store, () => T0);
  const recordingId = await journal.begin({
    mode: 'race',
    trackId: 'track_1',
    trackName: 'Kartódromo',
    layoutId: 'layout_1',
    layoutName: null,
    kartSetupId: 'setup_1',
  });
  for (let i = 0; i < samples.length; i += 25) {
    const batch = samples.slice(i, i + 25);
    journal.appendGps(batch);
    await journal.flushIfDue(batch[batch.length - 1].t);
  }
  await journal.flush();

  const repo = fakeSessionRepo();
  const events: string[] = [];
  const endCalls: string[] = [];
  const postSaveCalls: { session: RecordedSessionRow; lapIds: string[] }[] = [];
  const deps: FinishRecordingDeps = {
    journal: {
      end: async (id) => {
        endCalls.push(id);
        events.push(`end(sessões gravadas: ${repo.sessions.length})`);
        await journal.end(id);
      },
    },
    repo,
    postSave: async (session, laps) => {
      postSaveCalls.push({ session, lapIds: laps.map((l) => l.id) });
      events.push('postSave');
    },
  };
  const meta: FinishRecordingMeta = {
    recordingId,
    trackName: 'Kartódromo',
    trackId: 'track_1',
    layoutId: 'layout_1',
    kartSetupId: 'setup_1',
    mode: 'race',
    startedAt: T0,
  };
  const result = { allSamples: samples, laps: sliceLaps(samples, []) };
  return { store, journal, recordingId, repo, deps, meta, result, events, endCalls, postSaveCalls };
}

function track(numLaps: number): GpsSample[] {
  return generateLapSamples({ numLaps, warmupS: 5, cooldownS: 10, startTimestamp: T0 });
}

test('finishRecording: repo falha na 3ª volta → save-failed, sem journal.end nem efeitos, e o diário fica', async () => {
  const r = await recorded(track(4));
  assert.ok(r.result.laps.length >= 3, 'a pista sintética precisa de 3 voltas ou mais');
  const before = persistedGps(r.store, r.recordingId);
  assert.equal(before.length, r.result.allSamples.length);
  r.repo.failOnLap = 3;

  const out = await finishRecording(r.result, r.meta, r.deps);

  assert.equal(out.kind, 'save-failed');
  assert.deepEqual(r.endCalls, []);
  assert.deepEqual(r.postSaveCalls, []);
  // Nada gravado: a transação desfez tudo.
  assert.equal(r.repo.sessions.length, 0);
  assert.equal(r.repo.laps.length, 0);
  // O diário continua ativo e com os mesmos pedaços, para a recuperação.
  assert.equal(r.store.active?.id, r.recordingId);
  assert.deepEqual(persistedGps(r.store, r.recordingId), before);
});

test('finishRecording: menos de 30 pontos → too-few e o diário é apagado; 30 pontos já não é too-few', async () => {
  const r = await recorded(track(1).slice(0, 29));
  const out = await finishRecording(r.result, r.meta, r.deps);

  assert.deepEqual(out, { kind: 'too-few' });
  assert.deepEqual(r.endCalls, [r.recordingId]);
  assert.equal(r.store.active, null);
  assert.equal(r.store.chunks.size, 0);
  assert.equal(r.repo.sessions.length, 0);
  assert.deepEqual(r.postSaveCalls, []);

  const r30 = await recorded(track(1).slice(0, 30));
  const out30 = await finishRecording(r30.result, r30.meta, r30.deps);
  assert.equal(out30.kind, 'saved');
});

test('finishRecording: sucesso → saved com as voltas, journal.end depois do commit e efeitos depois', async () => {
  const r = await recorded(track(3));
  const n = r.result.laps.length;
  assert.ok(n > 0);

  const out = await finishRecording(r.result, r.meta, r.deps);

  assert.equal(out.kind, 'saved');
  if (out.kind !== 'saved') return;
  const id = `session_${r.recordingId}`;
  assert.equal(out.saved.session.id, id);
  assert.equal(out.saved.laps.length, n);
  assert.deepEqual(r.repo.sessions.map((s) => s.id), [id]);
  assert.deepEqual(
    r.repo.laps.map((l) => l.id),
    Array.from({ length: n }, (_, i) => `${id}_lap_${i + 1}`),
  );
  // O diário só é apagado com a sessão já no banco, e os efeitos vêm depois.
  assert.deepEqual(r.events, ['end(sessões gravadas: 1)', 'postSave']);
  assert.equal(r.store.active, null);
  assert.equal(r.store.chunks.size, 0);
  assert.equal(r.postSaveCalls[0].session.id, id);
  assert.deepEqual(r.postSaveCalls[0].lapIds, r.repo.laps.map((l) => l.id));
});
