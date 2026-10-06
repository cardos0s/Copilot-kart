/**
 * Velocidade mínima por curva (mapa detalhado da volta): o menor `speed` dos
 * pontos casados que caem dentro da curva, em km/h, e a diferença para a curva
 * de mínima mais alta. Curva sem ponto vale 0 km/h.
 */
import type { MatchedLap } from './analysis';
import type { Corner } from './corners';
import { msToKmh } from './speed';

export type CornerSpeed = {
  /** Número da curva, a partir de 1. */
  index: number;
  minKmh: number;
  /** `minKmh` menos a maior mínima entre as curvas (0 ou negativo). */
  deltaVsBest: number;
};

export function minSpeedPerCorner(corners: Corner[], matched: MatchedLap): CornerSpeed[] {
  const cornerSpeeds = corners.map((c) => {
    let minMs = Infinity;
    for (const p of matched.points) {
      if (p.s >= c.sStart && p.s <= c.sEnd) {
        if (p.speed < minMs) minMs = p.speed;
      }
    }
    const minKmh = msToKmh(Number.isFinite(minMs) ? minMs : 0);
    return { index: c.index + 1, minKmh, deltaVsBest: 0 };
  });
  // delta vs corner mais rápida
  const bestCornerKmh = cornerSpeeds.reduce(
    (b, c) => Math.max(b, c.minKmh),
    0
  );
  for (const c of cornerSpeeds) {
    c.deltaVsBest = c.minKmh - bestCornerKmh;
  }
  return cornerSpeeds;
}
