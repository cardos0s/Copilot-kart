/**
 * A régua única de S1/S2/S3 (TMP-07, TMP-08, TMP-09).
 *
 * S1, S2 e S3 são os terços do comprimento do traçado de referência, a partir
 * da linha de chegada. O instante em que a volta passa por 1/3 e 2/3 sai da
 * interpolação entre os dois pontos em volta de cada limite (map matching),
 * não do poll. O ao vivo, a publicação e a análise chamam esta mesma função
 * sobre os mesmos pontos.
 *
 * Puro: nada nativo, testado em Node.
 */
import type { LapRecord } from './analysis';
import { matchLapToReference } from './analysis';
import { buildReferenceLap, type GpsSample, type ReferenceLap } from './geometry';
import { lineFromLayout } from './startLine';

export type SectorSplits = { s1Ms: number | null; s2Ms: number | null; s3Ms: number | null };

/**
 * Régua a partir do traçado de referência. Com menos de 5 pontos ou sem
 * comprimento, devolve `null` (mesma regra de `lineFromLayout`): a sessão é
 * tratada como sem traçado.
 */
export function referenceFromLayout(samples: GpsSample[]): ReferenceLap | null {
  if (!lineFromLayout(samples)) return null;
  return buildReferenceLap(samples, { lat: samples[0].lat, lng: samples[0].lng });
}

/**
 * Régua a partir de uma volta (a melhor da sessão, quando não há traçado).
 * Com pontos de fronteira, a origem é o ponto da linha.
 */
export function referenceFromLap(lap: { samples: GpsSample[] }): ReferenceLap {
  const o = lap.samples[0];
  return buildReferenceLap(lap.samples, { lat: o.lat, lng: o.lng });
}

/**
 * S1/S2/S3 de uma volta contra a régua. `lapSamples[0]` é o início da volta
 * (o ponto de fronteira na linha).
 *
 * - Numa volta em curso, o setor ainda não alcançado fica `null`.
 * - Numa volta fechada (termina no ponto de fronteira), o fim é o último
 *   ponto, e `s1 + s2 + s3` é a duração arredondada da volta.
 */
export function sectorSplits(lapSamples: GpsSample[], ref: ReferenceLap): SectorSplits {
  const none: SectorSplits = { s1Ms: null, s2Ms: null, s3Ms: null };
  const L = ref.totalLength;
  if (lapSamples.length < 2 || L <= 0) return none;

  const lap: LapRecord = { id: '', sessionId: '', samples: lapSamples, startedAt: lapSamples[0].t, durationMs: 0 };
  const matched = matchLapToReference(lap, ref);
  const pts = matched.points;
  // O início da volta é a linha: s ≈ 0, ou s ≈ L quando o map matching o
  // pôs no fim da polilinha (a linha aparece nas duas pontas).
  const base = pts[0].s > L / 2 ? L : 0;
  const lastS = pts[pts.length - 1].s;
  const last = lapSamples[lapSamples.length - 1];
  const closed = last.synthetic === true;

  // Instante em que a volta passa por `target`: entre o último ponto antes e
  // o primeiro depois, com a fração pela corda entre os dois. O map matching
  // prende em s = L o ponto que já passou da linha (a busca com dica não dá a
  // volta na polilinha), e a fração por s o jogaria para o fim do par.
  const timeAt = (k: number): number | null => {
    const target = base + (k * L) / 3;
    if (lastS < target) return null;
    const j = pts.findIndex((p) => p.s >= target);
    if (j <= 0) return pts[0].tMs;
    const a = pts[j - 1];
    const b = pts[j];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const f = chord > 0 ? Math.min(1, (target - a.s) / chord) : 1;
    return a.tMs + f * (b.tMs - a.tMs);
  };

  const t1 = timeAt(1);
  const t2 = t1 === null ? null : timeAt(2);
  const t3 = t2 === null ? null : closed ? pts[pts.length - 1].tMs : timeAt(3);

  // Arredonda os instantes, não os setores: a soma fecha com a duração.
  const r1 = t1 === null ? null : Math.round(t1);
  const r2 = t2 === null ? null : Math.round(t2);
  const r3 = t3 === null ? null : Math.round(t3);
  return {
    s1Ms: r1,
    s2Ms: r1 !== null && r2 !== null ? r2 - r1 : null,
    s3Ms: r2 !== null && r3 !== null ? r3 - r2 : null,
  };
}
