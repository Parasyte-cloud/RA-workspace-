-- Critical bug sweep 2026-10-16 (source commit 37a82aa).
-- RA-002 / RA-003  ROOM 7 saved chat and minutes: active employees only, no silent admin read
-- RA-006           Re-authenticate the two cron jobs that still use the old service key
-- RA-012           Busy guard for chat calls
-- RA-015           Cursor so mail polling rotates through everyone
-- RA-016           Forwarded attachments must be the same bytes as the original
-- RA-021           Contracts and compliance: Legal and admin only, like the other legal tables
--
-- Safe to run twice.

begin;

-- ---------------------------------------------------------------------
-- RA-002 + RA-003: ROOM 7 saved content
-- ---------------------------------------------------------------------
-- Before: the helper never looked at employee_profiles.active, so a revoked
-- employee with a still-valid session kept reading and writing saved meeting
-- chat, and a revoked admin kept moderator rights. It also let ANY admin read
-- any room's chat and minutes without being in the room, with no notice to
-- the host.
-- Now: the caller must be an ACTIVE employee, and must be in the room (an
-- unremoved participant, or the host). An administrator who needs to see a
-- meeting joins it, which already tells the host. Moderation (deleting a
-- message) still allows an active admin who is in the room.
create or replace function public.can_use_room_chat(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.employee_profiles me
      where me.id = auth.uid() and me.active = true
    )
    and exists (select 1 from public.workspace_rooms r where r.id = p_room)
    and (
      exists (
        select 1 from public.workspace_room_participants p
        where p.room_id = p_room and p.user_id = auth.uid() and p.removed_at is null
      )
      or exists (
        select 1 from public.workspace_rooms r
        where r.id = p_room and r.created_by = auth.uid()
      )
    );
$$;
revoke all on function public.can_use_room_chat(uuid) from public, anon;
grant execute on function public.can_use_room_chat(uuid) to authenticated;

create or replace function public.delete_room_message(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.workspace_room_messages%rowtype;
  moderator boolean;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into msg from public.workspace_room_messages where id = p_id for update;
  if not found or not public.can_use_room_chat(msg.room_id) then
    raise exception 'Message not found';
  end if;
  -- can_use_room_chat already proved the caller is an active employee in the room.
  moderator := exists (select 1 from public.workspace_rooms r where r.id = msg.room_id and r.created_by = me)
    or exists (select 1 from public.employee_profiles e where e.id = me and e.role = 'admin' and e.active = true);
  if msg.sender_id <> me and not moderator then
    raise exception 'You can only delete your own messages';
  end if;
  update public.workspace_room_messages
  set deleted_at = now(), body = 'Message deleted'
  where id = p_id and deleted_at is null;
end;
$$;
revoke all on function public.delete_room_message(uuid) from public, anon;
grant execute on function public.delete_room_message(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RA-006: cron jobs that still send the old service-role key
-- ---------------------------------------------------------------------
-- The two Edge Functions now require CRON_DISPATCH_SECRET. Older migrations
-- scheduled their jobs with system_config.service_role_key, so a database
-- rebuilt from migrations got jobs that always answer 401.
--
-- This only touches a job that STILL references service_role_key, and only if
-- the matching Vault secret exists, so a project that was already repaired by
-- hand is left exactly as it is. One-time setup (same value as the function
-- secret CRON_DISPATCH_SECRET):
--   select vault.create_secret('<CRON_DISPATCH_SECRET value>', 'cron_dispatch_secret');
do $$
declare
  j record;
  v_cmd text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'cron/vault not available, skipping cron re-authentication.';
    return;
  end if;

  for j in
    select jobname, schedule, command
    from cron.job
    where jobname in ('ridearrivo-dispatch-notification-emails', 'ridearrivo-poll-bookings')
      and command like '%service_role_key%'
  loop
    if not exists (select 1 from vault.decrypted_secrets where name = 'cron_dispatch_secret') then
      raise notice 'Job % still uses the old key. Create the Vault secret cron_dispatch_secret, then run this migration step again.', j.jobname;
      continue;
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
  end loop;
exception when others then
  raise notice 'Cron re-authentication skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- RA-012: callee busy guard
-- ---------------------------------------------------------------------
-- If the person being called is already ringing or on a call, no second ring
-- is created. The caller gets NULL back (the app shows "on another call") and
-- a missed call is recorded for the callee so they can call back.
create or replace function public.start_chat_call(
  p_conversation uuid,
  p_kind text,
  p_room_code text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  other uuid;
  call_id uuid;
  caller_name text;
begin
  if me is null or not public.has_calling_access() then
    raise exception 'Calling is not enabled on your account. Reach out to Admin to give you access.'
      using errcode = '42501';
  end if;
  if p_kind not in ('voice', 'video') then
    raise exception 'Unknown call type';
  end if;

  select m.user_id into other
  from public.social_conversation_members m
  join public.social_conversations c on c.id = m.conversation_id and c.is_group = false
  where m.conversation_id = p_conversation
    and m.user_id <> me
    and exists (
      select 1 from public.social_conversation_members mine
      where mine.conversation_id = p_conversation and mine.user_id = me
    )
  limit 1;

  if other is null then
    raise exception 'Calls can only be started inside your own direct chats';
  end if;
  if not exists (select 1 from public.employee_profiles where id = other and active = true) then
    raise exception 'That person is not an active employee';
  end if;
  if not exists (
    select 1 from public.workspace_rooms r
    where r.room_code = p_room_code and r.created_by = me and r.status = 'active'
  ) then
    raise exception 'The call room could not be verified';
  end if;

  -- Serialise concurrent callers aimed at the same person, so two people
  -- cannot both see "free" and ring at once.
  perform pg_advisory_xact_lock(hashtextextended('chat-call:' || other::text, 0));

  select coalesce(nullif(btrim(full_name), ''), email) into caller_name
  from public.employee_profiles where id = me;

  if exists (
    select 1 from public.chat_calls c
    where (c.callee_id = other or c.caller_id = other)
      and c.caller_id <> me
      and (
        (c.status = 'ringing' and c.created_at > now() - interval '60 seconds')
        or (c.status = 'accepted' and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
      )
  ) or exists (
    select 1 from public.chat_calls c
    where c.callee_id = other and c.caller_id = me
      and c.status = 'accepted'
      and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours'
  ) then
    insert into public.chat_calls(conversation_id, caller_id, callee_id, room_code, kind, status)
    values (p_conversation, me, other, p_room_code, p_kind, 'missed');

    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
    values (other, 'call_missed', 'Missed call from ' || caller_name,
            'You were on another call',
            'social_conversation', p_conversation, 'skipped');
    return null;
  end if;

  -- One live ring per caller at a time.
  update public.chat_calls set status = 'cancelled'
  where caller_id = me and status = 'ringing';

  insert into public.chat_calls(conversation_id, caller_id, callee_id, room_code, kind)
  values (p_conversation, me, other, p_room_code, p_kind)
  returning id into call_id;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (other, 'call', caller_name || ' is calling',
          case when p_kind = 'video' then 'Incoming video call' else 'Incoming voice call' end,
          'social_conversation', p_conversation, 'skipped');

  return call_id;
end;
$$;
revoke all on function public.start_chat_call(uuid, text, text) from public, anon;
grant execute on function public.start_chat_call(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RA-015: rotation cursor for mail-notify-poll
-- ---------------------------------------------------------------------
create table if not exists public.mail_poll_cursor (
  user_id uuid primary key references public.employee_profiles(id) on delete cascade,
  polled_at timestamptz not null default now()
);
alter table public.mail_poll_cursor enable row level security;
revoke all on public.mail_poll_cursor from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RA-016: forwarded files must be the original bytes
-- ---------------------------------------------------------------------
-- The app copies the file into the destination chat. Before, the database only
-- checked that SOME object existed at the supplied path, so a member could
-- upload a different file there and have it shown as a forward of the
-- original. Now the copy's size and content hash (eTag) must match the source
-- object, which a storage copy preserves and an unrelated upload does not.
create or replace function public.forward_chat_message(
  p_source_id uuid,
  p_target_conversation_id uuid,
  p_attachment_path text default null,
  p_note text default null
)
returns public.social_messages
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_src public.social_messages%rowtype;
  v_msg public.social_messages%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_path text := null;
  v_origin uuid;
  v_src_meta jsonb;
  v_copy_meta jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_src from public.social_messages where id = p_source_id;

  if not found
     or v_src.deleted_at is not null
     or not public.can_read_message(v_src.conversation_id, v_src.created_at) then
    raise exception 'Message not found or not accessible' using errcode = '42501';
  end if;

  if not public.can_write_to_conversation(p_target_conversation_id) then
    raise exception 'Conversation write access required' using errcode = '42501';
  end if;

  if char_length(v_note) > 2000 then
    raise exception 'That note is too long';
  end if;

  if v_src.attachment_path is not null then
    v_path := p_attachment_path;
    if v_path is null
       or left(v_path, char_length(p_target_conversation_id::text || '/' || v_actor::text || '/'))
          <> (p_target_conversation_id::text || '/' || v_actor::text || '/') then
      raise exception 'The file could not be copied to that chat' using errcode = '42501';
    end if;

    select o.metadata into v_copy_meta
    from storage.objects o
    where o.bucket_id = 'chat-attachments' and o.name = v_path;
    if not found then
      raise exception 'The file could not be copied to that chat' using errcode = '42501';
    end if;

    select o.metadata into v_src_meta
    from storage.objects o
    where o.bucket_id = 'chat-attachments' and o.name = v_src.attachment_path;
    if not found then
      raise exception 'The original file is no longer available' using errcode = '42501';
    end if;

    if coalesce(v_copy_meta ->> 'size', 'a') is distinct from coalesce(v_src_meta ->> 'size', 'b')
       or coalesce(v_copy_meta ->> 'eTag', v_copy_meta ->> 'etag', '') is distinct from
          coalesce(v_src_meta ->> 'eTag', v_src_meta ->> 'etag', '') then
      raise exception 'The file does not match the original' using errcode = '42501';
    end if;
  end if;

  v_origin := coalesce(v_src.forwarded_from_user_id, v_src.sender_id);

  insert into public.social_messages (
    conversation_id, sender_id, body,
    attachment_path, attachment_name, attachment_mime, attachment_size, attachment_duration_ms,
    forwarded_from_user_id, forwarded_from_message_id
  ) values (
    p_target_conversation_id, v_actor, coalesce(v_src.body, ''),
    v_path,
    case when v_path is null then null else v_src.attachment_name end,
    case when v_path is null then null else v_src.attachment_mime end,
    case when v_path is null then null else v_src.attachment_size end,
    case when v_path is null then null else v_src.attachment_duration_ms end,
    v_origin, v_src.id
  )
  returning * into v_msg;

  if v_note <> '' then
    insert into public.social_messages (conversation_id, sender_id, body)
    values (p_target_conversation_id, v_actor, v_note);
  end if;

  return v_msg;
end;
$$;
revoke all on function public.forward_chat_message(uuid, uuid, text, text) from public, anon;
grant execute on function public.forward_chat_message(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RA-021: contracts and compliance are Legal and admin only
-- ---------------------------------------------------------------------
-- 20261015210000 narrowed the other legal tables but left these two readable
-- by every manager. Both are only shown in the Legal workstation.
drop policy if exists "legal read" on public.legal_contracts;
create policy "legal read" on public.legal_contracts
  for select to authenticated
  using (public.has_workspace_role(array['legal', 'admin']));

drop policy if exists "compliance read" on public.compliance_items;
create policy "compliance read" on public.compliance_items
  for select to authenticated
  using (public.has_workspace_role(array['legal', 'admin']));

commit;
