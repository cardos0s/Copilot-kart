import { listSessions, getLapsForSession, listTrackReferences, Session } from '../storage/db';
import { LapRecord } from './analysis';
import { polylineLength } from './geometry';
import { findTrackById } from '../data/tracks';

export type TrackRecord = {
  trackId: string;
  trackName: string;
  bestLapMs: number;
  sessionId: string;
  recordedAt: number;
};

export type PilotStats = {
  /** Total de sessões */
  sessionCount: number;
  /** Total de voltas válidas */
  lapCount: number;
  /** Melhor volta absoluta (entre todas as sessões/pistas) */
  bestLapMs: number | null;
  /** Total de km percorridos (soma do comprimento de todas as voltas) */
  totalKm: number;
  /** Tempo total em pista (soma do tempo das sessões via amostras) */
  totalTimeMs: number;
  /** Sessões onde a melhor volta foi melhor que a referência da pista naquele momento */
  podiums: number;
  /** Top N voltas absolutas (id + duration + sessionId + trackName) */
  topLaps: Array<{
    lapId: string;
    sessionId: string;
    trackName: string;
    durationMs: number;
    recordedAt: number;
  }>;
  /** Recorde pessoal por pista */
  recordsByTrack: TrackRecord[];
};

/**
 * Pódio = sessão onde o piloto **bateu a referência** da pista naquele momento.
 *
 * Como a referência muda ao longo do tempo (cada vez que bate, a próxima vira mais
 * difícil), aplicamos a regra processando as sessões em ordem cronológica e
 * mantendo o melhor tempo por pista observado até ali. Sessão conta como pódio
 * se a melhor volta dela for mais rápida que o que existia antes daquela sessão.
 *
 * Trade-off: sessões sem trackId não contam pra pódios (impossível atribuir).
 */
export async function computePilotStats(opts?: {
  topN?: number;
}): Promise<PilotStats> {
  const topN = opts?.topN ?? 10;
  const sessions = await listSessions();
  // listSessions ordena DESC por startedAt; cronológico ASC pra processar pódios
  const sessionsAsc = [...sessions].sort((a, b) => a.startedAt - b.startedAt);

  type AllLap = LapRecord & { trackId: string | null; trackName: string };
  const allLaps: AllLap[] = [];
  const sessionLaps = new Map<string, LapRecord[]>();

  let totalKm = 0;
  let totalTimeMs = 0;

  for (const sess of sessionsAsc) {
    const laps = await getLapsForSession(sess.id);
    sessionLaps.set(sess.id, laps);
    for (const lap of laps) {
      allLaps.push({ ...lap, trackId: sess.trackId, trackName: sess.trackName });
      totalKm += polylineLength(lap.samples) / 1000;
      totalTimeMs += lap.durationMs;
    }
  }

  const bestLapMs = allLaps.length ? Math.min(...allLaps.map((l) => l.durationMs)) : null;

  // Top N voltas absolutas
  const topLaps = [...allLaps]
    .sort((a, b) => a.durationMs - b.durationMs)
    .slice(0, topN)
    .map((l) => ({
      lapId: l.id,
      sessionId: l.sessionId,
      trackName: l.trackName,
      durationMs: l.durationMs,
      recordedAt: l.startedAt,
    }));

  // Pódios: sessão bateu o recorde existente da sua pista no momento
  let podiums = 0;
  const bestSoFarByTrack = new Map<string, number>();
  for (const sess of sessionsAsc) {
    if (!sess.trackId) continue;
    const laps = sessionLaps.get(sess.id) ?? [];
    if (laps.length === 0) continue;
    const bestThisSession = Math.min(...laps.map((l) => l.durationMs));
    const prevBest = bestSoFarByTrack.get(sess.trackId);
    if (prevBest === undefined || bestThisSession < prevBest) {
      // Primeira sessão na pista também conta como "marco" (estabeleceu referência)
      if (prevBest !== undefined) podiums++;
      bestSoFarByTrack.set(sess.trackId, bestThisSession);
    }
  }

  // Recordes por pista (estado final)
  const recordsByTrack: TrackRecord[] = [];
  for (const [trackId, bestMs] of bestSoFarByTrack.entries()) {
    // Acha sessão+volta que estabeleceu esse recorde
    const sessForTrack = sessionsAsc.filter((s) => s.trackId === trackId);
    let recSession: Session | null = null;
    for (const sess of sessForTrack) {
      const laps = sessionLaps.get(sess.id) ?? [];
      if (laps.some((l) => l.durationMs === bestMs)) {
        recSession = sess;
        break;
      }
    }
    const track = findTrackById(trackId);
    recordsByTrack.push({
      trackId,
      trackName: track?.shortName ?? recSession?.trackName ?? trackId,
      bestLapMs: bestMs,
      sessionId: recSession?.id ?? '',
      recordedAt: recSession?.startedAt ?? 0,
    });
  }
  recordsByTrack.sort((a, b) => a.bestLapMs - b.bestLapMs);

  return {
    sessionCount: sessions.length,
    lapCount: allLaps.length,
    bestLapMs,
    totalKm,
    totalTimeMs,
    podiums,
    topLaps,
    recordsByTrack,
  };
}
