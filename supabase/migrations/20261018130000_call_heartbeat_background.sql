-- A call in the background (the person is in another app) can send its
-- heartbeat less often, because phones slow a hidden page down. Give it
-- 150 seconds instead of 60 before the database calls the call abandoned.
create or replace function public.end_stale_calls_for(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.chat_calls
  set status = 'ended', ended_at = now()
  where status = 'accepted'
    and (caller_id = p_user or callee_id = p_user)
    and (
      (heartbeat_at is not null and heartbeat_at < now() - interval '150 seconds')
      or (heartbeat_at is null and coalesce(answered_at, created_at) < now() - interval '4 hours')
    );
$$;
revoke all on function public.end_stale_calls_for(uuid) from public, anon, authenticated;
