/**
 * Captura da IMU (T15): TF-05 (o frame usa o relógio do sensor no relógio da
 * sessão), a conversão de g para m/s² e o edge "par incompleto".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createImuCapture } from '../src/recording/imuCapture';
import { createSessionClock } from '../src/recording/sessionClock';
import type { ImuFrame } from '../src/telemetry/frame';

const T0_UTC = 1_790_000_000_000;
/** O sensor conta desde o boot: sensor 3600 s ↔ aparelho em T0_UTC. */
const BOOT_S = 3600;

function setup() {
  const frames: ImuFrame[] = [];
  let now = T0_UTC;
  const clock = createSessionClock(T0_UTC);
  const cap = createImuCapture(clock, (f) => frames.push(f), () => now);
  /** Leitura que chega `atMs` depois de T0_UTC, medida pelo sensor no mesmo instante. */
  const at = (atMs: number) => {
    now = T0_UTC + atMs;
    return BOOT_S + atMs / 1000;
  };
  return { frames, cap, at };
}

test('imuCapture: accel (1 g em z) e gyro com 3 ms de diferença dão um frame com accel.z = 9.80665 e o t do gyro', () => {
  const { frames, cap, at } = setup();
  cap.onAccel({ x: 0, y: 0, z: 1, timestamp: at(100) });
  assert.equal(frames.length, 0, 'meio par não sai');
  cap.onGyro({ x: 0.1, y: 0.2, z: 0.3, timestamp: at(103) });

  assert.deepEqual(frames, [
    { kind: 'imu', source: 'PHONE', t: 103, accel: { x: 0, y: 0, z: 9.80665 }, gyro: { x: 0.1, y: 0.2, z: 0.3 } },
  ]);
});

test('imuCapture: accel, accel e depois gyro dão um frame só com accel e depois um frame completo', () => {
  const { frames, cap, at } = setup();
  cap.onAccel({ x: 1, y: 0, z: 0, timestamp: at(100) });
  cap.onAccel({ x: 2, y: 0, z: 0, timestamp: at(120) });
  cap.onGyro({ x: 0, y: 0, z: 0.5, timestamp: at(124) });

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { kind: 'imu', source: 'PHONE', t: 100, accel: { x: 9.80665, y: 0, z: 0 } });
  assert.equal('gyro' in frames[0], false);
  assert.deepEqual(frames[1], {
    kind: 'imu',
    source: 'PHONE',
    t: 124,
    accel: { x: 2 * 9.80665, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z: 0.5 },
  });
});

test('imuCapture: a leitura sem par no fim da gravação sai sozinha, com o canal ausente', () => {
  const { frames, cap, at } = setup();
  cap.onGyro({ x: 0, y: 0, z: 1, timestamp: at(200) });
  cap.flush();
  assert.deepEqual(frames, [{ kind: 'imu', source: 'PHONE', t: 200, gyro: { x: 0, y: 0, z: 1 } }]);
  cap.flush();
  assert.equal(frames.length, 1, 'nada pendente, nada sai');
});
