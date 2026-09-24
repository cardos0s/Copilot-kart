/**
 * Salvamento da sessão: REC-05 (uma transação só), REC-03 AC 8 (sem duplicar)
 * e REC-12 AC 2 (sem traçado ou setup grava null, nunca '').
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ImuSample } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import {
  normalizeId,
  saveRecordedSession,
  sliceLaps,
  type RecordedLap,
  type RecordedSessionInput,
} from '../src/recording/finishSession';
import { fakeSessionRepo } from './helpers/fakeSessionRepo';
import { generateLapSamples } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

function fakeLaps(n: number): RecordedLap[] {
  return Array.from({ length: n }, (_, i) => ({
    samples: [{ t: T0 + i * 60_000, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4 }],
    imuSamples: [],
    durationMs: 55_000 + i,
    startedAt: T0 + i * 60_000,
  }));
}

function input(over: Partial<RecordedSessionInput> = {}): RecordedSessionInput {
  return {
    recordingId: 'rec_1_abc',
    trackName: 'Kartódromo',
    trackId: 'track_1',
    layoutId: 'layout_1',
    kartSetupId: 'setup_1',
    mode: 'race',
    startedAt: T0,
    laps: fakeLaps(4),
    ...over,
  };
}

test('saveRecordedSession: falha na 3ª volta desfaz tudo (0 sessões, 0 voltas) e o erro sobe', async () => {
  const repo = fakeSessionRepo();
  repo.failOnLap = 3;
  await assert.rejects(saveRecordedSession(input(), repo), /disk I\/O error na volta 3/);
  assert.equal(repo.sessions.length, 0);
  assert.equal(repo.laps.length, 0);
});

test('saveRecordedSession: salvar duas vezes com o mesmo recordingId deixa 1 sessão e N voltas', async () => {
  const repo = fakeSessionRepo();
  const first = await saveRecordedSession(input(), repo);
  const second = await saveRecordedSession(input(), repo);

  assert.equal(repo.sessions.length, 1);
  assert.equal(repo.sessions[0].id, 'session_rec_1_abc');
  assert.equal(repo.laps.length, 4);
  assert.ok(repo.laps.every((l) => l.sessionId === 'session_rec_1_abc'));
  assert.equal(first.session.id, 'session_rec_1_abc');
  assert.equal(second.session.id, 'session_rec_1_abc');
});

test('sliceLaps: recorta a IMU pela janela de tempo de cada volta', () => {
  const samples = generateLapSamples({
    numLaps: 3,
    warmupS: 5,
    cooldownS: 10,
    startTimestamp: T0,
  });
  const tEnd = samples[samples.length - 1].t;
  const imu: ImuSample[] = [];
  for (let t = T0; t <= tEnd; t += 20) {
    imu.push({ t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } });
  }

  const laps = sliceLaps(samples, imu);
  const detected = detectLaps(samples).laps;

  assert.equal(laps.length, 3);
  laps.forEach((lap, i) => {
    const d = detected[i];
    const end = d.startedAt + d.durationMs;
    assert.equal(lap.startedAt, d.startedAt);
    assert.equal(lap.durationMs, d.durationMs);
    assert.deepEqual(lap.samples, samples.slice(d.startIdx, d.endIdx + 1));
    // Exatamente a IMU dentro de [início, fim] da volta, nada de fora.
    assert.deepEqual(
      lap.imuSamples,
      imu.filter((s) => s.t >= d.startedAt && s.t <= end),
    );
    assert.ok(lap.imuSamples.length > 0);
    assert.ok(lap.imuSamples.every((s) => s.t >= d.startedAt && s.t <= end));
  });
});

test("saveRecordedSession: layoutId '' e kartSetupId '' são gravados como null", async () => {
  assert.equal(normalizeId(''), null);
  assert.equal(normalizeId(undefined), null);
  assert.equal(normalizeId('layout_9'), 'layout_9');

  const repo = fakeSessionRepo();
  await saveRecordedSession(input({ layoutId: '', kartSetupId: '' }), repo);
  assert.equal(repo.sessions[0].layoutId, null);
  assert.equal(repo.sessions[0].kartSetupId, null);
});

test('saveRecordedSession: recovered: true é repassado ao repositório', async () => {
  const repo = fakeSessionRepo();
  await saveRecordedSession(input({ recovered: true }), repo);
  assert.equal(repo.sessions[0].recovered, true);

  const normal = fakeSessionRepo();
  await saveRecordedSession(input(), normal);
  assert.equal(normal.sessions[0].recovered, false);
});
