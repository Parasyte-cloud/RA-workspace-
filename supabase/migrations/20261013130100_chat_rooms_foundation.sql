begin;

-- ============================================================
-- RideArrivo Department Communications
-- Governed room/domain foundation.
--
-- Additive only:
-- - preserves all existing direct conversations and messages
-- - adds governed room metadata
-- - adds explicit Chat administration and department-lead sources
-- - adds membership role/history lifecycle fields
-- - introduces reusable authorization capability helpers
-- ============================================================


-- ------------------------------------------------------------
-- 1. Conversation domain
-- ------------------------------------------------------------

alter table public.social_conversations
add column if not exists conversation_kind text not null default 'direct';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_conversations_conversation_kind_check'
      and conrelid = 'public.social_conversations'::regclass
  ) then
    alter table public.social_conversations
    add constraint social_conversations_conversation_kind_check
    check (
      conversation_kind in (
        'direct',
        'department',
        'project',
        'committee',
        'restricted'
      )
    );
  end if;
end;
$$;

create index if not exists idx_social_conversations_kind
on public.social_conversations(conversation_kind);


-- ------------------------------------------------------------
-- 2. Governed room metadata
-- ------------------------------------------------------------

create table if not exists public.chat_rooms (
  conversation_id uuid primary key
    references public.social_conversations(id) on delete cascade,

  room_type text not null
    check (
      room_type in (
        'department',
        'project',
        'committee',
        'restricted'
      )
    ),

  department text,
  description text,

  status text not null default 'active'
    check (status in ('active', 'archived')),

  history_policy text not null default 'full'
    check (history_policy in ('full', 'from_join_date')),

  created_by uuid
    references public.employee_profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint chat_rooms_department_required
    check (
      room_type <> 'department'
      or nullif(btrim(department), '') is not null
    ),

  constraint chat_rooms_archive_state_consistent
    check (
      (status = 'active' and archived_at is null)
      or status = 'archived'
    )
);

create index if not exists idx_chat_rooms_type_status
on public.chat_rooms(room_type, status);

create unique index if not exists idx_chat_rooms_active_department_unique
on public.chat_rooms(lower(btrim(department)))
where room_type = 'department'
  and status = 'active'
  and department is not null;


-- ------------------------------------------------------------
-- 3. Explicit global Chat administrator capability
--
-- HR and workspace administrators are authoritative roles already
-- present in employee_profiles.
--
-- Director and any additional Chat administrator are represented
-- through this explicit grant table. We deliberately do NOT infer
-- Director authority from job_title or grant every "manager" global
-- Chat privileges.
-- ------------------------------------------------------------

create table if not exists public.workspace_chat_admin_grants (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  granted_by uuid
    references public.employee_profiles(id) on delete set null,

  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists idx_workspace_chat_admin_grants_active
on public.workspace_chat_admin_grants(employee_id)
where revoked_at is null;

create index if not exists idx_workspace_chat_admin_grants_employee
on public.workspace_chat_admin_grants(employee_id, revoked_at);


-- ------------------------------------------------------------
-- 4. Explicit department leadership source
--
-- Leadership is never inferred from job-title text.
-- ended_at preserves leadership history while allowing one current
-- lead for each department.
-- ------------------------------------------------------------

create table if not exists public.workspace_department_leads (
  id uuid primary key default gen_random_uuid(),

  department text not null
    check (nullif(btrim(department), '') is not null),

  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  assigned_by uuid
    references public.employee_profiles(id) on delete set null,

  assigned_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists idx_workspace_department_leads_active_department
on public.workspace_department_leads(lower(btrim(department)))
where ended_at is null;

create index if not exists idx_workspace_department_leads_employee
on public.workspace_department_leads(employee_id, ended_at);


-- ------------------------------------------------------------
-- 5. Conversation membership lifecycle and room authority
-- ------------------------------------------------------------

alter table public.social_conversation_members
add column if not exists room_role text not null default 'member';

alter table public.social_conversation_members
add column if not exists added_by uuid
references public.employee_profiles(id) on delete set null;

alter table public.social_conversation_members
add column if not exists removed_at timestamptz;

alter table public.social_conversation_members
add column if not exists history_from timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_conversation_members_room_role_check'
      and conrelid = 'public.social_conversation_members'::regclass
  ) then
    alter table public.social_conversation_members
    add constraint social_conversation_members_room_role_check
    check (room_role in ('member', 'admin', 'owner'));
  end if;
end;
$$;

create index if not exists idx_social_conversation_members_active_user
on public.social_conversation_members(user_id, conversation_id)
where removed_at is null;

create index if not exists idx_social_conversation_members_active_room_role
on public.social_conversation_members(conversation_id, room_role)
where removed_at is null;


-- ------------------------------------------------------------
-- 6. Capability helpers
-- ------------------------------------------------------------

create or replace function public.is_active_employee()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
  );
$$;

revoke all on function public.is_active_employee()
from public, anon;

grant execute on function public.is_active_employee()
to authenticated, service_role;


create or replace function public.is_workspace_chat_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1
      from public.employee_profiles ep
      where ep.id = auth.uid()
        and ep.active = true
        and ep.role in ('hr', 'admin')
    )
    or exists (
      select 1
      from public.workspace_chat_admin_grants g
      join public.employee_profiles ep
        on ep.id = g.employee_id
       and ep.active = true
      where g.employee_id = auth.uid()
        and g.revoked_at is null
    );
$$;

revoke all on function public.is_workspace_chat_admin()
from public, anon;

grant execute on function public.is_workspace_chat_admin()
to authenticated, service_role;


create or replace function public.is_conversation_member(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.social_conversation_members m
    join public.employee_profiles ep
      on ep.id = m.user_id
     and ep.active = true
    where m.conversation_id = p_conversation_id
      and m.user_id = auth.uid()
      and m.removed_at is null
  );
$$;

revoke all on function public.is_conversation_member(uuid)
from public, anon;

grant execute on function public.is_conversation_member(uuid)
to authenticated, service_role;


create or replace function public.is_room_admin(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_workspace_chat_admin()
    or exists (
      select 1
      from public.social_conversation_members m
      join public.employee_profiles ep
        on ep.id = m.user_id
       and ep.active = true
      join public.chat_rooms r
        on r.conversation_id = m.conversation_id
      where m.conversation_id = p_conversation_id
        and m.user_id = auth.uid()
        and m.removed_at is null
        and m.room_role in ('admin', 'owner')
    );
$$;

revoke all on function public.is_room_admin(uuid)
from public, anon;

grant execute on function public.is_room_admin(uuid)
to authenticated, service_role;


create or replace function public.can_write_to_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_conversation_member(p_conversation_id)
    and exists (
      select 1
      from public.social_conversations c
      left join public.chat_rooms r
        on r.conversation_id = c.id
      where c.id = p_conversation_id
        and (
          c.conversation_kind = 'direct'
          or (
            r.conversation_id is not null
            and r.status = 'active'
          )
        )
    );
$$;

revoke all on function public.can_write_to_conversation(uuid)
from public, anon;

grant execute on function public.can_write_to_conversation(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- 7. Preserve the existing DM access helper while making removed_at
-- authoritative for the upgraded model.
-- ------------------------------------------------------------

create or replace function public.can_access_social_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_conversation_member(p_conversation_id);
$$;

revoke all on function public.can_access_social_conversation(uuid)
from public, anon;

grant execute on function public.can_access_social_conversation(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- 8. Row-level security
-- ------------------------------------------------------------

alter table public.chat_rooms
enable row level security;

alter table public.workspace_chat_admin_grants
enable row level security;

alter table public.workspace_department_leads
enable row level security;


drop policy if exists "chat rooms member read"
on public.chat_rooms;

create policy "chat rooms member read"
on public.chat_rooms
for select
to authenticated
using (
  public.is_conversation_member(conversation_id)
  or public.is_workspace_chat_admin()
);


drop policy if exists "chat admins read grants"
on public.workspace_chat_admin_grants;

create policy "chat admins read grants"
on public.workspace_chat_admin_grants
for select
to authenticated
using (
  public.is_workspace_chat_admin()
);


drop policy if exists "active employees read department leads"
on public.workspace_department_leads;

create policy "active employees read department leads"
on public.workspace_department_leads
for select
to authenticated
using (
  public.is_active_employee()
);


-- ------------------------------------------------------------
-- 9. Explicit privilege boundary
--
-- Governed room creation and membership administration must happen
-- through secured RPC/server-side flows, never direct browser writes.
-- ------------------------------------------------------------

revoke all
on table public.chat_rooms
from anon;

revoke insert, update, delete
on table public.chat_rooms
from authenticated;

grant select
on table public.chat_rooms
to authenticated;


revoke all
on table public.workspace_chat_admin_grants
from anon;

revoke insert, update, delete
on table public.workspace_chat_admin_grants
from authenticated;

grant select
on table public.workspace_chat_admin_grants
to authenticated;


revoke all
on table public.workspace_department_leads
from anon;

revoke insert, update, delete
on table public.workspace_department_leads
from authenticated;

grant select
on table public.workspace_department_leads
to authenticated;


-- Service-side workers and secured Edge Functions may need these
-- primitives without exposing browser write privileges.
grant select, insert, update, delete
on table public.chat_rooms
to service_role;

grant select, insert, update, delete
on table public.workspace_chat_admin_grants
to service_role;

grant select, insert, update, delete
on table public.workspace_department_leads
to service_role;


commit;
