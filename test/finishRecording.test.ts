/**
 * "Encerrar": REC-05 AC 2 (falha ao salvar mantém o diário, sem efeitos) e
 * REC-01 AC 9 (sucesso encerra o diário, só depois do commit). Desde a T20 a
 * volta é salva como janela sobre as séries da sessão (TF-07, TF-11), e a
 * gravação com menos de 30 pontos de GPS sai inteira (edge ajustado em 07/10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine, type GpsSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { lineFromLayout } from '../src/lib/startLine';
import { sliceLaps, type RecordedSessionRow } from '../src/recording/finishSession';
import { sqlSessionRepo } from '../src/storage/sqlSessionRepo';
import type { ImuFrame } from '../src/telemetry/frame';
import { analysisGps } from '../src/telemetry/laps';
import {
  finishRecording,
  type FinishRecordingDeps,
  type FinishRecordingMeta,
} from '../src/recording/finishRecording';
import { RecordingJournal } from '../src/recording/journal';
import { asFrames, fakeJournalStore, persistedGps, persistedImu, totalBlocks } from './helpers/fakeJournalStore';
import { fakeSessionRepo } from './helpers/fakeSessionRepo';
import { stopResult } from './helpers/recordingResult';
import { openV5Database, rowsOf } from './helpers/v5Database';
import { generateLapSamples, generateTimedLaps } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

/** Grava pelo diário, como no app, e devolve o que o `stop()` devolveria. */
async function recorded(samples: GpsSample[]) {
  const store = await fakeJournalStore();
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
    journal.appendGps(asFrames(batch, T0));
    await journal.flushIfDue(batch[batch.length - 1].t);
  }
  await journal.flush();

  const repo = fakeSessionRepo();
  const events: string[] = [];
  const endCalls: string[] = [];
  const discardCalls: string[] = [];
  const postSaveCalls: { session: RecordedSessionRow; lapIds: string[] }[] = [];
  const deps: FinishRecordingDeps = {
    journal: {
      end: async (id) => {
        endCalls.push(id);
        events.push(`end(sessões gravadas: ${repo.sessions.length})`);
        await journal.end(id);
      },
      discard: async (id) => {
        discardCalls.push(id);
        await journal.discard(id);
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
  // O que o `stop()` do hook devolve desde a T19: frames, janelas e voltas.
  const result = stopResult(asFrames(samples, T0), [], T0);
  return { store, journal, recordingId, repo, deps, meta, result, events, endCalls, discardCalls, postSaveCalls };
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
  // Desde a T16 o `end` mantém as séries (são a sessão); sem sessão, o diário sai
  // pelo `discard`, que apaga o registro e as séries (substitui "endCalls = [id]").
  assert.deepEqual(r.discardCalls, [r.recordingId]);
  assert.deepEqual(r.endCalls, []);
  assert.equal(r.store.active, null);
  assert.equal(totalBlocks(r.store), 0);
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
  // O diário só é encerrado com a sessão já no banco, e os efeitos vêm depois.
  assert.deepEqual(r.events, ['end(sessões gravadas: 1)', 'postSave']);
  assert.equal(r.store.active, null);
  // Desde a T16 o `end` apaga só o registro ativo: os blocos ficam como o bruto
  // da sessão (TF-07). Substitui "nenhum pedaço sobra".
  assert.equal(persistedGps(r.store, r.recordingId).length, r.result.allSamples.length);
  assert.equal(r.postSaveCalls[0].session.id, id);
  assert.deepEqual(r.postSaveCalls[0].lapIds, r.repo.laps.map((l) => l.id));
});

test('finishRecording: com meta.line no diário, salva voltas que começam no cruzamento da linha do traçado', async () => {
  // Traçado salvo (melhor volta com pontos de fronteira) e uma corrida que
  // começa andando na metade da pista: a linha inferida ficaria a 240 m.
  const layout = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, laps: 2, warmupS: 3, t0: T0 }).samples;
  const line = lineFromLayout(sliceLaps(layout, [])[0].samples);
  assert.ok(line);
  const samples = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, startPhase: 0.5, laps: 4, t0: T0 }).samples;

  const store = await fakeJournalStore();
  const journal = new RecordingJournal(store, () => T0);
  const recordingId = await journal.begin({
    mode: 'race',
    trackId: 'track_1',
    trackName: 'Kartódromo',
    layoutId: 'layout_1',
    layoutName: null,
    kartSetupId: 'setup_1',
    line,
  });
  journal.appendGps(asFrames(samples, T0));
  await journal.flush();
  // A linha que o "Encerrar" usa é a da meta gravada no diário.
  const metaLine = JSON.parse(store.active!.metaJson).line;
  assert.deepEqual(metaLine, line);

  const repo = fakeSessionRepo();
  const frames = asFrames(samples, T0);
  const out = await finishRecording(
    // O que o `stop()` do hook devolve: as voltas recortadas com a linha da meta.
    stopResult(frames, [], T0, metaLine),
    { recordingId, trackName: 'Kartódromo', trackId: 'track_1', layoutId: 'layout_1', kartSetupId: 'setup_1', mode: 'race', startedAt: T0 },
    { journal, repo, postSave: async () => {} },
  );

  assert.equal(out.kind, 'saved');
  // O oráculo no mesmo relógio dos frames (t desde o início da sessão).
  const detected = detectLaps(analysisGps(frames), { line }).laps;
  assert.equal(repo.laps.length, 3);
  assert.equal(repo.laps.length, detected.length);
  for (const [i, l] of repo.laps.entries()) {
    const first = l.samples[0];
    assert.equal(first.synthetic, true);
    assert.equal(first.t, detected[i].startCross.t);
    assert.ok(haversine(first, line) < 1, `volta ${i + 1} começa a ${haversine(first, line)} m da linha`);
  }
});

// ---------------------------------------------------------------------------
// T20: a sessão salva aponta para as séries do diário (SQL real, sql.js).
// ---------------------------------------------------------------------------

/** Grava pelo diário GPS e IMU (50 Hz), em blocos de 5 s, sobre o banco do app. */
async function recordedOnDb(samples: GpsSample[], imuMs: number) {
  const db = await openV5Database();
  const journal = new RecordingJournal(db.store, () => T0);
  const recordingId = await journal.begin({
    mode: 'race',
    trackId: 'track_1',
    trackName: 'Kartódromo',
    layoutId: null,
    layoutName: null,
    kartSetupId: null,
  });
  const gps = asFrames(samples, T0);
  const imu: ImuFrame[] = [];
  for (let t = 0; t < imuMs; t += 20) imu.push({ kind: 'imu', source: 'PHONE', t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: t / 1e5 } });
  const end = Math.max(gps.length ? gps[gps.length - 1].t : 0, imuMs);
  for (let at = 0, gi = 0, ii = 0; at <= end + 500; at += 500) {
    while (gi < gps.length && gps[gi].t <= at) journal.appendGps([gps[gi++]]);
    while (ii < imu.length && imu[ii].t <= at) journal.appendImu([imu[ii++]]);
    await journal.flushIfDue(T0 + at);
  }
  await journal.flush();
  const meta: FinishRecordingMeta = {
    recordingId,
    trackName: 'Kartódromo',
    trackId: 'track_1',
    layoutId: null,
    kartSetupId: null,
    mode: 'race',
    startedAt: T0 + end,
  };
  const deps: FinishRecordingDeps = { journal, repo: sqlSessionRepo(async () => db.conn), postSave: async () => {} };
  return { ...db, journal, recordingId, gps, imu, meta, deps, result: stopResult(gps, imu, T0) };
}

type LapRow = {
  id: string;
  started_at: number;
  duration_ms: number;
  samples_json: string;
  imu_samples_json: string | null;
  window_kind: string;
  start_t: number;
  start_lat: number;
  start_lng: number;
  start_speed: number;
  start_acc: number;
  end_t: number;
  end_lat: number;
  end_lng: number;
  end_speed: number;
  end_acc: number;
};

test('finishRecording (sql.js): 3 voltas salvam 3 linhas em laps com start_*/end_*, e as séries ficam com todos os frames, paddock e box inclusive', async () => {
  // 5 s parado no paddock antes, 10 s no box depois.
  const r = await recordedOnDb(track(3), 0);
  const gpsBefore = persistedGps(r.store, r.recordingId);
  assert.equal(gpsBefore.length, r.gps.length);
  const windows = r.result.windows;
  assert.equal(windows.length, 3);

  const out = await finishRecording(r.result, r.meta, r.deps);
  assert.equal(out.kind, 'saved');

  const id = `session_${r.recordingId}`;
  const laps = rowsOf<LapRow>(r.conn, 'SELECT * FROM laps WHERE session_id = ? ORDER BY started_at', [id]);
  assert.equal(laps.length, 3);
  laps.forEach((row, i) => {
    const { start, end } = windows[i].window;
    assert.equal(row.window_kind, 'cross');
    assert.deepEqual(
      [row.start_t, row.start_lat, row.start_lng, row.start_speed, row.start_acc],
      [start.t, start.lat, start.lng, start.speed, start.accuracy],
    );
    assert.deepEqual([row.end_t, row.end_lat, row.end_lng, row.end_speed, row.end_acc], [end.t, end.lat, end.lng, end.speed, end.accuracy]);
    assert.equal(row.duration_ms, windows[i].durationMs);
    assert.equal(row.started_at, T0 + windows[i].startT);
    // Sem JSON de amostra: o bruto está nas séries.
    assert.equal(row.samples_json, '[]');
    assert.equal(row.imu_samples_json, null);
  });
  assert.deepEqual(rowsOf(r.conn, 'SELECT frames_version FROM sessions WHERE id = ?', [id]), [{ frames_version: 5 }]);

  // Os frames das séries são os mesmos de antes do "Encerrar", do paddock ao box.
  const gpsAfter = persistedGps(r.store, r.recordingId);
  assert.deepEqual(gpsAfter, gpsBefore);
  assert.equal(gpsAfter[0].t, 0);
  assert.ok(gpsAfter[0].t < windows[0].window.start.t, 'o paddock fica');
  assert.ok(gpsAfter[gpsAfter.length - 1].t > windows[2].window.end.t, 'o box fica');
  assert.equal(r.store.active, null);
});

/** Linhas que sobram das séries no banco inteiro. */
function seriesRows(conn: Awaited<ReturnType<typeof openV5Database>>['conn']) {
  return [
    rowsOf<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM telemetry_series')[0].c,
    rowsOf<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM telemetry_blocks')[0].c,
  ];
}

test('finishRecording (sql.js): só IMU e nenhuma fix, ou 29 pontos de GPS, terminam sem sessão e sem séries; 30 pontos salvam a sessão', async () => {
  const imuOnly = await recordedOnDb([], 12_000);
  assert.equal(persistedImu(imuOnly.store, imuOnly.recordingId).length, 600);
  assert.deepEqual(await finishRecording(imuOnly.result, imuOnly.meta, imuOnly.deps), { kind: 'too-few' });
  assert.deepEqual(rowsOf(imuOnly.conn, 'SELECT id FROM sessions'), []);
  assert.deepEqual(seriesRows(imuOnly.conn), [0, 0]);
  assert.equal(imuOnly.store.active, null);

  const few = await recordedOnDb(track(1).slice(0, 29), 3_000);
  assert.deepEqual(await finishRecording(few.result, few.meta, few.deps), { kind: 'too-few' });
  assert.deepEqual(rowsOf(few.conn, 'SELECT id FROM sessions'), []);
  assert.deepEqual(seriesRows(few.conn), [0, 0]);

  const enough = await recordedOnDb(track(1).slice(0, 30), 3_000);
  const out = await finishRecording(enough.result, enough.meta, enough.deps);
  assert.equal(out.kind, 'saved');
  assert.deepEqual(rowsOf(enough.conn, 'SELECT id FROM sessions'), [{ id: `session_${enough.recordingId}` }]);
  assert.equal(persistedGps(enough.store, enough.recordingId).length, 30);
});
