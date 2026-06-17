/**
 * Leaderboard — ranking público de PBs por pista.
 *
 * Usa Supabase (já temos cliente). Cada PB pessoal é publicado opcionalmente
 * pra tabela `leaderboard_entries` (criada no schema.sql).
 *
 * Esquema da tabela (a usuária precisa rodar o SQL adicional):
 *
 *   create table leaderboard_entries (
 *     id uuid primary key default gen_random_uuid(),
 *     pilot_id uuid references pilots(id) on delete cascade,
 *     track_id text not null,
 *     layout_id text,
 *     best_lap_ms integer not null,
 *     session_id text,
 *     created_at timestamptz default now()
 *   );
 *   alter table leaderboard_entries enable row level security;
 *   create policy "public read leaderboard" on leaderboard_entries for select using (true);
 *   create policy "public insert leaderboard" on leaderboard_entries for insert with check (true);
 *
 * Pra cada pilot+track+layout, mantém apenas o MELHOR tempo (upsert por
 * tuple). Spectator agrega e mostra top N.
 */

import { getSupabase } from './supabase';

export type LeaderboardEntry = {
  id: string;
  pilotId: string;
  pilotName: string | null;
  pilotKartNumber: string | null;
  trackId: string;
  layoutId: string | null;
  bestLapMs: number;
  createdAt: number;
};

export async function publishLeaderboardEntry(args: {
  pilotId: string;
  trackId: string;
  layoutId: string | null;
  bestLapMs: number;
  sessionId: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // Insert simples — pra MVP, deixa entries duplicadas e ordena por best_lap_ms
  // no fetch. Pra produção, melhor é upsert por (pilot_id, track_id, layout_id).
  await supabase.from('leaderboard_entries').insert({
    pilot_id: args.pilotId,
    track_id: args.trackId,
    layout_id: args.layoutId,
    best_lap_ms: args.bestLapMs,
    session_id: args.sessionId,
  });
}

export async function fetchLeaderboard(
  trackId: string,
  layoutId: string | null,
  limit: number = 20,
  sinceMs?: number
): Promise<LeaderboardEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('leaderboard_entries')
    .select('*, pilots(display_name, kart_number)')
    .eq('track_id', trackId)
    .order('best_lap_ms', { ascending: true });

  if (layoutId) {
    query = query.eq('layout_id', layoutId);
  }
  if (sinceMs) {
    query = query.gte('created_at', new Date(sinceMs).toISOString());
  }

  const { data, error } = await query.limit(limit);
  if (error || !data) return [];

  // Dedupe por pilot_id mantendo o melhor (já vem ordenado ASC, o primeiro
  // de cada pilot é o melhor).
  const seen = new Set<string>();
  const out: LeaderboardEntry[] = [];
  for (const row of data) {
    if (seen.has(row.pilot_id)) continue;
    seen.add(row.pilot_id);
    out.push({
      id: row.id,
      pilotId: row.pilot_id,
      pilotName: row.pilots?.display_name ?? null,
      pilotKartNumber: row.pilots?.kart_number ?? null,
      trackId: row.track_id,
      layoutId: row.layout_id ?? null,
      bestLapMs: row.best_lap_ms,
      createdAt: new Date(row.created_at).getTime(),
    });
  }
  return out;
}
