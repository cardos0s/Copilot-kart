/**
 * RecordingJournal: REC-01 (no máximo 10 s perdidos), REC-10 AC 3 (falha de
 * escrita não para a gravação) e REC-13 (uma gravação por vez).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample, ImuSample } from '../src/lib/geometry';
import {
  FLUSH_INTERVAL_MS,
  RecordingJournal,
  UnresolvedRecordingError,
  type RecordingMetaInput,
} from '../src/recording/journal';
import { fakeJournalStore, persistedGps } from './helpers/fakeJournalStore';

const META: RecordingMetaInput = {
  mode: 'race',
  trackId: 'track_1',
  trackName: 'Kartódromo',
  layoutId: 'layout_1',
  layoutName: null,
  kartSetupId: null,
};

const gps = (t: number): GpsSample => ({ t, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4 });
const imu = (t: number): ImuSample => ({ t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } });

function setup() {
  let now = 0;
  const store = fakeJournalStore();
  const journal = new RecordingJournal(store, () => now);
  return { store, journal, setNow: (t: number) => (now = t) };
}

test('journal: pontos de t=0 a 4,9 s não são gravados; em t=5 s viram um pedaço com seq = 0', async () => {
  const { store, journal } = setup();
  assert.equal(FLUSH_INTERVAL_MS, 5000);
  const id = await journal.begin(META);

  for (let t = 0; t <= 4900; t += 100) {
    journal.appendGps([gps(t)]);
    journal.appendImu([imu(t)]);
    await journal.flushIfDue(t);
  }
  assert.equal(store.chunks.get(id)?.length ?? 0, 0);

  await journal.flushIfDue(5000);
  const chunks = store.chunks.get(id) ?? [];
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].seq, 0);
  assert.equal((JSON.parse(chunks[0].gpsJson) as GpsSample[]).length, 50);
  assert.equal((JSON.parse(chunks[0].imuJson) as ImuSample[]).length, 50);
});

test('journal: em 60 s com poll de 500 ms, o último ponto gravado nunca fica mais de 10 s atrás', async () => {
  const { store, journal } = setup();
  const id = await journal.begin(META);

  let worstGap = 0;
  for (let t = 0; t <= 60_000; t += 100) {
    journal.appendGps([gps(t)]); // GPS a 10 Hz
    if (t % 500 === 0) await journal.flushIfDue(t); // poll da UI
    const saved = persistedGps(store, id);
    const lastSavedT = saved.length > 0 ? saved[saved.length - 1].t : 0;
    worstGap = Math.max(worstGap, t - lastSavedT);
  }
  assert.ok(worstGap <= 10_000, `pior intervalo: ${worstGap} ms`);
});

test('journal: falha do store mantém o pendente, liga failed, e o flush seguinte grava tudo e desliga failed', async () => {
  const { store, journal } = setup();
  const id = await journal.begin(META);

  journal.appendGps([gps(0), gps(100)]);
  await journal.flush();
  assert.equal(store.chunks.get(id)?.[0].seq, 0);
  assert.equal(journal.failed, false);

  store.failAppends = 1;
  journal.appendGps([gps(200), gps(300)]);
  await journal.flush(); // não lança: a gravação segue
  assert.equal(journal.failed, true);
  assert.equal(store.chunks.get(id)?.length, 1);

  journal.appendGps([gps(400)]);
  await journal.flush();
  assert.equal(journal.failed, false);
  const chunks = store.chunks.get(id) ?? [];
  assert.deepEqual(chunks.map((c) => c.seq), [0, 1]);
  assert.deepEqual(persistedGps(store, id).map((s) => s.t), [0, 100, 200, 300, 400]);
});

test('journal: begin com um registro ativo no store rejeita com UnresolvedRecordingError', async () => {
  const { store } = setup();
  const first = new RecordingJournal(store, () => 0);
  await first.begin(META);

  const second = new RecordingJournal(store, () => 1000);
  await assert.rejects(second.begin(META), (err) => err instanceof UnresolvedRecordingError);
  assert.equal(second.recordingId, null);
});

test('journal: end apaga o registro ativo e os pedaços', async () => {
  const { store, journal } = setup();
  const id = await journal.begin(META);
  journal.appendGps([gps(0)]);
  await journal.flush();
  assert.notEqual(store.active, null);
  assert.equal(store.chunks.get(id)?.length, 1);

  await journal.end(id);
  assert.equal(store.active, null);
  assert.equal(store.chunks.has(id), false);
  assert.equal(journal.recordingId, null);
});
