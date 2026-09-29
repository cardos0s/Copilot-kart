/**
 * Comparação volta-vs-volta — duas voltas livres do mesmo piloto, ambas
 * projetadas na MESMA referência de pista (track layout), pra extrair:
 *
 *   - Delta total (lapA - lapB)
 *   - Delta em N trechos ao longo da volta (pra gráfico de barras)
 *   - Setores agregados (S1/S2/S3) com nome inteligente baseado em corners
 *   - Curva de velocidade overlay (ambas no mesmo eixo s)
 *   - Pontos da pista pra colorir a silhueta (verde=ganhou, vermelho=perdeu)
 *
 * Usa `matchLapToReference` + `interpolateTimeAtS` que já lidam com timestamps
 * degenerados (reparo) e wrap na linha de chegada. Função PURA — caller
 * passa as voltas + referência, recebe estrutura pra renderizar.
 */

import {
  LapRecord,
  matchLapToReference,
  Sector,
} from './analysis';
import { ReferenceLap } from './geometry';
import { Corner, describeSector } from './corners';
import { referenceFromLap, sectorLapSamples, sectorSplits } from './sectors';

export type LapTrace = {
  /** Pares (s, tempo) interpolados em N pontos uniformes pra plotar. */
  sValues: number[];
  /** Tempo (ms) em cada s — útil pra delta(s) = tempoA(s) - tempoB(s). */
  tValues: number[];
  /** Velocidade (m/s) em cada s — pra overlay. */
  speedValues: number[];
  /** Tempo total da volta. */
  durationMs: number;
};

export type CompareSectorRow = {
  index: number; // 0, 1, 2 (S1/S2/S3)
  label: string; // "Curvas 1-4", "Reta 5-7", etc
  aMs: number | null;
  bMs: number | null;
  deltaMs: number | null;
};

export type CompareResult = {
  /** Tempo total da volta A em ms. */
  aTotalMs: number;
  /** Tempo total da volta B em ms. */
  bTotalMs: number;
  /** A - B (positivo = A mais lenta). */
  totalDeltaMs: number;
  /** Comprimento da pista (m). */
  trackLengthM: number;
  /** Traces de A e B interpolados em N pontos uniformes. */
  traceA: LapTrace;
  traceB: LapTrace;
  /** Delta acumulado em N trechos do traçado. Cada item é o tempo perdido (ou
   *  ganho) no trecho relativo ao trecho equivalente da volta B. */
  trechos: Array<{ label: string; deltaMs: number }>;
  /** Setores S1/S2/S3 com labels inteligentes. */
  sectors: CompareSectorRow[];
  /** Voltas matched contra a referência — útil pra renderizar mapa colorido. */
  matchedA: ReturnType<typeof matchLapToReference>;
  matchedB: ReturnType<typeof matchLapToReference>;
};

/**
 * Interpola `n` pontos uniformes ao longo do traçado e calcula tempo
 * acumulado + velocidade em cada um. Velocidade no ponto s = média dos
 * samples no entorno (janela de ±2% do traçado).
 */
function buildLapTrace(
  matched: ReturnType<typeof matchLapToReference>,
  trackLengthM: number,
  n: number
): LapTrace {
  const sValues: number[] = [];
  const tValues: number[] = [];
  const speedValues: number[] = [];
  if (matched.points.length < 2 || trackLengthM <= 0) {
    return { sValues, tValues, speedValues, durationMs: matched.durationMs };
  }
  const windowM = trackLengthM * 0.02; // ±2%
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * trackLengthM;
    sValues.push(s);
    // Tempo: busca o pts adjacente
    let t = 0;
    // pts pode estar "unwrapped" (s > trackLengthM) — normaliza target
    let target = s;
    while (target < matched.points[0].s) target += trackLengthM;
    if (target <= matched.points[0].s) {
      t = matched.points[0].tMs;
    } else if (target >= matched.points[matched.points.length - 1].s) {
      t = matched.points[matched.points.length - 1].tMs;
    } else {
      for (let j = 1; j < matched.points.length; j++) {
        if (matched.points[j].s >= target) {
          const a = matched.points[j - 1];
          const b = matched.points[j];
          const ratio = b.s === a.s ? 0 : (target - a.s) / (b.s - a.s);
          t = a.tMs + ratio * (b.tMs - a.tMs);
          break;
        }
      }
    }
    tValues.push(t);

    // Velocidade: média no entorno (módulo do s)
    let sumSpeed = 0;
    let count = 0;
    for (const p of matched.points) {
      const pNormalized = p.s % trackLengthM;
      const targetMod = s % trackLengthM;
      const dist = Math.min(
        Math.abs(pNormalized - targetMod),
        trackLengthM - Math.abs(pNormalized - targetMod)
      );
      if (dist <= windowM) {
        sumSpeed += p.speed;
        count++;
      }
    }
    speedValues.push(count > 0 ? sumSpeed / count : 0);
  }
  return { sValues, tValues, speedValues, durationMs: matched.durationMs };
}

/**
 * Compara 2 voltas contra uma referência comum. As 2 voltas DEVEM ser da
 * mesma pista (mesmo layout) — caso contrário a comparação não faz sentido.
 *
 * S1/S2/S3 saem de `sectorSplits` sobre os pontos salvos das duas voltas
 * (`saved`), preparados como na sessão (`sectorLapSamples`): a mesma régua e
 * os mesmos pontos da sessão e do ao vivo (TMP-07, AD-006). Sem `saved`, são
 * os pontos de `lapA` e `lapB`. O traço do delta e o mapa usam `lapA` e `lapB`.
 * A régua é o traçado (`ref`); sem traçado (`null`), é a volta B, a
 * referência da comparação.
 */
export function compareLaps(
  lapA: LapRecord,
  lapB: LapRecord,
  ref: ReferenceLap | null,
  corners: Corner[],
  saved: { a: LapRecord; b: LapRecord } = { a: lapA, b: lapB }
): CompareResult {
  const ruler = ref ?? referenceFromLap(lapB);
  const matchedA = matchLapToReference(lapA, ruler);
  const matchedB = matchLapToReference(lapB, ruler);
  const trackLengthM = ruler.totalLength;

  const splitsA = sectorSplits(sectorLapSamples(saved.a), ruler);
  const splitsB = sectorSplits(sectorLapSamples(saved.b), ruler);
  const sectors: CompareSectorRow[] = (['s1Ms', 's2Ms', 's3Ms'] as const).map((k, g) => {
    const aMs = splitsA[k];
    const bMs = splitsB[k];
    // Label inteligente pelo terço do traçado que o setor cobre.
    const third = { index: g, sStart: (g * trackLengthM) / 3, sEnd: ((g + 1) * trackLengthM) / 3 } as Sector;
    return {
      index: g,
      label: describeSector(third, corners),
      aMs,
      bMs,
      deltaMs: aMs !== null && bMs !== null ? aMs - bMs : null,
    };
  });

  // Traces uniformes em ~80 pontos — suficiente pra gráfico bonito sem pesar
  const N = 80;
  const traceA = buildLapTrace(matchedA, trackLengthM, N);
  const traceB = buildLapTrace(matchedB, trackLengthM, N);

  // Trechos: agrupa o delta de N pontos em ~7 buckets pra gráfico de barras
  // estilo "T1...FIM" das suas refs.
  const BUCKETS = 7;
  const pointsPerBucket = Math.ceil(traceA.sValues.length / BUCKETS);
  const trechos: Array<{ label: string; deltaMs: number }> = [];
  for (let b = 0; b < BUCKETS; b++) {
    const from = b * pointsPerBucket;
    const to = Math.min(traceA.sValues.length - 1, (b + 1) * pointsPerBucket);
    if (from >= traceA.sValues.length) break;
    // Delta no bucket = (tempo em B em "to") - (tempo em B em "from")
    //                 - (tempo em A em "to" - tempo em A em "from")
    const aSpent = traceA.tValues[to] - traceA.tValues[from];
    const bSpent = traceB.tValues[to] - traceB.tValues[from];
    const label = b === BUCKETS - 1 ? 'FIM' : `T${b + 1}`;
    trechos.push({ label, deltaMs: aSpent - bSpent });
  }

  return {
    aTotalMs: lapA.durationMs,
    bTotalMs: lapB.durationMs,
    totalDeltaMs: lapA.durationMs - lapB.durationMs,
    trackLengthM,
    traceA,
    traceB,
    trechos,
    sectors,
    matchedA,
    matchedB,
  };
}
