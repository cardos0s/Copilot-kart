/**
 * Recuperação: REC-02 (oferta, zero voltas, ilegível), REC-03 (recuperar
 * com a meta original, sem duplicar) e REC-04 (descartar apaga). Desde a T21
 * a recuperação lê as séries do diário e salva as voltas como janelas sobre
 * elas, sem copiar frames (TF-08, edge "sessão recuperada").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine, type GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { lineFromLayout } from '../src/lib/startLine';
import type { TrackLayout } from '../src/storage/db';
import { sliceLaps, type LayoutRepo } from '../src/recording/finishSession';
import { RecordingJournal, type RecordingMetaInput } from '../src/recording/journal';
import { discard, recover, summarize, type RecoveryDeps } from '../src/recording/recovery';
import { sqlSessionRepo } from '../src/storage/sqlSessionRepo';
import type { ImuFrame } from '../src/telemetry/frame';
import { analysisGps } from '../src/telemetry/laps';
import {
  asFrames,
  fakeJournalStore,
  persistedGps,
  persistedImu,
  persistedSeries,
  type FakeJournalStore,
} from './helpers/fakeJournalStore';
import { fakeSessionRepo, type FakeSessionRepo } from './helpers/fakeSessionRepo';
import { generateLapSamples, generateTimedLaps } from './helpers/syntheticTrack';
import { openV5Database, rowsOf } from './helpers/v5Database';

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
  const store = await fakeJournalStore();
  const journal = new RecordingJournal(store, () => T0);
  const id = await journal.begin(meta);
  const samples = generateLapSamples({ numLaps, warmupS: 5, cooldownS: 10, startTimestamp: T0 });
  for (let i = 0; i < samples.length; i += 25) {
    const batch = samples.slice(i, i + 25);
    journal.appendGps(asFrames(batch, T0));
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
  const s = summarize(store.active!, await store.readSeries(id));
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

  // Desde a T21 a sessão recuperada fica com as séries do diário como bruto
  // (edge "sessão recuperada", sem copiar): só o registro ativo sai.
  // Substitui "apaga o diário" (séries vazias).
  assert.equal(store.active, null);
  assert.equal(persistedGps(store, id).length, samples.length);
});

test('recover: se morre depois do commit e antes de apagar, rodar de novo não duplica', async () => {
  const { store, id } = await journalWith(RACE, 3);
  const { d, sessions } = deps(store);

  // Desde a T21 a limpeza da corrida recuperada é o `deleteActive` (as séries ficam).
  const realDelete = store.deleteActive;
  store.deleteActive = async () => {
    throw new Error('processo morto');
  };
  await assert.rejects(recover(id, d), /processo morto/);
  assert.equal(sessions.sessions.length, 1);
  assert.notEqual(store.active, null); // o diário continua lá

  store.deleteActive = realDelete;
  await recover(id, d);
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.laps.length, 3);
  assert.equal(store.active, null);
});

test('recover (reconhecimento): cria o layout com o nome da meta a partir da melhor volta', async () => {
  const { store, id, samples } = await journalWith(REFERENCE, 3);
  const { d, sessions, layouts } = deps(store);

  const r = await recover(id, d);

  // O oráculo no relógio dos frames do diário (t desde o início da sessão): desde
  // a T21 a volta sai das séries, e os pontos do traçado são os frames dela.
  const laps = sliceLaps(analysisGps(asFrames(samples, T0)), []);
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  assert.equal(sessions.sessions.length, 0);
  assert.equal(layouts.layouts.length, 1);
  const layout = layouts.layouts[0];
  assert.equal(layout.name, 'Traçado invertido');
  assert.equal(layout.trackId, 'track_1');
  assert.equal(layout.durationMs, best.durationMs);
  const pts = (ps: GpsSample[]) => ps.map((p) => [p.t, p.lat, p.lng, p.speed, p.accuracy, p.synthetic]);
  assert.deepEqual(pts(layout.samples), pts(best.samples));
  assert.ok('layoutId' in r && r.layoutId === layout.id);
  assert.equal(store.active, null);
  // Nenhuma sessão é dona das séries do reconhecimento: o diário sai inteiro.
  assert.deepEqual(persistedSeries(store, id), []);
});

test('summarize: sem volta completa dá laps = 0', async () => {
  const { store, id } = await journalWith(RACE, 0);
  assert.ok(persistedGps(store, id).length > 0);
  const s = summarize(store.active!, await store.readSeries(id));
  assert.notEqual(s, 'unreadable');
  assert.equal(s !== 'unreadable' && s.laps, 0);
});

test('summarize: version 2 ou JSON quebrado dá unreadable', async () => {
  const { store, id } = await journalWith(RACE, 1);
  const read = await store.readSeries(id);
  const active = store.active!;

  const v2 = { ...active, metaJson: JSON.stringify({ ...JSON.parse(active.metaJson), version: 2 }) };
  assert.equal(summarize(v2, read), 'unreadable');

  assert.equal(summarize({ ...active, metaJson: '{"version":1,' }, read), 'unreadable');

  // O pedaço de JSON quebrado de antes (T16): um bloco com o cabeçalho corrompido.
  store.conn.db.run("UPDATE telemetry_blocks SET payload = x'0900' WHERE seq = 0");
  assert.equal(summarize(active, await store.readSeries(id)), 'unreadable');
});

test('discard: apaga o diário', async () => {
  const { store, id } = await journalWith(RACE, 2);
  await discard(id, { store });
  assert.equal(store.active, null);
  assert.deepEqual(persistedSeries(store, id), []);
});

/** Grava pelo diário os pontos dados, em pedaços de 25, como `journalWith`. */
async function journalFromSamples(meta: RecordingMetaInput, samples: GpsSample[]) {
  const store = await fakeJournalStore();
  const journal = new RecordingJournal(store, () => T0);
  const id = await journal.begin(meta);
  for (let i = 0; i < samples.length; i += 25) {
    const batch = samples.slice(i, i + 25);
    journal.appendGps(asFrames(batch, T0));
    await journal.flushIfDue(batch[batch.length - 1].t);
  }
  await journal.flush();
  return { store, id };
}

test('recover: buraco de 200 s sem pontos no meio segue a regra do detectLaps e a volta que o atravessa não entra', async () => {
  // 4 voltas de 55 s a 5 Hz, com 5 s de aquecimento (25 pontos). Da metade
  // da 3ª volta em diante, tudo chega 200 s depois: as voltas 1 e 2 vêm
  // antes do buraco, a 3ª o atravessa e a 4ª vem depois.
  const GAP_MS = 200_000;
  const base = generateLapSamples({ numLaps: 4, warmupS: 5, cooldownS: 10, startTimestamp: T0 });
  const gapIdx = 25 + Math.floor(2.5 * 275);
  const samples = base.map((p, i) => (i < gapIdx ? p : { ...p, t: p.t + GAP_MS }));
  const gapFrom = samples[gapIdx - 1].t;
  const gapTo = samples[gapIdx].t;
  assert.equal(gapTo - gapFrom, GAP_MS + 200);

  const { store, id } = await journalFromSamples(RACE, samples);
  const { d, sessions } = deps(store);
  await recover(id, d);

  // Exatamente as voltas que o detectLaps devolve para os mesmos pontos.
  const detected = detectLaps(samples).laps;
  assert.equal(sessions.sessions.length, 1);
  assert.deepEqual(
    sessions.laps.map((l) => [l.startedAt, l.durationMs]),
    detected.map((l) => [l.startedAt, l.durationMs]),
  );
  // Voltas 1, 2 e 4: a que atravessa o buraco passou de 180 s e foi descartada.
  assert.equal(sessions.laps.length, 3);
  for (const l of sessions.laps) {
    assert.ok(l.durationMs <= 180_000, `volta de ${l.durationMs} ms`);
    const crossesGap = l.startedAt <= gapFrom && l.startedAt + l.durationMs >= gapTo;
    assert.equal(crossesGap, false, `a volta que começa em ${l.startedAt} atravessa o buraco`);
  }
  assert.equal(sessions.laps.filter((l) => l.startedAt < gapFrom).length, 2);
  assert.equal(sessions.laps.filter((l) => l.startedAt > gapTo).length, 1);
  assert.equal(store.active, null);
});

// --- TMP-06: a recuperação usa a mesma linha da gravação ---

/** Traçado como o app o salva: a melhor volta, com os pontos de fronteira (AD-006). */
function layoutLine() {
  const { samples } = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, laps: 2, warmupS: 3, t0: T0 });
  const line = lineFromLayout(sliceLaps(samples, [])[0].samples);
  assert.ok(line);
  return line;
}

/** Corrida que começa já andando, na metade da pista: a linha inferida cai do outro lado. */
function midTrackRace() {
  return generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, startPhase: 0.5, laps: 4, t0: T0 }).samples;
}

test('recover: diário com meta.line recupera as voltas do detectLaps com essa linha (± 1 ms)', async () => {
  const line = layoutLine();
  const samples = midTrackRace();
  const { store, id } = await journalFromSamples({ ...RACE, line }, samples);

  const s = summarize(store.active!, await store.readSeries(id));
  const withLine = detectLaps(samples, { line }).laps;
  assert.equal(s !== 'unreadable' && s.laps, withLine.length);

  const { d, sessions } = deps(store);
  await recover(id, d);

  assert.equal(sessions.laps.length, withLine.length);
  assert.equal(sessions.laps.length, 3);
  for (const [i, l] of sessions.laps.entries()) {
    assert.ok(Math.abs(l.durationMs - withLine[i].durationMs) <= 1, `volta ${i + 1}: ${l.durationMs} × ${withLine[i].durationMs}`);
    assert.ok(Math.abs(l.startedAt - withLine[i].startedAt) <= 1, `volta ${i + 1}: início ${l.startedAt} × ${withLine[i].startedAt}`);
    // A volta começa na linha do traçado, não na inferida (240 m dali).
    assert.ok(haversine(l.samples[0], line) < 1, `volta ${i + 1} começa a ${haversine(l.samples[0], line)} m da linha`);
  }
  // Sem a linha, o mesmo diário daria outras voltas: o teste distingue.
  assert.notEqual(detectLaps(samples).laps.length, withLine.length);
});

test('recover: diário antigo sem line continua legível e recupera com a linha inferida', async () => {
  const samples = midTrackRace();
  const { store, id } = await journalFromSamples(RACE, samples);
  assert.equal('line' in JSON.parse(store.active!.metaJson), false);

  const s = summarize(store.active!, await store.readSeries(id));
  assert.notEqual(s, 'unreadable');
  const inferred = detectLaps(samples).laps;
  assert.equal(s !== 'unreadable' && s.laps, inferred.length);

  const { d, sessions } = deps(store);
  await recover(id, d);
  assert.deepEqual(
    sessions.laps.map((l) => [l.startedAt, l.durationMs]),
    inferred.map((l) => [l.startedAt, l.durationMs]),
  );
});

// ---------------------------------------------------------------------------
// T21: a recuperação lê as séries do diário e não copia frames (SQL real).
// ---------------------------------------------------------------------------

test('recover (sql.js): gravação interrompida depois de 4 blocos volta com todos os frames desses blocos e as voltas que eles fecham', async () => {
  const db = await openV5Database();
  const { samples } = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, startPhase: 0.37, laps: 5, warmupS: 3, t0: T0 });
  const frames = asFrames(samples, T0);
  const imu: ImuFrame[] = frames.map((f) => ({ kind: 'imu', source: 'PHONE', t: f.t + 5, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0.1 } }));

  // O app grava 4 blocos (a cada ~35 s) e morre com o resto ainda em memória.
  const journal = new RecordingJournal(db.store, () => T0);
  const id = await journal.begin(RACE);
  const perBlock = 350;
  for (let b = 0; b < 4; b++) {
    journal.appendGps(frames.slice(b * perBlock, (b + 1) * perBlock));
    journal.appendImu(imu.slice(b * perBlock, (b + 1) * perBlock));
    await journal.flush();
  }
  journal.appendGps(frames.slice(4 * perBlock)); // perdido no crash
  const saved = frames.slice(0, 4 * perBlock);
  assert.ok(frames.length > saved.length);

  // Processo novo: só o banco sobrou.
  const sessions = sqlSessionRepo(async () => db.conn);
  await recover(id, { store: db.store, sessions, layouts: fakeLayouts(), now: () => T0 + 999_000 });

  const sessionId = `session_${id}`;
  // Todos os frames dos 4 blocos, como estavam, e nenhum além deles.
  assert.deepEqual(persistedGps(db.store, id), saved);
  assert.equal(persistedImu(db.store, id).length, 4 * perBlock);
  // Sem cópia: as séries continuam as do diário, com os mesmos 4 blocos.
  assert.deepEqual(rowsOf(db.conn, 'SELECT owner_id, kind FROM telemetry_series ORDER BY kind'), [
    { owner_id: sessionId, kind: 'gps' },
    { owner_id: sessionId, kind: 'imu' },
  ]);
  assert.equal(rowsOf<{ c: number }>(db.conn, 'SELECT COUNT(*) AS c FROM telemetry_blocks')[0].c, 8);
  assert.equal(db.store.active, null);

  // As voltas são as que os frames gravados fecham (o oráculo: detectLaps sobre eles).
  const expected = detectLaps(saved as GpsSample[]).laps;
  assert.ok(expected.length >= 2 && expected.length < detectLaps(frames as GpsSample[]).laps.length);
  const laps = rowsOf<{ window_kind: string; start_t: number; end_t: number; duration_ms: number; started_at: number }>(
    db.conn,
    'SELECT window_kind, start_t, end_t, duration_ms, started_at FROM laps WHERE session_id = ? ORDER BY started_at',
    [sessionId],
  );
  assert.deepEqual(
    laps.map((l) => [l.window_kind, l.start_t, l.end_t, l.duration_ms, l.started_at]),
    expected.map((l) => ['cross', l.startCross.t, l.endCross.t, l.durationMs, T0 + l.startedAt]),
  );
  assert.deepEqual(rowsOf(db.conn, 'SELECT recovered, frames_version FROM sessions WHERE id = ?', [sessionId]), [
    { recovered: 1, frames_version: 5 },
  ]);
});
