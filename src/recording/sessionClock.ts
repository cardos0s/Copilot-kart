/**
 * Relógio da sessão (TF-05, TF-06): `t` em ms desde `t0Utc`, o instante UTC do
 * início da gravação (o `startedAt` do `journal.begin`). GPS e IMU do celular
 * usam este mesmo relógio, e cada série tem `t` estritamente crescente.
 *
 * - GPS: `t = tempo resolvido da fix − t0Utc`.
 * - IMU: o `offset` entre o relógio do sensor (conta desde o boot e só anda
 *   para frente) e o relógio do aparelho é fixado no primeiro evento. Daí em
 *   diante, `t = sensor·1000 + offset − t0Utc`: o espaçamento é o do sensor, e
 *   um ajuste do relógio do aparelho não mexe em `t`.
 *
 * Toda série aplica `max(t, lastT + 1)`, a regra que o `locationHandler` já
 * usava. O `lastT` começa em −∞: uma fix com horário anterior ao início fica
 * com o `t` negativo que tem, sem ser empurrada.
 */

export type SessionClock = {
  readonly t0Utc: number;
  /** `t` de uma fix de GPS, a partir do tempo resolvido em epoch ms. */
  gpsT(resolvedEpochMs: number): number;
  /** `t` de uma leitura da IMU: `timestamp` do sensor em s e o relógio do aparelho na chegada. */
  imuT(sensorSeconds: number, nowMs: number): number;
};

export function createSessionClock(t0Utc: number): SessionClock {
  let lastGps = -Infinity;
  let lastImu = -Infinity;
  let offset: number | null = null;
  return {
    t0Utc,
    gpsT(resolvedEpochMs) {
      lastGps = Math.max(resolvedEpochMs - t0Utc, lastGps + 1);
      return lastGps;
    },
    imuT(sensorSeconds, nowMs) {
      const sensorMs = sensorSeconds * 1000;
      offset ??= nowMs - sensorMs;
      lastImu = Math.max(sensorMs + offset - t0Utc, lastImu + 1);
      return lastImu;
    },
  };
}
