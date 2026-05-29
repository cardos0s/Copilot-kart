'use client';

import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { EventInfo, EventRankingRow } from './liveTypes';

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
  | { kind: 'ready'; event: EventInfo; ranking: EventRankingRow[] };

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
      setState({ kind: 'ready', event, ranking });

      // Realtime: nova volta de qualquer piloto do evento → reload debounced
      const reload = () => {
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

      channel = supabase
        .channel(`event:${event.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_laps',
            filter: `event_id=eq.${event.id}`,
          },
          reload
        )
        // Também recarrega quando um piloto novo entra (nova session no evento)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_sessions',
            filter: `event_id=eq.${event.id}`,
          },
          reload
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
