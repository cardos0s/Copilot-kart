/**
 * Análise de volta: pega uma volta de referência + volta do piloto e
 * responde "onde ele perdeu tempo?".
 *
 * Estratégia:
 * 1. Pra cada amostra da volta do piloto, fazer map matching e obter (s, t).
 *    Isso transforma trajetória 2D numa função t = f(s) — tempo em função de
 *    distância percorrida.
 * 2. Fazer o mesmo com a referência.
 * 3. Pra cada valor de s, interpolar linearmente o tempo em ambas as voltas
 *    e calcular delta = t_atual(s) - t_ref(s).
 * 4. Dividir a pista em N mini-setores (ex: 20 de ~40m cada) e sumarizar.
 */

import {
  GpsSample,
  LocalSample,
  ReferenceLap,
  buildReferenceLap,
  makeLocalProjector,
  matchToReference,
} from './geometry';

export type LapRecord = {
  id: string;
  sessionId: string;
  samples: GpsSample[];
  startedAt: number;
  durationMs: number;
};

export type MatchedLap = {
  /** Pra cada sample, distância ao longo da pista e tempo decorrido desde largada */
  points: Array<{ s: number; tMs: number; speed: number; x: number; y: number }>;
  durationMs: number;
  referenceLength: number;
};

/** Processa uma volta contra a referência, gerando mapping (s, t). */
export function matchLapToReference(lap: LapRecord, ref: ReferenceLap): MatchedLap {
  const proj = makeLocalProjector(ref.origin);
  const t0 = lap.samples[0]?.t ?? 0;
  let hintIdx: number | undefined;
  const points: MatchedLap['points'] = [];

  for (const sample of lap.samples) {
    const xy = proj.toXY(sample);
    const match = matchToReference(xy, ref, hintIdx);
    hintIdx = match.segmentIdx;
    points.push({
      s: match.s,
      tMs: sample.t - t0,
      speed: sample.speed,
      x: xy.x,
      y: xy.y,
    });
  }

  return {
    points,
    durationMs: lap.samples[lap.samples.length - 1].t - t0,
    referenceLength: ref.totalLength,
  };
}

/**
 * Interpola tempo em função de s, usando os pontos matched.
 * Retorna ms decorridos quando o piloto passou pela posição `s` metros.
 */
function interpolateTimeAtS(matched: MatchedLap, s: number): number | null {
  const pts = matched.points;
  if (pts.length < 2) return null;
  if (s <= pts[0].s) return pts[0].tMs;
  if (s >= pts[pts.length - 1].s) return pts[pts.length - 1].tMs;

  // Busca binária seria melhor; linear é suficiente pros tamanhos aqui.
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s >= s) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b.s === a.s) return a.tMs;
      const ratio = (s - a.s) / (b.s - a.s);
      return a.tMs + ratio * (b.tMs - a.tMs);
    }
  }
  return pts[pts.length - 1].tMs;
}

export type Sector = {
  index: number;
  sStart: number;
  sEnd: number;
  referenceMs: number;
  currentMs: number;
  deltaMs: number;           // positivo = perdeu tempo; negativo = ganhou
  avgSpeedRef: number;       // m/s
  avgSpeedCurrent: number;   // m/s
  /**
   * False quando os dados desse setor são suspeitos:
   *   - curMs == 0 (sem amostras na volta atual — interpolação falhou)
   *   - curMs > 3x refMs (provavelmente pit-in / sinal perdido)
   * Setores inválidos não devem entrar em estatísticas de "onde ganhou/perdeu".
   */
  valid: boolean;
};

export type LapAnalysis = {
  totalDeltaMs: number;
  sectors: Sector[];
  worstSectorIdx: number;
  bestSectorIdx: number;
};

/**
 * Compara uma volta contra a referência, dividindo a pista em `sectorCount`
 * mini-setores iguais em distância. Retorna análise com deltas por setor.
 */
export function analyzeLap(
  matchedCurrent: MatchedLap,
  matchedReference: MatchedLap,
  sectorCount: number = 20
): LapAnalysis {
  const trackLen = matchedCurrent.referenceLength;
  const sectorLen = trackLen / sectorCount;
  const sectors: Sector[] = [];

  for (let i = 0; i < sectorCount; i++) {
    const sStart = i * sectorLen;
    const sEnd = (i + 1) * sectorLen;

    const tRefStart = interpolateTimeAtS(matchedReference, sStart) ?? 0;
    const tRefEnd = interpolateTimeAtS(matchedReference, sEnd) ?? 0;
    const tCurStart = interpolateTimeAtS(matchedCurrent, sStart) ?? 0;
    const tCurEnd = interpolateTimeAtS(matchedCurrent, sEnd) ?? 0;

    const refMs = tRefEnd - tRefStart;
    const curMs = tCurEnd - tCurStart;
    const avgSpeedRef = refMs > 0 ? sectorLen / (refMs / 1000) : 0;
    const avgSpeedCur = curMs > 0 ? sectorLen / (curMs / 1000) : 0;

    // Setor inválido = sem dados (interpolação retornou tempo idêntico nos dois
    // extremos, indicando que o piloto não passou por essa região) ou tempo
    // muito anômalo (>5x da referência, kart parado em pit-in ou box).
    // 5x é tolerante o bastante pra aceitar out-laps em ritmo lento mas
    // ainda descartar segmentos onde o GPS perdeu o piloto.
    const valid = curMs > 0 && refMs > 0 && curMs <= refMs * 5;

    sectors.push({
      index: i,
      sStart,
      sEnd,
      referenceMs: refMs,
      currentMs: curMs,
      deltaMs: valid ? curMs - refMs : 0,
      avgSpeedRef,
      avgSpeedCurrent: avgSpeedCur,
      valid,
    });
  }

  const totalDeltaMs = matchedCurrent.durationMs - matchedReference.durationMs;
  // Ignora setores inválidos pra escolher pior/melhor — senão um setor "sem dados"
  // dominaria a estatística com delta zerado ou anômalo.
  const validIdx = sectors
    .map((sec, i) => (sec.valid ? i : -1))
    .filter((i) => i >= 0);
  let worst = validIdx[0] ?? 0;
  let best = validIdx[0] ?? 0;
  for (const i of validIdx) {
    if (sectors[i].deltaMs > sectors[worst].deltaMs) worst = i;
    if (sectors[i].deltaMs < sectors[best].deltaMs) best = i;
  }

  return {
    totalDeltaMs,
    sectors,
    worstSectorIdx: worst,
    bestSectorIdx: best,
  };
}

/**
 * Dada uma lista de voltas da mesma sessão, escolhe a melhor como referência
 * e analisa todas as outras contra ela.
 */
export function analyzeSession(laps: LapRecord[]) {
  if (laps.length === 0) return null;

  // Pega a mais rápida como referência (ou a primeira se só houver uma).
  const sorted = [...laps].sort((a, b) => a.durationMs - b.durationMs);
  const best = sorted[0];

  const refLap = buildReferenceLap(
    best.samples,
    { lat: best.samples[0].lat, lng: best.samples[0].lng }
  );
  const matchedBest = matchLapToReference(best, refLap);

  const analyses = laps.map((lap) => ({
    lapId: lap.id,
    durationMs: lap.durationMs,
    isReference: lap.id === best.id,
    analysis:
      lap.id === best.id
        ? null
        : analyzeLap(matchLapToReference(lap, refLap), matchedBest),
  }));

  return { referenceLapId: best.id, referenceLap: refLap, laps: analyses };
}

/** Filtro simples pra remover amostras com accuracy ruim antes de analisar. */
export function cleanSamples(samples: GpsSample[], maxAccuracyM: number = 10): GpsSample[] {
  return samples.filter((s) => s.accuracy <= maxAccuracyM);
}
