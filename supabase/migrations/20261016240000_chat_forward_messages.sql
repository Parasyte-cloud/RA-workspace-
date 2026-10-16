-- Forward a chat message to another chat.
--
-- A forwarded message is a NEW message in the destination, sent by the person
-- who forwarded it, marked with who first wrote it. The database checks both
-- ends, so nothing can be forwarded that the forwarder could not read, and
-- nothing can be forwarded into a chat the forwarder cannot post in.
--
-- Files: the app copies the file into the destination chat's own folder first
-- (storage rules already allow that for members), then this function checks the
-- copy exists in the right folder and attaches it. The original is untouched.
--
-- Safe to run twice.

begin;

alter table public.social_messages
  add column if not exists forwarded_from_user_id uuid,
  add column if not exists forwarded_from_message_id uuid;

create index if not exists social_messages_forwarded_from_idx
  on public.social_messages (forwarded_from_message_id)
  where forwarded_from_message_id is not null;

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
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_src from public.social_messages where id = p_source_id;

  -- Same answer for "missing", "deleted" and "not yours to read", so this cannot
  -- be used to probe for messages in chats the caller is not in.
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
    -- The copy must sit in the destination chat, in the forwarder's own folder,
    -- and must really exist.
    if v_path is null
       or left(v_path, char_length(p_target_conversation_id::text || '/' || v_actor::text || '/'))
          <> (p_target_conversation_id::text || '/' || v_actor::text || '/')
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'chat-attachments' and o.name = v_path
       ) then
      raise exception 'The file could not be copied to that chat' using errcode = '42501';
    end if;
  end if;

  -- Keep the first author through repeated forwards.
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

commit;
