begin;

-- ==========================================================
-- RIDEARRIVO COLLABORATION FOUNDATION
-- Department workspaces + cross-department shared spaces
-- ==========================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------
-- CTO ROLE
-- ----------------------------------------------------------

alter table public.employee_profiles
  drop constraint if exists employee_profiles_role_check;

alter table public.employee_profiles
  add constraint employee_profiles_role_check
  check (
    role in (
      'employee',
      'support',
      'engineer',
      'cto',
      'manager',
      'hr',
      'legal',
      'operations',
      'finance',
      'marketing',
      'partnerships',
      'admin'
    )
  );

create or replace function public.current_workspace_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.role
  from public.employee_profiles p
  where p.id=auth.uid()
    and p.active=true
  limit 1;
$$;

create or replace function public.has_workspace_role(
  roles text[]
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    public.current_workspace_role() = any(roles),
    false
  );
$$;

grant execute
on function public.current_workspace_role()
to authenticated;

grant execute
on function public.has_workspace_role(text[])
to authenticated;

-- ----------------------------------------------------------
-- ASSIGNMENT AUTHORITY
-- Admin/Manager: company-wide
-- CTO: engineering
-- Operations: own department
-- Everybody else: self
-- ----------------------------------------------------------

create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.employee_profiles target
      on target.id=target_user
    where
      me.id=auth.uid()
      and me.active=true
      and target.active=true
      and (
        me.role in ('manager','admin')

        or (
          me.role='cto'
          and (
            target.role in ('cto','engineer')
            or lower(coalesce(target.department,''))
               = 'engineering'
          )
        )

        or (
          me.role='operations'
          and lower(coalesce(target.department,''))
              =
              lower(coalesce(me.department,''))
        )

        or target.id=me.id
      )
  );
$$;

grant execute
on function public.can_assign_work(uuid)
to authenticated;

-- ----------------------------------------------------------
-- COLLABORATION SPACES
-- ----------------------------------------------------------

create table if not exists public.collaboration_spaces (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check(length(trim(name)) between 2 and 120),

  description text,

  space_type text not null default 'project'
    check(
      space_type in (
        'department',
        'project',
        'cross_department'
      )
    ),

  home_department text,

  created_by uuid not null
    references public.employee_profiles(id),

  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists
  collaboration_one_department_space
on public.collaboration_spaces(
  lower(home_department)
)
where
  space_type='department'
  and archived_at is null
  and home_department is not null;

create index if not exists
  collaboration_spaces_creator_idx
on public.collaboration_spaces(created_by);

-- ----------------------------------------------------------
-- MEMBERS
-- ----------------------------------------------------------

create table if not exists
public.collaboration_space_members (
  space_id uuid not null
    references public.collaboration_spaces(id)
    on delete cascade,

  user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  member_role text not null default 'member'
    check(
      member_role in (
        'owner',
        'admin',
        'member',
        'viewer'
      )
    ),

  added_by uuid
    references public.employee_profiles(id),

  joined_at timestamptz not null default now(),

  primary key(space_id,user_id)
);

create index if not exists
  collaboration_members_user_idx
on public.collaboration_space_members(user_id);

-- ----------------------------------------------------------
-- INVITES
-- ----------------------------------------------------------

create table if not exists
public.collaboration_invites (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null
    references public.collaboration_spaces(id)
    on delete cascade,

  inviter_id uuid not null
    references public.employee_profiles(id),

  invitee_id uuid not null
    references public.employee_profiles(id),

  message text,

  status text not null default 'pending'
    check(
      status in (
        'pending',
        'accepted',
        'declined',
        'cancelled'
      )
    ),

  created_at timestamptz not null default now(),
  responded_at timestamptz,

  check(inviter_id <> invitee_id)
);

create unique index if not exists
  collaboration_pending_invite_unique
on public.collaboration_invites(
  space_id,
  invitee_id
)
where status='pending';

create index if not exists
  collaboration_invitee_idx
on public.collaboration_invites(
  invitee_id,
  status
);

-- ----------------------------------------------------------
-- SHARED MESSAGES / DISCUSSION
-- ----------------------------------------------------------

create table if not exists
public.collaboration_messages (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null
    references public.collaboration_spaces(id)
    on delete cascade,

  author_id uuid not null
    references public.employee_profiles(id),

  body text not null
    check(length(trim(body)) between 1 and 10000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  collaboration_messages_space_idx
on public.collaboration_messages(
  space_id,
  created_at desc
);

-- ----------------------------------------------------------
-- UPDATED AT
-- ----------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists
  collaboration_spaces_updated_at
on public.collaboration_spaces;

create trigger collaboration_spaces_updated_at
before update
on public.collaboration_spaces
for each row
execute function public.set_updated_at();

drop trigger if exists
  collaboration_messages_updated_at
on public.collaboration_messages;

create trigger collaboration_messages_updated_at
before update
on public.collaboration_messages
for each row
execute function public.set_updated_at();

-- ----------------------------------------------------------
-- SECURITY HELPERS
-- SECURITY DEFINER prevents recursive RLS lookups.
-- ----------------------------------------------------------

create or replace function
public.can_access_collaboration_space(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    exists(
      select 1
      from public.employee_profiles me
      where me.id=auth.uid()
        and me.active=true
    )
    and
    exists(
      select 1
      from public.collaboration_spaces s
      where
        s.id=target_space
        and s.archived_at is null
        and (
          public.has_workspace_role(
            array['manager','admin']
          )

          or exists(
            select 1
            from public.collaboration_space_members m
            where
              m.space_id=s.id
              and m.user_id=auth.uid()
          )

          or (
            s.space_type='department'
            and lower(
              coalesce(s.home_department,'')
            ) =
            lower(
              coalesce(
                (
                  select p.department
                  from public.employee_profiles p
                  where
                    p.id=auth.uid()
                    and p.active=true
                  limit 1
                ),
                ''
              )
            )
          )
        )
    );
$$;

grant execute
on function
public.can_access_collaboration_space(uuid)
to authenticated;

-- ----------------------------------------------------------
-- ENSURE CURRENT EMPLOYEE HAS A DEPARTMENT SPACE
-- ----------------------------------------------------------

create or replace function
public.ensure_department_space()
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.employee_profiles%rowtype;
  result_id uuid;
begin
  select *
  into me
  from public.employee_profiles
  where
    id=auth.uid()
    and active=true;

  if not found then
    raise exception 'Active workspace profile required';
  end if;

  if
    me.department is null
    or trim(me.department)=''
    or lower(trim(me.department))='unassigned'
  then
    raise exception 'Employee department is not configured';
  end if;

  select s.id
  into result_id
  from public.collaboration_spaces s
  where
    s.space_type='department'
    and s.archived_at is null
    and lower(s.home_department)
        = lower(me.department)
  limit 1;

  if result_id is null then
    begin
      insert into public.collaboration_spaces(
        name,
        description,
        space_type,
        home_department,
        created_by
      )
      values(
        me.department || ' Team Workspace',
        'Shared workspace for the '
          || me.department
          || ' team.',
        'department',
        me.department,
        auth.uid()
      )
      returning id
      into result_id;

    exception
      when unique_violation then
        select s.id
        into result_id
        from public.collaboration_spaces s
        where
          s.space_type='department'
          and s.archived_at is null
          and lower(s.home_department)
              = lower(me.department)
        limit 1;
    end;
  end if;

  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  values(
    result_id,
    auth.uid(),
    'member',
    auth.uid()
  )
  on conflict(space_id,user_id)
  do nothing;

  return result_id;
end;
$$;

grant execute
on function public.ensure_department_space()
to authenticated;

-- ----------------------------------------------------------
-- CREATE PROJECT / CROSS-DEPARTMENT SPACE
-- ----------------------------------------------------------

create or replace function
public.create_collaboration_space(
  p_name text,
  p_description text default null,
  p_space_type text default 'project'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  new_id uuid;
begin
  if not exists(
    select 1
    from public.employee_profiles
    where id=auth.uid()
      and active=true
  ) then
    raise exception 'Active workspace profile required';
  end if;

  if p_space_type not in (
    'project',
    'cross_department'
  ) then
    raise exception
      'Use ensure_department_space for department workspaces';
  end if;

  insert into public.collaboration_spaces(
    name,
    description,
    space_type,
    created_by
  )
  values(
    trim(p_name),
    nullif(trim(coalesce(p_description,'')),''),
    p_space_type,
    auth.uid()
  )
  returning id into new_id;

  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  values(
    new_id,
    auth.uid(),
    'owner',
    auth.uid()
  );

  return new_id;
end;
$$;

grant execute
on function public.create_collaboration_space(
  text,
  text,
  text
)
to authenticated;

-- ----------------------------------------------------------
-- INVITE AN EMPLOYEE
-- ----------------------------------------------------------

create or replace function
public.invite_to_collaboration_space(
  p_space_id uuid,
  p_invitee_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  invite_id uuid;
  space_name text;
begin
  if not public.can_access_collaboration_space(
    p_space_id
  ) then
    raise exception 'You cannot access this workspace';
  end if;

  if p_invitee_id=auth.uid() then
    raise exception 'You are already in this workspace';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where
      id=p_invitee_id
      and active=true
  ) then
    raise exception 'Invitee is not an active employee';
  end if;

  if exists(
    select 1
    from public.collaboration_space_members
    where
      space_id=p_space_id
      and user_id=p_invitee_id
  ) then
    raise exception 'Employee is already a workspace member';
  end if;

  select id
  into invite_id
  from public.collaboration_invites
  where
    space_id=p_space_id
    and invitee_id=p_invitee_id
    and status='pending'
  limit 1;

  if invite_id is not null then
    return invite_id;
  end if;

  insert into public.collaboration_invites(
    space_id,
    inviter_id,
    invitee_id,
    message
  )
  values(
    p_space_id,
    auth.uid(),
    p_invitee_id,
    nullif(trim(coalesce(p_message,'')),'')
  )
  returning id into invite_id;

  select name
  into space_name
  from public.collaboration_spaces
  where id=p_space_id;

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  values(
    p_invitee_id,
    'collaboration_invite',
    'Workspace invitation',
    'You were invited to collaborate in '
      || coalesce(space_name,'a shared workspace')
      || '.',
    'collaboration_invite',
    invite_id
  );

  return invite_id;
end;
$$;

grant execute
on function public.invite_to_collaboration_space(
  uuid,
  uuid,
  text
)
to authenticated;

-- ----------------------------------------------------------
-- ACCEPT / DECLINE
-- ----------------------------------------------------------

create or replace function
public.respond_to_collaboration_invite(
  p_invite_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  invitation public.collaboration_invites%rowtype;
  space_name text;
begin
  if p_decision not in (
    'accepted',
    'declined'
  ) then
    raise exception 'Decision must be accepted or declined';
  end if;

  select *
  into invitation
  from public.collaboration_invites
  where id=p_invite_id
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if invitation.invitee_id<>auth.uid() then
    raise exception 'This invitation belongs to another employee';
  end if;

  if invitation.status<>'pending' then
    raise exception 'Invitation has already been processed';
  end if;

  update public.collaboration_invites
  set
    status=p_decision,
    responded_at=now()
  where id=p_invite_id;

  if p_decision='accepted' then
    insert into public.collaboration_space_members(
      space_id,
      user_id,
      member_role,
      added_by
    )
    values(
      invitation.space_id,
      invitation.invitee_id,
      'member',
      invitation.inviter_id
    )
    on conflict(space_id,user_id)
    do nothing;
  end if;

  select name
  into space_name
  from public.collaboration_spaces
  where id=invitation.space_id;

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  values(
    invitation.inviter_id,
    'collaboration_response',
    'Workspace invitation ' || p_decision,
    coalesce(space_name,'Shared workspace')
      || ' invitation was '
      || p_decision
      || '.',
    'collaboration_invite',
    invitation.id
  );
end;
$$;

grant execute
on function public.respond_to_collaboration_invite(
  uuid,
  text
)
to authenticated;

-- ----------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------

alter table public.collaboration_spaces
  enable row level security;

alter table public.collaboration_space_members
  enable row level security;

alter table public.collaboration_invites
  enable row level security;

alter table public.collaboration_messages
  enable row level security;

drop policy if exists
  "collaboration spaces read"
on public.collaboration_spaces;

create policy "collaboration spaces read"
on public.collaboration_spaces
for select
to authenticated
using(
  public.can_access_collaboration_space(id)
);

drop policy if exists
  "collaboration members read"
on public.collaboration_space_members;

create policy "collaboration members read"
on public.collaboration_space_members
for select
to authenticated
using(
  public.can_access_collaboration_space(space_id)
);

drop policy if exists
  "collaboration invites read"
on public.collaboration_invites;

create policy "collaboration invites read"
on public.collaboration_invites
for select
to authenticated
using(
  inviter_id=auth.uid()
  or invitee_id=auth.uid()
  or public.has_workspace_role(
    array['manager','admin']
  )
);

drop policy if exists
  "collaboration messages read"
on public.collaboration_messages;

create policy "collaboration messages read"
on public.collaboration_messages
for select
to authenticated
using(
  public.can_access_collaboration_space(space_id)
);

drop policy if exists
  "collaboration messages create"
on public.collaboration_messages;

create policy "collaboration messages create"
on public.collaboration_messages
for insert
to authenticated
with check(
  author_id=auth.uid()
  and public.can_access_collaboration_space(space_id)
);

drop policy if exists
  "collaboration messages update own"
on public.collaboration_messages;

create policy "collaboration messages update own"
on public.collaboration_messages
for update
to authenticated
using(
  author_id=auth.uid()
  and public.can_access_collaboration_space(space_id)
)
with check(
  author_id=auth.uid()
  and public.can_access_collaboration_space(space_id)
);

drop policy if exists
  "collaboration messages delete own"
on public.collaboration_messages;

create policy "collaboration messages delete own"
on public.collaboration_messages
for delete
to authenticated
using(
  author_id=auth.uid()
);

-- ----------------------------------------------------------
-- GRANTS
-- ----------------------------------------------------------

revoke all
on public.collaboration_spaces,
   public.collaboration_space_members,
   public.collaboration_invites,
   public.collaboration_messages
from anon;

revoke all
on public.collaboration_spaces,
   public.collaboration_space_members,
   public.collaboration_invites,
   public.collaboration_messages
from authenticated;

grant select
on public.collaboration_spaces,
   public.collaboration_space_members,
   public.collaboration_invites
to authenticated;

grant select,insert,update,delete
on public.collaboration_messages
to authenticated;

-- ----------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------

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
      where
        pubname='supabase_realtime'
        and schemaname='public'
        and tablename='collaboration_messages'
    ) then
      alter publication supabase_realtime
        add table public.collaboration_messages;
    end if;

    if not exists(
      select 1
      from pg_publication_tables
      where
        pubname='supabase_realtime'
        and schemaname='public'
        and tablename='collaboration_invites'
    ) then
      alter publication supabase_realtime
        add table public.collaboration_invites;
    end if;

  end if;
end;
$$;

commit;
