/**
 * Detecção automática de curvas a partir da volta de referência.
 *
 * Algoritmo:
 *   1. Pra cada segmento da polyline, calcula heading (direção do vetor).
 *   2. Diferença angular entre segmentos consecutivos / comprimento do segmento
 *      = taxa de curvatura em rad/m.
 *   3. Suaviza |curvatura| numa janela de W metros pra obter a intensidade.
 *   4. Threshold + agrupamento de regiões adjacentes = curvas individuais.
 *   5. Cada curva ganha sStart, sEnd, sApex e um nome ordinal "Curva N".
 */

import { ReferenceLap } from './geometry';
import { Sector } from './analysis';

export type Corner = {
  index: number;
  /** Nome legível, ex: "Curva 1". Pode ser sobrescrito por dados da pista no futuro. */
  name: string;
  /** Distância ao longo da pista onde começa, em metros. */
  sStart: number;
  /** Distância ao longo da pista onde termina, em metros. */
  sEnd: number;
  /** Ponto de curvatura máxima (ápice) — distância em metros. */
  sApex: number;
};

type Options = {
  /** Threshold de curvatura média (rad/m) pra considerar curva. ~2.3°/m. */
  threshold?: number;
  /** Comprimento mínimo de uma curva em metros pra valer. */
  minCornerLen?: number;
  /** Janela de suavização em metros. */
  smoothingWindow?: number;
};

export function detectCorners(ref: ReferenceLap, opts: Options = {}): Corner[] {
  const threshold = opts.threshold ?? 0.04;
  const minLen = opts.minCornerLen ?? 8;
  const W = opts.smoothingWindow ?? 6;

  const points = ref.points;
  const cum = ref.cumulativeDist;
  if (points.length < 4) return [];

  // Heading por segmento (rad)
  const headings: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    headings.push(Math.atan2(dy, dx));
  }

  // Taxa de curvatura (rad/m) e s no meio do segmento
  const turnRate: number[] = [];
  const segS: number[] = [];
  for (let i = 1; i < headings.length; i++) {
    let d = headings[i] - headings[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const segLen = cum[i + 1] - cum[i];
    turnRate.push(segLen > 0 ? d / segLen : 0);
    segS.push((cum[i] + cum[i + 1]) / 2);
  }

  // Intensidade suavizada
  const intensity: number[] = new Array(turnRate.length).fill(0);
  for (let i = 0; i < turnRate.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < turnRate.length; j++) {
      if (segS[j] - segS[i] > W) break;
      sum += Math.abs(turnRate[j]);
      count++;
    }
    for (let j = i - 1; j >= 0; j--) {
      if (segS[i] - segS[j] > W) break;
      sum += Math.abs(turnRate[j]);
      count++;
    }
    intensity[i] = count > 0 ? sum / count : 0;
  }

  // Threshold + agrupamento
  const corners: Corner[] = [];
  let i = 0;
  while (i < intensity.length) {
    if (intensity[i] < threshold) {
      i++;
      continue;
    }
    let j = i;
    while (j < intensity.length && intensity[j] >= threshold * 0.5) j++;
    const sStart = segS[i];
    const sEndIdx = Math.min(j, intensity.length - 1);
    const sEnd = segS[sEndIdx];
    if (sEnd - sStart >= minLen) {
      let apexIdx = i;
      for (let k = i; k < j; k++) {
        if (intensity[k] > intensity[apexIdx]) apexIdx = k;
      }
      corners.push({
        index: corners.length,
        name: `Curva ${corners.length + 1}`,
        sStart,
        sEnd,
        sApex: segS[apexIdx],
      });
    }
    i = j + 1;
  }

  return corners;
}

/**
 * Gera uma descrição legível pra um setor com base nas curvas detectadas.
 * Se o centro do setor cai dentro de uma curva: "Curva N — entrada/ápice/saída".
 * Se cai entre curvas: "Reta N→N+1".
 * Casos de borda: "Largada → Curva 1", "Curva N → Chegada".
 */
export function describeSector(sec: Sector, corners: Corner[]): string {
  const sectorNum = sec.index + 1;
  if (corners.length === 0) {
    return `Setor ${sectorNum}`;
  }

  const center = (sec.sStart + sec.sEnd) / 2;

  // Dentro de uma curva?
  const inside = corners.find((c) => center >= c.sStart && center <= c.sEnd);
  if (inside) {
    const t = (center - inside.sStart) / Math.max(1, inside.sEnd - inside.sStart);
    let phase: string;
    if (t < 0.33) phase = 'entrada';
    else if (t > 0.67) phase = 'saída';
    else phase = 'ápice';
    return `${inside.name} — ${phase}`;
  }

  // Entre curvas — adiciona número do setor pra desambiguar quando vários
  // mini-setores caem na mesma reta.
  const prevCorner = [...corners].reverse().find((c) => c.sEnd < center);
  const nextCorner = corners.find((c) => c.sStart > center);

  if (prevCorner && nextCorner) {
    return `Reta ${prevCorner.index + 1}→${nextCorner.index + 1} · S${sectorNum}`;
  }
  if (nextCorner) {
    return `Largada → ${nextCorner.name} · S${sectorNum}`;
  }
  if (prevCorner) {
    return `${prevCorner.name} → Chegada · S${sectorNum}`;
  }
  return `Setor ${sectorNum}`;
}
