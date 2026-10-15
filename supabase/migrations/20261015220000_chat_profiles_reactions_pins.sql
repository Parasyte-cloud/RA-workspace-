-- Chat upgrade: chat profile (photo and status), message reactions, pinned messages.
--
-- Privacy: employee headshots stay private to their owner (see
-- 20260829003000_private_employee_headshots.sql). The chat photo is a separate,
-- opt-in picture that the employee chooses to share with colleagues, kept in its
-- own bucket, so nothing private becomes visible.
begin;

-- ------------------------------------------------------------
-- Emoji validation: 1 to 8 characters, no letters, digits, spaces or markup.
-- ------------------------------------------------------------
create or replace function public.chat_valid_emoji(p_emoji text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_emoji is not null
    and char_length(p_emoji) between 1 and 8
    and p_emoji !~ '[A-Za-z0-9[:space:]<>&"''\\/]';
$$;

grant execute on function public.chat_valid_emoji(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Chat profile
-- ------------------------------------------------------------
create table if not exists public.chat_profiles (
  user_id uuid primary key references public.employee_profiles(id) on delete cascade,
  avatar_path text,
  status_emoji text,
  status_text text,
  status_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint chat_profiles_avatar_own_folder
    check (avatar_path is null or avatar_path like user_id::text || '/%'),
  constraint chat_profiles_emoji_valid
    check (status_emoji is null or public.chat_valid_emoji(status_emoji)),
  constraint chat_profiles_status_len
    check (status_text is null or char_length(status_text) <= 80)
);

alter table public.chat_profiles enable row level security;

revoke all on table public.chat_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_profiles to authenticated;
grant all on table public.chat_profiles to service_role;

drop policy if exists "chat profiles read" on public.chat_profiles;
create policy "chat profiles read" on public.chat_profiles
  for select to authenticated
  using (exists (select 1 from public.employee_profiles e where e.id = auth.uid() and e.active = true));

drop policy if exists "chat profiles insert own" on public.chat_profiles;
create policy "chat profiles insert own" on public.chat_profiles
  for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.employee_profiles e where e.id = auth.uid() and e.active = true));

drop policy if exists "chat profiles update own" on public.chat_profiles;
create policy "chat profiles update own" on public.chat_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat profiles delete own" on public.chat_profiles;
create policy "chat profiles delete own" on public.chat_profiles
  for delete to authenticated
  using (user_id = auth.uid());

-- Chat photos: small pictures employees choose to share with colleagues.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-avatars', 'chat-avatars', false, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "chat avatars read active" on storage.objects;
create policy "chat avatars read active" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-avatars'
    and exists (select 1 from public.employee_profiles e where e.id = auth.uid() and e.active = true));

drop policy if exists "chat avatars insert own" on storage.objects;
create policy "chat avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.employee_profiles e where e.id = auth.uid() and e.active = true));

drop policy if exists "chat avatars update own" on storage.objects;
create policy "chat avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'chat-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'chat-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat avatars delete own" on storage.objects;
create policy "chat avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- Reactions
-- ------------------------------------------------------------
create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.social_messages(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  emoji text not null check (public.chat_valid_emoji(emoji)),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists chat_message_reactions_message_idx
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;
alter table public.chat_message_reactions replica identity full;

revoke all on table public.chat_message_reactions from public, anon, authenticated;
grant select on table public.chat_message_reactions to authenticated;
grant all on table public.chat_message_reactions to service_role;

drop policy if exists "chat reactions read" on public.chat_message_reactions;
create policy "chat reactions read" on public.chat_message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.social_messages m
    where m.id = chat_message_reactions.message_id
      and public.can_read_message(m.conversation_id, m.created_at)
  ));

create or replace function public.toggle_chat_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.social_messages%rowtype;
  existing int;
begin
  if me is null then raise exception 'Sign in to react.'; end if;
  if not public.chat_valid_emoji(p_emoji) then raise exception 'That reaction is not allowed.'; end if;
  if not exists (select 1 from public.employee_profiles e where e.id = me and e.active = true) then
    raise exception 'Your account is not active.';
  end if;

  select * into msg from public.social_messages where id = p_message_id;
  if not found or msg.deleted_at is not null then raise exception 'Message not found.'; end if;
  if not public.can_read_message(msg.conversation_id, msg.created_at)
     or not public.can_write_to_conversation(msg.conversation_id) then
    raise exception 'You cannot react in this conversation.';
  end if;

  delete from public.chat_message_reactions
   where message_id = p_message_id and user_id = me and emoji = p_emoji;
  if found then return false; end if;

  select count(distinct emoji) into existing
    from public.chat_message_reactions where message_id = p_message_id;
  if existing >= 12 and not exists (
    select 1 from public.chat_message_reactions where message_id = p_message_id and emoji = p_emoji
  ) then
    raise exception 'This message already has the most reactions it can hold.';
  end if;

  insert into public.chat_message_reactions (message_id, user_id, emoji)
  values (p_message_id, me, p_emoji)
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.toggle_chat_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_chat_reaction(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Pinned messages
-- ------------------------------------------------------------
create table if not exists public.chat_pinned_messages (
  message_id uuid primary key references public.social_messages(id) on delete cascade,
  conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  pinned_by uuid not null references public.employee_profiles(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

create index if not exists chat_pinned_messages_conversation_idx
  on public.chat_pinned_messages (conversation_id, pinned_at desc);

alter table public.chat_pinned_messages enable row level security;
alter table public.chat_pinned_messages replica identity full;

revoke all on table public.chat_pinned_messages from public, anon, authenticated;
grant select on table public.chat_pinned_messages to authenticated;
grant all on table public.chat_pinned_messages to service_role;

drop policy if exists "chat pins read" on public.chat_pinned_messages;
create policy "chat pins read" on public.chat_pinned_messages
  for select to authenticated
  using (exists (
    select 1 from public.social_messages m
    where m.id = chat_pinned_messages.message_id
      and public.can_read_message(m.conversation_id, m.created_at)
  ));

create or replace function public.set_chat_message_pinned(p_message_id uuid, p_pinned boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.social_messages%rowtype;
begin
  if me is null then raise exception 'Sign in to pin messages.'; end if;
  if not exists (select 1 from public.employee_profiles e where e.id = me and e.active = true) then
    raise exception 'Your account is not active.';
  end if;

  select * into msg from public.social_messages where id = p_message_id;
  if not found or msg.deleted_at is not null then raise exception 'Message not found.'; end if;
  if not public.can_read_message(msg.conversation_id, msg.created_at)
     or not public.can_write_to_conversation(msg.conversation_id) then
    raise exception 'You cannot pin in this conversation.';
  end if;

  if not p_pinned then
    delete from public.chat_pinned_messages where message_id = p_message_id;
    return false;
  end if;

  if (select count(*) from public.chat_pinned_messages where conversation_id = msg.conversation_id) >= 10
     and not exists (select 1 from public.chat_pinned_messages where message_id = p_message_id) then
    raise exception 'A conversation can have 10 pinned messages. Unpin one first.';
  end if;

  insert into public.chat_pinned_messages (message_id, conversation_id, pinned_by)
  values (p_message_id, msg.conversation_id, me)
  on conflict (message_id) do nothing;
  return true;
end;
$$;

revoke all on function public.set_chat_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_chat_message_pinned(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_message_reactions', 'chat_pinned_messages', 'chat_profiles'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;
