-- R7 AI hardening, from the external audit.
--
--  * expected_chunks gets a hard ceiling in the database (and end_ai_session
--    refuses larger values), so finalization can never be asked to walk a
--    billion-entry list.
--  * Consent evidence for physical meetings is stronger: the exact wording the
--    host confirmed is stored by version in an append-only table, every consent
--    row points at it, and carries the device's user agent. The audit log entry
--    for the session also snapshots who attended, who attested, and the wording.
--  * Cron re-authentication (RA-006) can be re-run any time after the Vault
--    secret exists, and its state can be read, instead of silently skipping.
begin;

-- ---------------------------------------------------------------------
-- 4. expected_chunks ceiling
-- ---------------------------------------------------------------------
alter table public.workspace_room_ai_sessions
  drop constraint if exists workspace_room_ai_sessions_expected_chunks_max;
alter table public.workspace_room_ai_sessions
  add constraint workspace_room_ai_sessions_expected_chunks_max
  check (expected_chunks is null or expected_chunks <= 20000) not valid;
alter table public.workspace_room_ai_sessions
  validate constraint workspace_room_ai_sessions_expected_chunks_max;

create or replace function public.end_ai_session(p_session uuid, p_expected_chunks integer, p_duration_seconds integer)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.workspace_room_ai_sessions%rowtype;
begin
  if not public.can_manage_room_ai_session(p_session) then
    raise exception 'Meeting not found';
  end if;
  -- Hard server-side ceilings. The browser cuts a chunk every 10 seconds, so
  -- 20000 chunks is over 55 hours; anything larger is a bug or an attack, and
  -- would make finalization loop over a huge list.
  if p_expected_chunks is not null and (p_expected_chunks < 0 or p_expected_chunks > 20000) then
    raise exception 'That recording is longer than ROOM 7 can process.';
  end if;
  select * into s from public.workspace_room_ai_sessions where id = p_session for update;
  if s.state in ('recording', 'paused') then
    update public.workspace_room_ai_sessions
    set state = 'finalizing',
        ended_at = now(),
        expected_chunks = greatest(coalesce(p_expected_chunks, 0), 0),
        duration_seconds = least(greatest(coalesce(p_duration_seconds, 0), 0), 259200)
    where id = p_session;
    perform public.r7_ai_log(p_session, 'ended', jsonb_build_object('expected_chunks', p_expected_chunks));
    return 'finalizing';
  end if;
  return s.state; -- a second tap, or already processed
end;
$$;
revoke all on function public.end_ai_session(uuid, integer, integer) from public, anon;
grant execute on function public.end_ai_session(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Consent evidence
-- ---------------------------------------------------------------------
create table if not exists public.workspace_room_ai_consent_statements (
  version text primary key check (version ~ '^[a-z0-9-]{3,40}$'),
  body text not null check (char_length(body) between 20 and 1000),
  created_at timestamptz not null default now()
);
alter table public.workspace_room_ai_consent_statements enable row level security;
drop policy if exists r7_ai_statements_read on public.workspace_room_ai_consent_statements;
create policy r7_ai_statements_read on public.workspace_room_ai_consent_statements
  for select to authenticated using (true);
revoke all on public.workspace_room_ai_consent_statements from public, anon, authenticated;
grant select on public.workspace_room_ai_consent_statements to authenticated;

insert into public.workspace_room_ai_consent_statements(version, body) values (
  'physical-v1',
  'I confirm everyone in this room has been told this meeting is being recorded and transcribed, and agrees.'
) on conflict (version) do nothing;

drop trigger if exists r7_ai_statements_append_only on public.workspace_room_ai_consent_statements;
create trigger r7_ai_statements_append_only
  before update or delete on public.workspace_room_ai_consent_statements
  for each row execute function public.r7_ai_append_only();

-- The consents table blocks UPDATE, so new evidence columns are nullable: rows
-- written before this migration simply have none.
alter table public.workspace_room_ai_consents
  add column if not exists statement_version text
    references public.workspace_room_ai_consent_statements(version),
  add column if not exists client_user_agent text
    check (client_user_agent is null or char_length(client_user_agent) <= 300);

drop function if exists public.start_physical_ai_session(text, jsonb, text, boolean, boolean, text);
create or replace function public.start_physical_ai_session(
  p_title text,
  p_attendees jsonb,
  p_retention text,
  p_live boolean,
  p_attested boolean,
  p_device text default null,
  p_statement_version text default 'physical-v1'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  my_name text;
  sid uuid;
  item jsonb;
  n smallint := 1;
  nm text;
  uid uuid;
  ua text;
  statement text;
  names jsonb := '[]'::jsonb;
begin
  if not public.r7_ai_is_active_employee() then
    raise exception 'An active RideArrivo employee account is required.';
  end if;
  if p_attested is not true then
    raise exception 'Confirm that everyone in the room has been told about the recording.';
  end if;
  -- The exact wording the host agreed to is looked up here, never taken from the
  -- browser, so the stored evidence cannot be edited by the client.
  select body into statement from public.workspace_room_ai_consent_statements
  where version = coalesce(p_statement_version, 'physical-v1');
  if statement is null then
    raise exception 'Unknown consent wording. Reload the page and try again.';
  end if;
  begin
    ua := left(nullif((nullif(current_setting('request.headers', true), '')::jsonb)->>'user-agent', ''), 300);
  exception when others then
    ua := null;
  end;
  if p_retention not in ('delete_after_finalize','days_7','days_30','days_90','permanent') then
    raise exception 'Unknown audio retention choice.';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 2 or char_length(btrim(p_title)) > 120 then
    raise exception 'Give the meeting a title (2 to 120 characters).';
  end if;
  if p_attendees is not null and jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'Attendees must be a list.';
  end if;
  if p_attendees is not null and jsonb_array_length(p_attendees) > 60 then
    raise exception 'A meeting can list at most 60 attendees.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Host') into my_name
  from public.employee_profiles where id = me;

  insert into public.workspace_room_ai_sessions(
    mode, title, state, started_by, primary_device_label, retention_mode,
    live_transcript_enabled
  ) values (
    'physical', btrim(p_title), 'recording', me, nullif(left(btrim(coalesce(p_device, '')), 120), ''),
    p_retention, coalesce(p_live, false)
  ) returning id into sid;

  -- The host is always an attendee.
  insert into public.workspace_room_ai_attendees(ai_session_id, seq, user_id, display_name)
  values (sid, n, me, coalesce(my_name, 'Host'));
  insert into public.workspace_room_ai_consents(
    ai_session_id, participant_kind, user_id, display_name, consent_method, attested_by,
    statement_version, client_user_agent
  ) values (sid, 'employee', me, coalesce(my_name, 'Host'), 'host_physical_attestation', me,
    coalesce(p_statement_version, 'physical-v1'), ua);
  names := names || to_jsonb(coalesce(my_name, 'Host'));

  for item in select * from jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb))
  loop
    nm := nullif(left(btrim(coalesce(item->>'name', '')), 120), '');
    if nm is null then continue; end if;
    uid := null;
    if (item->>'user_id') ~* '^[0-9a-f-]{36}$' then
      uid := (item->>'user_id')::uuid;
      -- Only real, active employees become employee attendees.
      if uid = me or not exists (
        select 1 from public.employee_profiles e where e.id = uid and e.active = true
      ) then
        uid := null;
        if (item->>'user_id')::uuid = me then continue; end if;
      end if;
    end if;
    n := n + 1;
    insert into public.workspace_room_ai_attendees(ai_session_id, seq, user_id, display_name)
    values (sid, n, uid, nm);
    insert into public.workspace_room_ai_consents(
      ai_session_id, participant_kind, user_id, display_name, consent_method, attested_by,
      statement_version, client_user_agent
    ) values (
      sid, case when uid is null then 'physical_attendee' else 'employee' end,
      uid, nm, 'host_physical_attestation', me,
      coalesce(p_statement_version, 'physical-v1'), ua
    );
    names := names || to_jsonb(nm);
  end loop;

  perform public.r7_ai_log(sid, 'session_started', jsonb_build_object(
    'mode', 'physical', 'attendees', n, 'retention', p_retention, 'live', coalesce(p_live, false),
    'consent_statement_version', coalesce(p_statement_version, 'physical-v1'),
    'consent_statement', statement,
    'attested_by', me,
    'attendee_names', names,
    'device', nullif(left(btrim(coalesce(p_device, '')), 120), ''),
    'client_user_agent', ua
  ));
  return sid;
end;
$$;
revoke all on function public.start_physical_ai_session(text, jsonb, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.start_physical_ai_session(text, jsonb, text, boolean, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Cron re-authentication that cannot be silently skipped
-- ---------------------------------------------------------------------
-- The RA-006 step in 20261016320000 only prints a NOTICE when the Vault secret
-- is missing, and a migration never runs twice, so a database migrated before
-- the secret existed kept jobs that answer 401 forever without anyone noticing.
--
--   select * from public.cron_authentication_status();   -- read only
--   select * from public.repair_cron_authentication();   -- safe to run any time
--
-- Both are for the SQL editor or the service role. They are not callable from
-- the app.
create or replace function public.cron_authentication_status()
returns table (jobname text, state text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    return query select 'cron'::text, 'not_installed'::text;
    return;
  end if;
  return query
  select j.jobname::text,
         case
           when j.command like '%service_role_key%' then 'needs_repair'
           when j.command like '%cron_dispatch_secret%' then 'ok'
           else 'unknown'
         end
  from cron.job j
  where j.jobname in ('ridearrivo-dispatch-notification-emails', 'ridearrivo-poll-bookings')
  order by j.jobname;
end;
$$;

create or replace function public.repair_cron_authentication()
returns table (jobname text, result text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  j record;
  v_cmd text;
  has_secret boolean := false;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    return query select 'cron/vault'::text, 'not_available'::text;
    return;
  end if;

  execute 'select exists (select 1 from vault.decrypted_secrets where name = ''cron_dispatch_secret'')'
    into has_secret;

  for j in
    select cj.jobname, cj.schedule, cj.command
    from cron.job cj
    where cj.jobname in ('ridearrivo-dispatch-notification-emails', 'ridearrivo-poll-bookings')
  loop
    if j.command not like '%service_role_key%' then
      jobname := j.jobname; result := 'already_ok'; return next; continue;
    end if;
    if not has_secret then
      jobname := j.jobname; result := 'blocked_create_vault_secret_cron_dispatch_secret'; return next; continue;
    end if;
    v_cmd := format($cmd$
      select net.http_post(
        url := (select value from public.system_config where key = 'functions_base_url') || '/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret' limit 1)
        ),
        body := '{}'::jsonb
      );
    $cmd$, case j.jobname when 'ridearrivo-poll-bookings' then 'ridearrivo-bookings-poll' else 'notifications-email-dispatch' end);
    perform cron.unschedule(j.jobname);
    perform cron.schedule(j.jobname, j.schedule, v_cmd);
    jobname := j.jobname; result := 'repaired'; return next;
  end loop;
end;
$$;

revoke all on function public.cron_authentication_status() from public, anon, authenticated;
revoke all on function public.repair_cron_authentication() from public, anon, authenticated;

-- Try once now and say loudly if a job is still on the old key.
do $$
declare r record;
begin
  for r in select * from public.repair_cron_authentication() loop
    if r.result like 'blocked%' then
      raise warning 'Cron job % still uses the old key. Create the Vault secret cron_dispatch_secret, then run: select * from public.repair_cron_authentication();', r.jobname;
    end if;
  end loop;
exception when others then
  raise warning 'Cron re-authentication check failed: %', sqlerrm;
end $$;

commit;
