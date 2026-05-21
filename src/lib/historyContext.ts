/**
 * Resumo do histórico do piloto numa pista, formatado pra alimentar o
 * Coach IA. Pega N sessões anteriores e extrai:
 *   - PB histórico nessa pista
 *   - Quantas sessões já fez aqui
 *   - Tendência da melhor volta nas últimas sessões (melhorando / estável /
 *     piorando) — fit linear simples sobre os deltas
 *
 * Função pura no sentido de não fazer IO além do db query: recebe trackId,
 * devolve um snapshot imutável. Tudo opcional no prompt — se não tem
 * histórico (primeira vez na pista, ou pista sem trackId), o builder
 * simplesmente omite a seção.
 */

import { getTrackHistory, TrackHistoryEntry } from '../storage/db';

export type HistoryContext = {
  /** Melhor volta histórica do piloto nessa pista, ms. */
  pilotBestMs: number;
  /** Quando essa melhor foi feita (epoch ms). */
  pilotBestAt: number;
  /** Quantas sessões já contam pro histórico (com pelo menos 1 volta). */
  sessionsCount: number;
  /** Quantos dias desde a última sessão antes da atual. Null se só essa. */
  daysSinceLastSession: number | null;
  /**
   * Tendência das últimas até 5 sessões anteriores. 'improving' se cada
   * melhor volta foi caindo, 'regressing' se subindo, 'flat' caso contrário.
   * Null se menos de 2 sessões anteriores pra comparar.
   */
  trend: 'improving' | 'regressing' | 'flat' | null;
  /**
   * Entradas brutas — primeira é a sessão MAIS RECENTE anterior à atual.
   * Útil pro builder do prompt mostrar 1-2 datas pra ancorar contexto.
   */
  recent: Array<{
    sessionId: string;
    startedAt: number;
    bestLapMs: number;
  }>;
};

/**
 * Constrói o contexto, EXCLUINDO a sessão atual (que ainda tá em análise).
 * Retorna null se não tem histórico relevante (zero sessões anteriores ou
 * todas sem voltas válidas).
 */
export async function buildHistoryContext(
  trackId: string | null,
  currentSessionId: string
): Promise<HistoryContext | null> {
  if (!trackId) return null;

  // Pega 11: 1 pode ser a sessão atual (que filtramos), sobra até 10.
  const raw = await getTrackHistory(trackId, 11);
  const others: TrackHistoryEntry[] = raw.filter(
    (e) => e.sessionId !== currentSessionId && e.bestLapMs != null
  );
  if (others.length === 0) return null;

  // Best ever entre as anteriores
  let pilotBestMs = Infinity;
  let pilotBestAt = 0;
  for (const e of others) {
    if (e.bestLapMs! < pilotBestMs) {
      pilotBestMs = e.bestLapMs!;
      pilotBestAt = e.startedAt;
    }
  }
  if (!isFinite(pilotBestMs)) return null;

  const mostRecent = others[0]; // já vem DESC do db
  const now = Date.now();
  const daysSinceLastSession = Math.round(
    (now - mostRecent.startedAt) / (1000 * 60 * 60 * 24)
  );

  // Tendência: pega até 5 sessões anteriores em ordem cronológica e olha
  // se os bests estão caindo (improving), subindo (regressing) ou misturados.
  // Threshold: variação <1% é considerada plana — kart tem ruído natural.
  const window = others.slice(0, 5).slice().reverse(); // oldest → newest
  let trend: HistoryContext['trend'] = null;
  if (window.length >= 2) {
    const first = window[0].bestLapMs!;
    const last = window[window.length - 1].bestLapMs!;
    const deltaPct = (last - first) / first;
    if (Math.abs(deltaPct) < 0.01) trend = 'flat';
    else if (deltaPct < 0) trend = 'improving';
    else trend = 'regressing';
  }

  return {
    pilotBestMs,
    pilotBestAt,
    sessionsCount: others.length,
    daysSinceLastSession: others.length >= 1 ? daysSinceLastSession : null,
    trend,
    recent: others.slice(0, 5).map((e) => ({
      sessionId: e.sessionId,
      startedAt: e.startedAt,
      bestLapMs: e.bestLapMs!,
    })),
  };
}
