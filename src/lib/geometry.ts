/**
 * Geometria para análise de pista de kart.
 *
 * Trabalhamos em dois sistemas de coordenadas:
 * 1. GPS (lat/lng em graus) — entrada do sensor
 * 2. ENU local em metros (x leste, y norte) — tudo que envolve projeção,
 *    distâncias e map matching. Muito mais simples que fazer trig esférica
 *    a cada frame, e com pista de <1km o erro de planificação é desprezível.
 */

export type LatLng = { lat: number; lng: number };
export type XY = { x: number; y: number };

export type GpsSample = {
  t: number;        // timestamp ms desde epoch
  lat: number;
  lng: number;
  speed: number;    // m/s (vindo do GPS)
  accuracy: number; // metros
  heading?: number; // graus, 0 = norte
  altitude?: number;         // metros sobre nível do mar (quando disponível)
  altitudeAccuracy?: number; // precisão vertical em metros
};

/**
 * Sample da IMU (Inertial Measurement Unit). Capturado pelo expo-sensors
 * a ~50Hz em paralelo com o GPS (10Hz). Frequência alta porque mudanças
 * de rotação acontecem muito mais rápido que o GPS pode capturar.
 *
 * Eixos (Android/iOS convergem com expo-sensors após calibração interna):
 *   - x: pra direita do celular
 *   - y: pra cima (na orientação portrait); em landscape vira "pra frente"
 *   - z: saindo da tela (perpendicular)
 *
 * accel: m/s². Sem subtrair gravidade — pra detectar movimento total.
 *   App pode subtrair ~9.8 do eixo apontado pra baixo se quiser linear-only.
 * gyro: rad/s (yaw rate = z na maioria das orientações de cockpit).
 */
export type ImuSample = {
  t: number; // timestamp ms — alinhado com o relógio dos GpsSamples
  accel: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
};

export type LocalSample = GpsSample & { x: number; y: number };

const R_EARTH = 6371000; // metros
const DEG2RAD = Math.PI / 180;

/** Distância haversine em metros. Usa só onde precisar de precisão esférica. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Comprimento total de uma polyline em metros (haversine somado) */
export function polylineLength(samples: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += haversine(samples[i - 1], samples[i]);
  }
  return total;
}

/**
 * Cria um projetor ENU (East-North-Up) a partir de uma origem lat/lng.
 * Retorna funções para converter ida e volta. Precisão sub-métrica em raios <10km.
 */
export function makeLocalProjector(origin: LatLng) {
  const lat0 = origin.lat * DEG2RAD;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
  const mPerDegLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);

  return {
    toXY: (p: LatLng): XY => ({
      x: (p.lng - origin.lng) * mPerDegLng,
      y: (p.lat - origin.lat) * mPerDegLat,
    }),
    toLatLng: (p: XY): LatLng => ({
      lat: origin.lat + p.y / mPerDegLat,
      lng: origin.lng + p.x / mPerDegLng,
    }),
  };
}

/**
 * Projeta ponto p no segmento (a, b). Retorna o ponto projetado, a
 * distância perpendicular, e t ∈ [0,1] indicando posição no segmento.
 */
export function projectOnSegment(p: XY, a: XY, b: XY) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return { point: a, dist: Math.sqrt(dx * dx + dy * dy), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return { point: { x: projX, y: projY }, dist: Math.sqrt(dx * dx + dy * dy), t };
}

export type ReferenceLap = {
  points: LocalSample[];     // polyline da volta (já em coords locais)
  cumulativeDist: number[];  // distância acumulada em metros, mesmo length que points
  totalLength: number;       // comprimento total em metros
  origin: LatLng;            // origem do sistema ENU
};

/**
 * Pré-processa uma volta de referência: calcula distâncias cumulativas
 * pra permitir map matching rápido depois.
 */
export function buildReferenceLap(samples: GpsSample[], origin: LatLng): ReferenceLap {
  const proj = makeLocalProjector(origin);
  const points: LocalSample[] = samples.map((s) => ({ ...s, ...proj.toXY(s) }));
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cumulative.push(cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return {
    points,
    cumulativeDist: cumulative,
    totalLength: cumulative[cumulative.length - 1] ?? 0,
    origin,
  };
}

/**
 * Map matching: dado um ponto atual e a volta de referência, descobre em
 * que posição `s` da pista (metros desde a largada) o piloto está.
 *
 * Retorna s em metros, a distância perpendicular à trajetória de referência,
 * e o índice do segmento onde caiu.
 *
 * Custo: O(n) onde n = pontos da referência. Pra 600 pontos isso roda em
 * <1ms em JS. Se virar gargalo, dá pra otimizar com busca local a partir do
 * último segmento encontrado (a pista é contínua, não teletransporta).
 */
export function matchToReference(
  p: XY,
  ref: ReferenceLap,
  hintSegmentIdx?: number
): { s: number; dist: number; segmentIdx: number } {
  let bestDist = Infinity;
  let bestS = 0;
  let bestIdx = 0;

  // Se temos dica de onde o piloto estava, busca primeiro ali (janela de ±30 segmentos)
  // Caso contrário, busca global.
  const n = ref.points.length - 1;
  let start = 0;
  let end = n;
  if (hintSegmentIdx !== undefined) {
    start = Math.max(0, hintSegmentIdx - 30);
    end = Math.min(n, hintSegmentIdx + 30);
  }

  const search = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const a = ref.points[i];
      const b = ref.points[i + 1];
      const { dist, t } = projectOnSegment(p, a, b);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        const segLen = ref.cumulativeDist[i + 1] - ref.cumulativeDist[i];
        bestS = ref.cumulativeDist[i] + t * segLen;
      }
    }
  };

  search(start, end);

  // Se a melhor match está longe (>20m), refaz busca global — piloto pode ter
  // saído da dica (ex: rodou e refez percurso).
  if (bestDist > 20 && hintSegmentIdx !== undefined) {
    bestDist = Infinity;
    search(0, n);
  }

  return { s: bestS, dist: bestDist, segmentIdx: bestIdx };
}

/**
 * Detecta se o piloto cruzou a linha de chegada (= voltou ao ponto inicial
 * da polyline de referência). Usado pra fechar volta.
 *
 * Regra: se ele já andou pelo menos 50% do comprimento da pista E está a
 * menos de 15m do ponto inicial, fechou a volta.
 */
export function detectLapCompletion(
  currentXY: XY,
  ref: ReferenceLap,
  distanceTraveledSinceStart: number
): boolean {
  if (distanceTraveledSinceStart < ref.totalLength * 0.5) return false;
  const start = ref.points[0];
  const dx = currentXY.x - start.x;
  const dy = currentXY.y - start.y;
  return Math.sqrt(dx * dx + dy * dy) < 15;
}