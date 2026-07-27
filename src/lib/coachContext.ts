/**
 * Carregamento dos dados que o Coach IA precisa pra analisar uma volta.
 *
 * Usado pela tela `/coach` (chat full-screen) — recebe sessionId+lapId
 * nos query params, monta o input pra `requestAiAnalysis` e os metadados
 * pra UI exibir contexto ("Pista X · Volta Y · Tempo Z").
 *
 * Reaproveita exatamente as mesmas funções que a tela de sessão usa
 * (cleanSamples, repairDegenerateTimestamps, buildReferenceLap,
 * matchLapToReference, analyzeLap) — qualquer mudança na pipeline de
 * análise se reflete aqui automaticamente. Duplicação de lógica zero.
 */

import {
  getDefaultLayoutForTrack,
  getLapsForSession,
  getLayout,
  getSession,
  Session,
  TrackLayout,
} from '../storage/db';
import {
  LapRecord,
  analyzeLap,
  cleanSamples,
  matchLapToReference,
  repairDegenerateTimestamps,
} from './analysis';
import { buildReferenceLap } from './geometry';
import { detectCorners } from './corners';
import { CornerMetric, analyzeCorners } from './cornerAnalysis';
import { getProfile } from '../storage/profile';
import { buildHistoryContext, HistoryContext } from './historyContext';
import { PilotContext } from './analysisPrompt';

export type CoachContext = {
  /** Sessão da volta. */
  session: Session;
  /** A volta selecionada, já com samples reparadas. */
  lap: LapRecord;
  /** Tempo da referência usada (saved track ref ou melhor volta da sessão). */
  refDurationMs: number;
  /** Análise pronta pra enviar pro requestAiAnalysis. */
  analysis: ReturnType<typeof analyzeLap>;
  /** Métricas por curva (azimute, ápice, delta) — [] se detecção falhou. */
  cornerMetrics: CornerMetric[];
  /** Nome amigável da pista. */
  trackName: string;
  /** Perfil do piloto, se houver. */
  pilot: PilotContext | null;
  /** Histórico nessa pista, se houver. */
  history: HistoryContext | null;
};

export type LoadResult =
  | { kind: 'ok'; context: CoachContext }
  | { kind: 'no-session' }
  | { kind: 'no-lap' }
  | { kind: 'too-short' }
  | { kind: 'error'; error: Error };

export async function loadCoachContext(
  sessionId: string,
  lapId: string
): Promise<LoadResult> {
  try {
    const session = await getSession(sessionId);
    if (!session) return { kind: 'no-session' };

    const allLaps = await getLapsForSession(sessionId);
    if (allLaps.length === 0) return { kind: 'no-lap' };

    // Mesma pipeline da tela de sessão: limpa accuracy + repara timestamps.
    const preparedLaps = allLaps.map((l) => {
      const cleaned = cleanSamples(l.samples, 10);
      const { samples } = repairDegenerateTimestamps(
        cleaned,
        l.durationMs,
        l.startedAt
      );
      return { ...l, samples };
    });
    const lap = preparedLaps.find((l) => l.id === lapId);
    if (!lap) return { kind: 'no-lap' };

    // Referência: prioriza o layout que a sessão GRAVOU usar; se não tem,
    // cai pro default da pista; se nem isso, usa a melhor volta da sessão.
    let layout: TrackLayout | null = null;
    if (session.layoutId) {
      layout = await getLayout(session.layoutId);
    }
    if (!layout && session.trackId) {
      layout = await getDefaultLayoutForTrack(session.trackId);
    }

    let refSamples = lap.samples;
    let refDurationMs = lap.durationMs;
    if (layout && layout.samples.length >= 5) {
      const { samples: repaired } = repairDegenerateTimestamps(
        layout.samples,
        layout.durationMs
      );
      refSamples = repaired;
      refDurationMs = layout.durationMs;
    } else {
      const best = preparedLaps.reduce(
        (b, l) => (l.durationMs < b.durationMs ? l : b),
        preparedLaps[0]
      );
      refSamples = best.samples;
      refDurationMs = best.durationMs;
    }

    if (refSamples.length < 5 || lap.samples.length < 5) {
      return { kind: 'too-short' };
    }

    const refLap = buildReferenceLap(refSamples, {
      lat: refSamples[0].lat,
      lng: refSamples[0].lng,
    });
    const matchedRef = matchLapToReference(
      {
        id: 'ref',
        sessionId: 'ref',
        startedAt: 0,
        durationMs: refDurationMs,
        samples: refSamples,
      },
      refLap
    );
    const matchedCurrent = matchLapToReference(lap, refLap);
    const analysis = analyzeLap(matchedCurrent, matchedRef, 20);

    // Best-effort: coach funciona sem métricas de curva se a detecção falhar.
    let cornerMetrics: CornerMetric[] = [];
    try {
      const corners = detectCorners(refLap);
      cornerMetrics = analyzeCorners(corners, refLap, matchedCurrent, matchedRef);
    } catch {
      cornerMetrics = [];
    }

    const profile = await getProfile();
    const pilot: PilotContext | null =
      profile && profile.name
        ? {
            name: profile.name,
            nickname: profile.nickname,
            category: profile.category,
          }
        : null;

    const history = session.trackId
      ? await buildHistoryContext(session.trackId, sessionId)
      : null;

    return {
      kind: 'ok',
      context: {
        session,
        lap,
        refDurationMs,
        analysis,
        cornerMetrics,
        trackName: session.trackName,
        pilot,
        history,
      },
    };
  } catch (err: any) {
    return {
      kind: 'error',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
