/**
 * Salvamento da sessão: REC-05 (uma transação só), REC-03 AC 8 (sem duplicar)
 * e REC-12 AC 2 (sem traçado ou setup grava null, nunca '').
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GpsSample, ImuSample } from '../src/lib/geometry';
import type { GpsFrame } from '../src/telemetry/frame';
import { detectLaps } from '../src/lib/lapDetector';
import { lineFromLayout } from '../src/lib/startLine';
import {
  normalizeId,
  saveRecordedSession,
  sliceLaps,
  type RecordedLap,
  type RecordedSessionInput,
} from '../src/recording/finishSession';
import { fakeSessionRepo } from './helpers/fakeSessionRepo';
import { generateLapSamples, generateTimedLaps } from './helpers/syntheticTrack';

const T0 = 1_700_000_000_000;

/** Voltas como o `stop()` devolve desde a T19: a janela e os frames dela. */
function fakeLaps(n: number): RecordedLap[] {
  return Array.from({ length: n }, (_, i) => {
    const cross = (t: number) => ({ t, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4 });
    const gps: GpsFrame[] = [{ kind: 'gps', source: 'PHONE', t: i * 60_000, lat: -14.86, lng: -40.84, speed: 12, accuracy: 4, fix: 'unknown' }];
    return {
      window: { kind: 'cross' as const, start: cross(i * 60_000), end: cross(i * 60_000 + 55_000 + i) },
      gps,
      imu: [],
      samples: gps as GpsSample[],
      imuSamples: [],
      durationMs: 55_000 + i,
      startedAt: T0 + i * 60_000,
    };
  });
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
  // Desde a T20 a volta salva leva a janela sobre o bruto (TF-11).
  assert.deepEqual(repo.laps.map((l) => l.window), input().laps.map((l) => l.window));
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
    imu.push({ kind: 'imu', source: 'PHONE', t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } });
  }

  const laps = sliceLaps(samples, imu);
  const detected = detectLaps(samples).laps;

  assert.equal(laps.length, 3);
  laps.forEach((lap, i) => {
    const d = detected[i];
    const end = d.startedAt + d.durationMs;
    assert.equal(lap.startedAt, d.startedAt);
    assert.equal(lap.durationMs, d.durationMs);
    // Os pontos internos são os crus entre os dois cruzamentos (T3, exceção autorizada em 29/09).
    assert.deepEqual(
      lap.samples.slice(1, -1),
      samples.slice(d.startIdx, d.endIdx + 1).filter((s) => s.t > d.startCross.t && s.t < d.endCross.t),
    );
    // As duas fronteiras são sintéticas e ficam nos cruzamentos.
    const first = lap.samples[0];
    const last = lap.samples[lap.samples.length - 1];
    assert.equal(first.synthetic, true);
    assert.equal(first.t, d.startCross.t);
    assert.equal(last.synthetic, true);
    assert.equal(last.t, d.endCross.t);
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

// ---------------------------------------------------------------------------
// T3: a volta começa e termina em pontos sintéticos na linha (TMP-06, AD-006).
// ---------------------------------------------------------------------------

const LAP_MS = 37_699;

/** Linha do traçado de referência: uma volta gravada a partir da linha. */
function layoutLine() {
  const layout = generateTimedLaps({ lapDurationMs: LAP_MS, sampleRateHz: 10, laps: 1, tailS: 0 }).samples;
  const line = lineFromLayout(layout);
  assert.ok(line);
  return line;
}

function imuFor(samples: GpsSample[]): ImuSample[] {
  const imu: ImuSample[] = [];
  const tEnd = samples[samples.length - 1].t;
  for (let t = samples[0].t; t <= tEnd; t += 20) {
    imu.push({ kind: 'imu', source: 'PHONE', t, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } });
  }
  return imu;
}

/** Dois cenários: sem traçado (1ª volta abre no ponto de ritmo) e com a linha do traçado, começando andando. */
function scenarios() {
  const line = layoutLine();
  const noLine = generateTimedLaps({ lapDurationMs: LAP_MS, sampleRateHz: 10, startPhase: 0.37, laps: 4, warmupS: 3 });
  const withLine = generateTimedLaps({ lapDurationMs: LAP_MS, sampleRateHz: 5, startPhase: 0.5, laps: 4 });
  return [
    { label: 'sem traçado', samples: noLine.samples, line: undefined, expectedLaps: 4 },
    { label: 'com traçado', samples: withLine.samples, line, expectedLaps: 3 },
  ];
}

test('sliceLaps: cada volta começa e termina num ponto sintético no cruzamento, e a duração sai deles', () => {
  for (const { label, samples, line, expectedLaps } of scenarios()) {
    const laps = sliceLaps(samples, imuFor(samples), line);
    const detected = detectLaps(samples, { line }).laps;
    assert.equal(laps.length, expectedLaps, label);
    laps.forEach((lap, i) => {
      const d = detected[i];
      const first = lap.samples[0];
      const last = lap.samples[lap.samples.length - 1];
      assert.equal(first.t, d.startCross.t, `${label}: volta ${i + 1}`);
      assert.equal(first.lat, d.startCross.lat);
      assert.equal(first.lng, d.startCross.lng);
      assert.equal(first.speed, d.startCross.speed);
      assert.equal(last.t, d.endCross.t, `${label}: volta ${i + 1}`);
      assert.equal(last.lat, d.endCross.lat);
      assert.equal(last.lng, d.endCross.lng);
      assert.equal(last.speed, d.endCross.speed);
      assert.equal(first.synthetic, true);
      assert.equal(last.synthetic, true);
      assert.equal(lap.durationMs, Math.round(last.t - first.t));
      assert.equal(lap.startedAt, Math.round(first.t));
    });
  }
});

test('sliceLaps: o fim da volta N é o mesmo ponto que o início da volta N+1', () => {
  for (const { label, samples, line } of scenarios()) {
    const laps = sliceLaps(samples, [], line);
    assert.ok(laps.length >= 3, label);
    for (let i = 0; i + 1 < laps.length; i++) {
      const end = laps[i].samples[laps[i].samples.length - 1];
      const start = laps[i + 1].samples[0];
      assert.equal(end.t, start.t, `${label}: volta ${i + 1}`);
      assert.equal(end.lat, start.lat);
      assert.equal(end.lng, start.lng);
    }
  }
});

test('sliceLaps: nenhum ponto interno fica fora de (startCross.t, endCross.t), e nenhum é sintético', () => {
  for (const { label, samples, line } of scenarios()) {
    for (const lap of sliceLaps(samples, [], line)) {
      const t0 = lap.samples[0].t;
      const t1 = lap.samples[lap.samples.length - 1].t;
      const inner = lap.samples.slice(1, -1);
      assert.ok(inner.length > 0, label);
      for (const s of inner) {
        assert.ok(s.t > t0 && s.t < t1, `${label}: ponto em ${s.t} fora de (${t0}, ${t1})`);
        assert.equal(s.synthetic, undefined);
      }
    }
  }
});

test('sliceLaps: a IMU da volta fica toda dentro de [startCross.t, endCross.t]', () => {
  for (const { label, samples, line } of scenarios()) {
    const imu = imuFor(samples);
    for (const lap of sliceLaps(samples, imu, line)) {
      const t0 = lap.samples[0].t;
      const t1 = lap.samples[lap.samples.length - 1].t;
      assert.ok(lap.imuSamples.length > 0, label);
      assert.deepEqual(
        lap.imuSamples,
        imu.filter((s) => s.t >= t0 && s.t <= t1),
        label,
      );
    }
  }
});
