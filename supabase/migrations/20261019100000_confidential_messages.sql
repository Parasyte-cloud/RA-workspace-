-- Confidential messages ("the vault").
--
-- A person can send a text or a PDF / image as confidential. The message
-- arrives in the chat as a locked, blurred card. The content is NOT in the chat
-- row (that row only says "Confidential message"), so it cannot be read from
-- the browser, searched, forwarded, quoted, previewed in a notification or
-- pulled out with a dev tool. It sits sealed in a table the browser cannot
-- read, and is only handed out by the confidential-vault edge function after a
-- one-time key is proven.
--
-- How it works, in order:
--   1. The sender locks a message. The server makes a one-time key, stores only
--      a keyed hash of it, and shows the key to the sender once.
--   2. The recipient asks for the key (an in-app request that notifies the
--      sender and the administrators) and types it in.
--   3. A right key opens a view window (15 seconds up to the administrator's
--      ceiling). The key is burned at that moment. A wrong key counts as an
--      attempt; too many locks the item.
--   4. When the window ends the message is blurred again and says to contact an
--      administrator. Only an administrator can issue a new key.
--
-- Everything that changes state runs inside one transaction with the row
-- locked, so two people cannot both use the same key. Every step is logged.
-- Safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 0. Who is an administrator for the vault: role = 'admin' only (HR is not).
-- ---------------------------------------------------------------------------
create or replace function public.is_vault_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employee_profiles ep
    where ep.id = p_user and ep.active = true and ep.role = 'admin'
  );
$$;
revoke all on function public.is_vault_admin(uuid) from public, anon;
grant execute on function public.is_vault_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Administrator settings (one row).
-- ---------------------------------------------------------------------------
create table if not exists public.confidential_settings (
  id boolean primary key default true check (id),
  max_view_seconds integer not null default 900 check (max_view_seconds between 10 and 3600),
  max_attempts integer not null default 5 check (max_attempts between 3 and 10),
  updated_by uuid references public.employee_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.confidential_settings (id) values (true) on conflict (id) do nothing;
alter table public.confidential_settings enable row level security;
drop policy if exists "confidential settings read" on public.confidential_settings;
create policy "confidential settings read" on public.confidential_settings
  for select to authenticated using (true);
revoke all on public.confidential_settings from anon;
revoke insert, update, delete on public.confidential_settings from authenticated;

-- ---------------------------------------------------------------------------
-- 2. The chat row points at the vault item. Only the vault may set it.
-- ---------------------------------------------------------------------------
alter table public.social_messages add column if not exists confidential_id uuid;
create unique index if not exists social_messages_confidential_idx
  on public.social_messages (confidential_id) where confidential_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Tables. Status: pending (file still uploading), sealed (waiting for the
--    key), spent (the key was used), locked (too many wrong keys), destroyed.
-- ---------------------------------------------------------------------------
create table if not exists public.confidential_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  message_id uuid references public.social_messages(id) on delete cascade,
  sender_id uuid not null references public.employee_profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'file')),
  mime text,
  file_size bigint,
  view_seconds integer not null check (view_seconds between 10 and 3600),
  status text not null default 'pending'
    check (status in ('pending', 'sealed', 'spent', 'locked', 'destroyed')),
  failed_attempts integer not null default 0,
  unblock_count integer not null default 0,
  opened_by uuid references public.employee_profiles(id) on delete set null,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists confidential_items_conversation_idx on public.confidential_items (conversation_id);
create index if not exists confidential_items_message_idx on public.confidential_items (message_id);
create index if not exists confidential_items_status_idx on public.confidential_items (status, updated_at desc);

-- Everything secret lives here. No policy and no grant: the browser can never
-- read it, not even for its own messages. Realtime therefore never carries it.
create table if not exists public.confidential_secrets (
  item_id uuid primary key references public.confidential_items(id) on delete cascade,
  key_hash text,
  ciphertext text,
  file_path text,
  file_name_sealed text
);

create table if not exists public.confidential_grants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.confidential_items(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists confidential_grants_lookup_idx on public.confidential_grants (item_id, user_id, expires_at desc);

create table if not exists public.confidential_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.confidential_items(id) on delete cascade,
  requester_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index if not exists confidential_requests_lookup_idx on public.confidential_requests (item_id, requester_id, created_at desc);

create table if not exists public.confidential_audit (
  id bigint generated always as identity primary key,
  item_id uuid,
  conversation_id uuid,
  actor_id uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists confidential_audit_item_idx on public.confidential_audit (item_id, created_at desc);
create index if not exists confidential_audit_time_idx on public.confidential_audit (created_at desc);

alter table public.confidential_items enable row level security;
alter table public.confidential_secrets enable row level security;
alter table public.confidential_grants enable row level security;
alter table public.confidential_requests enable row level security;
alter table public.confidential_audit enable row level security;

revoke all on public.confidential_secrets, public.confidential_grants,
  public.confidential_requests, public.confidential_audit from public, anon, authenticated;
revoke all on public.confidential_items from public, anon;
revoke insert, update, delete on public.confidential_items from authenticated;

-- People in the conversation see the state of the card (never the content).
-- A file that is still uploading is only visible to the person sending it.
drop policy if exists "confidential items members read" on public.confidential_items;
create policy "confidential items members read" on public.confidential_items
  for select to authenticated
  using (
    public.is_conversation_member(conversation_id)
    and (status <> 'pending' or sender_id = auth.uid())
  );

do $$
begin
  begin
    alter publication supabase_realtime add table public.confidential_items;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Guards on the chat table.
-- ---------------------------------------------------------------------------
create or replace function public.guard_confidential_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.confidential_id is not null
       and coalesce(current_setting('vault.write', true), '') <> 'on' then
      raise exception 'Confidential messages are created through the vault only.' using errcode = '42501';
    end if;
    if new.forwarded_from_message_id is not null and exists (
      select 1 from public.social_messages s
      where s.id = new.forwarded_from_message_id and s.confidential_id is not null
    ) then
      raise exception 'A confidential message cannot be forwarded.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.confidential_id is distinct from old.confidential_id
     and coalesce(current_setting('vault.write', true), '') <> 'on' then
    raise exception 'The confidential link cannot be changed.' using errcode = '42501';
  end if;
  if old.confidential_id is not null and new.deleted_at is null
     and (new.body is distinct from old.body
          or new.attachment_path is distinct from old.attachment_path) then
    raise exception 'A confidential message cannot be edited.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_confidential_message_ins on public.social_messages;
create trigger guard_confidential_message_ins
  before insert on public.social_messages
  for each row execute function public.guard_confidential_message();
drop trigger if exists guard_confidential_message_upd on public.social_messages;
create trigger guard_confidential_message_upd
  before update on public.social_messages
  for each row execute function public.guard_confidential_message();

-- Deleting the chat message (by any route) destroys what is inside it.
create or replace function public.vault_on_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.confidential_secrets set key_hash = null, ciphertext = null
   where item_id = new.confidential_id;
  update public.confidential_items set status = 'destroyed', updated_at = now()
   where id = new.confidential_id and status <> 'destroyed';
  return new;
end;
$$;
drop trigger if exists vault_on_message_delete on public.social_messages;
create trigger vault_on_message_delete
  after update of deleted_at on public.social_messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null and new.confidential_id is not null)
  execute function public.vault_on_message_delete();

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (not callable from the browser).
-- ---------------------------------------------------------------------------
create or replace function public.vault_is_member(p_user uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.social_conversation_members m
    join public.employee_profiles ep on ep.id = m.user_id and ep.active = true
    where m.conversation_id = p_conversation and m.user_id = p_user and m.removed_at is null
  );
$$;

-- The same rule as can_write_to_conversation, for a named person.
create or replace function public.vault_can_post(p_user uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.vault_is_member(p_user, p_conversation)
    and exists (
      select 1
      from public.social_conversations c
      left join public.chat_rooms r on r.conversation_id = c.id
      where c.id = p_conversation
        and (c.conversation_kind = 'direct' or (r.conversation_id is not null and r.status = 'active'))
    );
$$;

create or replace function public.vault_log(
  p_item uuid, p_conversation uuid, p_actor uuid, p_event text, p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.confidential_audit (item_id, conversation_id, actor_id, event, detail)
  values (p_item, p_conversation, p_actor, p_event, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function public.vault_notify(
  p_users uuid[], p_type text, p_title text, p_body text, p_conversation uuid
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, email_status)
  select distinct u, p_type, p_title, p_body, 'social_conversation', p_conversation, 'skipped'
  from unnest(p_users) as u
  where u is not null;
$$;

create or replace function public.vault_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(ep.id), '{}'::uuid[])
  from public.employee_profiles ep where ep.active = true and ep.role = 'admin';
$$;

revoke all on function public.vault_is_member(uuid, uuid), public.vault_can_post(uuid, uuid),
  public.vault_log(uuid, uuid, uuid, text, jsonb),
  public.vault_notify(uuid[], text, text, text, uuid),
  public.vault_admin_ids() from public, anon, authenticated;
grant execute on function public.vault_is_member(uuid, uuid), public.vault_can_post(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Called by the edge function (service role only).
-- ---------------------------------------------------------------------------

-- Step 1 of sending. Makes the sealed item. A text is complete here; a file
-- is uploaded next, then vault_finish seals the key and posts the message.
create or replace function public.vault_begin(
  p_user uuid,
  p_conversation uuid,
  p_kind text,
  p_view_seconds integer,
  p_mime text,
  p_file_size bigint,
  p_file_path text,
  p_file_name_sealed text,
  p_ciphertext text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_id uuid;
begin
  if p_kind not in ('text', 'file') then
    raise exception 'Unknown confidential type.' using errcode = '22023';
  end if;
  if not public.vault_can_post(p_user, p_conversation) then
    raise exception 'You cannot post in this conversation.' using errcode = '42501';
  end if;

  select max_view_seconds into v_max from public.confidential_settings where id;
  v_max := coalesce(v_max, 900);
  if p_view_seconds is null or p_view_seconds < 10 or p_view_seconds > v_max then
    raise exception 'That view time is not allowed. The longest an administrator allows is % seconds.', v_max
      using errcode = '22023';
  end if;

  if p_kind = 'text' then
    if p_ciphertext is null or length(p_ciphertext) < 1 then
      raise exception 'A confidential text needs some text.' using errcode = '22023';
    end if;
  else
    if p_file_path is null or p_mime is null or p_file_size is null or p_file_size <= 0 then
      raise exception 'A confidential file needs a file.' using errcode = '22023';
    end if;
    if p_file_size > 15 * 1024 * 1024 then
      raise exception 'A confidential file can be at most 15 MB.' using errcode = '22023';
    end if;
    if p_mime <> 'application/pdf' and p_mime not like 'image/%' then
      raise exception 'Only PDF files and images can be sent as confidential.' using errcode = '22023';
    end if;
  end if;

  -- Tidy up abandoned uploads from this person.
  delete from public.confidential_items
   where sender_id = p_user and status = 'pending' and created_at < now() - interval '1 day';

  insert into public.confidential_items (conversation_id, sender_id, kind, mime, file_size, view_seconds)
  values (p_conversation, p_user, p_kind, p_mime, p_file_size, p_view_seconds)
  returning id into v_id;

  insert into public.confidential_secrets (item_id, ciphertext, file_path, file_name_sealed)
  values (v_id, p_ciphertext, p_file_path, p_file_name_sealed);

  return v_id;
end;
$$;

-- Step 2 of sending. Stores the hash of the one-time key and posts the card.
create or replace function public.vault_finish(p_item uuid, p_user uuid, p_key_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.confidential_items%rowtype;
  v_msg uuid;
begin
  select * into it from public.confidential_items where id = p_item for update;
  if not found or it.sender_id <> p_user then
    raise exception 'Confidential item not found.' using errcode = 'P0002';
  end if;
  if it.status <> 'pending' then
    raise exception 'This confidential message was already sent.' using errcode = '22023';
  end if;
  if p_key_hash is null or length(p_key_hash) < 32 then
    raise exception 'Missing key.' using errcode = '22023';
  end if;
  if not public.vault_can_post(p_user, it.conversation_id) then
    raise exception 'You cannot post in this conversation.' using errcode = '42501';
  end if;

  perform set_config('vault.write', 'on', true);
  insert into public.social_messages (conversation_id, sender_id, body, confidential_id)
  values (
    it.conversation_id, p_user,
    case when it.kind = 'file' then 'Confidential document' else 'Confidential message' end,
    p_item
  )
  returning id into v_msg;
  perform set_config('vault.write', 'off', true);

  update public.confidential_items set message_id = v_msg, status = 'sealed', updated_at = now()
   where id = p_item;
  update public.confidential_secrets set key_hash = p_key_hash where item_id = p_item;
  perform public.vault_log(p_item, it.conversation_id, p_user, 'created',
    jsonb_build_object('kind', it.kind, 'view_seconds', it.view_seconds));
  return v_msg;
end;
$$;

-- Tries a key. A right key burns itself and opens the view window. A wrong key
-- is counted; too many locks the item and tells the administrators.
create or replace function public.vault_open(p_item uuid, p_user uuid, p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.confidential_items%rowtype;
  sec public.confidential_secrets%rowtype;
  v_max integer;
  v_count integer;
  v_status text;
  v_grant uuid;
  v_expires timestamptz;
begin
  select * into it from public.confidential_items where id = p_item for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.vault_is_member(p_user, it.conversation_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if it.sender_id = p_user then
    return jsonb_build_object('ok', false, 'code', 'own');
  end if;
  if it.status <> 'sealed' then
    return jsonb_build_object('ok', false, 'code', it.status);
  end if;

  select * into sec from public.confidential_secrets where item_id = p_item;
  select max_attempts into v_max from public.confidential_settings where id;
  v_max := coalesce(v_max, 5);

  if sec.key_hash is null or p_key_hash is null or sec.key_hash <> p_key_hash then
    update public.confidential_items
       set failed_attempts = failed_attempts + 1,
           status = case when failed_attempts + 1 >= v_max then 'locked' else status end,
           updated_at = now()
     where id = p_item
    returning failed_attempts, status into v_count, v_status;

    perform public.vault_log(p_item, it.conversation_id, p_user, 'key_failed',
      jsonb_build_object('attempt', v_count));

    if v_status = 'locked' then
      perform public.vault_log(p_item, it.conversation_id, p_user, 'locked_out', '{}'::jsonb);
      perform public.vault_notify(
        public.vault_admin_ids() || array[it.sender_id],
        'confidential_locked',
        'A confidential message was locked',
        'Too many wrong keys were tried. An administrator can unblock it.',
        it.conversation_id
      );
      return jsonb_build_object('ok', false, 'code', 'locked');
    end if;
    return jsonb_build_object('ok', false, 'code', 'wrong_key', 'attempts_left', greatest(v_max - v_count, 0));
  end if;

  update public.confidential_items
     set status = 'spent', opened_by = p_user, opened_at = now(), failed_attempts = 0, updated_at = now()
   where id = p_item;
  update public.confidential_secrets set key_hash = null where item_id = p_item;
  insert into public.confidential_grants (item_id, user_id, expires_at)
  values (p_item, p_user, now() + make_interval(secs => it.view_seconds))
  returning id, expires_at into v_grant, v_expires;
  update public.confidential_requests set fulfilled_at = now()
   where item_id = p_item and fulfilled_at is null;
  perform public.vault_log(p_item, it.conversation_id, p_user, 'opened',
    jsonb_build_object('view_seconds', it.view_seconds));

  return jsonb_build_object(
    'ok', true, 'grant_id', v_grant, 'expires_at', v_expires,
    'kind', it.kind, 'mime', it.mime, 'view_seconds', it.view_seconds
  );
end;
$$;

-- A person whose window is still open (page reloaded, app came back) can
-- carry on, with no key, until the window ends. Never longer.
create or replace function public.vault_resume(p_item uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.confidential_items%rowtype;
  g public.confidential_grants%rowtype;
begin
  select * into it from public.confidential_items where id = p_item;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if it.status = 'destroyed' then
    return jsonb_build_object('ok', false, 'code', 'destroyed');
  end if;
  if not public.vault_is_member(p_user, it.conversation_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select * into g from public.confidential_grants
   where item_id = p_item and user_id = p_user and expires_at > now()
   order by expires_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  return jsonb_build_object(
    'ok', true, 'grant_id', g.id, 'expires_at', g.expires_at,
    'kind', it.kind, 'mime', it.mime, 'view_seconds', it.view_seconds
  );
end;
$$;

-- Administrator unblocks: a fresh one-time key, attempts reset, any open
-- window closed. The administrator is shown the key once and passes it on.
create or replace function public.vault_unblock(p_item uuid, p_admin uuid, p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.confidential_items%rowtype;
  v_requesters uuid[];
begin
  if not public.is_vault_admin(p_admin) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_key_hash is null or length(p_key_hash) < 32 then
    raise exception 'Missing key.' using errcode = '22023';
  end if;
  select * into it from public.confidential_items where id = p_item for update;
  if not found then
    raise exception 'Confidential item not found.' using errcode = 'P0002';
  end if;
  if it.status not in ('sealed', 'spent', 'locked') then
    raise exception 'This confidential message cannot be unblocked (%).', it.status using errcode = '22023';
  end if;

  update public.confidential_items
     set status = 'sealed', failed_attempts = 0, unblock_count = unblock_count + 1, updated_at = now()
   where id = p_item;
  update public.confidential_secrets set key_hash = p_key_hash where item_id = p_item;
  update public.confidential_grants set expires_at = now()
   where item_id = p_item and expires_at > now();

  select coalesce(array_agg(distinct requester_id), '{}'::uuid[]) into v_requesters
    from public.confidential_requests where item_id = p_item and fulfilled_at is null;
  update public.confidential_requests set fulfilled_at = now()
   where item_id = p_item and fulfilled_at is null;

  perform public.vault_log(p_item, it.conversation_id, p_admin, 'admin_unblocked',
    jsonb_build_object('from_status', it.status));
  perform public.vault_notify(
    v_requesters || array[it.sender_id],
    'confidential_unblocked',
    'A confidential message was unblocked',
    'An administrator unblocked it. Ask them for the new key.',
    it.conversation_id
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- Sender or administrator destroys the content for good.
create or replace function public.vault_destroy(p_item uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.confidential_items%rowtype;
  v_path text;
begin
  select * into it from public.confidential_items where id = p_item for update;
  if not found then
    raise exception 'Confidential item not found.' using errcode = 'P0002';
  end if;
  if it.sender_id <> p_user and not public.is_vault_admin(p_user) then
    raise exception 'Only the sender or an administrator can delete this.' using errcode = '42501';
  end if;

  select file_path into v_path from public.confidential_secrets where item_id = p_item;
  update public.confidential_secrets set key_hash = null, ciphertext = null, file_name_sealed = null
   where item_id = p_item;
  update public.confidential_grants set expires_at = now() where item_id = p_item and expires_at > now();
  update public.confidential_items set status = 'destroyed', updated_at = now() where id = p_item;
  if it.message_id is not null then
    update public.social_messages set deleted_at = coalesce(deleted_at, now()), body = 'Message deleted'
     where id = it.message_id;
  end if;
  perform public.vault_log(p_item, it.conversation_id, p_user, 'destroyed', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'file_path', v_path);
end;
$$;

revoke all on function
  public.vault_begin(uuid, uuid, text, integer, text, bigint, text, text, text),
  public.vault_finish(uuid, uuid, text),
  public.vault_open(uuid, uuid, text),
  public.vault_resume(uuid, uuid),
  public.vault_unblock(uuid, uuid, text),
  public.vault_destroy(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.vault_begin(uuid, uuid, text, integer, text, bigint, text, text, text),
  public.vault_finish(uuid, uuid, text),
  public.vault_open(uuid, uuid, text),
  public.vault_resume(uuid, uuid),
  public.vault_unblock(uuid, uuid, text),
  public.vault_destroy(uuid, uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 7. Called from the browser.
-- ---------------------------------------------------------------------------

-- "Request key". Tells the sender and the administrators. When the key was
-- already used (or the item is locked) only the administrators are told.
create or replace function public.vault_request_access(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  it public.confidential_items%rowtype;
  v_name text;
  v_title text;
  v_recent integer;
begin
  if me is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;
  select * into it from public.confidential_items where id = p_item;
  if not found or not public.vault_is_member(me, it.conversation_id) then
    raise exception 'Confidential item not found.' using errcode = 'P0002';
  end if;
  if it.sender_id = me then
    raise exception 'You sent this message.' using errcode = '22023';
  end if;
  if it.status not in ('sealed', 'spent', 'locked') then
    raise exception 'This message cannot be requested (%).', it.status using errcode = '22023';
  end if;

  select count(*) into v_recent from public.confidential_requests
   where item_id = p_item and requester_id = me and fulfilled_at is null
     and created_at > now() - interval '10 minutes';
  if v_recent > 0 then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.confidential_requests (item_id, requester_id) values (p_item, me);
  select coalesce(nullif(btrim(full_name), ''), 'A colleague') into v_name
    from public.employee_profiles where id = me;
  v_name := coalesce(v_name, 'A colleague');

  perform public.vault_log(p_item, it.conversation_id, me, 'requested',
    jsonb_build_object('status', it.status));
  perform public.vault_notify(
    case when it.status = 'sealed'
      then public.vault_admin_ids() || array[it.sender_id]
      else public.vault_admin_ids()
    end,
    'confidential_request',
    case when it.status = 'sealed' then 'Key requested' else 'Access requested again' end,
    v_name || ' asked for access to a confidential message.',
    it.conversation_id
  );
  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

create or replace function public.vault_admin_list(p_limit integer default 200)
returns table (
  item_id uuid,
  conversation_id uuid,
  conversation_title text,
  participants text,
  sender_id uuid,
  sender_name text,
  kind text,
  status text,
  view_seconds integer,
  failed_attempts integer,
  unblock_count integer,
  opened_by_name text,
  opened_at timestamptz,
  open_requests integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_vault_admin(auth.uid()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return query
  select
    i.id, i.conversation_id,
    coalesce(nullif(btrim(c.title), ''), 'Direct chat'),
    (select string_agg(coalesce(ep.full_name, 'Unknown'), ', ' order by ep.full_name)
       from public.social_conversation_members m
       join public.employee_profiles ep on ep.id = m.user_id
      where m.conversation_id = i.conversation_id and m.removed_at is null),
    i.sender_id, s.full_name, i.kind, i.status, i.view_seconds, i.failed_attempts, i.unblock_count,
    o.full_name, i.opened_at,
    (select count(*)::int from public.confidential_requests r where r.item_id = i.id and r.fulfilled_at is null),
    i.created_at
  from public.confidential_items i
  join public.social_conversations c on c.id = i.conversation_id
  left join public.employee_profiles s on s.id = i.sender_id
  left join public.employee_profiles o on o.id = i.opened_by
  where i.status <> 'pending'
  order by (i.status in ('locked', 'spent')) desc, i.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

create or replace function public.vault_admin_audit(p_item uuid default null, p_limit integer default 200)
returns table (
  id bigint,
  created_at timestamptz,
  event text,
  actor_name text,
  item_id uuid,
  conversation_title text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_vault_admin(auth.uid()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return query
  select a.id, a.created_at, a.event, ep.full_name, a.item_id,
         coalesce(nullif(btrim(c.title), ''), 'Direct chat'), a.detail
  from public.confidential_audit a
  left join public.employee_profiles ep on ep.id = a.actor_id
  left join public.social_conversations c on c.id = a.conversation_id
  where p_item is null or a.item_id = p_item
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.vault_admin_set_settings(p_max_view_seconds integer, p_max_attempts integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_vault_admin(auth.uid()) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_max_view_seconds is null or p_max_view_seconds < 10 or p_max_view_seconds > 3600 then
    raise exception 'The longest view time must be between 10 seconds and 1 hour.' using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 3 or p_max_attempts > 10 then
    raise exception 'Wrong-key attempts must be between 3 and 10.' using errcode = '22023';
  end if;
  update public.confidential_settings
     set max_view_seconds = p_max_view_seconds, max_attempts = p_max_attempts,
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform public.vault_log(null, null, auth.uid(), 'settings_changed',
    jsonb_build_object('max_view_seconds', p_max_view_seconds, 'max_attempts', p_max_attempts));
end;
$$;

revoke all on function
  public.vault_request_access(uuid),
  public.vault_admin_list(integer),
  public.vault_admin_audit(uuid, integer),
  public.vault_admin_set_settings(integer, integer)
from public, anon;
grant execute on function
  public.vault_request_access(uuid),
  public.vault_admin_list(integer),
  public.vault_admin_audit(uuid, integer),
  public.vault_admin_set_settings(integer, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Private storage for confidential files. No storage policy is created on
--    purpose: nobody in the browser can list, read or write this bucket. Files
--    go in through a one-time signed upload address and come out through a
--    short-lived signed address, both issued by the edge function.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'confidential-vault', 'confidential-vault', false, 15728640,
      array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = 15728640,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

commit;
