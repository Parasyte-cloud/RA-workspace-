begin;

-- ============================================================
-- Chat: reply to a message, archive a chat, admin-only delete.
-- Run this BEFORE the matching app release is deployed.
-- ============================================================

-- 1. Reply to a message -------------------------------------
alter table public.social_messages
  add column if not exists reply_to_id uuid
  references public.social_messages(id) on delete set null;

create index if not exists idx_social_messages_reply_to
  on public.social_messages(reply_to_id)
  where reply_to_id is not null;

-- A reply may only point at a message in the same conversation.
create or replace function public.enforce_social_reply_same_conversation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.reply_to_id is not null and not exists(
    select 1 from public.social_messages r
    where r.id=new.reply_to_id
      and r.conversation_id=new.conversation_id
  ) then
    raise exception 'You can only reply to a message in the same chat';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_social_reply_same_conversation on public.social_messages;
create trigger enforce_social_reply_same_conversation
before insert on public.social_messages
for each row execute function public.enforce_social_reply_same_conversation();

-- 2. Archive (per person: archiving never hides the chat from the other side)
alter table public.social_conversation_members
  add column if not exists archived_at timestamptz;

create or replace function public.set_social_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.can_access_social_conversation(p_conversation_id) then
    raise exception 'Conversation access required';
  end if;

  update public.social_conversation_members
  set archived_at = case when p_archived then clock_timestamp() else null end
  where conversation_id=p_conversation_id
    and user_id=auth.uid();

  if not found then
    raise exception 'Conversation membership not found';
  end if;
end;
$$;

revoke all on function public.set_social_conversation_archived(uuid,boolean) from public;
grant execute on function public.set_social_conversation_archived(uuid,boolean) to authenticated;

-- A new message from the other person brings an archived chat back.
create or replace function public.unarchive_social_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.social_conversation_members
  set archived_at=null
  where conversation_id=new.conversation_id
    and user_id<>new.sender_id
    and archived_at is not null;
  return new;
end;
$$;

drop trigger if exists unarchive_social_conversation_on_message on public.social_messages;
create trigger unarchive_social_conversation_on_message
after insert on public.social_messages
for each row execute function public.unarchive_social_conversation_on_message();

-- 3. Delete a chat: administrators only ----------------------
-- Employees still have no DELETE privilege on any chat table (revoked in
-- 20260901230000). The only way to delete is this function, and it checks
-- the role itself, so the rule holds even if the app is bypassed.
create or replace function public.delete_social_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.is_workspace_admin() then
    raise exception 'Only an administrator can delete a chat';
  end if;

  if not exists(select 1 from public.social_conversations where id=p_conversation_id) then
    raise exception 'Chat not found';
  end if;

  -- Messages, members and call records go with it (on delete cascade).
  delete from public.social_conversations where id=p_conversation_id;
end;
$$;

revoke all on function public.delete_social_conversation(uuid) from public;
grant execute on function public.delete_social_conversation(uuid) to authenticated;

commit;
