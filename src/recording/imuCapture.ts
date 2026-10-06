/**
 * Captura da IMU (TF-05; edge "par incompleto"), fora do hook e sem nada nativo.
 *
 * O expo-sensors entrega acelerômetro e giroscópio em callbacks separados. Cada
 * leitura recebe o `t` do relógio da sessão na chegada, pelo `timestamp` do
 * sensor (`clock.imuT`), e as duas formam um frame:
 * - o frame sai quando as duas chegaram, com o `t` da mais recente;
 * - se o mesmo sensor chega duas vezes antes de o par fechar, a leitura
 *   anterior sai sozinha, num frame só com ela;
 * - o acelerômetro chega em g e sai em m/s² (× `G`); o giroscópio já é rad/s.
 */
import { G, type ImuFrame, type Source, type Vec3 } from '../telemetry/frame';
import type { SessionClock } from './sessionClock';

/** Uma leitura do expo-sensors: os três eixos e o `timestamp` do sensor, em segundos. */
export type SensorReading = Vec3 & { timestamp: number };

export type ImuCapture = {
  onAccel(reading: SensorReading): void;
  onGyro(reading: SensorReading): void;
  /** Emite a leitura que ficou sem par (fim da gravação). */
  flush(): void;
};

type Pending = { v: Vec3; t: number } | null;

export function createImuCapture(
  clock: SessionClock,
  emit: (frame: ImuFrame) => void,
  now: () => number = Date.now,
  source: Source = 'PHONE'
): ImuCapture {
  let accel: Pending = null;
  let gyro: Pending = null;

  function flush(): void {
    if (accel && gyro) {
      emit({ kind: 'imu', source, t: Math.max(accel.t, gyro.t), accel: accel.v, gyro: gyro.v });
    } else if (accel) {
      emit({ kind: 'imu', source, t: accel.t, accel: accel.v });
    } else if (gyro) {
      emit({ kind: 'imu', source, t: gyro.t, gyro: gyro.v });
    }
    accel = null;
    gyro = null;
  }

  return {
    onAccel({ x, y, z, timestamp }) {
      const t = clock.imuT(timestamp, now());
      if (accel) flush(); // o mesmo sensor de novo: a leitura anterior sai sozinha
      accel = { v: { x: x * G, y: y * G, z: z * G }, t };
      if (gyro) flush();
    },
    onGyro({ x, y, z, timestamp }) {
      const t = clock.imuT(timestamp, now());
      if (gyro) flush();
      gyro = { v: { x, y, z }, t };
      if (accel) flush();
    },
    flush,
  };
}
