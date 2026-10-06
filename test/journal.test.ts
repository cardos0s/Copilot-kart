/**
 * RecordingJournal: REC-01 (no máximo 10 s perdidos), REC-10 AC 3 (falha de
 * escrita não para a gravação) e REC-13 (uma gravação por vez). Desde a T16 o
 * diário grava blocos nas séries da sessão (SQL real, sql.js): TF-01 (início
 * com t0Utc e fonte), TF-07 (o "Encerrar" mantém o bruto) e TF-09 (descartar apaga).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLUSH_INTERVAL_MS,
  RecordingJournal,
  UnresolvedRecordingError,
  type RecordingMetaInput,
} from '../src/recording/journal';
import type { GpsFrame, ImuFrame } from '../src/telemetry/frame';
import {
  blockCounts,
  fakeJournalStore,
  persistedGps,
  persistedImu,
  persistedSeries,
  totalBlocks,
} from './helpers/fakeJournalStore';

const META: RecordingMetaInput = {
  mode: 'race',
  trackId: 'track_1',
  trackName: 'Kartódromo',
  layoutId: 'layout_1',
  layoutName: null,
  kartSetupId: null,
};

const gps = (t: number): GpsFrame => ({ kind: 'gps', source: 'PHONE', t, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4, fix: 'unknown' });
const imu = (t: number): ImuFrame => ({ kind: 'imu', source: 'PHONE', t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } });

/** Seq dos blocos gravados, por tipo de série. */
function seqs(store: Awaited<ReturnType<typeof fakeJournalStore>>, id: string, kind: 'gps' | 'imu'): number[] {
  const meta = persistedSeries(store, id).find((m) => m.kind === kind)!;
  const res = store.conn.db.exec('SELECT seq FROM telemetry_blocks WHERE series_id = ? ORDER BY seq', [meta.id]);
  return res.length ? res[0].values.map((v) => Number(v[0])) : [];
}

async function setup() {
  let now = 0;
  const store = await fakeJournalStore();
  const journal = new RecordingJournal(store, () => now);
  return { store, journal, setNow: (t: number) => (now = t) };
}

test('journal: pontos de t=0 a 4,9 s não são gravados; em t=5 s viram um bloco por série com seq = 0', async () => {
  const { store, journal } = await setup();
  assert.equal(FLUSH_INTERVAL_MS, 5000);
  const id = await journal.begin(META);

  for (let t = 0; t <= 4900; t += 100) {
    journal.appendGps([gps(t)]);
    journal.appendImu([imu(t)]);
    await journal.flushIfDue(t);
  }
  assert.deepEqual(blockCounts(store, id), { gps: 0, imu: 0 });

  await journal.flushIfDue(5000);
  assert.deepEqual(seqs(store, id, 'gps'), [0]);
  assert.deepEqual(seqs(store, id, 'imu'), [0]);
  assert.equal(persistedGps(store, id).length, 50);
  assert.equal(persistedImu(store, id).length, 50);
});

test('journal: em 60 s com poll de 500 ms, o último ponto gravado nunca fica mais de 10 s atrás', async () => {
  const { store, journal } = await setup();
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
  const { store, journal } = await setup();
  const id = await journal.begin(META);

  journal.appendGps([gps(0), gps(100)]);
  await journal.flush();
  assert.deepEqual(seqs(store, id, 'gps'), [0]);
  assert.equal(journal.failed, false);

  store.failAppends = 1;
  journal.appendGps([gps(200), gps(300)]);
  journal.appendImu([imu(200)]);
  await journal.flush(); // não lança: a gravação segue
  assert.equal(journal.failed, true);
  assert.deepEqual(blockCounts(store, id), { gps: 1, imu: 0 });

  journal.appendGps([gps(400)]);
  await journal.flush();
  assert.equal(journal.failed, false);
  assert.deepEqual(seqs(store, id, 'gps'), [0, 1]);
  assert.deepEqual(seqs(store, id, 'imu'), [0]);
  assert.deepEqual(persistedGps(store, id).map((s) => s.t), [0, 100, 200, 300, 400]);
  assert.deepEqual(persistedImu(store, id).map((s) => s.t), [200]);
});

test('journal: begin com um registro ativo no store rejeita com UnresolvedRecordingError', async () => {
  const { store } = await setup();
  const first = new RecordingJournal(store, () => 0);
  await first.begin(META);

  const second = new RecordingJournal(store, () => 1000);
  await assert.rejects(second.begin(META), (err) => err instanceof UnresolvedRecordingError);
  assert.equal(second.recordingId, null);
});

// Substitui "end apaga o registro ativo e os pedaços": desde a T16 o `end` é o
// fim de uma gravação salva e apaga só o registro ativo, porque as séries são o
// bruto da sessão (TF-07). Apagar tudo é o `discard` (TF-09), testado abaixo.
test('journal: end apaga o registro ativo e mantém as séries e os blocos', async () => {
  const { store, journal } = await setup();
  const id = await journal.begin(META);
  journal.appendGps([gps(0)]);
  await journal.flush();
  assert.notEqual(store.active, null);
  assert.deepEqual(blockCounts(store, id), { gps: 1, imu: 0 });

  await journal.end(id);
  assert.equal(store.active, null);
  assert.deepEqual(blockCounts(store, id), { gps: 1, imu: 0 });
  assert.equal(journal.recordingId, null);
});

test('journal: begin registra as séries gps e imu da sessão com t0Utc e fonte PHONE', async () => {
  const { store, journal, setNow } = await setup();
  setNow(1_790_000_000_000);
  const id = await journal.begin(META);

  assert.equal(journal.t0Utc, 1_790_000_000_000);
  const series = persistedSeries(store, id);
  assert.deepEqual(
    series.map((m) => [m.kind, m.source, m.t0Utc, m.owner.kind, m.owner.id, m.legacy]),
    [
      ['gps', 'PHONE', 1_790_000_000_000, 'session', `session_${id}`, false],
      ['imu', 'PHONE', 1_790_000_000_000, 'session', `session_${id}`, false],
    ],
  );
  assert.equal(store.active?.id, id);
});

/** 12 s de gravação: GPS a 10 Hz, IMU a 50 Hz, poll de 500 ms e o flush final do "Encerrar". */
async function record12s(journal: RecordingJournal) {
  const id = await journal.begin(META);
  for (let t = 0; t < 12_000; t += 20) {
    if (t % 100 === 0) journal.appendGps([gps(t)]);
    journal.appendImu([imu(t)]);
    if (t % 500 === 0) await journal.flushIfDue(t);
  }
  await journal.flush();
  return id;
}

test('journal: 12 s de gravação dão 3 blocos por série, e end mantém todos', async () => {
  const { store, journal } = await setup();
  const id = await record12s(journal);

  assert.deepEqual(blockCounts(store, id), { gps: 3, imu: 3 });
  assert.equal(persistedGps(store, id).length, 120);
  assert.equal(persistedImu(store, id).length, 600);

  await journal.end(id);
  assert.equal(store.active, null);
  assert.deepEqual(blockCounts(store, id), { gps: 3, imu: 3 });
  assert.equal(persistedGps(store, id).length, 120);
  assert.equal(persistedImu(store, id).length, 600);
});

test('journal: discard apaga as séries, os blocos e o registro ativo', async () => {
  const { store, journal } = await setup();
  const id = await record12s(journal);
  assert.equal(totalBlocks(store), 6);

  await journal.discard(id);
  assert.equal(store.active, null);
  assert.deepEqual(persistedSeries(store, id), []);
  assert.equal(totalBlocks(store), 0);
  assert.equal(journal.recordingId, null);
});
