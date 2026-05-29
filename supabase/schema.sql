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
  delta_vs_ref_ms int,                        -- delta vs referência da pista (pode ser null)
  -- Setores (geográficos: 1/3 e 2/3 da polyline da ref do layout).
  -- Preenchidos só quando há layout reference carregada no app.
  current_sector_idx smallint,                -- 0=S1, 1=S2, 2=S3
  current_sector_elapsed_ms int,              -- tempo no setor atual
  s1_ms int,                                  -- parcial S1 (null antes de fechar)
  s2_ms int,                                  -- parcial S2
  s3_ms int                                   -- parcial S3 (só preenche no fim da volta)
);

create index if not exists idx_live_samples_session_t on live_samples(live_session_id, t);

-- Migration pra deployments existentes (idempotente — não falha se já tem)
alter table live_samples add column if not exists current_sector_idx smallint;
alter table live_samples add column if not exists current_sector_elapsed_ms int;
alter table live_samples add column if not exists s1_ms int;
alter table live_samples add column if not exists s2_ms int;
alter table live_samples add column if not exists s3_ms int;
-- Altitude do GPS — quando disponível. Usado pelo viewer 3D pra
-- elevation profile. accuracy vertical separada.
alter table live_samples add column if not exists altitude real;
alter table live_samples add column if not exists altitude_accuracy real;

create table if not exists live_laps (
  id bigserial primary key,
  live_session_id uuid references live_sessions(id) on delete cascade not null,
  lap_number int not null,
  duration_ms int not null,
  finished_at timestamptz default now(),
  -- Tempos por setor da volta fechada (null se sem layout ref no app).
  s1_ms int,
  s2_ms int,
  s3_ms int
);

create index if not exists idx_live_laps_session on live_laps(live_session_id);

-- Migration idempotente pra adicionar setores em deployments existentes
alter table live_laps add column if not exists s1_ms int;
alter table live_laps add column if not exists s2_ms int;
alter table live_laps add column if not exists s3_ms int;

-- =====================
-- Eventos / Modo Competição
-- =====================
-- Um EVENTO agrupa várias live_sessions (uma por piloto) sob um código.
-- Ranking ao vivo agrega a melhor volta de cada piloto. GPS outdoor —
-- cada piloto roda o app, entra no código, e cronometra suas voltas.
--
-- live_sessions.event_id liga a sessão ao evento. live_laps.event_id é
-- denormalizado (mesmo valor) pra permitir realtime filtrado por evento
-- (subscribe em live_laps WHERE event_id = X pega voltas de TODOS os
-- pilotos do evento num canal só).

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text,
  track_id text,
  track_name text,
  created_by text,                            -- device_id do criador, ou 'web'
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '12 hours'
);

create index if not exists idx_events_code on events(code);

alter table live_sessions add column if not exists event_id uuid references events(id) on delete set null;
alter table live_laps add column if not exists event_id uuid;

create index if not exists idx_live_laps_event on live_laps(event_id, finished_at);
create index if not exists idx_live_sessions_event on live_sessions(event_id);

-- =====================
-- Mensagens da equipe pro piloto (Team→Pilot)
-- =====================
-- Equipe/box manda comandos curtos pro piloto durante a sessão. O app
-- assina o canal realtime e mostra como overlay grande (~5s) por cima
-- do HUD. Severidade controla cor + prioridade visual:
--
--   info     → verde (BOA VOLTA, MANTÉM RITMO) — feedback positivo
--   warning  → amarelo (SETOR 2 LENTO, CUIDADO TRÁFEGO) — atenção
--   critical → vermelho (BOX AGORA, REDUZ RITMO) — comando urgente
--
-- Texto livre limitado a 24 chars (UI restringe). Mensagens ficam pra
-- consulta do histórico depois (debrief pós-sessão).
create table if not exists live_messages (
  id bigserial primary key,
  live_session_id uuid references live_sessions(id) on delete cascade not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  text text not null,
  sent_at timestamptz not null default now(),
  -- Marcado quando o app do piloto recebe e renderiza. Opcional, usado
  -- pra calcular latência real e pra histórico "mensagem foi vista".
  acked_at timestamptz,
  -- Quem mandou: nome livre da equipe pra contexto no histórico
  -- ("Coach Paulo", "Box A"). Não é auth — só etiqueta.
  sent_by text
);

create index if not exists idx_live_messages_session on live_messages(live_session_id, sent_at desc);

-- =====================
-- Realtime
-- =====================
-- Habilita Realtime nas tabelas de stream. Usa DO block com EXCEPTION pra
-- ser idempotente — `alter publication add table` é o tipo de DDL que
-- não tem "if not exists" e dá erro 42710 quando rodado de novo. Engole
-- duplicate_object pra que o schema possa ser reaplicado sem quebrar.
do $$
begin
  alter publication supabase_realtime add table live_samples;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table live_laps;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table live_sessions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table live_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null;
end $$;

-- =====================
-- Sync anônimo de sessões (backup + visibilidade dev)
-- =====================
-- Sincroniza METADATA + tempos de volta (não os sample arrays brutos —
-- grandes demais pro free tier). Chaveado por device_id (anônimo, sem
-- login). Dá backup pro tester + dashboard pro dev ver uso de campo.
-- Telemetria completa (samples/IMU) continua local; sincroniza sob demanda.
--
-- Upsert idempotente via UNIQUE(device_id, local_session_id).

create table if not exists synced_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  local_session_id text not null,           -- id da session no SQLite do device
  pilot_name text,
  track_id text,
  track_name text,
  layout_id text,
  mode text,
  started_at timestamptz,
  best_lap_ms int,
  lap_count int,
  synced_at timestamptz default now(),
  unique (device_id, local_session_id)
);

create index if not exists idx_synced_sessions_device on synced_sessions(device_id, started_at desc);

create table if not exists synced_laps (
  id bigserial primary key,
  device_id text not null,
  local_session_id text not null,
  lap_number int not null,
  duration_ms int not null,
  s1_ms int,
  s2_ms int,
  s3_ms int,
  unique (device_id, local_session_id, lap_number)
);

create index if not exists idx_synced_laps_session on synced_laps(device_id, local_session_id);

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
alter table live_messages enable row level security;
alter table synced_sessions enable row level security;
alter table synced_laps enable row level security;
alter table events enable row level security;

-- Policies — `create policy` não tem "if not exists" no Postgres, então
-- precedemos cada uma com `drop policy if exists` pra que o schema rode
-- múltiplas vezes sem quebrar (re-aplicação após mudanças de migration).

drop policy if exists "public read pilots" on pilots;
create policy "public read pilots" on pilots for select using (true);
drop policy if exists "public insert pilots" on pilots;
create policy "public insert pilots" on pilots for insert with check (true);
drop policy if exists "public update pilots" on pilots;
create policy "public update pilots" on pilots for update using (true);

drop policy if exists "public read live_sessions" on live_sessions;
create policy "public read live_sessions" on live_sessions for select using (true);
drop policy if exists "public insert live_sessions" on live_sessions;
create policy "public insert live_sessions" on live_sessions for insert with check (true);
drop policy if exists "public update live_sessions" on live_sessions;
create policy "public update live_sessions" on live_sessions for update using (true);

drop policy if exists "public read live_samples" on live_samples;
create policy "public read live_samples" on live_samples for select using (true);
drop policy if exists "public insert live_samples" on live_samples;
create policy "public insert live_samples" on live_samples for insert with check (true);

drop policy if exists "public read live_laps" on live_laps;
create policy "public read live_laps" on live_laps for select using (true);
drop policy if exists "public insert live_laps" on live_laps;
create policy "public insert live_laps" on live_laps for insert with check (true);

drop policy if exists "public read synced_sessions" on synced_sessions;
create policy "public read synced_sessions" on synced_sessions for select using (true);
drop policy if exists "public insert synced_sessions" on synced_sessions;
create policy "public insert synced_sessions" on synced_sessions for insert with check (true);
drop policy if exists "public update synced_sessions" on synced_sessions;
create policy "public update synced_sessions" on synced_sessions for update using (true);

drop policy if exists "public read synced_laps" on synced_laps;
create policy "public read synced_laps" on synced_laps for select using (true);
drop policy if exists "public insert synced_laps" on synced_laps;
create policy "public insert synced_laps" on synced_laps for insert with check (true);
drop policy if exists "public update synced_laps" on synced_laps;
create policy "public update synced_laps" on synced_laps for update using (true);

drop policy if exists "public read events" on events;
create policy "public read events" on events for select using (true);
drop policy if exists "public insert events" on events;
create policy "public insert events" on events for insert with check (true);
drop policy if exists "public update events" on events;
create policy "public update events" on events for update using (true);

drop policy if exists "public read live_messages" on live_messages;
create policy "public read live_messages" on live_messages for select using (true);
drop policy if exists "public insert live_messages" on live_messages;
create policy "public insert live_messages" on live_messages for insert with check (true);
drop policy if exists "public update live_messages" on live_messages;
create policy "public update live_messages" on live_messages for update using (true);

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

-- =====================
-- Leaderboard (PBs públicos por pista)
-- =====================
-- Cada PB pessoal pode ser publicado opcionalmente. Spectator (qualquer app
-- com a anon key) lê e mostra top N por (track_id, layout_id).

create table if not exists leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid references pilots(id) on delete cascade,
  track_id text not null,
  layout_id text,
  best_lap_ms integer not null,
  session_id text,
  created_at timestamptz default now()
);

create index if not exists idx_leaderboard_track on leaderboard_entries(track_id, best_lap_ms);

alter table leaderboard_entries enable row level security;

drop policy if exists "public read leaderboard" on leaderboard_entries;
create policy "public read leaderboard" on leaderboard_entries for select using (true);
drop policy if exists "public insert leaderboard" on leaderboard_entries;
create policy "public insert leaderboard" on leaderboard_entries for insert with check (true);
