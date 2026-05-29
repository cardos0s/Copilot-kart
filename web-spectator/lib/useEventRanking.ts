'use client';

import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { EventInfo, EventRankingRow } from './liveTypes';
import { CompiledReference, compileReference, projectProgress } from './trackProgress';

/** Posição de corrida ao vivo de um piloto. */
export type LivePosition = {
  pilotName: string;
  kartNumber: string | null;
  sessionId: string;
  lapNumber: number;
  /** Latitude/longitude da última posição reportada. */
  lat: number;
  lng: number;
  /** Progresso 0..1 na volta atual (precisa de referência). null se sem ref. */
  progress: number | null;
  /** Timestamp do último sample. */
  lastT: number;
};

/**
 * Hook do ranking de competição. Carrega o evento pelo código, agrega o
 * ranking (melhor volta por piloto) e assina realtime — a cada volta nova
 * de QUALQUER piloto do evento, recarrega o ranking (debounced).
 *
 * Agregação espelha a do app (src/lib/liveSession.loadEventRanking):
 *   - junta live_sessions do evento + pilots + live_laps
 *   - por piloto: best = min duração, last = mais recente, count
 *   - ordena por melhor volta asc (líder primeiro), sem-volta no fim
 */

export type EventState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      event: EventInfo;
      ranking: EventRankingRow[];
      /** Polyline da referência do evento (origem em primeira posição). null se ninguém fechou volta ainda. */
      reference: CompiledReference | null;
      /** Posições ao vivo, ordenadas P1 → último. */
      positions: LivePosition[];
    };

function mapEvent(row: any): EventInfo {
  return {
    id: row.id,
    code: row.code,
    name: row.name ?? null,
    trackId: row.track_id ?? null,
    trackName: row.track_name ?? null,
  };
}

async function aggregateRanking(
  supabase: ReturnType<typeof getSupabase>,
  eventId: string
): Promise<EventRankingRow[]> {
  const { data: sessRows } = await supabase
    .from('live_sessions')
    .select('id, pilots(display_name, kart_number)')
    .eq('event_id', eventId);
  if (!sessRows || sessRows.length === 0) return [];

  const { data: lapRows } = await supabase
    .from('live_laps')
    .select('live_session_id, duration_ms, finished_at')
    .eq('event_id', eventId)
    .order('finished_at', { ascending: true });

  const pilotBySession = new Map<string, { name: string; kart: string | null }>();
  for (const s of sessRows as any[]) {
    pilotBySession.set(s.id, {
      name: s.pilots?.display_name ?? 'Piloto',
      kart: s.pilots?.kart_number ?? null,
    });
  }

  const byPilot = new Map<string, EventRankingRow>();
  for (const lap of (lapRows ?? []) as any[]) {
    const pilot = pilotBySession.get(lap.live_session_id);
    if (!pilot) continue;
    const key = `${pilot.name}#${pilot.kart ?? ''}`;
    const t = new Date(lap.finished_at).getTime();
    const existing = byPilot.get(key);
    if (!existing) {
      byPilot.set(key, {
        pilotName: pilot.name,
        kartNumber: pilot.kart,
        bestLapMs: lap.duration_ms,
        lastLapMs: lap.duration_ms,
        lapCount: 1,
        lastLapAt: t,
      });
    } else {
      existing.lapCount += 1;
      if (lap.duration_ms < (existing.bestLapMs ?? Infinity)) {
        existing.bestLapMs = lap.duration_ms;
      }
      existing.lastLapMs = lap.duration_ms;
      existing.lastLapAt = t;
    }
  }

  for (const [, pilot] of pilotBySession) {
    const key = `${pilot.name}#${pilot.kart ?? ''}`;
    if (!byPilot.has(key)) {
      byPilot.set(key, {
        pilotName: pilot.name,
        kartNumber: pilot.kart,
        bestLapMs: null,
        lastLapMs: null,
        lapCount: 0,
        lastLapAt: null,
      });
    }
  }

  return Array.from(byPilot.values()).sort((a, b) => {
    if (a.bestLapMs === null && b.bestLapMs === null) return 0;
    if (a.bestLapMs === null) return 1;
    if (b.bestLapMs === null) return -1;
    return a.bestLapMs - b.bestLapMs;
  });
}

export function useEventRanking(code: string | null): EventState {
  const [state, setState] = useState<EventState>({ kind: 'loading' });
  // Debounce do reload — várias voltas podem chegar quase juntas.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      let supabase;
      try {
        supabase = getSupabase();
      } catch (err: any) {
        if (!cancelled) setState({ kind: 'error', message: err.message });
        return;
      }

      const { data: evRow } = await supabase
        .from('events')
        .select('*')
        .eq('code', code.toUpperCase())
        .maybeSingle();
      if (cancelled) return;
      if (!evRow) {
        setState({ kind: 'not-found' });
        return;
      }
      const event = mapEvent(evRow);

      const ranking = await aggregateRanking(supabase, event.id);
      if (cancelled) return;

      // Compila a referência do evento, se já tiver sido fixada por
      // algum piloto (1º que fechou volta). Polyline pra projeção +
      // visualização do mapa.
      let reference: CompiledReference | null = null;
      try {
        const refRaw = evRow.reference_samples_json;
        if (refRaw) {
          const parsed = JSON.parse(refRaw);
          if (Array.isArray(parsed) && parsed.length >= 2) {
            reference = compileReference(parsed);
          }
        }
      } catch {
        /* ignora ref corrompida */
      }

      setState({ kind: 'ready', event, ranking, reference, positions: [] });

      // Mapa interno: latest sample por sessão (key: live_session_id)
      const latestBySession = new Map<string, { lat: number; lng: number; t: number; lap: number }>();
      // Mapa: sessionId → piloto
      const pilotBySession = new Map<string, { name: string; kart: string | null }>();
      const { data: sessForPositions } = await supabase
        .from('live_sessions')
        .select('id, pilots(display_name, kart_number)')
        .eq('event_id', event.id);
      for (const s of (sessForPositions ?? []) as any[]) {
        pilotBySession.set(s.id, {
          name: s.pilots?.display_name ?? 'Piloto',
          kart: s.pilots?.kart_number ?? null,
        });
      }

      // Carrega o último sample de cada sessão como bootstrap das posições
      const { data: lastSamples } = await supabase
        .from('live_samples')
        .select('live_session_id, lat, lng, t, lap_number')
        .eq('event_id', event.id)
        .order('t', { ascending: false })
        .limit(200); // mais que suficiente pra pegar 1 por piloto recente
      for (const sm of (lastSamples ?? []) as any[]) {
        if (!latestBySession.has(sm.live_session_id)) {
          latestBySession.set(sm.live_session_id, {
            lat: sm.lat,
            lng: sm.lng,
            t: new Date(sm.t).getTime(),
            lap: sm.lap_number ?? 0,
          });
        }
      }

      const buildPositions = (): LivePosition[] => {
        const out: LivePosition[] = [];
        for (const [sessionId, sm] of latestBySession) {
          const pilot = pilotBySession.get(sessionId);
          if (!pilot) continue;
          let progress: number | null = null;
          if (reference) {
            progress = projectProgress({ lat: sm.lat, lng: sm.lng }, reference).progress;
          }
          out.push({
            pilotName: pilot.name,
            kartNumber: pilot.kart,
            sessionId,
            lapNumber: sm.lap,
            lat: sm.lat,
            lng: sm.lng,
            progress,
            lastT: sm.t,
          });
        }
        // Posição = ordena por (voltas desc, progresso desc). Sem ref,
        // só desempata por voltas; karts na mesma volta ficam empatados.
        return out.sort((a, b) => {
          if (a.lapNumber !== b.lapNumber) return b.lapNumber - a.lapNumber;
          if (a.progress === null && b.progress === null) return 0;
          if (a.progress === null) return 1;
          if (b.progress === null) return -1;
          return b.progress - a.progress;
        });
      };

      setState((prev) =>
        prev.kind === 'ready' ? { ...prev, positions: buildPositions() } : prev
      );

      // Debounce do reload do ranking — várias voltas podem chegar quase juntas.
      const reloadRanking = () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(async () => {
          const fresh = await aggregateRanking(supabase!, event.id);
          if (!cancelled) {
            setState((prev) =>
              prev.kind === 'ready' ? { ...prev, ranking: fresh } : prev
            );
          }
        }, 600);
      };

      // Throttle das atualizações de posição (samples chegam a 3.3Hz × N pilotos)
      let positionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
      const schedulePositionUpdate = () => {
        if (positionUpdateTimer) return;
        positionUpdateTimer = setTimeout(() => {
          positionUpdateTimer = null;
          if (!cancelled) {
            setState((prev) =>
              prev.kind === 'ready' ? { ...prev, positions: buildPositions() } : prev
            );
          }
        }, 250);
      };

      channel = supabase
        .channel(`event:${event.id}`)
        // Nova volta → recarrega ranking + atualiza positions
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_laps',
            filter: `event_id=eq.${event.id}`,
          },
          reloadRanking
        )
        // Piloto novo entrando no evento (session ganha event_id)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_sessions',
            filter: `event_id=eq.${event.id}`,
          },
          reloadRanking
        )
        // Cada sample atualiza posição do kart (throttled)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_samples',
            filter: `event_id=eq.${event.id}`,
          },
          (payload) => {
            const row = payload.new as any;
            if (!row || !row.live_session_id) return;
            latestBySession.set(row.live_session_id, {
              lat: row.lat,
              lng: row.lng,
              t: new Date(row.t).getTime(),
              lap: row.lap_number ?? 0,
            });
            schedulePositionUpdate();
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {}
      }
    };
  }, [code]);

  return state;
}
