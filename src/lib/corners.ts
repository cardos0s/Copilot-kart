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

import { ReferenceLap, smoothPolylineXY } from './geometry';
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

  const rawPoints = ref.points;
  const cum = ref.cumulativeDist;
  if (rawPoints.length < 4) return [];

  // Suaviza as POSIÇÕES antes de calcular headings. Jitter de GPS (~1m) em
  // samples espaçados 2–4m vira zigue-zague que domina a curvatura calculada —
  // sem isso, retas ficam "curvas" e regiões de curva engolem a pista inteira.
  // Raio adaptativo: cresce quando o espaçamento entre samples é maior (menos Hz).
  const avgSpacing = ref.totalLength / Math.max(1, rawPoints.length - 1);
  const smoothRadius = Math.max(W / 2, avgSpacing * 2);
  const points = smoothPolylineXY(rawPoints, cum, smoothRadius);

  // Heading por segmento (rad)
  const headings: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    headings.push(Math.atan2(dy, dx));
  }

  // Heading de corda (±4m) por ponto — segmento único oscila alguns graus
  // mesmo após suavizar posições; a corda dá a régua estável usada pra medir
  // o varrido líquido de cada run (consistente com a análise por curva).
  const CHORD = 4;
  const chordHeading: number[] = new Array(points.length).fill(0);
  {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < points.length; i++) {
      while (lo < i && cum[i] - cum[lo] > CHORD) lo++;
      while (hi < points.length - 1 && cum[hi] - cum[i] < CHORD) hi++;
      const dx = points[hi].x - points[lo].x;
      const dy = points[hi].y - points[lo].y;
      chordHeading[i] = dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : chordHeading[Math.max(0, i - 1)];
    }
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

  // Intensidade COM SINAL, mesma janela — usada pra separar complexos de
  // curvas encadeadas (S, chicane) onde o sentido de rotação inverte.
  const signedIntensity: number[] = new Array(turnRate.length).fill(0);
  for (let i = 0; i < turnRate.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < turnRate.length; j++) {
      if (segS[j] - segS[i] > W) break;
      sum += turnRate[j];
      count++;
    }
    for (let j = i - 1; j >= 0; j--) {
      if (segS[i] - segS[j] > W) break;
      sum += turnRate[j];
      count++;
    }
    signedIntensity[i] = count > 0 ? sum / count : 0;
  }

  // Threshold + agrupamento
  const corners: Corner[] = [];

  // Emite uma região contínua acima do threshold, dividindo-a onde o sentido
  // de rotação inverte. Sem isso, um miolo sinuoso vira "uma curva" de 500°+.
  const emitRegion = (from: number, to: number) => {
    type Run = { from: number; to: number; sweptRad: number };
    // Varrido = acumulado dos deltas de heading de CORDA no trecho do run.
    // Índice de turnRate k ↔ ponto k+1 da polyline.
    const makeRun = (a: number, b: number): Run => {
      let swept = 0;
      for (let k = a; k < b; k++) {
        const p0 = Math.min(k + 1, chordHeading.length - 1);
        const p1 = Math.min(k + 2, chordHeading.length - 1);
        let d = chordHeading[p1] - chordHeading[p0];
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        swept += d;
      }
      return { from: a, to: b, sweptRad: swept };
    };

    // Runs de sinal consistente (zeros continuam o run atual)
    const runs: Run[] = [];
    let runStart = from;
    let runSign = 0;
    for (let k = from; k < to; k++) {
      const sg = Math.sign(signedIntensity[k]);
      if (sg === 0) continue;
      if (runSign === 0) {
        runSign = sg;
      } else if (sg !== runSign) {
        runs.push(makeRun(runStart, k));
        runStart = k;
        runSign = sg;
      }
    }
    runs.push(makeRun(runStart, to));

    // Fusão iterativa até estabilizar:
    //   1. vizinhos com o MESMO sentido se juntam (blips de ruído entre eles
    //      já absorvidos criam runs adjacentes iguais);
    //   2. o run mais fraco abaixo de MIN_SWEPT é absorvido pelo vizinho mais
    //      forte — oscilação de GPS não é curva.
    // Convergência garantida: cada passo reduz o número de runs.
    const MIN_SWEPT = (30 * Math.PI) / 180;
    const merged: Run[] = [...runs];
    const mergeInto = (keepIdx: number, dropIdx: number) => {
      const a = Math.min(keepIdx, dropIdx);
      const b = Math.max(keepIdx, dropIdx);
      merged[a] = {
        from: merged[a].from,
        to: merged[b].to,
        sweptRad: merged[a].sweptRad + merged[b].sweptRad,
      };
      merged.splice(b, 1);
    };
    let changed = true;
    while (changed && merged.length > 1) {
      changed = false;
      // 1. junta vizinhos do mesmo sentido
      for (let k = 0; k < merged.length - 1; ) {
        if (Math.sign(merged[k].sweptRad) === Math.sign(merged[k + 1].sweptRad)) {
          mergeInto(k, k + 1);
          changed = true;
        } else {
          k++;
        }
      }
      // 2. absorve o run mais fraco abaixo do mínimo no vizinho mais forte
      if (merged.length > 1) {
        let weakest = -1;
        for (let k = 0; k < merged.length; k++) {
          if (Math.abs(merged[k].sweptRad) >= MIN_SWEPT) continue;
          if (weakest < 0 || Math.abs(merged[k].sweptRad) < Math.abs(merged[weakest].sweptRad)) {
            weakest = k;
          }
        }
        if (weakest >= 0) {
          const left = weakest > 0 ? Math.abs(merged[weakest - 1].sweptRad) : -1;
          const right =
            weakest < merged.length - 1 ? Math.abs(merged[weakest + 1].sweptRad) : -1;
          mergeInto(left >= right ? weakest - 1 : weakest + 1, weakest);
          changed = true;
        }
      }
    }

    for (const r of merged) {
      const sStart = segS[r.from];
      const sEnd = segS[Math.min(r.to, segS.length - 1)];
      if (sEnd - sStart < minLen) continue;
      // Regiões de run único escapam da absorção — filtra wiggles aqui também
      if (Math.abs(r.sweptRad) < MIN_SWEPT) continue;
      let apexIdx = r.from;
      for (let k = r.from; k < r.to; k++) {
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
  };

  let i = 0;
  while (i < intensity.length) {
    if (intensity[i] < threshold) {
      i++;
      continue;
    }
    let j = i;
    while (j < intensity.length && intensity[j] >= threshold * 0.5) j++;
    emitRegion(i, Math.min(j, intensity.length));
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
    return `Reta ${prevCorner.index + 1}-${nextCorner.index + 1} · S${sectorNum}`;
  }
  if (nextCorner) {
    return `Largada · ${nextCorner.name} · S${sectorNum}`;
  }
  if (prevCorner) {
    return `${prevCorner.name} · Chegada · S${sectorNum}`;
  }
  return `Setor ${sectorNum}`;
}
