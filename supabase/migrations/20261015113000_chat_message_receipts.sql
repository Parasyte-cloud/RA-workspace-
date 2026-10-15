begin;

create table if not exists public.chat_message_receipts (
  message_id uuid not null
    references public.social_messages(id)
    on delete cascade,

  user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  delivered_at timestamptz,
  read_at timestamptz,

  created_at timestamptz not null
    default now(),

  primary key (message_id, user_id),

  constraint chat_message_receipts_read_requires_delivery
    check (
      read_at is null
      or delivered_at is not null
    )
);

create index if not exists
chat_message_receipts_user_pending_idx
on public.chat_message_receipts(
  user_id,
  delivered_at,
  read_at
);

create index if not exists
chat_message_receipts_message_idx
on public.chat_message_receipts(message_id);

alter table public.chat_message_receipts
enable row level security;

revoke all
on table public.chat_message_receipts
from public, anon, authenticated;

grant select
on table public.chat_message_receipts
to authenticated;

grant all
on table public.chat_message_receipts
to service_role;


-- ------------------------------------------------------------
-- Sender/recipient visibility only.
-- ------------------------------------------------------------

drop policy if exists
"chat receipt participants read"
on public.chat_message_receipts;

create policy
"chat receipt participants read"
on public.chat_message_receipts
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.social_messages message
    where message.id = message_id
      and message.sender_id = auth.uid()
  )
);


-- ------------------------------------------------------------
-- One immutable intended-recipient row per message.
-- ------------------------------------------------------------

create or replace function
public.seed_chat_message_receipts()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.chat_message_receipts(
    message_id,
    user_id
  )
  select
    new.id,
    m.user_id
  from public.social_conversation_members m
  join public.employee_profiles ep
    on ep.id = m.user_id
   and ep.active = true
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and m.removed_at is null
  on conflict (message_id, user_id)
  do nothing;

  return new;
end;
$$;

revoke all
on function public.seed_chat_message_receipts()
from public, anon, authenticated;

drop trigger if exists
seed_chat_message_receipts
on public.social_messages;

create trigger
seed_chat_message_receipts
after insert on public.social_messages
for each row
execute function public.seed_chat_message_receipts();


-- ------------------------------------------------------------
-- Conservative backfill.
--
-- Existing messages get receipt rows only for people whose current
-- membership timeline says they were already in the conversation.
-- A historical read is treated as delivered + seen.
-- ------------------------------------------------------------

insert into public.chat_message_receipts(
  message_id,
  user_id,
  delivered_at,
  read_at
)
select
  message.id,
  member.user_id,

  case
    when member.last_read_at >= message.created_at
      then member.last_read_at
    else null
  end,

  case
    when member.last_read_at >= message.created_at
      then member.last_read_at
    else null
  end

from public.social_messages message

join public.social_conversation_members member
  on member.conversation_id =
     message.conversation_id
 and member.user_id <>
     message.sender_id
 and member.joined_at <=
     message.created_at
 and (
   member.removed_at is null
   or member.removed_at >=
      message.created_at
 )

join public.employee_profiles ep
  on ep.id = member.user_id

on conflict (message_id, user_id)
do nothing;


-- ------------------------------------------------------------
-- Device/app delivery acknowledgement.
--
-- Called when a signed-in workspace instance is alive and synced.
-- It does not treat Web Push transport alone as delivery.
-- ------------------------------------------------------------

create or replace function
public.ack_chat_delivered(
  p_message_ids uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  affected integer := 0;
begin
  if actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if not public.is_active_employee() then
    raise exception 'Active employee required'
      using errcode = '42501';
  end if;

  if coalesce(cardinality(p_message_ids), 0) = 0 then
    return 0;
  end if;

  update public.chat_message_receipts receipt
  set delivered_at =
    coalesce(
      receipt.delivered_at,
      clock_timestamp()
    )
  where receipt.user_id = actor
    and receipt.message_id = any(p_message_ids)
    and receipt.delivered_at is null;

  get diagnostics affected = row_count;

  return affected;
end;
$$;

revoke all
on function public.ack_chat_delivered(uuid[])
from public, anon;

grant execute
on function public.ack_chat_delivered(uuid[])
to authenticated, service_role;


-- ------------------------------------------------------------
-- Read acknowledgement.
--
-- Opening/focusing a conversation marks every message intended for
-- this recipient as both delivered and read.
-- ------------------------------------------------------------

create or replace function
public.ack_chat_read(
  p_conversation_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  affected integer := 0;
begin
  if actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if not public.is_conversation_member(
    p_conversation_id
  ) then
    raise exception
      'Conversation read access required'
      using errcode = '42501';
  end if;

  update public.chat_message_receipts receipt
  set
    delivered_at =
      coalesce(
        receipt.delivered_at,
        clock_timestamp()
      ),
    read_at =
      coalesce(
        receipt.read_at,
        clock_timestamp()
      )
  from public.social_messages message
  where receipt.message_id = message.id
    and receipt.user_id = actor
    and message.conversation_id =
        p_conversation_id
    and receipt.read_at is null;

  get diagnostics affected = row_count;

  return affected;
end;
$$;

revoke all
on function public.ack_chat_read(uuid)
from public, anon;

grant execute
on function public.ack_chat_read(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- Sender receipt summary.
--
-- Only summaries for messages authored by the caller are returned.
-- Names make room receipts useful without exposing unrelated chats.
-- ------------------------------------------------------------

create or replace function
public.chat_receipt_summary(
  p_conversation_id uuid
)
returns table (
  message_id uuid,
  recipient_count bigint,
  delivered_count bigint,
  read_count bigint,
  delivered_by text[],
  read_by text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    receipt.message_id,

    count(*) as recipient_count,

    count(*)
      filter (
        where receipt.delivered_at
        is not null
      )
      as delivered_count,

    count(*)
      filter (
        where receipt.read_at
        is not null
      )
      as read_count,

    coalesce(
      array_agg(
        coalesce(
          nullif(
            btrim(profile.full_name),
            ''
          ),
          profile.email,
          'Employee'
        )
        order by
          coalesce(
            nullif(
              btrim(profile.full_name),
              ''
            ),
            profile.email,
            'Employee'
          )
      )
      filter (
        where receipt.delivered_at
        is not null
      ),
      array[]::text[]
    )
      as delivered_by,

    coalesce(
      array_agg(
        coalesce(
          nullif(
            btrim(profile.full_name),
            ''
          ),
          profile.email,
          'Employee'
        )
        order by
          coalesce(
            nullif(
              btrim(profile.full_name),
              ''
            ),
            profile.email,
            'Employee'
          )
      )
      filter (
        where receipt.read_at
        is not null
      ),
      array[]::text[]
    )
      as read_by

  from public.chat_message_receipts receipt

  join public.social_messages message
    on message.id =
       receipt.message_id

  left join public.employee_profiles profile
    on profile.id =
       receipt.user_id

  where message.conversation_id =
        p_conversation_id
    and message.sender_id =
        auth.uid()

  group by receipt.message_id;
$$;

revoke all
on function
public.chat_receipt_summary(uuid)
from public, anon;

grant execute
on function
public.chat_receipt_summary(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- Realtime sender-side receipt updates.
-- ------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname =
          'supabase_realtime'
      and schemaname =
          'public'
      and tablename =
          'chat_message_receipts'
  )
  then
    alter publication supabase_realtime
    add table public.chat_message_receipts;
  end if;
end;
$$;

commit;
