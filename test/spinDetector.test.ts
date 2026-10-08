/**
 * Detector de trompo sobre frames (TF-13, TF-14, T30; edge "par incompleto").
 *
 * A sessão de referência 1 tem um trompo simulado na volta 4: o giroscópio sobe
 * a 5,5 rad/s por 800 ms, com o kart a 4 m/s num ponto conhecido da pista. Com a
 * IMU e o GPS no mesmo relógio da sessão, o trompo que a IMU acha cai no instante
 * simulado, e o GPS desse instante põe o kart no ponto e na velocidade do trompo.
 *
 * Nota de precisão: o GPS sozinho (`detectSpinsFromGps`) não vê este trompo, porque
 * o rumo simulado é o da trajetória e não gira. "Pelo GPS" aqui é a posição e a
 * velocidade que os frames de GPS dão no instante achado pela IMU.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine } from '../src/lib/geometry';
import { detectSpins, detectSpinsFromImu } from '../src/lib/spinDetector';
import { createImuCapture } from '../src/recording/imuCapture';
import { handleLocations } from '../src/recording/locationHandler';
import { createSessionClock } from '../src/recording/sessionClock';
import type { GpsFrame, ImuFrame, SeriesMeta } from '../src/telemetry/frame';
import { lapFrames, sliceLapWindows } from '../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../src/telemetry/series';
import { session1, session1Spin, T0 } from './golden/sessions';

/** As voltas da sessão 1 pela captura e pelas janelas do app, no relógio da sessão. */
async function session1Laps(): Promise<Array<{ gps: GpsFrame[]; imu: ImuFrame[] }>> {
  const s1 = session1();
  const buf = { samples: [] as GpsFrame[] };
  const clock = { trustsRaw: false, session: createSessionClock(s1.t0) };
  for (const b of s1.batches) {
    await handleLocations(b.locations, {
      buf,
      journal: null,
      uiActive: true,
      stopLocationUpdates: async () => {},
      now: () => b.arrivalAt,
      clock,
    });
  }
  const imu: ImuFrame[] = [];
  let now = s1.t0;
  const cap = createImuCapture(createSessionClock(s1.t0), (f) => imu.push(f), () => now);
  const bootAt = T0 - 3_600_000;
  for (const e of s1.imuEvents) {
    now = e.at;
    const reading = { x: e.x, y: e.y, z: e.z, timestamp: (e.at - bootAt) / 1000 };
    if (e.kind === 'accel') cap.onAccel(reading);
    else cap.onGyro(reading);
  }
  cap.flush();
  const meta = (kind: 'gps' | 'imu'): SeriesMeta => ({
    id: `s1_${kind}`,
    owner: { kind: 'session', id: 's1' },
    source: 'PHONE',
    kind,
    t0Utc: s1.t0,
    legacy: false,
  });
  const gps = gpsSeriesOf(meta('gps'), buf.samples);
  const imuSeries = imuSeriesOf(meta('imu'), imu);
  return sliceLapWindows(buf.samples, null).map((w) => lapFrames(w.window, gps, imuSeries));
}

test('detectSpins: o trompo da sessão 1 sai pela IMU no instante simulado, e o GPS desse instante põe o kart no ponto e a 4 m/s', async () => {
  const laps = await session1Laps();
  const spin = session1Spin();
  const start = spin.startAt - T0; // no relógio da sessão

  const events = laps.map((l) => detectSpins(l.gps, l.imu));
  // Só a volta 4 tem trompo, e só um.
  assert.deepEqual(events.map((e) => e.length), [0, 0, 0, 1, 0, 0]);
  const ev = events[3][0];
  assert.equal(ev.source, 'imu');
  // O instante da IMU (relógio da sessão): o giro passa de 90°/s logo depois de começar e cai no fim.
  assert.ok(Math.abs(ev.startT - start) <= 50, `início ${ev.startT}, simulado ${start}`);
  assert.ok(Math.abs(ev.endT - (start + spin.durationMs)) <= 50, `fim ${ev.endT}, simulado ${start + spin.durationMs}`);
  // O GPS do mesmo instante: o ponto do trompo e a velocidade em que o kart está nele.
  assert.ok(haversine(ev, spin.point) <= 3, `a ${haversine(ev, spin.point).toFixed(2)} m do ponto do trompo`);
  assert.ok(Math.abs(ev.meanSpeedMs - spin.speedMs) <= 0.25, `velocidade média ${ev.meanSpeedMs} m/s`);
});

test('detectSpins: frames de IMU só com accel (par incompleto) não geram trompo nem erro', async () => {
  const lap = (await session1Laps())[3];
  const accelOnly: ImuFrame[] = lap.imu.map(({ gyro: _gyro, ...f }) => f);
  assert.ok(accelOnly.length >= 10 && accelOnly.every((f) => f.accel && !f.gyro));

  assert.deepEqual(detectSpinsFromImu(accelOnly, lap.gps), []);
  // Sem giroscópio, a detecção cai para o GPS, que não vê este trompo (o rumo não gira).
  assert.deepEqual(detectSpins(lap.gps, accelOnly), []);
});
