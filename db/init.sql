create extension if not exists "uuid-ossp";

create table if not exists sessions (
  id uuid primary key default uuid_generate_v4(),
  external_id text,
  created_at timestamptz not null default now(),
  user_agent text,
  referrer text,
  ip inet
);

create unique index if not exists sessions_external_id_uq on sessions(external_id);

create table if not exists events (
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  event_index int not null,
  ts_ms bigint not null,
  type int not null,
  data jsonb not null
);

create unique index if not exists events_session_idx_uq
  on events(session_id, event_index);

create index if not exists events_session_ts_idx
  on events(session_id, ts_ms);