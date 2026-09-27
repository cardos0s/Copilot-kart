/**
 * Linha de chegada: um ponto, um rumo e um segmento perpendicular a esse rumo,
 * com `halfWidthM` para cada lado do ponto.
 *
 * A volta fecha no instante em que a trajetória atravessa esse segmento no
 * sentido do rumo. O instante sai da interpolação linear entre os dois pontos
 * do GPS que ficam um de cada lado da linha, e por isso não depende da taxa
 * do GPS.
 *
 * Puro: nada nativo, testado em Node.
 */
import { GpsSample, LatLng, haversine, makeLocalProjector } from './geometry';

export type StartLine = { lat: number; lng: number; headingDeg: number };

export type CrossPoint = { t: number; lat: number; lng: number; speed: number };

/** Corda mínima para o rumo da linha: um segmento isolado oscila alguns graus. */
const HEADING_CHORD_M = 5;
/** Sem ponto de um dos lados em até 2 s, o cruzamento não conta (buraco no GPS). */
const MAX_CROSSING_GAP_MS = 2000;

/** Rumo em graus (0 = norte, sentido horário) de `from` para `to`, no plano local. */
function headingBetween(from: LatLng, to: LatLng): number {
  const { x, y } = makeLocalProjector(from).toXY(to);
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Índice do primeiro ponto depois de `fromIdx` a 5 m ou mais dele, ou -1. */
function firstPointAtChord(samples: GpsSample[], fromIdx: number): number {
  const origin = samples[fromIdx];
  for (let i = fromIdx + 1; i < samples.length; i++) {
    if (haversine(origin, samples[i]) >= HEADING_CHORD_M) return i;
  }
  return -1;
}

/**
 * Linha do traçado de referência: o primeiro ponto do traçado, com o rumo até
 * o primeiro ponto a 5 m ou mais. Com menos de 5 pontos ou sem comprimento,
 * devolve `null` e a sessão é tratada como sem traçado.
 */
export function lineFromLayout(samples: GpsSample[]): StartLine | null {
  if (samples.length < 5) return null;
  const j = firstPointAtChord(samples, 0);
  if (j < 0) return null;
  const p = samples[0];
  return { lat: p.lat, lng: p.lng, headingDeg: headingBetween(p, samples[j]) };
}

/**
 * Linha inferida, para a sessão sem traçado: o ponto em que o ritmo começou,
 * com o rumo do movimento a partir dele. Se nenhum ponto seguinte se afasta
 * 5 m, usa o rumo do próprio GPS.
 */
export function lineFromMotion(samples: GpsSample[], movingStartIdx: number): StartLine {
  const p = samples[movingStartIdx];
  const j = firstPointAtChord(samples, movingStartIdx);
  const headingDeg = j >= 0 ? headingBetween(p, samples[j]) : p.heading ?? 0;
  return { lat: p.lat, lng: p.lng, headingDeg };
}

/**
 * Testa se o par (a, b) atravessa a linha no sentido do rumo.
 *
 * No referencial da linha, `u` é a distância ao longo do rumo e `v` a
 * distância lateral. Há cruzamento quando `u_a < 0 ≤ u_b`, o ponto em que o
 * segmento corta a linha fica a até `halfWidthM` do ponto da linha e os dois
 * pontos estão a até 2 s um do outro. `f = −u_a / (u_b − u_a)` interpola o
 * instante, a posição e a velocidade.
 */
export function crossing(
  a: GpsSample,
  b: GpsSample,
  line: StartLine,
  halfWidthM = 15
): (CrossPoint & { f: number }) | null {
  if (b.t - a.t > MAX_CROSSING_GAP_MS) return null;

  const proj = makeLocalProjector(line);
  const h = (line.headingDeg * Math.PI) / 180;
  const sinH = Math.sin(h);
  const cosH = Math.cos(h);
  const pa = proj.toXY(a);
  const pb = proj.toXY(b);
  const ua = pa.x * sinH + pa.y * cosH;
  const ub = pb.x * sinH + pb.y * cosH;
  if (!(ua < 0 && ub >= 0)) return null;

  const f = -ua / (ub - ua);
  const va = pa.x * cosH - pa.y * sinH;
  const vb = pb.x * cosH - pb.y * sinH;
  if (Math.abs(va + f * (vb - va)) > halfWidthM) return null;

  return {
    t: a.t + f * (b.t - a.t),
    lat: a.lat + f * (b.lat - a.lat),
    lng: a.lng + f * (b.lng - a.lng),
    speed: a.speed + f * (b.speed - a.speed),
    f,
  };
}
