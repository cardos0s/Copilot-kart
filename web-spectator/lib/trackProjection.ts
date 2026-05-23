/**
 * Projeta amostras GPS (lat/lng) numa caixa 2D pra desenhar no SVG.
 *
 * Estratégia simples e suficiente pra escala de uma pista de kart:
 *  1. Acha bounding box em lat/lng
 *  2. Converte cada ponto pra metros relativos (haversine seria mais
 *     preciso, mas em <1km a aproximação linear erra <0.5%)
 *  3. Escala uniforme pra caber em (width, height) com padding
 *  4. Inverte Y porque SVG cresce pra baixo
 */

export type Pt = { lat: number; lng: number };
export type ProjectionResult = {
  /** Pontos transformados em coords SVG. Mesma ordem do input. */
  points: { x: number; y: number }[];
  /** Função reutilizável pra projetar pontos extras (ex: kart atual). */
  project: (p: Pt) => { x: number; y: number };
  /** Bounding box pra layout/debug. */
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

export function projectTrack(
  samples: Pt[],
  width: number,
  height: number,
  padding: number = 20
): ProjectionResult {
  if (samples.length === 0) {
    return {
      points: [],
      project: () => ({ x: width / 2, y: height / 2 }),
      bbox: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 },
    };
  }

  let minLat = samples[0].lat;
  let maxLat = samples[0].lat;
  let minLng = samples[0].lng;
  let maxLng = samples[0].lng;
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  }

  // Latitude longitudinal scaling — 1deg lng ≈ cos(lat) * 1deg lat em metros
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);

  const widthM = (maxLng - minLng) * lngScale;
  const heightM = maxLat - minLat;
  // Evita divisão por zero em traçados degenerados
  const scale = Math.min(
    (width - padding * 2) / Math.max(widthM, 1e-9),
    (height - padding * 2) / Math.max(heightM, 1e-9)
  );

  const offsetX =
    (width - widthM * scale) / 2 - minLng * lngScale * scale;
  const offsetY = (height - heightM * scale) / 2 + maxLat * scale;

  const project = (p: Pt): { x: number; y: number } => ({
    x: p.lng * lngScale * scale + offsetX,
    y: -p.lat * scale + offsetY,
  });

  return {
    points: samples.map(project),
    project,
    bbox: { minLat, maxLat, minLng, maxLng },
  };
}
