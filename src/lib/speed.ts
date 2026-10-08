/**
 * Helpers de velocidade.
 *
 * Trabalha em m/s (unidade interna do GPS sample) e expõe utilitários de
 * conversão pra km/h, picos por volta/sessão/setor.
 */

import type { GpsFrame } from '../telemetry/frame';
import { LapRecord, MatchedLap } from './analysis';

export function msToKmh(speedMs: number): number {
  return speedMs * 3.6;
}

/** Só pontos com precisão de até 10 m entram no pico. */
const PEAK_MAX_ACCURACY_M = 10;

/**
 * Pico de velocidade em m/s: percentil 99 (nearest-rank) da velocidade dos
 * pontos com precisão de até 10 m. Um ponto fora da curva em ~500 por volta
 * não chega ao p99. Sem nenhum ponto bom, `null` (a interface mostra "—").
 */
export function peakSpeedMs(samples: GpsFrame[]): number | null {
  const speeds = samples
    .filter((s) => s.accuracy !== undefined && s.accuracy <= PEAK_MAX_ACCURACY_M)
    .map((s) => s.speed)
    .sort((a, b) => a - b);
  if (speeds.length === 0) return null;
  return speeds[Math.ceil(0.99 * speeds.length) - 1];
}

/** Pico em km/h direto. */
export function peakSpeedKmh(samples: GpsFrame[]): number | null {
  const p = peakSpeedMs(samples);
  return p === null ? null : msToKmh(p);
}

/** Maior pico entre as voltas (m/s), com a mesma regra; `null` se nenhuma tem ponto bom. */
export function peakSpeedMsOfLaps(laps: LapRecord[]): number | null {
  let max: number | null = null;
  for (const lap of laps) {
    const p = peakSpeedMs(lap.gps);
    if (p !== null && (max === null || p > max)) max = p;
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
