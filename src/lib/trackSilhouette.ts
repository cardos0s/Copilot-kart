/**
 * Silhueta do traçado para as telas de escolha e confirmação de pista.
 *
 * O handoff entrega formas genéricas de marcação de posição e é explícito:
 * o traçado real precisa vir de dado verdadeiro antes de ir pra produção.
 * Aqui a fonte verdadeira já existe — a volta de referência gravada por GPS
 * (`track_references`) e os layouts. Quando a pista tem uma, a silhueta é ela.
 * Só quem nunca foi gravado cai na forma genérica.
 */

import { GpsSample, LatLng, makeLocalProjector } from './geometry';

/** Todas as silhuetas vivem neste viewBox. */
export const SILHOUETTE_VIEWBOX = '0 0 50 48';
const VB_W = 50;
const VB_H = 48;

export type Silhouette = {
  /** Path SVG fechado, pronto pro <Path d>. */
  d: string;
  /** Ponto de largada/chegada já no espaço do viewBox. */
  start: { x: number; y: number } | null;
  /** Se veio de GPS gravado ou da forma genérica de marcação de posição. */
  real: boolean;
};

/**
 * Formas genéricas do handoff. Não representam nenhuma pista — são marcação
 * de posição até existir volta gravada. A escolha por id é determinística só
 * pra mesma pista não trocar de desenho a cada render.
 */
const PLACEHOLDERS = [
  'M14 31 C8 23 12 12 21 12 C28 12 28 20 34 20 C42 20 44 30 37 35 C31 39 21 38 14 31 Z',
  'M10 24 C10 14 18 9 27 11 C35 13 40 20 37 28 C34 35 24 38 17 34 C12 31 10 28 10 24 Z',
  'M12 20 C14 11 24 8 32 13 C39 17 40 27 34 33 C27 39 15 36 12 28 Z',
  'M11 33 C6 26 9 15 17 13 C24 11 26 19 33 17 C40 15 45 22 42 29 C39 37 28 40 21 38 C16 37 13 36 11 33 Z',
  'M13 16 C19 9 31 10 36 16 C41 22 37 27 31 27 C25 27 21 24 17 27 C13 30 15 36 22 37 C29 38 36 36 40 32 C44 27 42 20 38 15 C33 9 22 8 15 12 C12 13 12 14 13 16 Z',
  'M9 27 C9 17 17 11 26 12 C33 13 36 18 33 22 C30 26 22 24 20 28 C18 33 24 38 32 37 C38 36 42 32 43 27 C44 22 40 17 34 16 C27 15 21 18 16 21 C12 23 9 24 9 27 Z',
];

export function placeholderSilhouette(trackId: string): Silhouette {
  let hash = 0;
  for (let i = 0; i < trackId.length; i++) {
    hash = (hash * 31 + trackId.charCodeAt(i)) >>> 0;
  }
  return { d: PLACEHOLDERS[hash % PLACEHOLDERS.length], start: null, real: false };
}

/**
 * Converte uma volta gravada em silhueta, encaixada no viewBox com a
 * proporção preservada. `pad` deixa respiro pra espessura do traço não
 * encostar na borda.
 */
export function samplesToSilhouette(samples: GpsSample[] | LatLng[], pad = 4): Silhouette | null {
  if (!samples || samples.length < 8) return null;

  const projector = makeLocalProjector({ lat: samples[0].lat, lng: samples[0].lng });
  const pts = samples.map((s) => projector.toXY({ lat: s.lat, lng: s.lng }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!isFinite(spanX) || !isFinite(spanY) || (spanX === 0 && spanY === 0)) return null;

  const scale = Math.min((VB_W - pad * 2) / (spanX || 1), (VB_H - pad * 2) / (spanY || 1));
  const offX = (VB_W - spanX * scale) / 2;
  const offY = (VB_H - spanY * scale) / 2;

  // O eixo Y do GPS cresce pro norte e o do SVG cresce pra baixo — inverter
  // aqui é o que mantém o traçado com a orientação que o piloto vê no mapa.
  const toBox = (p: { x: number; y: number }) => ({
    x: offX + (p.x - minX) * scale,
    y: VB_H - (offY + (p.y - minY) * scale),
  });

  // Uma volta tem centenas de amostras; ~110 pontos já desenham a forma sem
  // encher o path de ruído de GPS.
  const target = 110;
  const step = Math.max(1, Math.floor(pts.length / target));
  const kept: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i += step) kept.push(toBox(pts[i]));
  if (kept.length < 3) return null;

  const fmt = (n: number) => Math.round(n * 100) / 100;
  const d =
    kept.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ') + ' Z';

  return { d, start: kept[0], real: true };
}
