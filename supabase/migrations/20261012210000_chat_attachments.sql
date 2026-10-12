-- Chat attachments: send images and files in a one to one chat.
--
-- Files live in a PRIVATE storage bucket, 'chat-attachments'. Nothing is ever
-- public. A file is stored at   <conversation id>/<sender id>/<random>-<name>
-- and the storage rules read that path:
--   * only a member of the conversation can open a file in it,
--   * only a member can upload into it, and only into their own sender folder,
--   * the sender can remove a file that no message uses (a failed send),
--   * an administrator can remove files (used when a chat is deleted).
-- Files are opened with short-lived signed links made for the person asking.
--
-- Limits: 25 MB per file, and only common safe types (images, PDF, text, CSV,
-- Office documents, ZIP). Programs and scripts are refused by the bucket itself.
--
-- A message may now have no text, as long as it carries a file.
--
-- Run 20261012190000_chat_reply_archive_delete.sql first. Safe to run twice.

begin;

-- 1. The message gets file details --------------------------------
alter table public.social_messages
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

-- Replace the "text must be 1 to 10000 characters" rule: text is optional when
-- there is a file, and a file needs a name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.social_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%char_length(body)%'
  loop
    execute format('alter table public.social_messages drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.social_messages
  drop constraint if exists social_messages_content_check;
alter table public.social_messages
  add constraint social_messages_content_check check (
    char_length(body) <= 10000
    and (
      char_length(body) >= 1
      or (attachment_path is not null and attachment_name is not null)
    )
  );

alter table public.social_messages
  drop constraint if exists social_messages_attachment_size_check;
alter table public.social_messages
  add constraint social_messages_attachment_size_check check (
    attachment_size is null or attachment_size between 0 and 26214400
  );

-- 2. Storage helper: which conversation does a file path belong to? ----
create or replace function public.chat_attachment_conversation(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

grant execute on function public.chat_attachment_conversation(text) to authenticated;

-- 3. The private bucket ----------------------------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat attachments read" on storage.objects;
create policy "chat attachments read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.chat_attachment_conversation(name) is not null
  and public.can_access_social_conversation(public.chat_attachment_conversation(name))
);

drop policy if exists "chat attachments upload" on storage.objects;
create policy "chat attachments upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and public.chat_attachment_conversation(name) is not null
  and public.can_access_social_conversation(public.chat_attachment_conversation(name))
  and split_part(name, '/', 2) = auth.uid()::text
);

-- A failed send leaves an unused file. The sender may remove it, but only while
-- no message points at it.
drop policy if exists "chat attachments orphan cleanup" on storage.objects;
create policy "chat attachments orphan cleanup"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and split_part(name, '/', 2) = auth.uid()::text
  and not exists (
    select 1 from public.social_messages m
    where m.attachment_path = storage.objects.name
  )
);

-- Administrators can remove files, so deleting a chat can clear its files too.
drop policy if exists "chat attachments admin delete" on storage.objects;
create policy "chat attachments admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.is_workspace_admin()
);

-- 4. Sending: a file must sit in this conversation and in the sender's folder.
drop policy if exists "social messages member send" on public.social_messages;
create policy "social messages member send"
on public.social_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and deleted_at is null
  and public.can_access_social_conversation(conversation_id)
  and (
    attachment_path is null
    or (
      split_part(attachment_path, '/', 1) = conversation_id::text
      and split_part(attachment_path, '/', 2) = auth.uid()::text
    )
  )
);

-- 5. Notifications read "Sent a photo" or "Sent a file" when there is no text.
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
