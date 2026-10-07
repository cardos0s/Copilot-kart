/**
 * Selo de fonte e qualidade do GPS da sessão (TF-23, TF-24; design §11).
 *
 * A qualidade é a mediana da precisão dos frames de GPS dentro das voltas, sem os
 * pontos de fronteira (`synthetic`). Sem nenhuma volta, a mediana é sobre todos os
 * frames da sessão. Faixas: boa (≤ 5 m), média (≤ 10 m), ruim (> 10 m), e
 * "desconhecida" quando nenhum frame tem precisão.
 */
import type { GpsFrame, Source } from './frame';

/** Limites das faixas de qualidade, em metros (inclusive). */
export const GOOD_MAX_M = 5;
export const MEDIUM_MAX_M = 10;

// SPEC_DEVIATION: a design tem `sessionBadge(source: Source, …)`; aqui a fonte é só `PHONE` ou `MYCHRON`.
// Reason: `ALFANO` e `GOPRO` ainda não têm rótulo (design §11). O tipo estreito faz o compilador
// recusar uma fonte sem rótulo, em vez de o selo inventar um.
export type BadgeSource = Extract<Source, 'PHONE' | 'MYCHRON'>;
export type SourceLabel = 'Celular' | 'MyChron';
export type GpsQuality = 'boa' | 'média' | 'ruim' | 'desconhecida';

export type SessionBadge = {
  sourceLabel: SourceLabel;
  quality: GpsQuality;
  medianAccuracyM: number | null;
};

const SOURCE_LABEL: Record<BadgeSource, SourceLabel> = { PHONE: 'Celular', MYCHRON: 'MyChron' };

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sessionBadge(source: BadgeSource, lapsGps: GpsFrame[][], allGps: GpsFrame[]): SessionBadge {
  const frames = lapsGps.length > 0 ? lapsGps.flat() : allGps;
  const accuracies: number[] = [];
  for (const f of frames) {
    if (f.synthetic || f.accuracy === undefined || f.accuracy !== f.accuracy) continue;
    accuracies.push(f.accuracy);
  }
  const sourceLabel = SOURCE_LABEL[source];
  if (accuracies.length === 0) return { sourceLabel, quality: 'desconhecida', medianAccuracyM: null };

  const m = median(accuracies.sort((a, b) => a - b));
  const quality: GpsQuality = m <= GOOD_MAX_M ? 'boa' : m <= MEDIUM_MAX_M ? 'média' : 'ruim';
  return { sourceLabel, quality, medianAccuracyM: m };
}

/** "Celular · GPS boa (4 m)"; sem precisão, "Celular · GPS desconhecida", sem metros. */
export function badgeText(badge: SessionBadge): string {
  const head = `${badge.sourceLabel} · GPS ${badge.quality}`;
  return badge.medianAccuracyM === null ? head : `${head} (${Math.round(badge.medianAccuracyM)} m)`;
}
