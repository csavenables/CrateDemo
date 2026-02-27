create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_ms bigint null,
  viewer_version text,
  asset_id text null,
  device_type text null,
  referrer text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  anonymous_user_id text null,
  press_counts jsonb null
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  ts timestamptz not null default now(),
  name text not null,
  category text not null,
  payload jsonb not null default '{}'::jsonb
);

alter table public.sessions add column if not exists entry_page text null;
alter table public.sessions add column if not exists exit_page text null;
alter table public.sessions add column if not exists language text null;
alter table public.sessions add column if not exists timezone text null;
alter table public.sessions add column if not exists os text null;
alter table public.sessions add column if not exists browser text null;
alter table public.sessions add column if not exists screen_resolution text null;
alter table public.sessions add column if not exists viewport_size text null;
alter table public.sessions add column if not exists pixel_ratio numeric null;
alter table public.sessions add column if not exists touch_capable boolean null;
alter table public.sessions add column if not exists country text null;
alter table public.sessions add column if not exists region text null;
alter table public.sessions add column if not exists city text null;
alter table public.sessions add column if not exists device_memory_gb numeric null;
alter table public.sessions add column if not exists time_to_first_interaction_ms bigint null;
alter table public.sessions add column if not exists rotate_count int not null default 0;
alter table public.sessions add column if not exists zoom_count int not null default 0;
alter table public.sessions add column if not exists pan_count int not null default 0;
alter table public.sessions add column if not exists rotate_duration_ms bigint null;
alter table public.sessions add column if not exists zoom_duration_ms bigint null;
alter table public.sessions add column if not exists pan_duration_ms bigint null;
alter table public.sessions add column if not exists fps_bucket text null;
alter table public.sessions add column if not exists long_frame_count int null;
alter table public.sessions add column if not exists asset_dns_ms int null;
alter table public.sessions add column if not exists asset_connect_ms int null;
alter table public.sessions add column if not exists asset_download_ms int null;
alter table public.sessions add column if not exists asset_ready_ms int null;
alter table public.sessions add column if not exists telemetry_send_fail_count int not null default 0;
alter table public.sessions add column if not exists webgl_context_lost_count int not null default 0;
alter table public.sessions add column if not exists webgl_context_restored_count int not null default 0;

create index if not exists idx_events_session_ts on public.events (session_id, ts desc);
create index if not exists idx_events_name_ts on public.events (name, ts desc);
create index if not exists idx_events_cta_id on public.events ((payload->>'cta_id'));
create index if not exists idx_sessions_started_at on public.sessions (started_at desc);
create index if not exists idx_sessions_device_started_at on public.sessions (device_type, started_at desc);
