/**
 * Faixa da cor por velocidade do mapa da sessão: os percentis 5 e 95 das
 * velocidades da volta, para que um ponto fora da curva não achate a escala.
 */
import type { GpsSample } from './geometry';

/** Percentil (clamp 0..1) sem mutar o array. */
function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export function speedColorRange(samples: GpsSample[]): { minS: number; maxS: number } {
  const speeds = samples.map((p) => p.speed);
  return { minS: percentile(speeds, 0.05), maxS: percentile(speeds, 0.95) };
}
