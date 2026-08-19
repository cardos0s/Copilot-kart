/**
 * Número de curvas de um traçado gravado.
 *
 * O catálogo de kartódromos não traz esse dado — ninguém levantou pista a
 * pista — mas quando existe uma volta gravada ele está lá, no próprio
 * desenho. Reaproveita o detector de curvas da análise, então a contagem
 * aqui e a das telas de sessão falam da mesma coisa.
 */

import { detectCorners } from './corners';
import { buildReferenceLap, GpsSample } from './geometry';

export function countCorners(samples: GpsSample[]): number | null {
  if (!samples || samples.length < 20) return null;
  try {
    const ref = buildReferenceLap(samples, { lat: samples[0].lat, lng: samples[0].lng });
    return detectCorners(ref).length;
  } catch {
    return null;
  }
}
