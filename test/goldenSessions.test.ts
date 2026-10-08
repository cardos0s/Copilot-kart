/**
 * Sessões de referência (TF-14, T4): a sessão 1 tem paddock, volta de saída,
 * 6 voltas e box, fixes acima de 30 m e um trecho de timestamp quantizado; e
 * todas as entradas saem iguais a cada geração.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine } from '../src/lib/geometry';
import { detectLaps } from '../src/lib/lapDetector';
import { handleLocations } from '../src/recording/locationHandler';
import { createSessionClock } from '../src/recording/sessionClock';
import type { GpsFrame } from '../src/telemetry/frame';
import { analysisGps } from '../src/telemetry/laps';
import { session1, session2, session3, session4, type LocationBatch } from './golden/sessions';

/**
 * Passa os lotes pela tarefa de localização, sem diário. Desde a T14 ela emite
 * frames no relógio da sessão e sem o corte de 30 m; aqui eles voltam ao tempo
 * absoluto e ao corte de 30 m, que é o que as fases da sessão descrevem.
 */
async function capture(batches: LocationBatch[]): Promise<GpsFrame[]> {
  const t0Utc = batches[0].arrivalAt;
  const buf = { gps: [] as GpsFrame[] };
  const clock = { trustsRaw: false, session: createSessionClock(t0Utc) };
  for (const b of batches) {
    await handleLocations(b.locations, {
      buf,
      journal: null,
      uiActive: true,
      stopLocationUpdates: async () => {},
      now: () => b.arrivalAt,
      clock,
    });
  }
  return analysisGps(buf.gps).map((f) => ({ ...f, t: t0Utc + f.t }));
}

test('sessão 1: paddock, volta de saída, 6 voltas e box; detectLaps fecha exatamente 6 voltas', async () => {
  const s = session1();
  const samples = await capture(s.batches);
  const result = detectLaps(samples);

  assert.equal(result.laps.length, 6);

  // Paddock: os 20 s iniciais parados (nenhum fix acima de 1 m/s).
  const paddock = samples.filter((p) => p.t < s.phases.paddockEnd);
  assert.ok(paddock.length >= 150, `paddock com ${paddock.length} pontos`);
  assert.ok(paddock.every((p) => p.speed < 1));

  // Volta de saída: o ritmo começa antes da espera na fila, e nenhuma volta
  // fechada começa antes do fim da espera (a de saída passou de 180 s).
  assert.ok(samples[result.movingStartIdx].t < s.phases.queueStart);
  assert.ok(result.laps[0].startedAt > s.phases.queueEnd);
  for (const lap of result.laps) assert.ok(lap.durationMs >= 25_000 && lap.durationMs <= 60_000, `${lap.durationMs} ms`);

  // Box: depois da última volta o kart para longe da linha e fica parado.
  const box = samples.filter((p) => p.t >= s.phases.boxStart);
  assert.ok(box.length >= 100, `box com ${box.length} pontos`);
  assert.ok(box.every((p) => p.speed < 1));
  assert.ok(haversine(s.boxPoint, result.startFinishLine!) > 30);
  assert.ok(result.laps[5].startedAt + result.laps[5].durationMs < s.phases.boxStart);

  // IMU a 50 Hz: um evento de acelerômetro e um de giroscópio a cada 20 ms.
  const accel = s.imuEvents.filter((e) => e.kind === 'accel');
  const gyro = s.imuEvents.filter((e) => e.kind === 'gyro');
  assert.equal(accel.length, gyro.length);
  assert.equal(accel[1].at - accel[0].at, 20);
});

test('sessão 1: pelo menos 5 fixes acima de 30 m e um trecho de 20 fixes com timestamp % 1000 === 0', () => {
  const fixes = session1().batches.flatMap((b) => b.locations);
  const above30 = fixes.filter((f) => (f.coords.accuracy ?? 999) > 30);
  assert.ok(above30.length >= 5, `${above30.length} fixes acima de 30 m`);

  let run = 0;
  let longest = 0;
  for (const f of fixes) {
    run = f.timestamp % 1000 === 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  assert.ok(longest >= 20, `maior trecho quantizado: ${longest}`);
});

test('sessões de referência: duas gerações dão entradas idênticas', () => {
  assert.deepEqual(session1(), session1());
  assert.deepEqual(session2(), session2());
  assert.deepEqual(session3(), session3());
  assert.deepEqual(session4(), session4());
});
