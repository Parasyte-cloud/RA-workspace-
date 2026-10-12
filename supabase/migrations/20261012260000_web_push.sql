-- Phone and desktop push notifications.
--
-- What this adds:
--   1. push_subscriptions: one row per browser or phone a person turned
--      "Phone alerts" on for. The person manages only their own rows.
--   2. A trigger on notifications. When a notification is created for someone
--      who has at least one subscription, the database asks the push-dispatch
--      edge function to send it. This is what lets a ringing call reach a
--      phone whose app is closed.
--
-- The trigger can never break the thing that created the notification: any
-- failure inside it is swallowed, so a call still starts if push is down.
--
-- One-time setup after running this (SQL editor), see docs/push-notifications.md:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
--   select vault.create_secret('<long random string>', 'push_dispatch_secret');
--
-- Safe to run more than once.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Saving goes through a function so the row always belongs to the caller, and
-- the same browser signing in as someone else moves the row to the new person.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failure_count = 0;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- The trigger. Secrets live in Vault, never in this file.
create or replace function public.push_on_notification()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.push_on_notification() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.push_on_notification();

commit;
