-- R7 AI Assistant, phases 0 and 1: a meeting recorder that transcribes.
--
-- Physical meetings are recorded from one device, uploaded in numbered chunks
-- to a private bucket, and turned into a transcript after the meeting (a live
-- transcript is optional). This migration adds the data model, the access
-- rules and the retention clock. It deliberately does not touch
-- workspace_rooms: a physical meeting has no video room.
--
-- Access rule (the part that matters most): a recording and its transcript are
-- readable ONLY by the host and by active employees listed as attendees.
-- Holding the admin role grants nothing here. Every predicate also requires
-- employee_profiles.active = true, so a deactivated employee loses access at
-- once even if they were an attendee. (The older can_use_room_chat helper had
-- this gap and was fixed in the bug sweep; this feature never had it.)
--
-- Writes happen through the SECURITY DEFINER functions below or through the
-- room-ai-* edge functions using the service role. Clients get SELECT only.

begin;

-- ---------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------
create table if not exists public.workspace_room_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.workspace_rooms(id) on delete set null,
  mode text not null default 'physical' check (mode in ('online','physical','hybrid')),
  title text not null check (char_length(title) between 2 and 120),
  state text not null default 'recording' check (state in (
    'preparing','awaiting_consent','recording','paused','finalizing','ready','failed','incomplete_upload'
  )),
  started_by uuid not null references public.employee_profiles(id),
  primary_device_label text check (primary_device_label is null or char_length(primary_device_label) <= 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  finalized_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  expected_chunks integer check (expected_chunks is null or expected_chunks >= 0),
  retention_mode text not null default 'delete_after_finalize' check (retention_mode in (
    'delete_after_finalize','days_7','days_30','days_90','permanent'
  )),
  delete_after timestamptz,
  audio_deleted_at timestamptz,
  live_transcript_enabled boolean not null default false,
  recording_enabled boolean not null default true,
  processing_revision integer not null default 0 check (processing_revision >= 0),
  finalize_claimed_at timestamptz,
  summary_text text check (summary_text is null or char_length(summary_text) <= 100000),
  topics jsonb not null default '[]'::jsonb,
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_room_ai_sessions_host_idx
  on public.workspace_room_ai_sessions(started_by, started_at desc);
create index if not exists workspace_room_ai_sessions_due_idx
  on public.workspace_room_ai_sessions(delete_after)
  where audio_deleted_at is null and delete_after is not null;

-- Who was in the room. Employees get access to the finished record; people
-- without an account (guests in a physical room) are named only.
create table if not exists public.workspace_room_ai_attendees (
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  seq smallint not null,
  user_id uuid references public.employee_profiles(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (ai_session_id, seq)
);
create unique index if not exists workspace_room_ai_attendees_user_uidx
  on public.workspace_room_ai_attendees(ai_session_id, user_id) where user_id is not null;
create index if not exists workspace_room_ai_attendees_user_idx
  on public.workspace_room_ai_attendees(user_id) where user_id is not null;

-- Consent trail. Append-only: a later decline never erases the original event.
create table if not exists public.workspace_room_ai_consents (
  id bigint generated always as identity primary key,
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  participant_kind text not null check (participant_kind in ('employee','guest','physical_attendee')),
  user_id uuid references public.employee_profiles(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  consent_method text not null check (consent_method in ('online_explicit','host_physical_attestation')),
  attested_by uuid references public.employee_profiles(id),
  consented_at timestamptz not null default now()
);
create index if not exists workspace_room_ai_consents_session_idx
  on public.workspace_room_ai_consents(ai_session_id);

-- Audio chunks, in order. The final recording is the concatenation by seq.
create table if not exists public.workspace_room_ai_chunks (
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  seq integer not null check (seq >= 0 and seq < 20000),
  storage_path text not null,
  bytes integer not null check (bytes > 0 and bytes <= 15728640),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null,
  created_at timestamptz not null default now(),
  primary key (ai_session_id, seq)
);

-- The assembled recording (metadata only; bytes live in private storage).
create table if not exists public.workspace_room_recordings (
  id uuid primary key default gen_random_uuid(),
  ai_session_id uuid not null unique references public.workspace_room_ai_sessions(id) on delete cascade,
  storage_path text not null,
  bytes bigint not null check (bytes > 0),
  mime text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz,
  delete_error text check (delete_error is null or char_length(delete_error) <= 300),
  created_at timestamptz not null default now()
);

-- Transcript. Provisional (live) rows are revision 0 and is_final=false.
-- Final rows carry the processing revision that produced them, so reprocessing
-- adds a new revision instead of overwriting the old one.
create table if not exists public.workspace_room_transcript_segments (
  id bigint generated always as identity primary key,
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  is_final boolean not null default false,
  source text not null default 'room_mic' check (source in ('room_mic','remote')),
  seq integer not null check (seq >= 0),
  speaker_key text not null check (char_length(speaker_key) between 1 and 40),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text text not null check (char_length(text) between 1 and 8000),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  unique (ai_session_id, revision, source, seq)
);
create index if not exists workspace_room_transcript_segments_idx
  on public.workspace_room_transcript_segments(ai_session_id, revision, start_ms);

-- Speaker names set by people. The raw provider output is never rewritten;
-- the viewer applies the latest correction for each speaker key.
create table if not exists public.workspace_room_speaker_corrections (
  id bigint generated always as identity primary key,
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  speaker_key text not null check (char_length(speaker_key) between 1 and 40),
  display_name text not null check (char_length(display_name) between 1 and 120),
  user_id uuid references public.employee_profiles(id) on delete set null,
  corrected_by uuid not null references public.employee_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists workspace_room_speaker_corrections_idx
  on public.workspace_room_speaker_corrections(ai_session_id, speaker_key, id desc);

-- Important moments and typed notes made during the meeting.
create table if not exists public.workspace_room_ai_markers (
  id bigint generated always as identity primary key,
  ai_session_id uuid not null references public.workspace_room_ai_sessions(id) on delete cascade,
  at_ms integer not null check (at_ms >= 0),
  kind text not null check (kind in ('important','note')),
  body text check (body is null or char_length(body) <= 2000),
  created_by uuid not null references public.employee_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists workspace_room_ai_markers_idx
  on public.workspace_room_ai_markers(ai_session_id, at_ms);

-- Who did what. Counts and states only, never transcript text.
create table if not exists public.workspace_room_ai_audit (
  id bigint generated always as identity primary key,
  ai_session_id uuid references public.workspace_room_ai_sessions(id) on delete set null,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event text not null check (char_length(event) between 2 and 60),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists workspace_room_ai_audit_idx
  on public.workspace_room_ai_audit(ai_session_id, id desc);

-- Consent and audit rows can be added but never changed or removed.
create or replace function public.r7_ai_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists r7_ai_consents_append_only on public.workspace_room_ai_consents;
create trigger r7_ai_consents_append_only
  before update or delete on public.workspace_room_ai_consents
  for each row execute function public.r7_ai_append_only();

drop trigger if exists r7_ai_audit_append_only on public.workspace_room_ai_audit;
create trigger r7_ai_audit_append_only
  before update or delete on public.workspace_room_ai_audit
  for each row execute function public.r7_ai_append_only();

-- ---------------------------------------------------------------------
-- State machine, timestamps and the retention clock
-- ---------------------------------------------------------------------
create or replace function public.r7_ai_transition_ok(p_old text, p_new text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_old = p_new or (p_old, p_new) in (
    ('preparing','awaiting_consent'), ('preparing','recording'), ('preparing','failed'),
    ('awaiting_consent','recording'), ('awaiting_consent','failed'),
    ('recording','paused'), ('recording','finalizing'), ('recording','failed'),
    ('paused','recording'), ('paused','finalizing'), ('paused','failed'),
    ('finalizing','ready'), ('finalizing','failed'), ('finalizing','incomplete_upload'),
    ('incomplete_upload','finalizing'), ('incomplete_upload','failed'),
    ('failed','finalizing'),
    ('ready','finalizing')
  );
$$;

create or replace function public.r7_ai_session_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.created_at := old.created_at;
  new.started_by := old.started_by;
  new.updated_at := now();

  if not public.r7_ai_transition_ok(old.state, new.state) then
    raise exception 'AI session cannot move from % to %', old.state, new.state;
  end if;

  if new.state = 'ready' and old.state <> 'ready' then
    new.finalized_at := coalesce(new.finalized_at, now());
    new.error_code := null;
    new.error_message := null;
  end if;

  -- Work out when the audio may be deleted. Only set once a deadline is
  -- meaningful; the host can change the policy until audio is deleted.
  if new.audio_deleted_at is null then
    if new.state = 'ready' then
      new.delete_after := case new.retention_mode
        when 'delete_after_finalize' then coalesce(new.finalized_at, now())
        when 'days_7'  then coalesce(new.finalized_at, now()) + interval '7 days'
        when 'days_30' then coalesce(new.finalized_at, now()) + interval '30 days'
        when 'days_90' then coalesce(new.finalized_at, now()) + interval '90 days'
        else null
      end;
    elsif new.state in ('failed','incomplete_upload') then
      -- A failed session keeps its audio for recovery, but not forever.
      new.delete_after := coalesce(new.ended_at, now()) + interval '14 days';
    else
      new.delete_after := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists r7_ai_session_guard on public.workspace_room_ai_sessions;
create trigger r7_ai_session_guard
  before update on public.workspace_room_ai_sessions
  for each row execute function public.r7_ai_session_guard();

-- ---------------------------------------------------------------------
-- Access predicates
-- ---------------------------------------------------------------------
create or replace function public.r7_ai_is_active_employee()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.employee_profiles e
      where e.id = auth.uid() and e.active = true
    );
$$;

-- Host or an attendee, and in both cases an active employee. No admin branch.
create or replace function public.can_read_room_ai_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.r7_ai_is_active_employee()
    and exists (
      select 1 from public.workspace_room_ai_sessions s
      where s.id = p_session
        and (
          s.started_by = auth.uid()
          or exists (
            select 1 from public.workspace_room_ai_attendees a
            where a.ai_session_id = s.id and a.user_id = auth.uid()
          )
        )
    );
$$;

create or replace function public.can_manage_room_ai_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.r7_ai_is_active_employee()
    and exists (
      select 1 from public.workspace_room_ai_sessions s
      where s.id = p_session and s.started_by = auth.uid()
    );
$$;

revoke all on function public.r7_ai_is_active_employee() from public, anon;
revoke all on function public.can_read_room_ai_session(uuid) from public, anon;
revoke all on function public.can_manage_room_ai_session(uuid) from public, anon;
grant execute on function public.r7_ai_is_active_employee() to authenticated;
grant execute on function public.can_read_room_ai_session(uuid) to authenticated;
grant execute on function public.can_manage_room_ai_session(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Row level security: read only for clients
-- ---------------------------------------------------------------------
alter table public.workspace_room_ai_sessions enable row level security;
alter table public.workspace_room_ai_attendees enable row level security;
alter table public.workspace_room_ai_consents enable row level security;
alter table public.workspace_room_ai_chunks enable row level security;
alter table public.workspace_room_recordings enable row level security;
alter table public.workspace_room_transcript_segments enable row level security;
alter table public.workspace_room_speaker_corrections enable row level security;
alter table public.workspace_room_ai_markers enable row level security;
alter table public.workspace_room_ai_audit enable row level security;

drop policy if exists r7_ai_sessions_read on public.workspace_room_ai_sessions;
create policy r7_ai_sessions_read on public.workspace_room_ai_sessions
  for select to authenticated using (public.can_read_room_ai_session(id));

drop policy if exists r7_ai_attendees_read on public.workspace_room_ai_attendees;
create policy r7_ai_attendees_read on public.workspace_room_ai_attendees
  for select to authenticated using (public.can_read_room_ai_session(ai_session_id));

drop policy if exists r7_ai_consents_read on public.workspace_room_ai_consents;
create policy r7_ai_consents_read on public.workspace_room_ai_consents
  for select to authenticated using (public.can_manage_room_ai_session(ai_session_id));

drop policy if exists r7_ai_chunks_read on public.workspace_room_ai_chunks;
create policy r7_ai_chunks_read on public.workspace_room_ai_chunks
  for select to authenticated using (public.can_manage_room_ai_session(ai_session_id));

drop policy if exists r7_ai_recordings_read on public.workspace_room_recordings;
create policy r7_ai_recordings_read on public.workspace_room_recordings
  for select to authenticated using (public.can_read_room_ai_session(ai_session_id));

drop policy if exists r7_ai_segments_read on public.workspace_room_transcript_segments;
create policy r7_ai_segments_read on public.workspace_room_transcript_segments
  for select to authenticated using (public.can_read_room_ai_session(ai_session_id));

drop policy if exists r7_ai_corrections_read on public.workspace_room_speaker_corrections;
create policy r7_ai_corrections_read on public.workspace_room_speaker_corrections
  for select to authenticated using (public.can_read_room_ai_session(ai_session_id));

drop policy if exists r7_ai_markers_read on public.workspace_room_ai_markers;
create policy r7_ai_markers_read on public.workspace_room_ai_markers
  for select to authenticated using (public.can_read_room_ai_session(ai_session_id));

drop policy if exists r7_ai_audit_read on public.workspace_room_ai_audit;
create policy r7_ai_audit_read on public.workspace_room_ai_audit
  for select to authenticated using (
    ai_session_id is not null and public.can_manage_room_ai_session(ai_session_id)
  );

revoke all on public.workspace_room_ai_sessions, public.workspace_room_ai_attendees,
  public.workspace_room_ai_consents, public.workspace_room_ai_chunks,
  public.workspace_room_recordings, public.workspace_room_transcript_segments,
  public.workspace_room_speaker_corrections, public.workspace_room_ai_markers,
  public.workspace_room_ai_audit from public, anon, authenticated;
grant select on public.workspace_room_ai_sessions, public.workspace_room_ai_attendees,
  public.workspace_room_ai_consents, public.workspace_room_ai_chunks,
  public.workspace_room_recordings, public.workspace_room_transcript_segments,
  public.workspace_room_speaker_corrections, public.workspace_room_ai_markers,
  public.workspace_room_ai_audit to authenticated;

-- ---------------------------------------------------------------------
-- Private bucket: no client policies at all. Uploads go through signed upload
-- URLs minted by the room-ai-upload function after it checks the caller owns
-- the session; downloads are not offered (audio is never played back).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-ai-recordings', 'room-ai-recordings', false, 52428800,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','video/webm','video/mp4']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Writes the browser may make (all checked inside)
-- ---------------------------------------------------------------------
create or replace function public.r7_ai_log(p_session uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.workspace_room_ai_audit(ai_session_id, actor_id, event, detail)
  values (p_session, auth.uid(), p_event, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.r7_ai_log(uuid, text, jsonb) from public, anon, authenticated;

-- Start a physical meeting. The host's attestation that everyone in the room
-- agreed is stored here, in the same transaction that creates the session, so
-- there is no session without a consent record.
create or replace function public.start_physical_ai_session(
  p_title text,
  p_attendees jsonb,
  p_retention text,
  p_live boolean,
  p_attested boolean,
  p_device text default null
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
begin
  if not public.r7_ai_is_active_employee() then
    raise exception 'An active RideArrivo employee account is required.';
  end if;
  if p_attested is not true then
    raise exception 'Confirm that everyone in the room has been told about the recording.';
  end if;
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
    ai_session_id, participant_kind, user_id, display_name, consent_method, attested_by
  ) values (sid, 'employee', me, coalesce(my_name, 'Host'), 'host_physical_attestation', me);

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
      ai_session_id, participant_kind, user_id, display_name, consent_method, attested_by
    ) values (
      sid, case when uid is null then 'physical_attendee' else 'employee' end,
      uid, nm, 'host_physical_attestation', me
    );
  end loop;

  perform public.r7_ai_log(sid, 'session_started', jsonb_build_object(
    'mode', 'physical', 'attendees', n, 'retention', p_retention, 'live', coalesce(p_live, false)
  ));
  return sid;
end;
$$;
revoke all on function public.start_physical_ai_session(text, jsonb, text, boolean, boolean, text) from public, anon;
grant execute on function public.start_physical_ai_session(text, jsonb, text, boolean, boolean, text) to authenticated;

create or replace function public.pause_resume_ai_session(p_session uuid, p_pause boolean)
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
  select * into s from public.workspace_room_ai_sessions where id = p_session for update;
  if p_pause and s.state = 'recording' then
    update public.workspace_room_ai_sessions set state = 'paused' where id = p_session;
    perform public.r7_ai_log(p_session, 'paused');
    return 'paused';
  elsif not p_pause and s.state = 'paused' then
    update public.workspace_room_ai_sessions set state = 'recording' where id = p_session;
    perform public.r7_ai_log(p_session, 'resumed');
    return 'recording';
  end if;
  return s.state; -- already there: idempotent
end;
$$;
revoke all on function public.pause_resume_ai_session(uuid, boolean) from public, anon;
grant execute on function public.pause_resume_ai_session(uuid, boolean) to authenticated;

-- End the meeting. The browser says how many chunks it cut; finalization
-- refuses to run until every one of them has arrived.
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
  select * into s from public.workspace_room_ai_sessions where id = p_session for update;
  if s.state in ('recording', 'paused') then
    update public.workspace_room_ai_sessions
    set state = 'finalizing',
        ended_at = now(),
        expected_chunks = greatest(coalesce(p_expected_chunks, 0), 0),
        duration_seconds = greatest(coalesce(p_duration_seconds, 0), 0)
    where id = p_session;
    perform public.r7_ai_log(p_session, 'ended', jsonb_build_object('expected_chunks', p_expected_chunks));
    return 'finalizing';
  end if;
  return s.state; -- a second tap, or already processed
end;
$$;
revoke all on function public.end_ai_session(uuid, integer, integer) from public, anon;
grant execute on function public.end_ai_session(uuid, integer, integer) to authenticated;

create or replace function public.add_ai_marker(p_session uuid, p_at_ms integer, p_kind text, p_body text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s_state text;
  mid bigint;
begin
  if not public.can_manage_room_ai_session(p_session) then
    raise exception 'Meeting not found';
  end if;
  if p_kind not in ('important', 'note') then
    raise exception 'Unknown marker type.';
  end if;
  select state into s_state from public.workspace_room_ai_sessions where id = p_session;
  if s_state not in ('recording', 'paused') then
    raise exception 'The meeting is not being recorded.';
  end if;
  insert into public.workspace_room_ai_markers(ai_session_id, at_ms, kind, body, created_by)
  values (p_session, greatest(coalesce(p_at_ms, 0), 0), p_kind, nullif(left(btrim(coalesce(p_body, '')), 2000), ''), auth.uid())
  returning id into mid;
  return mid;
end;
$$;
revoke all on function public.add_ai_marker(uuid, integer, text, text) from public, anon;
grant execute on function public.add_ai_marker(uuid, integer, text, text) to authenticated;

create or replace function public.correct_ai_speaker(p_session uuid, p_speaker_key text, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  nm text := nullif(left(btrim(coalesce(p_name, '')), 120), '');
  att_user uuid;
begin
  if not public.can_read_room_ai_session(p_session) then
    raise exception 'Meeting not found';
  end if;
  if nm is null then
    raise exception 'Enter a name for this speaker.';
  end if;
  if not exists (
    select 1 from public.workspace_room_transcript_segments
    where ai_session_id = p_session and speaker_key = p_speaker_key
  ) then
    raise exception 'That speaker is not in this transcript.';
  end if;
  -- If the name matches a listed attendee who is an employee, link them.
  select a.user_id into att_user
  from public.workspace_room_ai_attendees a
  where a.ai_session_id = p_session and lower(a.display_name) = lower(nm)
  limit 1;
  insert into public.workspace_room_speaker_corrections(ai_session_id, speaker_key, display_name, user_id, corrected_by)
  values (p_session, p_speaker_key, nm, att_user, auth.uid());
  perform public.r7_ai_log(p_session, 'speaker_corrected', jsonb_build_object('speaker_key', p_speaker_key));
end;
$$;
revoke all on function public.correct_ai_speaker(uuid, text, text) from public, anon;
grant execute on function public.correct_ai_speaker(uuid, text, text) to authenticated;

-- The host can change the audio policy until the audio is gone.
create or replace function public.set_ai_retention(p_session uuid, p_mode text)
returns void
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
  if p_mode not in ('delete_after_finalize','days_7','days_30','days_90','permanent') then
    raise exception 'Unknown audio retention choice.';
  end if;
  select * into s from public.workspace_room_ai_sessions where id = p_session for update;
  if s.audio_deleted_at is not null then
    raise exception 'The audio has already been deleted.';
  end if;
  -- The guard trigger recomputes delete_after on this update.
  update public.workspace_room_ai_sessions
  set retention_mode = p_mode, updated_at = now()
  where id = p_session;
  perform public.r7_ai_log(p_session, 'retention_changed', jsonb_build_object('mode', p_mode));
end;
$$;
revoke all on function public.set_ai_retention(uuid, text) from public, anon;
grant execute on function public.set_ai_retention(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Service-role only helpers used by the edge functions
-- ---------------------------------------------------------------------
create or replace function public.r7_ai_sessions_due_for_deletion(p_limit integer default 25)
returns table (id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
  from public.workspace_room_ai_sessions s
  where s.audio_deleted_at is null
    and s.delete_after is not null
    and s.delete_after <= now()
    and s.state in ('ready', 'failed', 'incomplete_upload')
  order by s.delete_after
  limit greatest(least(coalesce(p_limit, 25), 100), 1);
$$;

create or replace function public.r7_ai_mark_audio_deleted(p_session uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_ok then
    update public.workspace_room_ai_sessions set audio_deleted_at = now() where id = p_session and audio_deleted_at is null;
    update public.workspace_room_recordings set deleted_at = now(), delete_error = null where ai_session_id = p_session;
    delete from public.workspace_room_ai_chunks where ai_session_id = p_session;
    insert into public.workspace_room_ai_audit(ai_session_id, event) values (p_session, 'audio_deleted');
  else
    update public.workspace_room_recordings set delete_error = left(coalesce(p_error, 'unknown'), 300) where ai_session_id = p_session;
    insert into public.workspace_room_ai_audit(ai_session_id, event, detail)
    values (p_session, 'audio_delete_failed', jsonb_build_object('error', left(coalesce(p_error, 'unknown'), 200)));
  end if;
end;
$$;

revoke all on function public.r7_ai_sessions_due_for_deletion(integer) from public, anon, authenticated;
revoke all on function public.r7_ai_mark_audio_deleted(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.r7_ai_sessions_due_for_deletion(integer) to service_role;
grant execute on function public.r7_ai_mark_audio_deleted(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- Retention sweep, every 15 minutes. Same pattern as the other cron jobs:
-- scheduled only when pg_cron is on and the Vault secret exists.
-- ---------------------------------------------------------------------
do $$
declare
  v_cmd text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'cron/vault not available: schedule room-ai-retention manually.';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_dispatch_secret') then
    raise notice 'Vault secret cron_dispatch_secret is missing: create it, then rerun this block to schedule room-ai-retention.';
    return;
  end if;
  v_cmd := $cmd$
    select net.http_post(
      url := (select value from public.system_config where key = 'functions_base_url') || '/room-ai-retention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$;
  if exists (select 1 from cron.job where jobname = 'ridearrivo-room-ai-retention') then
    perform cron.unschedule('ridearrivo-room-ai-retention');
  end if;
  perform cron.schedule('ridearrivo-room-ai-retention', '*/15 * * * *', v_cmd);
exception when others then
  raise notice 'room-ai-retention not scheduled: %', sqlerrm;
end $$;

commit;
