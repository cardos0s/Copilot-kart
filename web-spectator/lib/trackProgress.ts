/**
 * Cálculo de "progresso ao longo da pista" pra posição ao vivo do evento.
 *
 * Dada uma referência (polyline) e um ponto GPS, projeta o ponto na
 * polyline (segmento mais próximo) e retorna o progresso normalizado 0..1.
 *
 * Combinado com lap_number, ordena os karts: P1 = mais voltas + mais
 * progresso na volta atual.
 *
 * Cálculos em ENU local (metros) — projeção esférica desnecessária pra
 * pistas <10km.
 */

export type RefPoint = { lat: number; lng: number };

export type CompiledReference = {
  /** Pontos em metros locais (ENU), origem = ref[0]. */
  points: Array<{ x: number; y: number }>;
  /** Distância cumulativa em metros até cada ponto. cum[0] = 0. */
  cum: number[];
  /** Comprimento total da polyline (m). */
  totalLength: number;
  /** Origem usada na projeção local. */
  origin: RefPoint;
  /** Bbox em metros locais (pra normalização do mapa). */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
};

const DEG = Math.PI / 180;

function makeProjector(origin: RefPoint) {
  const lat0 = origin.lat * DEG;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
  const mPerDegLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);
  return (p: RefPoint) => ({
    x: (p.lng - origin.lng) * mPerDegLng,
    y: (p.lat - origin.lat) * mPerDegLat,
  });
}

/** Pré-processa a referência: projeção + cumulativa + bbox. */
export function compileReference(samples: RefPoint[]): CompiledReference | null {
  if (samples.length < 2) return null;
  const origin = samples[0];
  const project = makeProjector(origin);
  const points = samples.map(project);
  const cum: number[] = [0];
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
    if (points[i].x < minX) minX = points[i].x;
    if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].y > maxY) maxY = points[i].y;
  }
  return {
    points,
    cum,
    totalLength: cum[cum.length - 1],
    origin,
    bbox: { minX, maxX, minY, maxY },
  };
}

/**
 * Projeta um ponto GPS na polyline e retorna progresso normalizado (0..1).
 * Algoritmo: testa todos os segmentos (N pequeno, ~500), encontra o mais
 * próximo, calcula a posição relativa no segmento, soma cumulativa.
 */
export function projectProgress(p: RefPoint, ref: CompiledReference): {
  progress: number;
  x: number;
  y: number;
  matchDistance: number;
} {
  const proj = makeProjector(ref.origin);
  const xy = proj(p);
  let best = { segIdx: 0, t: 0, dist: Infinity };
  for (let i = 0; i < ref.points.length - 1; i++) {
    const a = ref.points[i];
    const b = ref.points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1) continue;
    // t = quão longe no segmento [0..1]
    let t = ((xy.x - a.x) * dx + (xy.y - a.y) * dy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const ddx = xy.x - px;
    const ddy = xy.y - py;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < best.dist) {
      best = { segIdx: i, t, dist: d2 };
    }
  }
  const segStart = ref.cum[best.segIdx];
  const segEnd = ref.cum[best.segIdx + 1];
  const distAlong = segStart + best.t * (segEnd - segStart);
  return {
    progress: ref.totalLength > 0 ? distAlong / ref.totalLength : 0,
    x: xy.x,
    y: xy.y,
    matchDistance: Math.sqrt(best.dist),
  };
}
