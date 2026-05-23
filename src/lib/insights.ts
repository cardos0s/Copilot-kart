/**
 * Geração de insights "smart" — específicos por setor e tendências
 * entre sessões. Substitui as heurísticas genéricas anteriores.
 *
 * Filosofia:
 *   1. Insights só fazem sentido quando há contexto suficiente.
 *      Sem dados → não inventa; mostra empty state honesto.
 *   2. Sempre apontam ONDE ou O QUE — generic "boa repetição" não vale.
 *   3. Comparações dentro da MESMA PISTA. Voltas em pistas diferentes não
 *      são comparáveis.
 *   4. Janela curta (3 sessões) — relevância recente > histórico completo.
 */

import {
  listSessions,
  getLapsForSession,
  getTrackReference,
  Session,
} from '../storage/db';
import { LapRecord, analyzeLap, cleanSamples, matchLapToReference } from './analysis';
import { buildReferenceLap } from './geometry';
import { detectCorners, describeSector } from './corners';
import { findTrackById } from '../data/tracks';
import { peakSpeedMs, msToKmh } from './speed';

export type SmartInsight = {
  type: 'strong' | 'attention' | 'opportunity' | 'trend';
  title: string;
  body: string;
  /** ID de sessão pra deep-link (futuro: tap → abre sessão). */
  sessionId?: string;
};

export type InsightsBundle = {
  /** Estatísticas agregadas (mostradas como labels). */
  stats: {
    bestLapMs: number | null;
    avgLapMs: number | null;
    lapCount: number;
    sessionCount: number;
    peakKmh: number;
  };
  /** Score 0-100. */
  score: number;
  /** Componentes do score pra explicar o número. */
  scoreBreakdown: {
    consistency: number;
    pace: number;
    cleanLap: number;
  };
  insights: SmartInsight[];
};

function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms / 1000).toFixed(2)}s`;
}

/**
 * Janela default: 3 sessões mais recentes.
 */
export async function computeSmartInsights(opts?: {
  window?: number;
}): Promise<InsightsBundle> {
  const window = opts?.window ?? 3;

  const allSessions = await listSessions();
  const recentSessions = allSessions.slice(0, window);

  // Empty state
  if (recentSessions.length === 0) {
    return {
      stats: { bestLapMs: null, avgLapMs: null, lapCount: 0, sessionCount: 0, peakKmh: 0 },
      score: 0,
      scoreBreakdown: { consistency: 0, pace: 0, cleanLap: 0 },
      insights: [
        {
          type: 'opportunity',
          title: 'Vamos começar',
          body: 'Faça sua primeira sessão pra desbloquear insights sobre suas voltas.',
        },
      ],
    };
  }

  // Carrega todas as voltas das sessões recentes
  type SessionWithLaps = { session: Session; laps: LapRecord[]; bestLap: LapRecord | null };
  const sessionData: SessionWithLaps[] = await Promise.all(
    recentSessions.map(async (sess) => {
      const lapsRaw = await getLapsForSession(sess.id);
      const laps = lapsRaw.map((l) => ({ ...l, samples: cleanSamples(l.samples, 10) }));
      const bestLap = laps.length
        ? laps.reduce((a, b) => (a.durationMs < b.durationMs ? a : b))
        : null;
      return { session: sess, laps, bestLap };
    })
  );

  const validSessions = sessionData.filter((sd) => sd.bestLap !== null);

  // Estatísticas básicas
  const allLaps = validSessions.flatMap((sd) => sd.laps);
  const allDurations = allLaps.map((l) => l.durationMs);
  const bestLapMs = allDurations.length ? Math.min(...allDurations) : null;
  const avgLapMs = allDurations.length
    ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    : null;
  const peakKmh = allLaps.length ? msToKmh(Math.max(0, ...allLaps.map((l) => peakSpeedMs(l.samples)))) : 0;

  // Score com 3 componentes
  const scoreBreakdown = computeScore(allDurations);
  const score = Math.round(
    (scoreBreakdown.consistency + scoreBreakdown.pace + scoreBreakdown.cleanLap) / 3
  );

  // Insights
  const insights: SmartInsight[] = [];

  // 1. Trend por pista (compara melhor volta entre sessões da mesma pista)
  insights.push(...computeTrackTrends(validSessions));

  // 2. Padrão de setor (qual trecho aparece como pior nas voltas recentes)
  const sectorInsight = await computeRecurringWorstSector(validSessions);
  if (sectorInsight) insights.push(sectorInsight);

  // 3. Trend de pico de velocidade
  const speedTrend = computeSpeedTrend(validSessions);
  if (speedTrend) insights.push(speedTrend);

  // 4. Consistência forte
  if (scoreBreakdown.consistency >= 85 && allDurations.length >= 5) {
    insights.push({
      type: 'strong',
      title: 'Consistência boa',
      body: `Suas voltas variam pouco (${scoreBreakdown.consistency}/100). Base sólida — agora foque em baixar o tempo absoluto.`,
    });
  }

  // 5. Oportunidade — encoraja mais voltas se faltam
  if (allLaps.length < 5) {
    insights.push({
      type: 'opportunity',
      title: 'Acumule mais voltas',
      body: 'Com 5+ voltas em uma pista a análise por setor fica muito mais precisa. Hoje você tem ' +
        `${allLaps.length} volta${allLaps.length === 1 ? '' : 's'}.`,
    });
  }

  return {
    stats: {
      bestLapMs,
      avgLapMs,
      lapCount: allLaps.length,
      sessionCount: validSessions.length,
      peakKmh,
    },
    score,
    scoreBreakdown,
    insights: insights.slice(0, 4),
  };
}

/**
 * Score com 3 componentes 0-100:
 *   - Consistência (std/best)
 *   - Pace (gap avg vs best)
 *   - Volta limpa (best lap rank)
 *
 * Os 3 componentes são heurísticos — a fórmula vai ser refinada quando
 * tivermos baseline por pista/categoria.
 */
function computeScore(durations: number[]): {
  consistency: number;
  pace: number;
  cleanLap: number;
} {
  if (durations.length < 2) return { consistency: 70, pace: 70, cleanLap: 70 };

  const sorted = [...durations].sort((a, b) => a - b);
  // Tira top outlier (in/out laps)
  const cut = Math.max(2, Math.floor(sorted.length * 0.8));
  const sample = sorted.slice(0, cut);
  const best = sample[0];
  const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
  const variance = sample.reduce((a, b) => a + (b - avg) ** 2, 0) / sample.length;
  const std = Math.sqrt(variance);

  const stdRatio = std / best;
  const gapRatio = (avg - best) / best;

  // Maps relativos
  const consistency = Math.round(Math.max(0, Math.min(100, (1 - stdRatio * 8) * 100)));
  const pace = Math.round(Math.max(0, Math.min(100, (1 - gapRatio * 6) * 100)));
  // cleanLap = quão próximo a best está do percentil 10 (não-outlier rápido)
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const cleanRatio = best / p10;
  const cleanLap = Math.round(Math.max(0, Math.min(100, cleanRatio * 100)));

  return { consistency, pace, cleanLap };
}

function computeTrackTrends(
  sessionData: { session: Session; laps: LapRecord[]; bestLap: LapRecord | null }[]
): SmartInsight[] {
  // Agrupa por trackId (ignora sessões sem track ID)
  const byTrack = new Map<string, { session: Session; bestLap: LapRecord }[]>();
  for (const sd of sessionData) {
    if (!sd.session.trackId || !sd.bestLap) continue;
    const arr = byTrack.get(sd.session.trackId) ?? [];
    arr.push({ session: sd.session, bestLap: sd.bestLap });
    byTrack.set(sd.session.trackId, arr);
  }

  const insights: SmartInsight[] = [];
  for (const [trackId, sessions] of byTrack.entries()) {
    if (sessions.length < 2) continue;
    const track = findTrackById(trackId);
    const trackName = track?.shortName ?? sessions[0].session.trackName;

    // sessions[0] é a mais recente (lista vem ordenada DESC)
    const latest = sessions[0];
    const previous = sessions[1];
    const deltaMs = latest.bestLap.durationMs - previous.bestLap.durationMs;

    if (deltaMs < -200) {
      insights.push({
        type: 'strong',
        title: `${trackName}: mais rápido`,
        body: `Sua melhor volta caiu de ${fmtLap(previous.bestLap.durationMs)} pra ${fmtLap(
          latest.bestLap.durationMs
        )} — ${(Math.abs(deltaMs) / 1000).toFixed(2)}s melhor que a sessão anterior.`,
        sessionId: latest.session.id,
      });
    } else if (deltaMs > 500) {
      insights.push({
        type: 'attention',
        title: `${trackName}: mais lento`,
        body: `Sua melhor volta subiu ${(deltaMs / 1000).toFixed(
          2
        )}s vs sessão anterior (de ${fmtLap(previous.bestLap.durationMs)} pra ${fmtLap(
          latest.bestLap.durationMs
        )}). Pode ser kart, pista ou pilotagem.`,
        sessionId: latest.session.id,
      });
    } else if (Math.abs(deltaMs) <= 200) {
      insights.push({
        type: 'trend',
        title: `${trackName}: ritmo estável`,
        body: `Sua melhor volta variou só ${fmtDelta(deltaMs)} vs sessão anterior. Estável — bom momento pra atacar setores específicos.`,
        sessionId: latest.session.id,
      });
    }
  }

  return insights;
}

/**
 * Identifica o setor onde o piloto perde tempo de forma RECORRENTE.
 * Para isso, analisa cada volta válida contra a referência da pista,
 * pega o pior setor de cada volta, e conta a frequência.
 *
 * Se um mesmo setor aparece como pior em >= 50% das voltas analisadas,
 * gera insight "foque em X".
 */
async function computeRecurringWorstSector(
  sessionData: { session: Session; laps: LapRecord[]; bestLap: LapRecord | null }[]
): Promise<SmartInsight | null> {
  // Agrupa por trackId
  const byTrack = new Map<string, { session: Session; laps: LapRecord[] }[]>();
  for (const sd of sessionData) {
    if (!sd.session.trackId || sd.laps.length === 0) continue;
    const arr = byTrack.get(sd.session.trackId) ?? [];
    arr.push({ session: sd.session, laps: sd.laps });
    byTrack.set(sd.session.trackId, arr);
  }

  // Pega a pista com mais voltas pra analisar
  let bestTrack: { trackId: string; sessions: { session: Session; laps: LapRecord[] }[] } | null = null;
  let mostLaps = 0;
  for (const [trackId, sessions] of byTrack.entries()) {
    const total = sessions.reduce((a, s) => a + s.laps.length, 0);
    if (total > mostLaps) {
      mostLaps = total;
      bestTrack = { trackId, sessions };
    }
  }
  if (!bestTrack || mostLaps < 3) return null;

  // Carrega referência + corners
  const ref = await getTrackReference(bestTrack.trackId);
  if (!ref || ref.samples.length < 5) return null;

  let refLap: ReturnType<typeof buildReferenceLap>;
  try {
    refLap = buildReferenceLap(ref.samples, {
      lat: ref.samples[0].lat,
      lng: ref.samples[0].lng,
    });
  } catch {
    return null;
  }
  const corners = detectCorners(refLap);

  const matchedRef = matchLapToReference(
    {
      id: 'ref',
      sessionId: 'ref',
      startedAt: 0,
      durationMs: ref.durationMs,
      samples: ref.samples,
    },
    refLap
  );

  // Conta worstSector por volta
  type SectorStats = { count: number; totalDeltaMs: number; label: string };
  const sectorStats = new Map<number, SectorStats>();
  let analyzed = 0;

  for (const s of bestTrack.sessions) {
    for (const lap of s.laps) {
      if (lap.samples.length < 5) continue;
      try {
        const matched = matchLapToReference(lap, refLap);
        const analysis = analyzeLap(matched, matchedRef, 20);
        const validSecs = analysis.sectors.filter((sec) => sec.valid !== false);
        if (validSecs.length === 0) continue;
        const worst = validSecs.reduce((a, b) => (b.deltaMs > a.deltaMs ? b : a));
        if (worst.deltaMs < 150) continue; // perda mínima pra contar (150ms)
        const label = describeSector(worst, corners);
        const prev = sectorStats.get(worst.index) ?? { count: 0, totalDeltaMs: 0, label };
        prev.count++;
        prev.totalDeltaMs += worst.deltaMs;
        sectorStats.set(worst.index, prev);
        analyzed++;
      } catch {
        // pula voltas que não casam com a referência
      }
    }
  }

  if (analyzed < 3) return null;
  const entries = [...sectorStats.entries()].sort((a, b) => b[1].count - a[1].count);
  if (entries.length === 0) return null;
  const [, top] = entries[0];
  const ratio = top.count / analyzed;
  if (ratio < 0.4) return null; // não tem padrão claro

  const avgLossSec = top.totalDeltaMs / top.count / 1000;

  return {
    type: 'attention',
    title: `Foque em ${top.label}`,
    body:
      `Em ${top.count} das ${analyzed} voltas analisadas você perdeu tempo aqui ` +
      `(média +${avgLossSec.toFixed(2)}s/volta). Treinar esse trecho ` +
      `tem potencial de economizar até ${(avgLossSec * top.count).toFixed(1)}s na próxima sessão.`,
  };
}

function computeSpeedTrend(
  sessionData: { session: Session; laps: LapRecord[]; bestLap: LapRecord | null }[]
): SmartInsight | null {
  // Agrupa por trackId
  const byTrack = new Map<string, { session: Session; peakKmh: number }[]>();
  for (const sd of sessionData) {
    if (!sd.session.trackId) continue;
    let peak = 0;
    for (const lap of sd.laps) {
      const p = peakSpeedMs(lap.samples);
      if (p > peak) peak = p;
    }
    if (peak <= 0) continue;
    const arr = byTrack.get(sd.session.trackId) ?? [];
    arr.push({ session: sd.session, peakKmh: msToKmh(peak) });
    byTrack.set(sd.session.trackId, arr);
  }

  for (const sessions of byTrack.values()) {
    if (sessions.length < 2) continue;
    const latest = sessions[0];
    const previous = sessions[1];
    const diff = latest.peakKmh - previous.peakKmh;
    if (Math.abs(diff) < 3) continue;

    const track = findTrackById(latest.session.trackId!);
    const trackName = track?.shortName ?? latest.session.trackName;

    if (diff > 0) {
      return {
        type: 'strong',
        title: `Pico de velocidade subiu`,
        body: `Você bateu ${latest.peakKmh.toFixed(0)} km/h em ${trackName} (era ${previous.peakKmh.toFixed(
          0
        )} km/h). +${diff.toFixed(0)} km/h vs sessão anterior.`,
      };
    } else {
      return {
        type: 'trend',
        title: 'Pico de velocidade caiu',
        body: `Seu pico em ${trackName} caiu de ${previous.peakKmh.toFixed(0)} pra ${latest.peakKmh.toFixed(
          0
        )} km/h. Pode ser saída de curva, kart, ou trecho diferente da reta.`,
      };
    }
  }
  return null;
}
