-- Local/server-side abuse control for the reusable intake service.
-- Raw client IP addresses are never stored; the Edge Function supplies an HMAC key.

create table if not exists public.intake_rate_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  last_seen_at timestamptz not null default now(),
  primary key (key_hash, bucket_start),
  check (length(key_hash) between 32 and 128)
);

alter table public.intake_rate_limits enable row level security;

revoke all on public.intake_rate_limits from anon, authenticated;
grant all on public.intake_rate_limits to service_role;

create or replace function public.consume_intake_rate_limit(
  p_key_hash text,
  p_limit integer default 10,
  p_window_seconds integer default 600
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz;
  v_hits integer;
  v_reset timestamptz;
begin
  if p_key_hash is null
     or length(p_key_hash) < 32
     or length(p_key_hash) > 128
     or p_limit < 1
     or p_limit > 1000
     or p_window_seconds < 60
     or p_window_seconds > 86400 then
    raise exception 'Invalid intake rate-limit arguments';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_reset := v_bucket + make_interval(secs => p_window_seconds);

  insert into public.intake_rate_limits (
    key_hash,
    bucket_start,
    hits,
    last_seen_at
  ) values (
    p_key_hash,
    v_bucket,
    1,
    v_now
  )
  on conflict (key_hash, bucket_start)
  do update set
    hits = public.intake_rate_limits.hits + 1,
    last_seen_at = excluded.last_seen_at
  returning public.intake_rate_limits.hits into v_hits;

  if random() < 0.01 then
    delete from public.intake_rate_limits
    where bucket_start < v_now - interval '2 days';
  end if;

  return query
  select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    v_reset;
end;
$$;

revoke all on function public.consume_intake_rate_limit(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_intake_rate_limit(text, integer, integer)
to service_role;
