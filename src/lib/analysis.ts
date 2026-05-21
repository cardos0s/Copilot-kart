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
  projectOnSegment,
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
  const totalLength = ref.totalLength;
  let hintIdx: number | undefined;
  const rawS: number[] = [];
  const meta: Array<{ tMs: number; speed: number; x: number; y: number }> = [];

  for (const sample of lap.samples) {
    const xy = proj.toXY(sample);
    const match = matchToReference(xy, ref, hintIdx);
    hintIdx = match.segmentIdx;
    rawS.push(match.s);
    meta.push({
      tMs: sample.t - t0,
      speed: sample.speed,
      x: xy.x,
      y: xy.y,
    });
  }

  // ===== Fix 1: ambiguidade da linha de chegada =====
  // O ponto físico de largada/chegada aparece em DOIS lugares da polyline de
  // referência: no início (s≈0) e no fim (s≈totalLength). Quando o primeiro
  // sample da volta cai no de retorno (fim), o `hintIdx` da iteração seguinte
  // procura em janela ±30 ao redor do fim e nunca consegue voltar pro início
  // — a volta inteira fica "presa" no terço final da pista.
  //
  // Detecção: se o primeiro sample foi pra região do fim (s > 70% total) mas
  // o restante deveria estar no início (poucos samples lá), refaz o primeiro
  // forçando busca apenas na região inicial. Daí o hint da próxima iteração
  // cai no lugar certo e tudo se ajusta.
  if (rawS.length > 5 && totalLength > 0) {
    const samplesAtEnd = rawS.filter((s) => s > totalLength * 0.7).length;
    const ratioAtEnd = samplesAtEnd / rawS.length;
    if (rawS[0] > totalLength * 0.7 && ratioAtEnd > 0.5) {
      const firstXY = { x: meta[0].x, y: meta[0].y };
      let altDist = Infinity;
      let altS = 0;
      // Busca SÓ no primeiro terço da polyline pra forçar match no início
      const searchEnd = Math.max(2, Math.floor(ref.points.length * 0.35));
      for (let i = 0; i < searchEnd - 1; i++) {
        const a = ref.points[i];
        const b = ref.points[i + 1];
        const { dist, t } = projectOnSegment(firstXY, a, b);
        if (dist < altDist) {
          altDist = dist;
          const segLen = ref.cumulativeDist[i + 1] - ref.cumulativeDist[i];
          altS = ref.cumulativeDist[i] + t * segLen;
        }
      }
      // Aceita se a match alternativa não estiver absurdamente longe (até 25m).
      // 25m cobre tracks largas — kart de rental tem pista de ~6-10m de largura.
      if (altDist < 25) {
        rawS[0] = altS;
        // Re-roda map matching dos próximos samples com hint corrigido
        let newHint = Math.floor((altS / totalLength) * (ref.points.length - 1));
        for (let i = 1; i < lap.samples.length; i++) {
          const xy = { x: meta[i].x, y: meta[i].y };
          const m = matchToReference(xy, ref, newHint);
          rawS[i] = m.s;
          newHint = m.segmentIdx;
        }
      }
    }
  }

  // ===== Fix 2: unwrap pra `s` ficar monotonicamente crescente =====
  // Se a volta cruza a linha de chegada no meio (lap detector recortou um
  // pouco antes do ponto exato), os últimos samples podem ter s≈0 enquanto
  // os anteriores estão em s≈totalLength. Pra interpolateTimeAtS funcionar,
  // os pts.s precisam ser monotônicos — então somamos totalLength quando
  // detectamos wrap (s caiu mais que metade do traçado).
  let offset = 0;
  const points: MatchedLap['points'] = [];
  for (let i = 0; i < rawS.length; i++) {
    if (i > 0 && totalLength > 0) {
      const prevSWithOffset = points[i - 1].s;
      const currSWithOffset = rawS[i] + offset;
      if (currSWithOffset < prevSWithOffset - totalLength / 2) {
        offset += totalLength;
      }
    }
    points.push({
      s: rawS[i] + offset,
      ...meta[i],
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
 *
 * Suporta `pts` "unwrapped" (s pode ultrapassar referenceLength quando a
 * volta cruzou a linha de chegada — ver Fix 2 em matchLapToReference).
 * O `s` solicitado está sempre em [0, referenceLength); a função desloca
 * pra alinhar com o range real de pts antes de interpolar.
 */
function interpolateTimeAtS(matched: MatchedLap, s: number): number | null {
  const pts = matched.points;
  if (pts.length < 2) return null;

  // Se pts foi "unwrapped" (primeiro s já passou de uma volta), shift o
  // target em múltiplos de referenceLength até cair no range de pts.
  let target = s;
  const refLen = matched.referenceLength;
  if (refLen > 0) {
    while (target < pts[0].s) target += refLen;
  }

  if (target <= pts[0].s) return pts[0].tMs;
  if (target >= pts[pts.length - 1].s) return pts[pts.length - 1].tMs;

  // Busca binária seria melhor; linear é suficiente pros tamanhos aqui.
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s >= target) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b.s === a.s) return a.tMs;
      const ratio = (target - a.s) / (b.s - a.s);
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

/**
 * Detecta voltas com `sample.t` degenerado (todos os timestamps iguais ou
 * span muito menor que a duração conhecida da volta) e reescreve `t` com
 * espaçamento linear baseado em `durationMs`.
 *
 * Por que existe: algumas builds Expo/Android entregam `loc.timestamp = 0`
 * em todas as fixes GPS. Os samples saem com posição/velocidade corretas
 * mas timestamps iguais. Resultado: `matchLapToReference` produz
 * `tMs = 0` em todos os pontos → `interpolateTimeAtS` sempre retorna 0 →
 * cada setor calcula `curMs = 0` → tudo marcado inválido → tela mostra
 * "Confiança baixa 20/20".
 *
 * Limitação: o reparo distribui tempo uniformemente. Não recupera onde o
 * piloto perdeu/ganhou tempo dentro da volta (essa informação foi perdida
 * na gravação). Mas viabiliza pelo menos:
 *   - peak speed por setor (vinha do `sample.speed`, que tava OK)
 *   - delta TOTAL da volta (vem de `durationMs`, também OK)
 *   - mostrar a volta no mapa colorida pelo delta proporcional
 *
 * Retorna `{ samples, repaired }` — `repaired = true` quando precisou
 * reescrever, pra UI poder sinalizar que os tempos por setor são aproximados.
 */
export function repairDegenerateTimestamps(
  samples: GpsSample[],
  durationMs: number,
  baseT?: number
): { samples: GpsSample[]; repaired: boolean } {
  if (samples.length < 2 || durationMs <= 0) {
    return { samples, repaired: false };
  }
  const span = samples[samples.length - 1].t - samples[0].t;
  // Threshold: se o span é pelo menos metade da durationMs, confia. Caso
  // contrário (timestamps degenerados ou faltando muito), reescreve.
  if (span >= durationMs / 2) {
    return { samples, repaired: false };
  }
  const t0 = baseT ?? samples[0].t ?? 0;
  const repairedSamples = samples.map((s, i) => ({
    ...s,
    t: t0 + (i / (samples.length - 1)) * durationMs,
  }));
  return { samples: repairedSamples, repaired: true };
}
