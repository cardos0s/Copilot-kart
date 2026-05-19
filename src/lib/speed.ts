/**
 * Helpers de velocidade.
 *
 * Trabalha em m/s (unidade interna do GPS sample) e expõe utilitários de
 * conversão pra km/h, picos por volta/sessão/setor.
 */

import { GpsSample } from './geometry';
import { LapRecord, MatchedLap } from './analysis';

export function msToKmh(speedMs: number): number {
  return speedMs * 3.6;
}

/** Pico de velocidade em m/s nos samples (0 se vazio). */
export function peakSpeedMs(samples: GpsSample[]): number {
  let max = 0;
  for (const s of samples) {
    if (s.speed > max) max = s.speed;
  }
  return max;
}

/** Pico em km/h direto. */
export function peakSpeedKmh(samples: GpsSample[]): number {
  return msToKmh(peakSpeedMs(samples));
}

/** Pico entre todas as voltas (m/s). */
export function peakSpeedMsOfLaps(laps: LapRecord[]): number {
  let max = 0;
  for (const lap of laps) {
    const p = peakSpeedMs(lap.samples);
    if (p > max) max = p;
  }
  return max;
}

/**
 * Pico de velocidade dentro de um setor (range de s — distância na pista).
 * Usa os pontos matched (que já têm s computado).
 */
export function peakSpeedInSectorMs(
  matched: MatchedLap,
  sStart: number,
  sEnd: number
): number {
  let max = 0;
  for (const p of matched.points) {
    if (p.s >= sStart && p.s <= sEnd && p.speed > max) max = p.speed;
  }
  return max;
}
