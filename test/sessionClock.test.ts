/**
 * Relógio da sessão (T13): TF-05 (IMU no relógio do GPS) e TF-06 (`t`
 * estritamente crescente por série, inclusive com o relógio do aparelho voltando).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionClock } from '../src/recording/sessionClock';

test('sessionClock: a IMU usa o espaçamento do sensor, e não o do relógio do aparelho', () => {
  const clock = createSessionClock(1000);
  // 1º evento: sensor em 5,000 s chegando com o aparelho em 6020 → offset = 1020.
  assert.equal(clock.imuT(5.0, 6020), 5020);
  // 2º evento: 20 ms de sensor depois, mas o aparelho andou 80 ms. Vale o sensor.
  assert.equal(clock.imuT(5.02, 6100), 5040);
});

test('sessionClock: GPS e IMU com o mesmo instante absoluto dão o mesmo t', () => {
  const t0Utc = 1_790_000_000_000;
  const clock = createSessionClock(t0Utc);
  // O sensor conta desde o boot: 3600 s de sensor = t0Utc + 500 no aparelho.
  const imu = clock.imuT(3600, t0Utc + 500);
  const gps = clock.gpsT(t0Utc + 500);
  assert.equal(imu, 500);
  assert.equal(gps, 500);
  // E continuam juntos: 1,2 s depois nos dois relógios.
  assert.equal(clock.imuT(3601.2, t0Utc + 1700), 1700);
  assert.equal(clock.gpsT(t0Utc + 1700), 1700);
});

test('sessionClock: o relógio do aparelho voltando 1 h não faz t decrescer em nenhuma série', () => {
  const t0Utc = 1_790_000_000_000;
  const HOUR = 3_600_000;
  const clock = createSessionClock(t0Utc);

  const imu = [clock.imuT(100.0, t0Utc + 10), clock.imuT(100.02, t0Utc + 30)];
  // Ajuste de hora: o aparelho volta 1 h. O sensor segue andando.
  imu.push(clock.imuT(100.04, t0Utc + 50 - HOUR), clock.imuT(100.06, t0Utc + 70 - HOUR));
  assert.deepEqual(imu, [10, 30, 50, 70]);

  // O GPS sem relógio confiável usa o horário de chegada: depois do ajuste ele volta 1 h.
  const gps = [clock.gpsT(t0Utc + 100), clock.gpsT(t0Utc + 200), clock.gpsT(t0Utc + 300 - HOUR), clock.gpsT(t0Utc + 400 - HOUR)];
  assert.deepEqual(gps, [100, 200, 201, 202]);

  for (const ts of [imu, gps]) {
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], `t[${i}] = ${ts[i]} não passa de ${ts[i - 1]}`);
  }
});
