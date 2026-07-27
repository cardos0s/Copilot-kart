/**
 * Pilot DNA — a identidade técnica do piloto, agregada de TODAS as sessões.
 *
 * Não é relatório de uma volta: é o perfil de estilo que persiste e evolui.
 * Cada sessão contribui com métricas por curva (cornerAnalysis) e a agregação
 * responde: como esse piloto entra em curva? Onde ele brilha? Onde ele
 * perde recorrentemente? Quão consistente ele é?
 *
 * Filosofia de confiança: com poucos dados o DNA mostra "perfil inicial" e
 * NÃO afirma traços que a estatística não sustenta. Cada traço tem um
 * mínimo de amostras pra ser emitido — melhor dizer "ainda calibrando" que
 * inventar identidade.
 */

import {
  LapRecord,
  cleanSamples,
  matchLapToReference,
  repairDegenerateTimestamps,
} from './analysis';
import { buildReferenceLap } from './geometry';
import { detectCorners } from './corners';
import { CornerMetric, analyzeCorners } from './cornerAnalysis';

// ============================================================================
// Tipos
// ============================================================================

export type CornerClass = 'hairpin' | 'media' | 'rapida';

export type DnaTrait = {
  /** Rótulo curto, ex: "Entrada de curva". */
  label: string;
  /** Valor legível, ex: "Agressiva" ou "Vira cedo". */
  value: string;
  /** Detalhe numérico opcional, ex: "média −7° vs referência". */
  detail?: string;
  /** 'good' | 'neutral' | 'attention' — pinta o valor na UI. */
  tone: 'good' | 'neutral' | 'attention';
};

export type PrescribedExercise = {
  trackName: string;
  cornerName: string;
  /** Diagnóstico em uma frase. */
  problem: string;
  /** Passos do exercício. */
  steps: string[];
  /** Critérios de sucesso mensuráveis. */
  successCriteria: string[];
};

export type PilotDna = {
  /** Traços emitidos (só os que têm amostra suficiente). */
  traits: DnaTrait[];
  /** Consistência 0-100 (100 = voltas idênticas). */
  consistencyPct: number | null;
  /** Exercício prescrito pra próxima bateria (da pista mais recente). */
  exercise: PrescribedExercise | null;
  /** Volume de dados por trás do perfil. */
  sessionsUsed: number;
  lapsUsed: number;
  cornersAnalyzed: number;
  /** True quando há dados de sobra pra confiar no perfil (>=3 sessões). */
  mature: boolean;
};

// ============================================================================
// Classificação de curvas
// ============================================================================

export function classifyCorner(angleDeg: number): CornerClass {
  if (angleDeg >= 120) return 'hairpin';
  if (angleDeg >= 60) return 'media';
  return 'rapida';
}

const CLASS_LABEL: Record<CornerClass, string> = {
  hairpin: 'Hairpins',
  media: 'Curvas médias',
  rapida: 'Alta velocidade',
};

// ============================================================================
// Agregação
// ============================================================================

type SessionAnalysis = {
  trackName: string;
  startedAt: number;
  lapTimesMs: number[];
  /** Métricas de todas as voltas não-referência da sessão. */
  metrics: CornerMetric[];
  /** Velocidade de entrada da referência por curva (pro exercício). */
  refEntrySpeedKmh: Map<number, number>;
};

/** Mínimos de amostra pra emitir cada traço. */
const MIN_CORNERS_FOR_ENTRY_TRAIT = 8;
const MIN_CORNERS_PER_CLASS = 4;
const MIN_LAPS_FOR_CONSISTENCY = 4;

/**
 * Analisa uma sessão: melhor volta vira referência, demais voltas geram
 * cornerMetrics contra ela. Sessões de 1 volta contribuem só com tempo.
 */
function analyzeSession(
  trackName: string,
  startedAt: number,
  laps: LapRecord[]
): SessionAnalysis | null {
  const prepared = laps
    .map((l) => {
      const cleaned = cleanSamples(l.samples, 10);
      const { samples } = repairDegenerateTimestamps(cleaned, l.durationMs, l.startedAt);
      return { ...l, samples };
    })
    .filter((l) => l.samples.length >= 10);
  if (prepared.length === 0) return null;

  const best = prepared.reduce((b, l) => (l.durationMs < b.durationMs ? l : b));
  const lapTimesMs = prepared.map((l) => l.durationMs);

  const result: SessionAnalysis = {
    trackName,
    startedAt,
    lapTimesMs,
    metrics: [],
    refEntrySpeedKmh: new Map(),
  };

  try {
    const ref = buildReferenceLap(best.samples, {
      lat: best.samples[0].lat,
      lng: best.samples[0].lng,
    });
    const corners = detectCorners(ref);
    if (corners.length === 0) return result;
    const matchedBest = matchLapToReference(best, ref);

    // Velocidade de entrada da referência por curva — alvo dos exercícios
    const refLen = ref.totalLength;
    for (const c of corners) {
      let bestDiff = Infinity;
      let speed: number | null = null;
      for (const p of matchedBest.points) {
        const sNorm = refLen > 0 ? ((p.s % refLen) + refLen) % refLen : 0;
        const d0 = Math.abs(sNorm - c.sStart);
        const d = Math.min(d0, refLen - d0);
        if (d < bestDiff) {
          bestDiff = d;
          speed = p.speed;
        }
      }
      if (speed !== null && bestDiff < 15) {
        result.refEntrySpeedKmh.set(c.index, speed * 3.6);
      }
    }

    for (const lap of prepared) {
      if (lap.id === best.id) continue;
      const matched = matchLapToReference(lap, ref);
      result.metrics.push(...analyzeCorners(corners, ref, matched, matchedBest));
    }
  } catch {
    // Sessão com GPS ruim contribui só com tempos de volta
  }

  return result;
}

/** Desvio-padrão relativo → consistência 0-100. Mesma régua da home. */
function computeConsistency(lapTimesMs: number[]): number | null {
  if (lapTimesMs.length < MIN_LAPS_FOR_CONSISTENCY) return null;
  const mean = lapTimesMs.reduce((a, b) => a + b, 0) / lapTimesMs.length;
  if (mean <= 0) return null;
  const variance =
    lapTimesMs.reduce((acc, t) => acc + (t - mean) ** 2, 0) / lapTimesMs.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(100, Math.round(100 - cv * 1000)));
}

export type DnaSessionInput = {
  trackName: string;
  startedAt: number;
  laps: LapRecord[];
};

/**
 * Computa o Pilot DNA a partir das sessões fornecidas (mais recente
 * primeiro). Função PURA — o caller carrega do banco; isso permite testar
 * o motor com dados reais fora do app.
 */
export function buildPilotDna(sessions: DnaSessionInput[]): PilotDna {
  const analyses: SessionAnalysis[] = [];

  for (const session of sessions) {
    if (session.laps.length === 0) continue;
    const a = analyzeSession(session.trackName, session.startedAt, session.laps);
    if (a) analyses.push(a);
  }

  const allMetrics = analyses.flatMap((a) => a.metrics);
  const validMetrics = allMetrics.filter((m) => m.valid);
  const allLapTimes = analyses.flatMap((a) => a.lapTimesMs);

  const traits: DnaTrait[] = [];

  // ===== Tendência de entrada (virar cedo vs tarde) =====
  const entryDeltas = validMetrics
    .map((m) => m.entryOpenDeg)
    .filter((d): d is number => d !== null);
  if (entryDeltas.length >= MIN_CORNERS_FOR_ENTRY_TRAIT) {
    const mean = entryDeltas.reduce((a, b) => a + b, 0) / entryDeltas.length;
    if (Math.abs(mean) < 3) {
      traits.push({
        label: 'Entrada de curva',
        value: 'Precisa',
        detail: `desvio médio de ${Math.abs(mean).toFixed(0)}° vs referência`,
        tone: 'good',
      });
    } else if (mean > 0) {
      traits.push({
        label: 'Entrada de curva',
        value: 'Vira tarde (aberta)',
        detail: `média +${mean.toFixed(0)}° mais aberto que a referência`,
        tone: 'attention',
      });
    } else {
      traits.push({
        label: 'Entrada de curva',
        value: 'Vira cedo (fechada)',
        detail: `média ${mean.toFixed(0)}° mais fechado que a referência`,
        tone: 'attention',
      });
    }
  }

  // ===== Melhor e pior tipo de curva =====
  const byClass = new Map<CornerClass, number[]>();
  for (const m of validMetrics) {
    if (m.deltaMs === null) continue;
    const cls = classifyCorner(m.angleDeg);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(m.deltaMs);
  }
  const classAvgs = [...byClass.entries()]
    .filter(([, deltas]) => deltas.length >= MIN_CORNERS_PER_CLASS)
    .map(([cls, deltas]) => ({
      cls,
      avgDeltaMs: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      n: deltas.length,
    }))
    .sort((a, b) => a.avgDeltaMs - b.avgDeltaMs);
  if (classAvgs.length >= 2) {
    const best = classAvgs[0];
    const worst = classAvgs[classAvgs.length - 1];
    traits.push({
      label: 'Melhor tipo de curva',
      value: CLASS_LABEL[best.cls],
      detail:
        best.avgDeltaMs <= 50
          ? 'no ritmo da sua referência'
          : `perde só ${(best.avgDeltaMs / 1000).toFixed(2)}s em média`,
      tone: 'good',
    });
    traits.push({
      label: 'Maior dificuldade',
      value: CLASS_LABEL[worst.cls],
      detail: `perde ${(Math.max(0, worst.avgDeltaMs) / 1000).toFixed(2)}s em média`,
      tone: 'attention',
    });
  }

  // ===== Perda recorrente (curva que mais aparece como pior da sessão) =====
  const worstPerSessionTrack = new Map<string, number>();
  for (const a of analyses) {
    const worst = a.metrics
      .filter((m) => m.valid && m.deltaMs !== null && m.deltaMs > 100)
      .sort((x, y) => (y.deltaMs ?? 0) - (x.deltaMs ?? 0))[0];
    if (worst) {
      const key = `${a.trackName} · ${worst.corner.name}`;
      worstPerSessionTrack.set(key, (worstPerSessionTrack.get(key) ?? 0) + 1);
    }
  }
  const recurrent = [...worstPerSessionTrack.entries()].sort((a, b) => b[1] - a[1])[0];
  if (recurrent && recurrent[1] >= 2) {
    traits.push({
      label: 'Perda recorrente',
      value: recurrent[0],
      detail: `pior curva em ${recurrent[1]} sessões`,
      tone: 'attention',
    });
  }

  // ===== Consistência =====
  const consistencyPct = computeConsistency(allLapTimes);
  if (consistencyPct !== null) {
    traits.push({
      label: 'Consistência',
      value: `${consistencyPct}%`,
      detail:
        consistencyPct >= 85
          ? 'voltas muito regulares'
          : consistencyPct >= 70
            ? 'regular, com espaço pra ganhar'
            : 'irregular — foco em repetição',
      tone: consistencyPct >= 85 ? 'good' : consistencyPct >= 70 ? 'neutral' : 'attention',
    });
  }

  // ===== Exercício prescrito (da sessão mais recente com diagnóstico) =====
  let exercise: PrescribedExercise | null = null;
  for (const a of analyses) {
    // analyses segue a ordem de listSessions (mais recente primeiro)
    const worst = a.metrics
      .filter((m) => m.valid && m.deltaMs !== null && m.deltaMs > 100)
      .sort((x, y) => (y.deltaMs ?? 0) - (x.deltaMs ?? 0))[0];
    if (!worst) continue;

    const refEntry = a.refEntrySpeedKmh.get(worst.corner.index);
    const openTxt =
      worst.entryOpenDeg !== null && Math.abs(worst.entryOpenDeg) >= 6
        ? worst.entryOpenDeg > 0
          ? 'entrada aberta demais (vira tarde)'
          : 'entrada fechada demais (vira cedo)'
        : 'entrada inconsistente';

    const steps: string[] = [
      'Não tente melhorar a volta inteira',
      `Faça 5 voltas focando SÓ na ${worst.corner.name}`,
    ];
    if (refEntry) {
      steps.push(
        `Mantenha a entrada entre ${Math.round(refEntry - 1)} e ${Math.round(refEntry + 1)} km/h`
      );
    }
    steps.push(
      worst.entryOpenDeg !== null && worst.entryOpenDeg < 0
        ? 'Atrase o ponto de rotação — deixa a curva "abrir" antes de virar'
        : 'Antecipe levemente a rotação e use toda a pista na saída'
    );
    steps.push('Tente variar o azimute de entrada menos de 5° entre passagens');

    exercise = {
      trackName: a.trackName,
      cornerName: worst.corner.name,
      problem: `${openTxt} — perdendo ${((worst.deltaMs ?? 0) / 1000).toFixed(2)}s vs sua referência`,
      steps,
      successCriteria: [
        '3 passagens consecutivas dentro da janela de velocidade',
        `Perda menor que 0,15s na ${worst.corner.name}`,
      ],
    };
    break;
  }

  return {
    traits,
    consistencyPct,
    exercise,
    sessionsUsed: analyses.length,
    lapsUsed: allLapTimes.length,
    cornersAnalyzed: validMetrics.length,
    mature: analyses.length >= 3,
  };
}
