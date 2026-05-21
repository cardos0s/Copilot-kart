'use client';

import { useEffect, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { LiveLap, LiveSample, LiveSessionInfo } from './liveTypes';

/**
 * Hook que assina uma live session pelo código.
 *
 * Estratégia:
 *  1. Fetch inicial: descobre `id` da session a partir do `code`, depois
 *     pega histórico de samples e laps já gravados (pra spectator que
 *     conecta no meio da corrida ver o que já passou).
 *  2. Realtime: assina INSERTs em `live_samples` e `live_laps` filtrados
 *     por `live_session_id`. Cada chegada faz append no state.
 *  3. Polling do session info a cada 10s pra detectar `ended_at` setado.
 *
 * Retorna:
 *  - `state`: loading / not-found / live / ended / error
 *  - `info`: dados da sessão (track name, piloto, etc)
 *  - `samples`: ordenados por t crescente
 *  - `laps`: voltas fechadas em ordem de lap_number
 */

export type LiveState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | {
      kind: 'live' | 'ended';
      info: LiveSessionInfo;
      samples: LiveSample[];
      laps: LiveLap[];
    };

function mapSessionRow(row: any): LiveSessionInfo {
  return {
    id: row.id,
    code: row.code,
    pilotId: row.pilot_id ?? null,
    pilotName: row.pilots?.display_name ?? null,
    pilotKartNumber: row.pilots?.kart_number ?? null,
    trackName: row.track_name ?? null,
    trackId: row.track_id ?? null,
    referenceLapMs: row.reference_lap_ms ?? null,
    startedAt: new Date(row.started_at).getTime(),
    endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
  };
}

function mapSample(row: any): LiveSample {
  return {
    t: new Date(row.t).getTime(),
    lat: row.lat,
    lng: row.lng,
    speed: row.speed,
    heading: row.heading ?? undefined,
    accuracy: row.accuracy ?? undefined,
    lapNumber: row.lap_number ?? undefined,
    lapElapsedMs: row.lap_elapsed_ms ?? undefined,
    bestLapMs: row.best_lap_ms ?? null,
    deltaVsRefMs: row.delta_vs_ref_ms ?? null,
  };
}

function mapLap(row: any): LiveLap {
  return {
    lapNumber: row.lap_number,
    durationMs: row.duration_ms,
    finishedAt: new Date(row.finished_at).getTime(),
  };
}

export function useLive(code: string | null): LiveState {
  const [state, setState] = useState<LiveState>({ kind: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      let supabase;
      try {
        supabase = getSupabase();
      } catch (err: any) {
        if (!cancelled) setState({ kind: 'error', message: err.message });
        return;
      }

      // 1. Descobre a session pelo code
      const { data: sessionRow, error: sErr } = await supabase
        .from('live_sessions')
        .select('*, pilots(display_name, kart_number)')
        .eq('code', code)
        .maybeSingle();
      if (sErr) {
        if (!cancelled) setState({ kind: 'error', message: sErr.message });
        return;
      }
      if (!sessionRow) {
        if (!cancelled) setState({ kind: 'not-found' });
        return;
      }
      const info = mapSessionRow(sessionRow);

      // 2. Histórico inicial — todos os samples + laps que já tem
      const [samplesRes, lapsRes] = await Promise.all([
        supabase
          .from('live_samples')
          .select('*')
          .eq('live_session_id', info.id)
          .order('t', { ascending: true }),
        supabase
          .from('live_laps')
          .select('*')
          .eq('live_session_id', info.id)
          .order('lap_number', { ascending: true }),
      ]);
      if (cancelled) return;
      const initialSamples = (samplesRes.data ?? []).map(mapSample);
      const initialLaps = (lapsRes.data ?? []).map(mapLap);

      setState({
        kind: info.endedAt ? 'ended' : 'live',
        info,
        samples: initialSamples,
        laps: initialLaps,
      });

      // 3. Realtime — escuta INSERTs nas duas tabelas filtrados por session.
      channel = supabase
        .channel(`live:${info.code}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_samples',
            filter: `live_session_id=eq.${info.id}`,
          },
          (payload) => {
            if (cancelled) return;
            const s = mapSample(payload.new);
            setState((prev) => {
              if (prev.kind !== 'live' && prev.kind !== 'ended') return prev;
              return { ...prev, samples: [...prev.samples, s] };
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_laps',
            filter: `live_session_id=eq.${info.id}`,
          },
          (payload) => {
            if (cancelled) return;
            const l = mapLap(payload.new);
            setState((prev) => {
              if (prev.kind !== 'live' && prev.kind !== 'ended') return prev;
              return { ...prev, laps: [...prev.laps, l] };
            });
          }
        )
        .subscribe();

      // 4. Polling do info — detecta ended_at sem precisar de outro canal.
      pollTimer = setInterval(async () => {
        const { data } = await supabase
          .from('live_sessions')
          .select('ended_at')
          .eq('id', info.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.ended_at) {
          setState((prev) => {
            if (prev.kind !== 'live') return prev;
            return { ...prev, kind: 'ended' };
          });
        }
      }, 10000);
    })();

    return () => {
      cancelled = true;
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {}
      }
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [code]);

  return state;
}
