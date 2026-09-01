begin;

-- ============================================================
-- RideArrivo native chat security foundation
-- Harden existing social conversation tables for private DMs.
-- ===========================================================

Alter table public.social_conversation_members
  add column if not exists last_read_at timestamptz not null default now();

create index if not exists idx_social_conversation_members_user
  on public.social_conversation_members(user_id, conversation_id);

create or replace function public.can_access_social_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.social_conversation_members m
    join public.employee_profiles p
      on p.id=m.user_id
     and p.active=true
    where m.conversation_id=p_conversation_id
      and m.user_id=auth.uid()
  );
$$;

revoke all
on function public.can_access_social_conversation(uuid)
from public;

grant execute
on function public.can_access_social_conversation(uuid)
to authenticated, service_role;

create or replace function public.start_or_get_social_direct_conversation(
  p_other_user uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  me uuid:=auth.uid();
  conversation_id uuid;
  pair_key text;
begin
  if me is null then
    raise exception 'Authentication required';
  end if;

  if p_other_user is null or p_other_user=me then
    raise exception 'Choose another active employee';
  end if;

  if not exists(
    select 1
    from public.employee_profiles p
    where p.id=me
      and p.active=true
  ) then
    raise exception 'Active workspace profile required';
  end if;

  if not exists(
    select 1
    from public.employee_profiles p
    where p.id=p_other_user
      and p.active=true
  ) then
    raise exception 'Recipient is not an active employee';
  end if;

  pair_key:=
    least(me::text,p_other_user::text)
    || ':'
    || greatest(me::text,p_other_user::text);

  perform pg_advisory_xact_lock(
    hashtextextended(pair_key,0)
  );

  select c.id
  into conversation_id
  from public.social_conversations c
  where c.is_group=false
    and exists(
      select 1
      from public.social_conversation_members m
      where m.conversation_id=c.id
        and m.user_id=me
    )
    and exists(
      select 1
      from public.social_conversation_members m
      where m.conversation_id=c.id
        and m.user_id=p_other_user
  )
    and (
      select count(*)
      from public.social_conversation_members m
      where m.conversation_id=c.id
    )=2
  order by c.created_at asc
  limit 1;

  if conversation_id is null then
    insert into public.social_conversations(
      is_group,
      title,
      created_by
    )
    values(
      false,
      null,
      me
    )
    returning id into conversation_id;

    insert into public.social_conversation_members(
      conversation_id,
      user_id,
      last_read_at
    )
    values
      (conversation_id,me,now()),
      (conversation_id,p_other_user,now());
  end if;

  return conversation_id;
end;
$$;

revoke all
on function public.start_or_get_social_direct_conversation(uuid)
from public;

grant execute
on function public.start_or_get_social_direct_conversation(uuid)
to authenticated;

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

  update public.social_conversation_members
  set last_read_at=clock_timestamp()
  where conversation_id=p_conversation_id
    and user_id=auth.uid();

  if not found then
    raise exception 'Conversation membership not found';
  end if;
end;
$$;

revoke all
on function public.mark_social_conversation_read(uuid)
from public;

grant execute
on function public.mark_social_conversation_read(uuid)
to authenticated;

drop policy if exists
  "social conversations member read"
on public.social_conversations;

drop policy if exists
  "social conversations create"
on public.social_conversations;

create policy "social conversations member read"
on public.social_conversations
for select
to authenticated
using(
  public.can_access_social_conversation(id)
);

drop policy if exists
  "social conversation members read"
on public.social_conversation_members;

drop policy if exists
  "social conversation members add"
on public.social_conversation_members;

create policy "social conversation members read"
on public.social_conversation_members
for select
to authenticated
using(
  public.can_access_social_conversation(conversation_id)
);

drop policy if exists
  "social messages member read"
on public.social_messages;

drop policy if exists
  "social messages member send"
on public.social_messages;

create policy "social messages member read"
on public.social_messages
for select
to authenticated
using(
  deleted_at is null
  and public.can_access_social_conversation(conversation_id)
);

create policy "social messages member send"
on public.social_messages
for insert
to authenticated
with check(
  sender_id=auth.uid()
  and deleted_at is null
  and public.can_access_social_conversation(conversation_id)
);

revoke insert, update, delete
on table public.social_conversations
from authenticated;

revoke insert, update, delete
on table public.social_conversation_members
from authenticated;

revoke update, delete
on table public.social_messages
from authenticated;

grant select
on table public.social_conversations
to authenticated;

grant select
on table public.social_conversation_members
to authenticated;

grant select, insert
on table public.social_messages
to authenticated;

do $$
begin
  if exists(
    select 1
    from pg_publication
    where pubname='supabase_realtime'
  ) then
    if not exists(
      select 1
      from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='social_messages'
    ) then
      alter publication supabase_realtime
        add table public.social_messages;
    end if;

    if not exists(
      select 1
      from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='social_conversation_members'
    ) then
      alter publication supabase_realtime
        add table public.social_conversation_members;
    end if;
  end if;
end;
$$;

commit;
