/**
 * Handler da tarefa de localização: REC-01 (o GPS vai ao diário direto do
 * callback) e REC-09 (sem gravação ativa, a tarefa se para).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample } from '../src/lib/geometry';
import { RecordingJournal } from '../src/recording/journal';
import {
  handleLocations,
  type LocationLike,
  type LocationTaskDeps,
} from '../src/recording/locationHandler';
import { fakeJournalStore, persistedGps } from './helpers/fakeJournalStore';

const NOW = 1_700_000_050_000;

function loc(timestamp: number, accuracy: number | null, lat = -14.86): LocationLike {
  return {
    timestamp,
    coords: {
      latitude: lat,
      longitude: -40.84,
      speed: 12,
      accuracy,
      heading: 90,
      altitude: 900,
      altitudeAccuracy: 3,
    },
  };
}

async function setup(active: boolean, uiActive = false) {
  const store = fakeJournalStore();
  const journal = new RecordingJournal(store, () => NOW);
  const id = active
    ? await journal.begin({
        mode: 'race',
        trackId: 't',
        trackName: 'Pista',
        layoutId: null,
        layoutName: null,
        kartSetupId: null,
      })
    : null;
  const buf = { samples: [] as GpsSample[] };
  const calls = { stop: 0 };
  const deps: LocationTaskDeps = {
    buf,
    journal,
    uiActive,
    stopLocationUpdates: async () => {
      calls.stop++;
    },
    now: () => NOW,
    clock: { trustsRaw: false, lastT: 0 },
  };
  return { store, journal, id, buf, calls, deps };
}

test('handleLocations: fix com accuracy 31 m é descartado e com 30 m entra', async () => {
  const { buf, journal, store, id, deps } = await setup(true);
  await handleLocations([loc(NOW - 123, 31, -14.1), loc(NOW - 23, 30, -14.2)], deps);

  assert.deepEqual(buf.samples.map((s) => s.lat), [-14.2]);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!).map((s) => s.lat), [-14.2]);
});

test('handleLocations: com diário ativo, os pontos vão ao buf e ao diário', async () => {
  const { buf, journal, store, id, deps, calls } = await setup(true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  const expected: GpsSample[] = [
    { t: NOW - 223, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4, heading: 90, altitude: 900, altitudeAccuracy: 3 },
    { t: NOW - 123, lat: -14.86, lng: -40.84, speed: 12, accuracy: 5, heading: 90, altitude: 900, altitudeAccuracy: 3 },
  ];
  assert.deepEqual(buf.samples, expected);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!), expected);
  assert.equal(calls.stop, 0);
});

test('handleLocations: gravação real (diário ativo e tela ativa), os pontos vão ao buf e ao diário e a tarefa segue', async () => {
  const { buf, journal, store, id, deps, calls } = await setup(true, true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  const expected: GpsSample[] = [
    { t: NOW - 223, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4, heading: 90, altitude: 900, altitudeAccuracy: 3 },
    { t: NOW - 123, lat: -14.86, lng: -40.84, speed: 12, accuracy: 5, heading: 90, altitude: 900, altitudeAccuracy: 3 },
  ];
  assert.deepEqual(buf.samples, expected);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!), expected);
  assert.equal(calls.stop, 0);
});

test('handleLocations: sem diário ativo, para a tarefa e nada vai ao diário', async () => {
  const { store, journal, deps, calls } = await setup(false);
  await handleLocations([loc(NOW - 123, 4)], deps);

  assert.equal(calls.stop, 1);
  assert.equal(journal.recordingId, null);
  assert.equal(store.chunks.size, 0);

  // Sem diário nenhum configurado, o mesmo.
  await handleLocations([loc(NOW - 123, 4)], { ...deps, journal: null });
  assert.equal(calls.stop, 2);
  assert.equal(store.chunks.size, 0);
});

test('handleLocations: tela de gravação ativa sem diário, os pontos vão só ao buf e a tarefa segue', async () => {
  const { store, journal, buf, deps, calls } = await setup(false, true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  assert.equal(calls.stop, 0);
  assert.deepEqual(buf.samples, [
    { t: NOW - 223, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4, heading: 90, altitude: 900, altitudeAccuracy: 3 },
    { t: NOW - 123, lat: -14.86, lng: -40.84, speed: 12, accuracy: 5, heading: 90, altitude: 900, altitudeAccuracy: 3 },
  ]);
  await journal.flush();
  assert.equal(journal.recordingId, null);
  assert.equal(store.chunks.size, 0);

  // Sem diário nenhum configurado, o mesmo.
  await handleLocations([loc(NOW - 23, 6)], { ...deps, journal: null });
  assert.equal(calls.stop, 0);
  assert.deepEqual(buf.samples.map((s) => s.accuracy), [4, 5, 6]);
  assert.equal(store.chunks.size, 0);
});

test('handleLocations: sem tela de gravação e sem diário, para a tarefa e o buf não recebe nada', async () => {
  const { buf, deps, calls } = await setup(false, false);
  await handleLocations([loc(NOW - 123, 4)], deps);
  await handleLocations([loc(NOW - 123, 4)], { ...deps, journal: null });

  assert.equal(calls.stop, 2);
  assert.deepEqual(buf.samples, []);
});

test('handleLocations: timestamp sub-segundo é usado; quantizado ou zero vira now espalhado a 100 ms', async () => {
  const sub = await setup(true);
  await handleLocations([loc(1_700_000_049_123, 4)], sub.deps);
  assert.deepEqual(sub.buf.samples.map((s) => s.t), [1_700_000_049_123]);

  const quant = await setup(true);
  await handleLocations(
    [loc(1_700_000_047_000, 4), loc(1_700_000_048_000, 4), loc(0, 4)],
    quant.deps,
  );
  assert.deepEqual(quant.buf.samples.map((s) => s.t), [NOW - 200, NOW - 100, NOW]);
});

// ---------------------------------------------------------------------------
// TMP-14: timestamp do GPS confiável mesmo quando cai no segundo cheio.
// ---------------------------------------------------------------------------

test('handleLocations: lote com t = …49.900, …50.000, …50.100 mantém os três timestamps originais', async () => {
  const { buf, deps } = await setup(true);
  await handleLocations(
    [loc(1_700_000_049_900, 4), loc(1_700_000_050_000, 4), loc(1_700_000_050_100, 4)],
    deps,
  );
  assert.deepEqual(buf.samples.map((s) => s.t), [1_700_000_049_900, 1_700_000_050_000, 1_700_000_050_100]);

  // O fix no segundo cheio abrindo o lote também fica com o seu timestamp.
  const first = await setup(true);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_050_100, 4)], first.deps);
  assert.deepEqual(first.buf.samples.map((s) => s.t), [1_700_000_050_000, 1_700_000_050_100]);

  // Depois de visto o sub-segundo, um lote só com segundo cheio também confia no cru.
  await handleLocations([loc(1_700_000_051_000, 4)], first.deps);
  assert.deepEqual(first.buf.samples.map((s) => s.t), [1_700_000_050_000, 1_700_000_050_100, 1_700_000_051_000]);
});

test('handleLocations: aparelho que só entrega timestamp quantizado continua com o horário de chegada espalhado a 100 ms', async () => {
  const { buf, deps } = await setup(true);
  let now = NOW;
  const withNow = { ...deps, now: () => now };
  await handleLocations([loc(1_700_000_049_000, 4), loc(1_700_000_050_000, 4), loc(0, 4)], withNow);
  now = NOW + 1_000;
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_051_000, 4)], withNow);
  assert.deepEqual(buf.samples.map((s) => s.t), [NOW - 200, NOW - 100, NOW, NOW + 900, NOW + 1_000]);
  assert.equal(deps.clock.trustsRaw, false);
});

test('handleLocations: os timestamps emitidos são estritamente crescentes entre lotes, mesmo com t repetido', async () => {
  // Relógio confiável: o lote seguinte repete o último t.
  const raw = await setup(true);
  await handleLocations([loc(1_700_000_049_900, 4), loc(1_700_000_050_000, 4)], raw.deps);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_050_100, 4)], raw.deps);
  const tr = raw.buf.samples.map((s) => s.t);
  assert.deepEqual(tr, [1_700_000_049_900, 1_700_000_050_000, 1_700_000_050_001, 1_700_000_050_100]);

  // Horário de chegada: dois lotes que chegam no mesmo instante.
  const arr = await setup(true);
  await handleLocations([loc(1_700_000_049_000, 4), loc(1_700_000_050_000, 4)], arr.deps);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_051_000, 4)], arr.deps);
  const ta = arr.buf.samples.map((s) => s.t);
  assert.deepEqual(ta, [NOW - 100, NOW, NOW + 1, NOW + 2]);

  for (const ts of [tr, ta]) {
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], `t[${i}] = ${ts[i]} não passa de ${ts[i - 1]}`);
  }
});
