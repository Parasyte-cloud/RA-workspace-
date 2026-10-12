begin;

-- ============================================================
-- ROOM 7 guest access: approval queue, auto-open, rate limits.
-- Run this BEFORE deploying the matching edge functions.
-- Everything here is additive: existing events keep working
-- exactly as they do today (admission = auto, auto_open = true).
-- ============================================================

-- 1. Per event settings --------------------------------------
alter table public.room7_external_rooms
  add column if not exists admission text not null default 'auto';

alter table public.room7_external_rooms
  drop constraint if exists room7_external_rooms_admission_check;
alter table public.room7_external_rooms
  add constraint room7_external_rooms_admission_check
  check (admission in ('auto','host'));

-- When true, the room opens to guests by itself as soon as its host joins
-- the call (only if the public page is already on).
alter table public.room7_external_rooms
  add column if not exists auto_open boolean not null default true;

-- 2. Approval queue ------------------------------------------
-- One row per guest browser (key_hash is the SHA-256 of a random key the
-- guest page keeps in sessionStorage), so an approval cannot be borrowed by
-- someone who only knows the approved person's email address.
create table if not exists public.room7_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (char_length(email) between 3 and 320),
  display_name text not null check (char_length(display_name) between 1 and 180),
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (room_id, key_hash)
);

create index if not exists room7_join_requests_room_status_idx
  on public.room7_join_requests(room_id, status, created_at);

alter table public.room7_join_requests enable row level security;
revoke all on public.room7_join_requests from public, anon, authenticated;
grant all on public.room7_join_requests to service_role;

-- 3. Rate limiter --------------------------------------------
-- Fixed windows, keyed by any text (the edge function uses IP + room).
create table if not exists public.room7_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

alter table public.room7_rate_limits enable row level security;
revoke all on public.room7_rate_limits from public, anon, authenticated;
grant all on public.room7_rate_limits to service_role;

-- Returns the number of hits in the current window. p_increment=false only
-- reads, so a caller can check first and count only failures.
create or replace function public.room7_rate_count(
  p_key text,
  p_window_seconds integer,
  p_increment boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or char_length(p_key) = 0 or char_length(p_key) > 200 then
    raise exception 'Invalid rate limit key';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit window';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  if p_increment then
    insert into public.room7_rate_limits as r (key, window_start, hits)
    values (p_key, v_window, 1)
    on conflict (key, window_start)
    do update set hits = r.hits + 1
    returning r.hits into v_hits;

    -- Housekeeping: now and then, drop windows older than a day.
    if random() < 0.01 then
      delete from public.room7_rate_limits where window_start < now() - interval '1 day';
    end if;
  else
    select r.hits into v_hits
    from public.room7_rate_limits r
    where r.key = p_key and r.window_start = v_window;
  end if;

  return coalesce(v_hits, 0);
end;
$$;

revoke all on function public.room7_rate_count(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.room7_rate_count(text, integer, boolean) to service_role;

commit;
