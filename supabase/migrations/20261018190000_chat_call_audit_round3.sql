-- Chat and call audit, round 3 (18 October 2026).
--
--  1. Messages: the attachment path rule is back on the insert policy.
--     20261013130300 replaced the policy and dropped the rule from
--     20261012210000 that a file must sit in THIS conversation and in the
--     sender's own folder. Without it a member can attach any path to a message.
--  2. Notifications: a photo, file or voice note has a readable preview again
--     ("Sent a photo"). 20261015003000 rewrote the trigger and lost it, so the
--     bell and the phone alert were blank for anything without text.
--  3. Calls: a person already on a live call cannot start another (the second
--     call used to run over the first and strand it).
--  4. Calls: an abandoned call is closed at its last heartbeat, so call history
--     shows how long it really lasted instead of how long the sweep took.
--  5. Reading: marking a chat read no longer rewrites the row when nothing is
--     newer. Every rewrite was a realtime event that made every member's app
--     reload its whole chat list.
--  6. Deleted messages show as "This message was deleted" for everyone, live,
--     and an unread alert quoting the deleted text is scrubbed.
--
-- Safe to run twice. Run BEFORE the matching app release.

begin;

-- 1. Attachment path rule on insert --------------------------------------
drop policy if exists "social messages member send" on public.social_messages;
create policy "social messages member send"
on public.social_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and deleted_at is null
  and public.can_write_to_conversation(conversation_id)
  and (
    attachment_path is null
    or (
      split_part(attachment_path, '/', 1) = conversation_id::text
      and split_part(attachment_path, '/', 2) = auth.uid()::text
    )
  )
);

-- 2. Attachment preview in notifications ---------------------------------
create or replace function public.notify_social_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_name text;
  recipient record;
  existing uuid;
  existing_type text;
  existing_title text;
  existing_body text;
  unread_count bigint;
  preview text :=
    left(
      regexp_replace(
        coalesce(new.body, ''),
        '\s+',
        ' ',
        'g'
      ),
      140
    );
begin
  -- A photo, file or voice note has no text. Say what it is, so the bell and
  -- the phone alert are never blank (20261015003000 lost this).
  if preview = '' and new.attachment_path is not null then
    preview := case
      when coalesce(new.attachment_mime, '') like 'audio/%' then 'Sent a voice note'
      when coalesce(new.attachment_mime, '') like 'image/%' then 'Sent a photo'
      else 'Sent a file: ' || left(coalesce(new.attachment_name, 'attachment'), 100)
    end;
  end if;

  select
    coalesce(
      nullif(btrim(full_name), ''),
      email
    )
  into sender_name
  from public.employee_profiles
  where id = new.sender_id;

  for recipient in
    select m.user_id
    from public.social_conversation_members m
    join public.employee_profiles p
      on p.id = m.user_id
     and p.active = true
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender_id
      and m.removed_at is null
  loop
    existing := null;
    existing_type := null;
    existing_title := null;
    existing_body := null;

    select
      n.id,
      n.type,
      n.title,
      n.body
    into
      existing,
      existing_type,
      existing_title,
      existing_body
    from public.notifications n
    where n.user_id = recipient.user_id
      and n.type in (
        'chat_message',
        'chat_mention'
      )
      and n.entity_id = new.conversation_id
      and n.read_at is null
    order by n.created_at desc
    limit 1;

    if existing is null then
      insert into public.notifications(
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        email_status
      )
      values (
        recipient.user_id,
        'chat_message',
        coalesce(sender_name, 'New message'),
        preview,
        'social_conversation',
        new.conversation_id,
        'skipped'
      );
    else
      select count(*)
      into unread_count
      from public.social_messages sm
      join public.social_conversation_members me
        on me.conversation_id = sm.conversation_id
       and me.user_id = recipient.user_id
       and me.removed_at is null
      where sm.conversation_id = new.conversation_id
        and sm.sender_id <> recipient.user_id
        and sm.deleted_at is null
        and sm.created_at >
          coalesce(
            me.last_read_at,
            me.joined_at,
            'epoch'::timestamptz
          );

      update public.notifications
      set
        title =
          case
            when existing_type = 'chat_mention'
              then existing_title
            else
              coalesce(sender_name, 'New message')
              ||
              case
                when unread_count > 1
                  then
                    ' (' ||
                    unread_count ||
                    ' new messages)'
                else ''
              end
          end,

        body =
          case
            when existing_type = 'chat_mention'
              then existing_body
            else preview
          end,

        created_at = now()
      where id = existing;
    end if;
  end loop;

  return new;
end;
$$;

revoke all
on function public.notify_social_message()
from public, anon, authenticated;

-- 3. No second live call for the caller -----------------------------------
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

  -- A call whose app was swiped away or closed never hung up. Clear dead calls
  -- of both people first, so a stuck call cannot make someone look busy.
  perform public.end_stale_calls_for(other);
  perform public.end_stale_calls_for(me);

  -- The caller must not already be on a live call with someone else. Before,
  -- only the person being rung was checked, so a second call could be started
  -- over the first and the first was left running with nobody tending it.
  -- Live means a heartbeat in the last 75 seconds, or a call answered in the
  -- last two minutes that has not had its first beat yet.
  if exists (
    select 1 from public.chat_calls c
    where c.status = 'accepted'
      and (c.caller_id = me or c.callee_id = me)
      and (
        c.heartbeat_at > now() - interval '75 seconds'
        or (c.heartbeat_at is null and coalesce(c.answered_at, c.created_at) > now() - interval '2 minutes')
      )
  ) then
    raise exception 'You are already on a call. End it before starting another.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into caller_name
  from public.employee_profiles where id = me;

  -- "On another call" only counts while that other call is really alive: its
  -- phone has sent a heartbeat in the last 75 seconds (or is an older app that
  -- never sends one and the call is under 4 hours old). A call whose phone went
  -- quiet (locked, offline, swiped away) no longer stops people ringing through.
  if exists (
    select 1 from public.chat_calls c
    where (c.callee_id = other or c.caller_id = other)
      and c.caller_id <> me
      and (
        (c.status = 'ringing' and c.created_at > now() - interval '60 seconds')
        or (c.status = 'accepted' and (
              c.heartbeat_at > now() - interval '75 seconds'
              or (c.heartbeat_at is null and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
           ))
      )
  ) or exists (
    select 1 from public.chat_calls c
    where c.callee_id = other and c.caller_id = me
      and c.status = 'accepted'
      and (
        c.heartbeat_at > now() - interval '75 seconds'
        or (c.heartbeat_at is null and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
      )
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

-- 4. Abandoned calls end at their last heartbeat --------------------------
create or replace function public.end_stale_calls_for(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  -- A call nobody tended ends when the last heartbeat said it was alive, not
  -- when this sweep happened to run. Before, ended_at was the sweep time, so a
  -- two minute call dropped by a dead phone showed as 15 minutes (or 4 hours).
  update public.chat_calls
  set status = 'ended', ended_at = coalesce(heartbeat_at, now())
  where status = 'accepted'
    and (caller_id = p_user or callee_id = p_user)
    and (
      (heartbeat_at is not null and heartbeat_at < now() - interval '15 minutes')
      or (heartbeat_at is null and coalesce(answered_at, created_at) < now() - interval '4 hours')
    );
$$;

revoke all on function public.end_stale_calls_for(uuid) from public, anon, authenticated;

-- 5. Reading a chat only writes when something is newer -------------------
create or replace function public.mark_social_conversation_read(
  p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.can_access_social_conversation(
    p_conversation_id
  ) then
    raise exception 'Conversation access required';
  end if;

  if not exists (
    select 1 from public.social_conversation_members
    where conversation_id=p_conversation_id
      and user_id=auth.uid()
  ) then
    raise exception 'Conversation membership not found';
  end if;

  -- Skip the write when nothing arrived since the last read. A write is a
  -- realtime event for every member, so a no-op write is pure noise.
  update public.social_conversation_members m
  set last_read_at=clock_timestamp()
  where m.conversation_id=p_conversation_id
    and m.user_id=auth.uid()
    and exists (
      select 1 from public.social_messages sm
      where sm.conversation_id=p_conversation_id
        and sm.created_at>coalesce(m.last_read_at,'epoch'::timestamptz)
    );
end;
$$;

revoke all
on function public.mark_social_conversation_read(uuid)
from public;

grant execute
on function public.mark_social_conversation_read(uuid)
to authenticated;

-- 6. Deleted messages show as "This message was deleted" -----------------
-- The app is built for it (the row stays, the text and file are wiped, replies
-- and ordering keep working). 20261013130300 added "deleted_at is null" to the
-- read rule, which made a deleted message vanish instead, and kept the other
-- person's screen on the old text until its next refresh because realtime
-- checks the changed row against this rule. Nothing is exposed: delete_social_message
-- has already replaced the text and cleared the file details.
drop policy if exists "social messages member read" on public.social_messages;
create policy "social messages member read"
on public.social_messages
for select
to authenticated
using (
  public.can_read_message(
    conversation_id,
    created_at
  )
);

create or replace function public.delete_social_message(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.social_messages%rowtype;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select * into msg from public.social_messages where id = p_id for update;
  if not found or msg.sender_id <> me then
    raise exception 'Message not found';
  end if;
  if msg.deleted_at is not null then
    return null;
  end if;

  update public.social_messages
  set deleted_at = now(),
      body = 'This message was deleted',
      attachment_path = null,
      attachment_name = null,
      attachment_mime = null,
      attachment_size = null,
      attachment_duration_ms = null
  where id = p_id;

  -- An unread alert that quotes the text must not keep showing it.
  update public.notifications
  set body = 'This message was deleted'
  where type in ('chat_message', 'chat_mention')
    and entity_id = msg.conversation_id
    and read_at is null
    and body = left(regexp_replace(coalesce(msg.body, ''), '\s+', ' ', 'g'), 140);

  return msg.attachment_path;
end;
$$;

revoke all on function public.delete_social_message(uuid) from public, anon;
grant execute on function public.delete_social_message(uuid) to authenticated;

commit;
