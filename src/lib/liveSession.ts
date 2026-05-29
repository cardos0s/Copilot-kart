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
  // Setores — preenchidos só quando app tem layout reference carregada
  currentSectorIdx?: 0 | 1 | 2 | null;
  currentSectorElapsedMs?: number | null;
  s1Ms?: number | null;
  s2Ms?: number | null;
  s3Ms?: number | null;
  // Altitude (GPS + barômetro). Pra elevation profile + 3D viewer.
  altitude?: number | null;
  altitudeAccuracy?: number | null;
};

export type LiveLap = {
  lapNumber: number;
  durationMs: number;
  finishedAt: number;
  // Setores da volta fechada (null se sem layout ref)
  s1Ms?: number | null;
  s2Ms?: number | null;
  s3Ms?: number | null;
};

/** Evento / competição que agrupa várias live_sessions. */
export type EventInfo = {
  id: string;
  code: string;
  name: string | null;
  trackId: string | null;
  trackName: string | null;
};

/** Uma linha do ranking do evento — agregado por piloto. */
export type EventRankingRow = {
  pilotName: string;
  kartNumber: string | null;
  bestLapMs: number | null;
  lastLapMs: number | null;
  lapCount: number;
  /** Timestamp da última volta — pra ordenar/detectar atividade. */
  lastLapAt: number | null;
};

/**
 * Mensagem da equipe pro piloto. Severidade controla a cor do overlay
 * no app (info=verde, warning=amarelo, critical=vermelho).
 *
 * Texto livre limitado a 24 chars no UI da equipe — não validado aqui
 * por simplicidade; quem renderiza decide o que cabe na tela do piloto.
 */
export type MessageSeverity = 'info' | 'warning' | 'critical';

export type LiveMessage = {
  id: number;
  severity: MessageSeverity;
  text: string;
  sentAt: number;
  ackedAt: number | null;
  sentBy: string | null;
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
  /** Evento de competição ao qual a sessão pertence (null se avulsa). */
  eventId: string | null;
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
  /** Se a sessão faz parte de uma competição, o id do evento. */
  eventId?: string | null;
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
        event_id: opts.eventId ?? null,
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

// =====================
// Eventos / Competição
// =====================

function mapEventRow(row: any): EventInfo {
  return {
    id: row.id,
    code: row.code,
    name: row.name ?? null,
    trackId: row.track_id ?? null,
    trackName: row.track_name ?? null,
  };
}

/**
 * Cria um evento de competição. Retorna o info (com o código pra
 * compartilhar). Pilotos entram com esse código.
 */
export async function createEvent(opts: {
  name: string | null;
  trackId: string | null;
  trackName: string | null;
}): Promise<EventInfo> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Competição precisa do Supabase configurado.');
  const deviceId = await getDeviceId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from('events')
      .insert({
        code,
        name: opts.name,
        track_id: opts.trackId,
        track_name: opts.trackName,
        created_by: deviceId,
      })
      .select('*')
      .single();
    if (!error && data) return mapEventRow(data);
    if (error?.code !== '23505') {
      throw new Error(error?.message ?? 'Erro ao criar evento');
    }
  }
  throw new Error('Não foi possível gerar um código único após 5 tentativas');
}

/** Busca um evento pelo código. null se não existe. */
export async function findEventByCode(code: string): Promise<EventInfo | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  return data ? mapEventRow(data) : null;
}

/**
 * Tenta gravar uma volta como REFERÊNCIA geográfica do evento. Update
 * atômico — só grava se reference_set_at AINDA é null (o primeiro
 * piloto que fechar uma volta no evento ganha). Demais updates viram
 * no-op (não sobrescrevem).
 *
 * A partir daí, todos os karts são projetados nessa polyline pra
 * posição ao vivo (progresso na volta) tanto no app quanto na web.
 *
 * Retorna true se ESSE piloto fixou a referência (foi o primeiro),
 * false se já existia uma.
 */
export async function setEventReferenceIfEmpty(
  eventId: string,
  samples: Array<{ lat: number; lng: number; t: number }>,
  durationMs: number
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (samples.length < 10) return false; // muito pouco — não vira referência
  try {
    // Decimação leve antes de gravar (cap em ~500 pontos = ~15KB JSON)
    const step = Math.max(1, Math.floor(samples.length / 500));
    const decimated = samples.filter((_, i) => i % step === 0);
    const { data, error } = await supabase
      .from('events')
      .update({
        reference_samples_json: JSON.stringify(decimated),
        reference_duration_ms: durationMs,
        reference_set_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .is('reference_set_at', null)
      .select('id');
    if (error) return false;
    // data não-vazio = update aconteceu = fui o primeiro
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Carrega o ranking agregado do evento. Junta todas as live_sessions do
 * evento + suas voltas + nome do piloto, e agrega por piloto:
 *   bestLapMs = menor duração, lastLapMs = volta mais recente, lapCount.
 *
 * Ordenado por melhor volta (asc) — líder primeiro. Pilotos sem volta
 * fechada ainda vão pro fim.
 */
export async function loadEventRanking(eventId: string): Promise<EventRankingRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  // 1. Sessions do evento + pilotos
  const { data: sessRows } = await supabase
    .from('live_sessions')
    .select('id, pilot_id, pilots(display_name, kart_number)')
    .eq('event_id', eventId);
  if (!sessRows || sessRows.length === 0) return [];

  // 2. Todas as voltas do evento (denormalizado por event_id)
  const { data: lapRows } = await supabase
    .from('live_laps')
    .select('live_session_id, duration_ms, finished_at')
    .eq('event_id', eventId)
    .order('finished_at', { ascending: true });

  // Mapa session → piloto
  const pilotBySession = new Map<string, { name: string; kart: string | null }>();
  for (const s of sessRows as any[]) {
    pilotBySession.set(s.id, {
      name: s.pilots?.display_name ?? 'Piloto',
      kart: s.pilots?.kart_number ?? null,
    });
  }

  // Agrega por NOME do piloto (junta múltiplas sessions do mesmo piloto
  // — ex: parou e voltou). Chave por nome+kart é suficiente pra MVP.
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
      // lapRows vem ordenado asc por finished_at, então o último visto é o mais recente
      existing.lastLapMs = lap.duration_ms;
      existing.lastLapAt = t;
    }
  }

  // Pilotos sem volta ainda — entram no ranking com null (no fim)
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

/**
 * Assina novas voltas do evento (de QUALQUER piloto). Callback dispara a
 * cada volta fechada — o consumidor re-carrega o ranking (debounced).
 * Retorna unsubscribe.
 */
export function subscribeEventLaps(eventId: string, onLap: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel: RealtimeChannel = supabase
    .channel(`event:${eventId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_laps',
        filter: `event_id=eq.${eventId}`,
      },
      () => onLap()
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function endLiveSession(code: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from('live_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('code', code);
}

export async function publishSample(
  sessionId: string,
  sample: LiveSample,
  eventId?: string | null
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('live_samples').insert({
    live_session_id: sessionId,
    event_id: eventId ?? null,
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
    current_sector_idx: sample.currentSectorIdx ?? null,
    current_sector_elapsed_ms: sample.currentSectorElapsedMs ?? null,
    s1_ms: sample.s1Ms ?? null,
    s2_ms: sample.s2Ms ?? null,
    s3_ms: sample.s3Ms ?? null,
    altitude: sample.altitude ?? null,
    altitude_accuracy: sample.altitudeAccuracy ?? null,
  });
  if (error && __DEV__) console.warn('[liveSession] publishSample error:', error.message);
}

export async function publishLap(
  sessionId: string,
  lap: LiveLap,
  eventId?: string | null
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('live_laps').insert({
    live_session_id: sessionId,
    lap_number: lap.lapNumber,
    duration_ms: lap.durationMs,
    finished_at: new Date(lap.finishedAt).toISOString(),
    s1_ms: lap.s1Ms ?? null,
    s2_ms: lap.s2Ms ?? null,
    s3_ms: lap.s3Ms ?? null,
    // Denormalizado pro ranking de evento via realtime filtrado por event_id.
    event_id: eventId ?? null,
  });
  if (error && __DEV__) console.warn('[liveSession] publishLap error:', error.message);
}

/**
 * Manda mensagem da equipe pro piloto. Insert simples em live_messages —
 * o piloto recebe via realtime no canal `live:<sessionId>`.
 *
 * `sentBy` é só etiqueta de contexto (nome do coach, ex). Não é auth.
 * Texto deve ser curto (24 chars no UI) mas DB não força — caller cuida.
 */
export async function publishMessage(
  sessionId: string,
  msg: { severity: MessageSeverity; text: string; sentBy?: string }
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('live_messages').insert({
    live_session_id: sessionId,
    severity: msg.severity,
    text: msg.text,
    sent_by: msg.sentBy ?? null,
  });
  if (error && __DEV__) console.warn('[liveSession] publishMessage error:', error.message);
}

/**
 * Marca uma mensagem como reconhecida pelo piloto (renderizou). Útil pro
 * histórico da equipe ver latência ou se a mensagem foi vista.
 * Não-bloqueante — falha silenciosa.
 */
export async function ackMessage(messageId: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from('live_messages')
    .update({ acked_at: new Date().toISOString() })
    .eq('id', messageId);
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

/**
 * Histórico de mensagens da sessão, ordem cronológica (mais antiga
 * primeiro). Usado no debrief pós-sessão e como bootstrap quando a
 * equipe abre o painel no meio de uma sessão em andamento.
 */
export async function loadMessages(sessionId: string): Promise<LiveMessage[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from('live_messages')
    .select('*')
    .eq('live_session_id', sessionId)
    .order('sent_at', { ascending: true });
  return (data ?? []).map(mapMessageRow);
}

export type SubscribeCallbacks = {
  onSample?: (s: LiveSample) => void;
  onLap?: (l: LiveLap) => void;
  onSessionUpdate?: (info: LiveSessionInfo) => void;
  /** Mensagem nova da equipe pro piloto (ou eco pra outros viewers). */
  onMessage?: (m: LiveMessage) => void;
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
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_messages',
        filter: `live_session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onMessage?.(mapMessageRow(payload.new));
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
    eventId: row.event_id ?? null,
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
    currentSectorIdx:
      row.current_sector_idx !== null && row.current_sector_idx !== undefined
        ? (row.current_sector_idx as 0 | 1 | 2)
        : null,
    currentSectorElapsedMs: row.current_sector_elapsed_ms ?? null,
    s1Ms: row.s1_ms ?? null,
    s2Ms: row.s2_ms ?? null,
    s3Ms: row.s3_ms ?? null,
    altitude: row.altitude ?? null,
    altitudeAccuracy: row.altitude_accuracy ?? null,
  };
}

function mapLapRow(row: any): LiveLap {
  return {
    lapNumber: row.lap_number,
    durationMs: row.duration_ms,
    finishedAt: new Date(row.finished_at).getTime(),
    s1Ms: row.s1_ms ?? null,
    s2Ms: row.s2_ms ?? null,
    s3Ms: row.s3_ms ?? null,
  };
}

function mapMessageRow(row: any): LiveMessage {
  return {
    id: row.id,
    severity: row.severity as MessageSeverity,
    text: row.text,
    sentAt: new Date(row.sent_at).getTime(),
    ackedAt: row.acked_at ? new Date(row.acked_at).getTime() : null,
    sentBy: row.sent_by ?? null,
  };
}
