-- Chat voice notes: recorded audio is a file like any other, plus a length.
--
-- Adds the length of a voice note, allows audio types in the private chat
-- bucket, and makes notifications read "Sent a voice note".
--
-- Run 20261012210000_chat_attachments.sql first. Safe to run twice.

begin;

alter table public.social_messages
  add column if not exists attachment_duration_ms integer;

alter table public.social_messages
  drop constraint if exists social_messages_attachment_duration_check;
alter table public.social_messages
  add constraint social_messages_attachment_duration_check check (
    attachment_duration_ms is null or attachment_duration_ms between 0 and 3600000
  );

update storage.buckets
set allowed_mime_types = array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav'
  ]
where id = 'chat-attachments';

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
  unread_count int;
  preview text := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 140);
begin
  if preview = '' and new.attachment_path is not null then
    preview := case
      when coalesce(new.attachment_mime, '') like 'audio/%' then 'Sent a voice note'
      when coalesce(new.attachment_mime, '') like 'image/%' then 'Sent a photo'
      else 'Sent a file: ' || left(coalesce(new.attachment_name, 'attachment'), 100)
    end;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into sender_name
  from public.employee_profiles where id = new.sender_id;

  for recipient in
    select m.user_id
    from public.social_conversation_members m
    join public.employee_profiles p on p.id = m.user_id and p.active = true
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender_id
  loop
    select n.id into existing
    from public.notifications n
    where n.user_id = recipient.user_id
      and n.type = 'chat_message'
      and n.entity_id = new.conversation_id
      and n.read_at is null
    order by n.created_at desc
    limit 1;

    if existing is null then
      insert into public.notifications(
        user_id, type, title, body, entity_type, entity_id, email_status
      ) values (
        recipient.user_id, 'chat_message', coalesce(sender_name, 'New message'),
        preview, 'social_conversation', new.conversation_id, 'skipped'
      );
    else
      select count(*) into unread_count
      from public.social_messages sm
      join public.social_conversation_members me
        on me.conversation_id = sm.conversation_id and me.user_id = recipient.user_id
      where sm.conversation_id = new.conversation_id
        and sm.sender_id <> recipient.user_id
        and sm.created_at > me.last_read_at;

      update public.notifications
      set title = coalesce(sender_name, 'New message')
                  || case when unread_count > 1 then ' (' || unread_count || ' new messages)' else '' end,
          body = preview,
          created_at = now()
      where id = existing;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_social_message() from public, anon, authenticated;

commit;
