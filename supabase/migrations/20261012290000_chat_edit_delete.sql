-- Chat: edit and delete your own messages.
--
-- Messages are read straight from the table, and nobody can update them
-- directly (there is no update policy), so these two functions are the only
-- way to change one, and each checks that the caller wrote the message.
--
--   edit_social_message(id, text)   own text, within 24 hours
--   delete_social_message(id)       own message, any time; returns the file path
--                                   (if any) so the app can remove the file too
--
-- A deleted message keeps its row (so replies and ordering still work) but
-- loses its text and file details.
--
-- Run it BEFORE the matching app release. Safe to run twice.

begin;

create or replace function public.edit_social_message(p_id uuid, p_body text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.social_messages%rowtype;
  clean text := btrim(coalesce(p_body, ''));
  stamp timestamptz := now();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select * into msg from public.social_messages where id = p_id for update;
  if not found or msg.sender_id <> me then
    raise exception 'Message not found';
  end if;
  if msg.deleted_at is not null then
    raise exception 'This message was deleted';
  end if;
  if msg.created_at < now() - interval '24 hours' then
    raise exception 'Messages can only be edited for 24 hours';
  end if;
  if char_length(clean) > 10000 then
    raise exception 'That message is too long';
  end if;
  if char_length(clean) < 1 and msg.attachment_path is null then
    raise exception 'A message cannot be empty';
  end if;

  update public.social_messages
  set body = clean, edited_at = stamp
  where id = p_id;

  return stamp;
end;
$$;

revoke all on function public.edit_social_message(uuid, text) from public, anon;
grant execute on function public.edit_social_message(uuid, text) to authenticated;

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

  return msg.attachment_path;
end;
$$;

revoke all on function public.delete_social_message(uuid) from public, anon;
grant execute on function public.delete_social_message(uuid) to authenticated;

commit;
