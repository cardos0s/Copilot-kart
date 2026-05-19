-- =============================================================================
-- Copilot Karting — Live Session Schema
-- =============================================================================
-- Rode esse arquivo no SQL Editor do Supabase (Dashboard → SQL Editor → New).
--
-- Modelo:
--   - pilots: identidade anônima por device_id (sem signup tradicional)
--   - live_sessions: sessões compartilhadas ao vivo, identificadas por código
--   - live_samples: stream de telemetria a ~1Hz (insert-only)
--   - live_laps: voltas fechadas (evento discreto)
--
-- Realtime: o cliente assina o canal `live:<code>` e recebe INSERTs em
-- live_samples e live_laps filtrados pelo live_session_id.
-- =============================================================================

-- =====================
-- Tabelas
-- =====================

create table if not exists pilots (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,
  display_name text,
  kart_number text,
  team text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  pilot_id uuid references pilots(id) on delete set null,
  track_name text,
  track_id text,
  reference_lap_ms int,                       -- referência da pista no momento da sessão
  started_at timestamptz default now(),
  ended_at timestamptz,
  expires_at timestamptz default now() + interval '6 hours'
);

create index if not exists idx_live_sessions_code on live_sessions(code);
create index if not exists idx_live_sessions_expires on live_sessions(expires_at);

create table if not exists live_samples (
  id bigserial primary key,
  live_session_id uuid references live_sessions(id) on delete cascade not null,
  t timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null,
  speed real not null,                        -- m/s
  heading real,                               -- graus, opcional
  accuracy real,                              -- metros, opcional
  lap_number int,                             -- volta atual (0-based)
  lap_elapsed_ms int,                         -- tempo da volta em curso
  best_lap_ms int,                            -- melhor volta da sessão até aqui
  delta_vs_ref_ms int                         -- delta vs referência da pista (pode ser null)
);

create index if not exists idx_live_samples_session_t on live_samples(live_session_id, t);

create table if not exists live_laps (
  id bigserial primary key,
  live_session_id uuid references live_sessions(id) on delete cascade not null,
  lap_number int not null,
  duration_ms int not null,
  finished_at timestamptz default now()
);

create index if not exists idx_live_laps_session on live_laps(live_session_id);

-- =====================
-- Realtime
-- =====================
-- Habilita Realtime nas tabelas de stream.
alter publication supabase_realtime add table live_samples;
alter publication supabase_realtime add table live_laps;
alter publication supabase_realtime add table live_sessions;

-- =====================
-- RLS (Row-Level Security)
-- =====================
-- Por enquanto: permissivo (qualquer um com o anon key pode ler/escrever).
-- TODO produção: trocar pra anonymous auth + policies baseadas em auth.uid().
--
-- Modelo permissivo:
--   - Leitura pública em todas as tabelas
--   - Insert público em live_samples / live_laps / live_sessions / pilots
--   - Update permitido em live_sessions (pra setar ended_at)

alter table pilots enable row level security;
alter table live_sessions enable row level security;
alter table live_samples enable row level security;
alter table live_laps enable row level security;

create policy "public read pilots" on pilots for select using (true);
create policy "public insert pilots" on pilots for insert with check (true);
create policy "public update pilots" on pilots for update using (true);

create policy "public read live_sessions" on live_sessions for select using (true);
create policy "public insert live_sessions" on live_sessions for insert with check (true);
create policy "public update live_sessions" on live_sessions for update using (true);

create policy "public read live_samples" on live_samples for select using (true);
create policy "public insert live_samples" on live_samples for insert with check (true);

create policy "public read live_laps" on live_laps for select using (true);
create policy "public insert live_laps" on live_laps for insert with check (true);

-- =====================
-- Limpeza automática (opcional)
-- =====================
-- Cria uma função que apaga sessões expiradas. Rode manualmente ou via
-- Supabase scheduled functions (cron).

create or replace function cleanup_expired_live_sessions()
returns void as $$
begin
  delete from live_sessions where expires_at < now();
end;
$$ language plpgsql;

-- Pra agendar: Supabase Dashboard → Database → Cron Jobs → New job
-- Exemplo: a cada 1h, executar: select cleanup_expired_live_sessions();
