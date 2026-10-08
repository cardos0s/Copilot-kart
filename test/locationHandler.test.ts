/**
 * Handler da tarefa de localização: REC-01 (o GPS vai ao diário direto do
 * callback), REC-09 (sem gravação ativa, a tarefa se para) e, desde a T14,
 * TF-02/03/04/06 (cada fix vira um `GpsFrame` no relógio da sessão, sem descarte).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RecordingJournal } from '../src/recording/journal';
import {
  handleLocations,
  type LocationLike,
  type LocationTaskDeps,
} from '../src/recording/locationHandler';
import { createSessionClock } from '../src/recording/sessionClock';
import type { GpsFrame } from '../src/telemetry/frame';
import { fakeJournalStore, persistedGps, totalBlocks } from './helpers/fakeJournalStore';

const NOW = 1_700_000_050_000;
/** Início da sessão (`t0Utc`): o `t` dos frames é contado a partir dele. */
const START = 1_700_000_000_000;

/** O frame que uma fix de `loc()` vira, com o `t` no relógio da sessão. */
function frame(t: number, accuracy: number | undefined, gnssTime: number, over: Partial<GpsFrame> = {}): GpsFrame {
  return {
    kind: 'gps',
    source: 'PHONE',
    t,
    lat: -14.86,
    lng: -40.84,
    speed: 12,
    accuracy,
    heading: 90,
    altitude: 900,
    altitudeAccuracy: 3,
    fix: 'unknown',
    gnssTime,
    ...over,
  };
}

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
  const store = await fakeJournalStore();
  // O diário começa em START: é o t0Utc das séries e do relógio da tarefa.
  const journal = new RecordingJournal(store, () => START);
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
  const buf = { gps: [] as GpsFrame[] };
  const calls = { stop: 0 };
  const deps: LocationTaskDeps = {
    buf,
    journal,
    uiActive,
    stopLocationUpdates: async () => {
      calls.stop++;
    },
    now: () => NOW,
    clock: { trustsRaw: false, session: createSessionClock(START) },
  };
  return { store, journal, id, buf, calls, deps };
}

// Substitui "fix com accuracy 31 m é descartado e com 30 m entra": desde a
// T14 nenhuma fix é descartada na captura (TF-03). O corte de 30 m é da análise.
test('handleLocations: fix com precisão de 45 m é gravada com accuracy 45, e a de 30 m também', async () => {
  const { buf, journal, store, id, deps } = await setup(true);
  await handleLocations([loc(NOW - 123, 45, -14.1), loc(NOW - 23, 30, -14.2)], deps);

  assert.deepEqual(buf.gps.map((s) => [s.lat, s.accuracy]), [[-14.1, 45], [-14.2, 30]]);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!).map((s) => [s.lat, s.accuracy]), [[-14.1, 45], [-14.2, 30]]);
});

test('handleLocations: fix sem precisão é emitida com accuracy indefinido (não 999)', async () => {
  const { buf, deps } = await setup(true);
  await handleLocations([loc(NOW - 123, null)], deps);

  assert.equal(buf.gps.length, 1);
  assert.equal(buf.gps[0].accuracy, undefined);
});

test('handleLocations: com o relógio confiável o frame sai sem timeRepaired; com timestamp quantizado, sai marcado', async () => {
  const trusted = await setup(true);
  await handleLocations([loc(1_700_000_049_123, 4), loc(1_700_000_049_223, 4)], trusted.deps);
  assert.deepEqual(trusted.buf.gps.map((s) => s.timeRepaired), [undefined, undefined]);

  const quant = await setup(true);
  await handleLocations([loc(1_700_000_048_000, 4), loc(1_700_000_049_000, 4), loc(0, 4)], quant.deps);
  assert.deepEqual(quant.buf.gps.map((s) => s.timeRepaired), [true, true, true]);
});

test('handleLocations: cada frame tem gnssTime = loc.timestamp e t = tempo resolvido − t0Utc', async () => {
  // Relógio confiável: o tempo resolvido é o próprio timestamp.
  const raw = await setup(true);
  await handleLocations([loc(1_700_000_049_123, 4), loc(1_700_000_049_223, 4)], raw.deps);
  assert.deepEqual(raw.buf.gps.map((s) => [s.t, s.gnssTime]), [
    [1_700_000_049_123 - START, 1_700_000_049_123],
    [1_700_000_049_223 - START, 1_700_000_049_223],
  ]);

  // Quantizado: o tempo resolvido é o de chegada espalhado; gnssTime guarda o que veio.
  const quant = await setup(true);
  await handleLocations([loc(1_700_000_049_000, 4), loc(0, 4)], quant.deps);
  assert.deepEqual(quant.buf.gps.map((s) => [s.t, s.gnssTime]), [
    [NOW - 100 - START, 1_700_000_049_000],
    [NOW - START, 0],
  ]);
});

test('handleLocations: com diário ativo, os pontos vão ao buf e ao diário', async () => {
  const { buf, journal, store, id, deps, calls } = await setup(true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  const expected: GpsFrame[] = [frame(NOW - 223 - START, 4, NOW - 223), frame(NOW - 123 - START, 5, NOW - 123)];
  assert.deepEqual(buf.gps, expected);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!), expected);
  assert.equal(calls.stop, 0);
});

test('handleLocations: gravação real (diário ativo e tela ativa), os pontos vão ao buf e ao diário e a tarefa segue', async () => {
  const { buf, journal, store, id, deps, calls } = await setup(true, true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  const expected: GpsFrame[] = [frame(NOW - 223 - START, 4, NOW - 223), frame(NOW - 123 - START, 5, NOW - 123)];
  assert.deepEqual(buf.gps, expected);
  await journal.flush();
  assert.deepEqual(persistedGps(store, id!), expected);
  assert.equal(calls.stop, 0);
});

test('handleLocations: sem diário ativo, para a tarefa e nada vai ao diário', async () => {
  const { store, journal, deps, calls } = await setup(false);
  await handleLocations([loc(NOW - 123, 4)], deps);

  assert.equal(calls.stop, 1);
  assert.equal(journal.recordingId, null);
  assert.equal(totalBlocks(store), 0);

  // Sem diário nenhum configurado, o mesmo.
  await handleLocations([loc(NOW - 123, 4)], { ...deps, journal: null });
  assert.equal(calls.stop, 2);
  assert.equal(totalBlocks(store), 0);
});

test('handleLocations: tela de gravação ativa sem diário, os pontos vão só ao buf e a tarefa segue', async () => {
  const { store, journal, buf, deps, calls } = await setup(false, true);
  await handleLocations([loc(NOW - 223, 4), loc(NOW - 123, 5)], deps);

  assert.equal(calls.stop, 0);
  assert.deepEqual(buf.gps, [frame(NOW - 223 - START, 4, NOW - 223), frame(NOW - 123 - START, 5, NOW - 123)]);
  await journal.flush();
  assert.equal(journal.recordingId, null);
  assert.equal(totalBlocks(store), 0);

  // Sem diário nenhum configurado, o mesmo.
  await handleLocations([loc(NOW - 23, 6)], { ...deps, journal: null });
  assert.equal(calls.stop, 0);
  assert.deepEqual(buf.gps.map((s) => s.accuracy), [4, 5, 6]);
  assert.equal(totalBlocks(store), 0);
});

test('handleLocations: sem tela de gravação e sem diário, para a tarefa e o buf não recebe nada', async () => {
  const { buf, deps, calls } = await setup(false, false);
  await handleLocations([loc(NOW - 123, 4)], deps);
  await handleLocations([loc(NOW - 123, 4)], { ...deps, journal: null });

  assert.equal(calls.stop, 2);
  assert.deepEqual(buf.gps, []);
});

// Desde a T14 o `t` é contado a partir do início da sessão: `t + START` é o tempo resolvido.
test('handleLocations: timestamp sub-segundo é usado; quantizado ou zero vira now espalhado a 100 ms', async () => {
  const sub = await setup(true);
  await handleLocations([loc(1_700_000_049_123, 4)], sub.deps);
  assert.deepEqual(sub.buf.gps.map((s) => s.t + START), [1_700_000_049_123]);

  const quant = await setup(true);
  await handleLocations(
    [loc(1_700_000_047_000, 4), loc(1_700_000_048_000, 4), loc(0, 4)],
    quant.deps,
  );
  assert.deepEqual(quant.buf.gps.map((s) => s.t + START), [NOW - 200, NOW - 100, NOW]);
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
  assert.deepEqual(buf.gps.map((s) => s.t + START), [1_700_000_049_900, 1_700_000_050_000, 1_700_000_050_100]);

  // O fix no segundo cheio abrindo o lote também fica com o seu timestamp.
  const first = await setup(true);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_050_100, 4)], first.deps);
  assert.deepEqual(first.buf.gps.map((s) => s.t + START), [1_700_000_050_000, 1_700_000_050_100]);

  // Depois de visto o sub-segundo, um lote só com segundo cheio também confia no cru.
  await handleLocations([loc(1_700_000_051_000, 4)], first.deps);
  assert.deepEqual(first.buf.gps.map((s) => s.t + START), [1_700_000_050_000, 1_700_000_050_100, 1_700_000_051_000]);
});

test('handleLocations: aparelho que só entrega timestamp quantizado continua com o horário de chegada espalhado a 100 ms', async () => {
  const { buf, deps } = await setup(true);
  let now = NOW;
  const withNow = { ...deps, now: () => now };
  await handleLocations([loc(1_700_000_049_000, 4), loc(1_700_000_050_000, 4), loc(0, 4)], withNow);
  now = NOW + 1_000;
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_051_000, 4)], withNow);
  assert.deepEqual(buf.gps.map((s) => s.t + START), [NOW - 200, NOW - 100, NOW, NOW + 900, NOW + 1_000]);
  assert.equal(deps.clock.trustsRaw, false);
});

test('handleLocations: os timestamps emitidos são estritamente crescentes entre lotes, mesmo com t repetido', async () => {
  // Relógio confiável: o lote seguinte repete o último t.
  const raw = await setup(true);
  await handleLocations([loc(1_700_000_049_900, 4), loc(1_700_000_050_000, 4)], raw.deps);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_050_100, 4)], raw.deps);
  const tr = raw.buf.gps.map((s) => s.t + START);
  assert.deepEqual(tr, [1_700_000_049_900, 1_700_000_050_000, 1_700_000_050_001, 1_700_000_050_100]);

  // Horário de chegada: dois lotes que chegam no mesmo instante.
  const arr = await setup(true);
  await handleLocations([loc(1_700_000_049_000, 4), loc(1_700_000_050_000, 4)], arr.deps);
  await handleLocations([loc(1_700_000_050_000, 4), loc(1_700_000_051_000, 4)], arr.deps);
  const ta = arr.buf.gps.map((s) => s.t + START);
  assert.deepEqual(ta, [NOW - 100, NOW, NOW + 1, NOW + 2]);

  for (const ts of [tr, ta]) {
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], `t[${i}] = ${ts[i]} não passa de ${ts[i - 1]}`);
  }
});
