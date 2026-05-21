import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { getDeviceId } from './deviceId';
import { getProfile } from '../storage/profile';

/**
 * Abstração de live sharing.
 *
 * - Piloto: `createLiveSession()` cria sessão e retorna o código. Depois
 *   `publishSample()` a cada amostra GPS, `publishLap()` quando volta fecha.
 * - Spectator: `subscribeLiveSession(code, ...)` assina realtime e recebe
 *   amostras + voltas em tempo real. `loadLiveSessionByCode()` faz fetch
 *   inicial do histórico.
 */

export type LiveSample = {
  t: number; // epoch ms
  lat: number;
  lng: number;
  speed: number; // m/s
  heading?: number;
  accuracy?: number;
  lapNumber?: number;
  lapElapsedMs?: number;
  bestLapMs?: number | null;
  deltaVsRefMs?: number | null;
};

export type LiveLap = {
  lapNumber: number;
  durationMs: number;
  finishedAt: number;
};

export type LiveSessionInfo = {
  id: string;
  code: string;
  pilotId: string | null;
  pilotName?: string | null;
  pilotKartNumber?: string | null;
  trackName: string | null;
  trackId: string | null;
  referenceLapMs: number | null;
  startedAt: number;
  endedAt: number | null;
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I/L

function generateCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Upsert do registro de piloto no backend a partir do perfil local.
 * Retorna o id do piloto no Supabase (uuid).
 */
export async function ensurePilot(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const deviceId = await getDeviceId();
  const profile = await getProfile();
  const payload = {
    device_id: deviceId,
    display_name: profile?.name ?? null,
    kart_number: profile?.kartNumber ?? null,
    team: profile?.team ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('pilots')
    .upsert(payload, { onConflict: 'device_id' })
    .select('id')
    .single();
  if (error) {
    if (__DEV__) console.warn('[liveSession] ensurePilot error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export type CreateOpts = {
  trackName: string | null;
  trackId: string | null;
  referenceLapMs?: number | null;
};

/**
 * Cria uma sessão ao vivo. Retorna o info da sessão (incluindo o código).
 * Lança se não conseguir conectar/criar.
 */
export async function createLiveSession(opts: CreateOpts): Promise<LiveSessionInfo> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Live sharing não está configurado (Supabase ausente).');
  const pilotId = await ensurePilot();

  // Tenta gerar código único — em caso de colisão (raro), tenta de novo
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from('live_sessions')
      .insert({
        code,
        pilot_id: pilotId,
        track_name: opts.trackName,
        track_id: opts.trackId,
        reference_lap_ms: opts.referenceLapMs ?? null,
      })
      .select('*')
      .single();
    if (!error && data) {
      return mapSessionRow(data);
    }
    // 23505 = unique_violation (Postgres) — colisão de código, tenta de novo
    if (error?.code !== '23505') {
      throw new Error(error?.message ?? 'Erro ao criar live session');
    }
  }
  throw new Error('Não foi possível gerar um código único após 5 tentativas');
}

export async function endLiveSession(code: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from('live_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('code', code);
}

export async function publishSample(sessionId: string, sample: LiveSample): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('live_samples').insert({
    live_session_id: sessionId,
    t: new Date(sample.t).toISOString(),
    lat: sample.lat,
    lng: sample.lng,
    speed: sample.speed,
    heading: sample.heading ?? null,
    accuracy: sample.accuracy ?? null,
    lap_number: sample.lapNumber ?? null,
    lap_elapsed_ms: sample.lapElapsedMs ?? null,
    best_lap_ms: sample.bestLapMs ?? null,
    delta_vs_ref_ms: sample.deltaVsRefMs ?? null,
  });
  if (error && __DEV__) console.warn('[liveSession] publishSample error:', error.message);
}

export async function publishLap(sessionId: string, lap: LiveLap): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('live_laps').insert({
    live_session_id: sessionId,
    lap_number: lap.lapNumber,
    duration_ms: lap.durationMs,
    finished_at: new Date(lap.finishedAt).toISOString(),
  });
  if (error && __DEV__) console.warn('[liveSession] publishLap error:', error.message);
}

export async function loadLiveSessionByCode(code: string): Promise<{
  session: LiveSessionInfo;
  recentSamples: LiveSample[];
  laps: LiveLap[];
} | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: sessRow, error: sessErr } = await supabase
    .from('live_sessions')
    .select('*, pilots(display_name, kart_number)')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  if (sessErr || !sessRow) return null;

  const session = mapSessionRow(sessRow);

  // Últimas N amostras (do mais recente — vai ser invertido pra cronológico)
  const { data: sampleRows } = await supabase
    .from('live_samples')
    .select('*')
    .eq('live_session_id', session.id)
    .order('t', { ascending: false })
    .limit(300);

  const recentSamples: LiveSample[] = (sampleRows ?? [])
    .map(mapSampleRow)
    .reverse();

  const { data: lapRows } = await supabase
    .from('live_laps')
    .select('*')
    .eq('live_session_id', session.id)
    .order('lap_number', { ascending: true });

  const laps: LiveLap[] = (lapRows ?? []).map(mapLapRow);

  return { session, recentSamples, laps };
}

export type SubscribeCallbacks = {
  onSample?: (s: LiveSample) => void;
  onLap?: (l: LiveLap) => void;
  onSessionUpdate?: (info: LiveSessionInfo) => void;
};

/**
 * Assina realtime da sessão. Retorna função pra unsubscribe.
 */
export function subscribeLiveSession(
  sessionId: string,
  callbacks: SubscribeCallbacks
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`live:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_samples',
        filter: `live_session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onSample?.(mapSampleRow(payload.new));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_laps',
        filter: `live_session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onLap?.(mapLapRow(payload.new));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'live_sessions',
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onSessionUpdate?.(mapSessionRow(payload.new));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =====================
// Row mappers
// =====================

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

function mapSampleRow(row: any): LiveSample {
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

function mapLapRow(row: any): LiveLap {
  return {
    lapNumber: row.lap_number,
    durationMs: row.duration_ms,
    finishedAt: new Date(row.finished_at).getTime(),
  };
}
