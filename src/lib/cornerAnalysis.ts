/**
 * Análise profissional por curva: azimute, ângulo varrido, velocidade de
 * ápice e delta de tempo — o dado que telemetria de F1 mostra, calculado
 * a partir do que o app já captura (GPS 10Hz + curvas detectadas).
 *
 * Convenções:
 *   - Coordenadas ENU (x = leste, y = norte), mesmas de geometry.ts.
 *   - Azimute em graus de bússola: 0 = Norte, 90 = Leste, crescendo em
 *     sentido horário. Calculado como atan2(dx_leste, dy_norte).
 *   - Ângulo varrido com sinal: positivo = horário = curva pra DIREITA.
 */

import { ReferenceLap, XY, smoothPolylineXY } from './geometry';
import { Corner } from './corners';
import { MatchedLap, interpolateTimeAtS } from './analysis';

export type CornerMetric = {
  corner: Corner;
  /** 'right' = sentido horário (ângulo varrido positivo). */
  direction: 'left' | 'right';
  /** Ângulo total varrido pela curva, em graus (sempre positivo). */
  angleDeg: number;
  /** Azimute da referência na entrada da curva (graus bússola). */
  entryAzimuthDeg: number;
  /** Azimute da referência na saída da curva (graus bússola). */
  exitAzimuthDeg: number;
  /** Azimute no ápice (graus bússola). */
  apexAzimuthDeg: number;
  /** Velocidade mínima do piloto dentro da curva, km/h. null = sem samples ali. */
  minSpeedKmh: number | null;
  /** Velocidade mínima da volta de referência na mesma curva, km/h. */
  refMinSpeedKmh: number | null;
  /** Distância s onde ocorreu a velocidade mínima do piloto. */
  sMinSpeed: number | null;
  /** Tempo do piloto dentro da curva, ms. */
  timeMs: number | null;
  /** Tempo da referência dentro da curva, ms. */
  refTimeMs: number | null;
  /** timeMs - refTimeMs. Positivo = perdeu tempo na curva. */
  deltaMs: number | null;
  /**
   * Quanto o azimute de entrada do piloto desviou da referência, em graus,
   * no referencial da curva: positivo = entrou mais ABERTO (apontando pro
   * lado de fora), negativo = mais fechado. null = dados insuficientes.
   */
  entryOpenDeg: number | null;
  /** False quando o tempo na curva é anômalo (pit/GPS perdido). */
  valid: boolean;
};

const RAD2DEG = 180 / Math.PI;

/** Normaliza pra [0, 360). */
function normAz(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Menor diferença angular a→b em [-180, 180]. */
function azDiff(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Azimute de bússola do vetor a→b (0 = Norte, horário). */
function bearing(a: XY, b: XY): number {
  return normAz(Math.atan2(b.x - a.x, b.y - a.y) * RAD2DEG);
}

/** Ponto cardeal em PT-BR pra um azimute. */
export function cardinal(azimuthDeg: number): string {
  const names = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return names[Math.round(normAz(azimuthDeg) / 45) % 8];
}

/** "142° SE" — formato compacto pros cards e pro mapa. */
export function fmtAzimuth(azimuthDeg: number): string {
  return `${Math.round(normAz(azimuthDeg))}° ${cardinal(azimuthDeg)}`;
}

/** Polyline pré-suavizada + distâncias — base comum de todos os azimutes. */
type SmoothTrack = {
  pts: XY[];
  cum: number[];
  total: number;
};

/**
 * Suaviza a referência com o MESMO raio adaptativo do detectCorners —
 * azimutes e varridos ficam na mesma régua que a detecção de curvas.
 */
function buildSmoothTrack(ref: ReferenceLap): SmoothTrack {
  const avgSpacing = ref.totalLength / Math.max(1, ref.points.length - 1);
  const radius = Math.max(3, avgSpacing * 2);
  return {
    pts: smoothPolylineXY(ref.points, ref.cumulativeDist, radius),
    cum: ref.cumulativeDist,
    total: ref.totalLength,
  };
}

/** Interpola o ponto XY da polyline na distância s. */
function xyAtS(track: SmoothTrack, s: number): XY {
  const { pts, cum, total } = track;
  const clamped = Math.max(0, Math.min(total, s));
  // Linear scan é suficiente: chamado poucas vezes por análise (<100).
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= clamped) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (clamped - cum[i - 1]) / segLen : 0;
      return {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Azimute da trajetória na distância s, medido pela corda
 * s−halfWindow → s+halfWindow. A corda suaviza o ruído do GPS: com 4m pra
 * cada lado, 1m de erro lateral vira <8° de erro angular.
 */
function azimuthAtS(track: SmoothTrack, s: number, halfWindow = 4): number {
  const a = xyAtS(track, s - halfWindow);
  const b = xyAtS(track, s + halfWindow);
  return bearing(a, b);
}

/** Azimute da referência na distância s (corda suavizada de ±halfWindow m). */
export function refAzimuthAtS(ref: ReferenceLap, s: number, halfWindow = 4): number {
  return azimuthAtS(buildSmoothTrack(ref), s, halfWindow);
}

/**
 * Azimute da trajetória REAL do piloto perto da distância s.
 * Acha o matched point mais próximo de s (em distância circular na pista)
 * e mede a corda entre ±windowPts vizinhos — os points são ordenados no
 * tempo, então a corda segue o sentido de percurso do piloto.
 */
function pilotAzimuthAtS(
  matched: MatchedLap,
  s: number,
  windowPts = 3
): number | null {
  const pts = matched.points;
  const refLen = matched.referenceLength;
  if (pts.length < windowPts * 2 + 1 || refLen <= 0) return null;

  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const sNorm = ((pts[i].s % refLen) + refLen) % refLen;
    let d = Math.abs(sNorm - s);
    d = Math.min(d, refLen - d); // distância circular
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  // Se o ponto mais próximo está a mais de 15m, o piloto não passou ali
  // (GPS perdido nesse trecho) — melhor não inventar azimute.
  if (bestIdx < 0 || bestDiff > 15) return null;

  const i0 = Math.max(0, bestIdx - windowPts);
  const i1 = Math.min(pts.length - 1, bestIdx + windowPts);
  const a = pts[i0];
  const b = pts[i1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Corda muito curta = piloto parado ou samples duplicados; azimute não confiável.
  if (Math.sqrt(dx * dx + dy * dy) < 2) return null;
  return bearing({ x: a.x, y: a.y }, { x: b.x, y: b.y });
}

/**
 * Ângulo varrido (com sinal) pela referência entre sStart e sEnd.
 * Amostra o azimute de corda (já suavizado) a cada ~2m e acumula os deltas
 * com unwrap — funciona pra hairpins de 180° e curvas compostas >180°.
 * Somar deltas de heading segmento a segmento acumularia o ruído do GPS
 * (zigue-zague de ±1m vira dezenas de graus falsos por curva).
 * Positivo = horário = direita.
 */
function sweptAngleDeg(track: SmoothTrack, sStart: number, sEnd: number): number {
  const step = 2;
  let total = 0;
  let prev: number | null = null;
  for (let s = sStart; s <= sEnd + 1e-6; s += step) {
    const az = azimuthAtS(track, Math.min(s, sEnd));
    if (prev !== null) total += azDiff(az, prev);
    prev = az;
  }
  return total;
}

/** Velocidade mínima (m/s) do matched lap dentro de [sStart, sEnd]. */
function minSpeedInRange(
  matched: MatchedLap,
  sStart: number,
  sEnd: number
): { speed: number; s: number } | null {
  const refLen = matched.referenceLength;
  if (refLen <= 0) return null;
  let best: { speed: number; s: number } | null = null;
  for (const p of matched.points) {
    const sNorm = ((p.s % refLen) + refLen) % refLen;
    if (sNorm < sStart || sNorm > sEnd) continue;
    if (!best || p.speed < best.speed) {
      best = { speed: p.speed, s: sNorm };
    }
  }
  return best;
}

/**
 * Analisa todas as curvas da volta selecionada.
 *
 * @param matchedReference null quando a volta selecionada É a referência —
 *   nesse caso os campos comparativos (delta, refMinSpeed, entryOpenDeg)
 *   saem null e a UI mostra só os dados absolutos.
 */
export function analyzeCorners(
  corners: Corner[],
  ref: ReferenceLap,
  matchedCurrent: MatchedLap,
  matchedReference: MatchedLap | null
): CornerMetric[] {
  const track = buildSmoothTrack(ref);
  return corners.map((corner) => {
    const swept = sweptAngleDeg(track, corner.sStart, corner.sEnd);
    const direction: 'left' | 'right' = swept >= 0 ? 'right' : 'left';

    const entryAz = azimuthAtS(track, corner.sStart);
    const exitAz = azimuthAtS(track, corner.sEnd);
    const apexAz = azimuthAtS(track, corner.sApex);

    const minCur = minSpeedInRange(matchedCurrent, corner.sStart, corner.sEnd);
    const minRef = matchedReference
      ? minSpeedInRange(matchedReference, corner.sStart, corner.sEnd)
      : null;

    // Tempo dentro da curva (atual e referência)
    const tCurStart = interpolateTimeAtS(matchedCurrent, corner.sStart);
    const tCurEnd = interpolateTimeAtS(matchedCurrent, corner.sEnd);
    const timeMs =
      tCurStart !== null && tCurEnd !== null && tCurEnd > tCurStart
        ? tCurEnd - tCurStart
        : null;

    let refTimeMs: number | null = null;
    if (matchedReference) {
      const tRefStart = interpolateTimeAtS(matchedReference, corner.sStart);
      const tRefEnd = interpolateTimeAtS(matchedReference, corner.sEnd);
      refTimeMs =
        tRefStart !== null && tRefEnd !== null && tRefEnd > tRefStart
          ? tRefEnd - tRefStart
          : null;
    }

    // Mesma heurística de analysis.ts: tempo >5x da referência = pit/GPS perdido.
    const valid =
      timeMs !== null && (refTimeMs === null || timeMs <= refTimeMs * 5);
    const deltaMs =
      valid && timeMs !== null && refTimeMs !== null ? timeMs - refTimeMs : null;

    // Desvio do azimute de entrada do piloto vs referência.
    // Pro piloto "abrir" a entrada, o nariz aponta pro lado de FORA da curva:
    // curva à direita → fora é à esquerda → desvio anti-horário (negativo).
    let entryOpenDeg: number | null = null;
    if (matchedReference) {
      const pilotAz = pilotAzimuthAtS(matchedCurrent, corner.sStart);
      const refAzHere = pilotAzimuthAtS(matchedReference, corner.sStart);
      if (pilotAz !== null && refAzHere !== null) {
        const diff = azDiff(pilotAz, refAzHere);
        entryOpenDeg = direction === 'right' ? -diff : diff;
      }
    }

    return {
      corner,
      direction,
      angleDeg: Math.abs(swept),
      entryAzimuthDeg: entryAz,
      exitAzimuthDeg: exitAz,
      apexAzimuthDeg: apexAz,
      minSpeedKmh: minCur ? minCur.speed * 3.6 : null,
      refMinSpeedKmh: minRef ? minRef.speed * 3.6 : null,
      sMinSpeed: minCur ? minCur.s : null,
      timeMs,
      refTimeMs,
      deltaMs,
      entryOpenDeg,
      valid,
    };
  });
}
