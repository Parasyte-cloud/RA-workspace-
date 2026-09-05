begin;

-- ============================================================
-- RideArrivo Workspace Unification
--
-- 1. Private department discussion
-- 2. Cross-department collaboration = exactly two departments
-- 3. No global role bypass into collaboration content
-- 4. Department -> Finance -> Executive -> execution workflow
-- 5. Employee self device/session access
-- 6. Admin-only company-wide device/session inventory
--
-- This migration contains no automatic external-payment execution.
-- ============================================================


-- ============================================================
-- COLLABORATION: EXACTLY TWO DEPARTMENTS
-- ============================================================

create table if not exists
public.collaboration_space_departments (
  space_id uuid not null
    references public.collaboration_spaces(id)
    on delete cascade,
  department text not null,
  ordinal smallint not null
    check (ordinal in (1,2)),
  added_at timestamptz not null default now(),
  primary key(space_id,department),
  unique(space_id,ordinal),
  check (
    length(trim(department)) between 2 and 120
    and department=lower(trim(department))
  )
);

create index if not exists
  collaboration_space_departments_department_idx
on public.collaboration_space_departments(department);


-- Existing cross-department spaces that do not already represent exactly
-- two active departments are preserved as ordinary explicit-member projects.
-- We do not guess a second department or silently broaden access.

with department_counts as (
  select
    s.id,
    count(
      distinct lower(trim(p.department))
    ) filter (
      where
        p.active=true
        and nullif(trim(coalesce(p.department,'')),'') is not null
    ) as department_count
  from public.collaboration_spaces s
  left join public.collaboration_space_members m
    on m.space_id=s.id
  left join public.employee_profiles p
    on p.id=m.user_id
  where s.space_type='cross_department'
  group by s.id
)
update public.collaboration_spaces s
set
  space_type='project',
  home_department=coalesce(
    nullif(trim(s.home_department),''),
    s.home_department
  )
from department_counts c
where
  s.id=c.id
  and c.department_count<>2;


-- Backfill the department boundary for valid legacy two-department spaces.

with distinct_departments as (
  select distinct
    s.id as space_id,
    lower(trim(p.department)) as department
  from public.collaboration_spaces s
  join public.collaboration_space_members m
    on m.space_id=s.id
  join public.employee_profiles p
    on p.id=m.user_id
  where
    s.space_type='cross_department'
    and p.active=true
    and nullif(trim(coalesce(p.department,'')),'') is not null
),
ranked as (
  select
    space_id,
    department,
    row_number() over (
      partition by space_id
      order by department
    )::smallint as ordinal
  from distinct_departments
)
insert into public.collaboration_space_departments(
  space_id,
  department,
  ordinal
)
select
  space_id,
  department,
  ordinal
from ranked
where ordinal<=2
on conflict do nothing;


-- Remove stale membership from two-department spaces.

delete from public.collaboration_space_members m
using public.collaboration_spaces s
where
  s.id=m.space_id
  and s.space_type='cross_department'
  and not exists(
    select 1
    from public.employee_profiles p
    join public.collaboration_space_departments d
      on d.space_id=m.space_id
      and d.department=
        lower(trim(coalesce(p.department,'')))
    where
      p.id=m.user_id
      and p.active=true
  );


-- Every active employee in either participating department is a member.

insert into public.collaboration_space_members(
  space_id,
  user_id,
  member_role,
  added_by
)
select
  d.space_id,
  p.id,
  case
    when p.id=s.created_by then 'owner'
    else 'member'
  end,
  s.created_by
from public.collaboration_space_departments d
join public.collaboration_spaces s
  on s.id=d.space_id
  and s.space_type='cross_department'
join public.employee_profiles p
  on
    p.active=true
    and lower(trim(coalesce(p.department,'')))=d.department
on conflict(space_id,user_id) do nothing;


-- Ensure every valid two-team workspace retains an explicit manager.

with unmanaged as (
  select s.id
  from public.collaboration_spaces s
  where
    s.space_type='cross_department'
    and not exists(
      select 1
      from public.collaboration_space_members m
      where
        m.space_id=s.id
        and m.member_role in ('owner','admin')
    )
),
candidate as (
  select distinct on (m.space_id)
    m.space_id,
    m.user_id
  from public.collaboration_space_members m
  join unmanaged u
    on u.id=m.space_id
  order by
    m.space_id,
    m.joined_at,
    m.user_id
)
update public.collaboration_space_members m
set member_role='owner'
from candidate c
where
  m.space_id=c.space_id
  and m.user_id=c.user_id;


create or replace function
public.enforce_two_department_collaboration()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_space uuid;
  v_count integer;
begin
  if tg_table_name='collaboration_spaces' then
    if tg_op='DELETE' then
      v_space:=old.id;
    else
      v_space:=new.id;
    end if;
  else
    if tg_op='DELETE' then
      v_space:=old.space_id;
    else
      v_space:=new.space_id;
    end if;
  end if;

  if not exists(
    select 1
    from public.collaboration_spaces s
    where
      s.id=v_space
      and s.space_type='cross_department'
  ) then
    return null;
  end if;

  select count(*)
  into v_count
  from public.collaboration_space_departments d
  where d.space_id=v_space;

  if v_count<>2 then
    raise exception
      'Cross-department collaboration must contain exactly two departments';
  end if;

  return null;
end;
$$;

drop trigger if exists
  collaboration_spaces_exact_two_departments
on public.collaboration_spaces;

create constraint trigger
  collaboration_spaces_exact_two_departments
after insert or update or delete
on public.collaboration_spaces
deferrable initially deferred
for each row
execute function
  public.enforce_two_department_collaboration();

drop trigger if exists
  collaboration_department_map_exact_two
on public.collaboration_space_departments;

create constraint trigger
  collaboration_department_map_exact_two
after insert or update or delete
on public.collaboration_space_departments
deferrable initially deferred
for each row
execute function
  public.enforce_two_department_collaboration();


-- Prevent removal of an active employee who still belongs to one of
-- the two participating departments. Membership follows department,
-- not an individual invitation.

create or replace function
public.guard_two_department_membership()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_space uuid;
  v_user uuid;
begin
  if tg_op='DELETE' then
    v_space:=old.space_id;
    v_user:=old.user_id;
  else
    v_space:=new.space_id;
    v_user:=new.user_id;
  end if;

  if not exists(
    select 1
    from public.collaboration_spaces s
    where
      s.id=v_space
      and s.space_type='cross_department'
  ) then
    if tg_op='DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op='DELETE' then
    if exists(
      select 1
      from public.employee_profiles p
      join public.collaboration_space_departments d
        on
          d.space_id=v_space
          and d.department=
            lower(trim(coalesce(p.department,'')))
      where
        p.id=v_user
        and p.active=true
    ) then
      raise exception
        'Two-department collaboration membership follows department assignment';
    end if;

    return old;
  end if;

  if not exists(
    select 1
    from public.employee_profiles p
    join public.collaboration_space_departments d
      on
        d.space_id=v_space
        and d.department=
          lower(trim(coalesce(p.department,'')))
    where
      p.id=v_user
      and p.active=true
  ) then
    raise exception
      'Employee does not belong to either collaboration department';
  end if;

  return new;
end;
$$;

drop trigger if exists
  collaboration_two_department_member_guard
on public.collaboration_space_members;

create trigger
  collaboration_two_department_member_guard
before insert or update or delete
on public.collaboration_space_members
for each row
execute function
  public.guard_two_department_membership();


-- ============================================================
-- CONTENT ACCESS
--
-- No Manager/Admin global collaboration-content bypass.
-- ============================================================

create or replace function
public.can_access_collaboration_space(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.collaboration_spaces s
      on s.id=target_space
    where
      me.id=auth.uid()
      and me.active=true
      and s.archived_at is null
      and (
        (
          s.space_type='department'
          and nullif(
            lower(trim(coalesce(me.department,''))),
            ''
          ) is not null
          and lower(trim(coalesce(me.department,'')))=
              lower(trim(coalesce(s.home_department,'')))
        )
        or
        (
          s.space_type='cross_department'
          and (
            select count(*)
            from public.collaboration_space_departments d
            where d.space_id=s.id
          )=2
          and exists(
            select 1
            from public.collaboration_space_departments d
            where
              d.space_id=s.id
              and d.department=
                lower(trim(coalesce(me.department,'')))
          )
        )
        or
        (
          s.space_type='project'
          and exists(
            select 1
            from public.collaboration_space_members m
            where
              m.space_id=s.id
              and m.user_id=me.id
          )
        )
      )
  );
$$;

revoke all
on function public.can_access_collaboration_space(uuid)
from public;

grant execute
on function public.can_access_collaboration_space(uuid)
to authenticated;


create or replace function
public.can_view_collaboration_space_metadata(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.can_access_collaboration_space(target_space)
    or exists(
      select 1
      from public.collaboration_invites i
      where
        i.space_id=target_space
        and i.invitee_id=auth.uid()
        and i.status='pending'
    );
$$;

revoke all
on function
  public.can_view_collaboration_space_metadata(uuid)
from public;

grant execute
on function
  public.can_view_collaboration_space_metadata(uuid)
to authenticated;


create or replace function
public.can_manage_collaboration_space(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.collaboration_space_members m
      on
        m.user_id=me.id
        and m.space_id=target_space
    join public.collaboration_spaces s
      on s.id=m.space_id
    where
      me.id=auth.uid()
      and me.active=true
      and s.archived_at is null
      and m.member_role in ('owner','admin')
  );
$$;

revoke all
on function public.can_manage_collaboration_space(uuid)
from public;

grant execute
on function public.can_manage_collaboration_space(uuid)
to authenticated;


-- ============================================================
-- PROJECT CREATION
--
-- Ordinary projects remain explicit-member and same-department.
-- Cross-department work must use the two-team RPC.
-- ============================================================

create or replace function
public.create_collaboration_space(
  p_name text,
  p_description text default null,
  p_space_type text default 'project'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  me public.employee_profiles%rowtype;
  v_space uuid;
begin
  select *
  into me
  from public.employee_profiles
  where
    id=auth.uid()
    and active=true;

  if not found then
    raise exception
      'Active workspace profile required';
  end if;

  if p_space_type<>'project' then
    raise exception
      'Cross-department work must use the two-department collaboration workflow';
  end if;

  if length(trim(coalesce(p_name,'')))<2 then
    raise exception
      'Workspace name is required';
  end if;

  insert into public.collaboration_spaces(
    name,
    description,
    space_type,
    home_department,
    created_by
  )
  values(
    trim(p_name),
    nullif(trim(coalesce(p_description,'')),''),
    'project',
    nullif(trim(coalesce(me.department,'')),''),
    me.id
  )
  returning id
  into v_space;

  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  values(
    v_space,
    me.id,
    'owner',
    me.id
  );

  return v_space;
end;
$$;

revoke all
on function
  public.create_collaboration_space(text,text,text)
from public;

grant execute
on function
  public.create_collaboration_space(text,text,text)
to authenticated;


create or replace function
public.create_two_department_collaboration(
  p_name text,
  p_description text,
  p_partner_department text
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  me public.employee_profiles%rowtype;
  v_space uuid;
  v_home text;
  v_partner text;
begin
  select *
  into me
  from public.employee_profiles
  where
    id=auth.uid()
    and active=true;

  if not found then
    raise exception
      'Active workspace profile required';
  end if;

  v_home=
    lower(trim(coalesce(me.department,'')));

  v_partner=
    lower(trim(coalesce(p_partner_department,'')));

  if v_home='' then
    raise exception
      'Your employee profile requires a department';
  end if;

  if v_partner='' then
    raise exception
      'Partner department is required';
  end if;

  if v_partner=v_home then
    raise exception
      'Partner department must be different from your department';
  end if;

  if not exists(
    select 1
    from public.employee_profiles p
    where
      p.active=true
      and lower(trim(coalesce(p.department,'')))=
          v_partner
  ) then
    raise exception
      'Partner department has no active employees';
  end if;

  if length(trim(coalesce(p_name,'')))<2 then
    raise exception
      'Collaboration name is required';
  end if;

  insert into public.collaboration_spaces(
    name,
    description,
    space_type,
    home_department,
    created_by
  )
  values(
    trim(p_name),
    nullif(trim(coalesce(p_description,'')),''),
    'cross_department',
    me.department,
    me.id
  )
  returning id
  into v_space;

  insert into public.collaboration_space_departments(
    space_id,
    department,
    ordinal
  )
  values
    (v_space,v_home,1),
    (v_space,v_partner,2);

  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  select
    v_space,
    p.id,
    case
      when p.id=me.id then 'owner'
      else 'member'
    end,
    me.id
  from public.employee_profiles p
  where
    p.active=true
    and lower(trim(coalesce(p.department,'')))
      in (v_home,v_partner)
  on conflict(space_id,user_id) do nothing;

  return v_space;
end;
$$;

revoke all
on function
  public.create_two_department_collaboration(text,text,text)
from public;

grant execute
on function
  public.create_two_department_collaboration(text,text,text)
to authenticated;


-- ============================================================
-- INDIVIDUAL INVITATIONS
--
-- Individual invitations are for same-department project spaces only.
-- They cannot create cross-department authority.
-- ============================================================

update public.collaboration_invites i
set
  status='cancelled',
  responded_at=coalesce(i.responded_at,now())
from
  public.collaboration_spaces s,
  public.employee_profiles inviter,
  public.employee_profiles invitee
where
  i.space_id=s.id
  and inviter.id=i.inviter_id
  and invitee.id=i.invitee_id
  and i.status='pending'
  and (
    s.space_type<>'project'
    or lower(trim(coalesce(inviter.department,'')))
       <>
       lower(trim(coalesce(invitee.department,'')))
  );


create or replace function
public.invite_to_collaboration_space(
  p_space_id uuid,
  p_invitee_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  invite_id uuid;
  space_name text;
  space_kind text;
  inviter_department text;
  invitee_department text;
  inviter_member_role text;
begin
  select
    s.name,
    s.space_type
  into
    space_name,
    space_kind
  from public.collaboration_spaces s
  where
    s.id=p_space_id
    and s.archived_at is null;

  if not found then
    raise exception
      'Workspace not found';
  end if;

  if space_kind<>'project' then
    raise exception
      'Individual invitations cannot grant cross-department collaboration access';
  end if;

  select
    p.department,
    m.member_role
  into
    inviter_department,
    inviter_member_role
  from public.employee_profiles p
  join public.collaboration_space_members m
    on
      m.user_id=p.id
      and m.space_id=p_space_id
  where
    p.id=auth.uid()
    and p.active=true;

  if not found
     or inviter_member_role not in (
       'owner',
       'admin',
       'member'
     )
  then
    raise exception
      'You cannot invite employees to this project';
  end if;

  if p_invitee_id=auth.uid() then
    raise exception
      'You are already in this workspace';
  end if;

  select department
  into invitee_department
  from public.employee_profiles
  where
    id=p_invitee_id
    and active=true;

  if not found then
    raise exception
      'Invitee is not an active employee';
  end if;

  if
    nullif(
      lower(trim(coalesce(inviter_department,''))),
      ''
    ) is null
    or
    lower(trim(coalesce(inviter_department,'')))
    <>
    lower(trim(coalesce(invitee_department,'')))
  then
    raise exception
      'Individual project invitations must remain within one department; use a two-department collaboration instead';
  end if;

  if exists(
    select 1
    from public.collaboration_space_members
    where
      space_id=p_space_id
      and user_id=p_invitee_id
  ) then
    raise exception
      'Employee is already a workspace member';
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
  returning id
  into invite_id;

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
    'You were invited to ' || space_name,
    'collaboration_space',
    p_space_id
  );

  return invite_id;
end;
$$;

revoke all
on function
  public.invite_to_collaboration_space(uuid,uuid,text)
from public;

grant execute
on function
  public.invite_to_collaboration_space(uuid,uuid,text)
to authenticated;


-- ============================================================
-- KEEP TWO-DEPARTMENT ROSTERS SYNCHRONISED
-- ============================================================

create or replace function
public.sync_two_department_collaboration_members()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid;
begin
  if tg_op='DELETE' then
    v_user:=old.id;
  else
    v_user:=new.id;
  end if;

  delete from public.collaboration_space_members m
  using public.collaboration_spaces s
  where
    m.user_id=v_user
    and s.id=m.space_id
    and s.space_type='cross_department'
    and not exists(
      select 1
      from public.employee_profiles p
      join public.collaboration_space_departments d
        on
          d.space_id=m.space_id
          and d.department=
            lower(trim(coalesce(p.department,'')))
      where
        p.id=m.user_id
        and p.active=true
    );

  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  select
    d.space_id,
    p.id,
    case
      when p.id=s.created_by then 'owner'
      else 'member'
    end,
    s.created_by
  from public.employee_profiles p
  join public.collaboration_space_departments d
    on d.department=
      lower(trim(coalesce(p.department,'')))
  join public.collaboration_spaces s
    on
      s.id=d.space_id
      and s.space_type='cross_department'
      and s.archived_at is null
  where
    p.id=v_user
    and p.active=true
  on conflict(space_id,user_id) do nothing;

  with unmanaged as (
    select s.id
    from public.collaboration_spaces s
    where
      s.space_type='cross_department'
      and s.archived_at is null
      and not exists(
        select 1
        from public.collaboration_space_members m
        where
          m.space_id=s.id
          and m.member_role in ('owner','admin')
      )
  ),
  candidate as (
    select distinct on (m.space_id)
      m.space_id,
      m.user_id
    from public.collaboration_space_members m
    join unmanaged u
      on u.id=m.space_id
    order by
      m.space_id,
      m.joined_at,
      m.user_id
  )
  update public.collaboration_space_members m
  set member_role='owner'
  from candidate c
  where
    m.space_id=c.space_id
    and m.user_id=c.user_id;

  if tg_op='DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists
  sync_two_department_collaboration_members_insert_delete
on public.employee_profiles;

create trigger
  sync_two_department_collaboration_members_insert_delete
after insert or delete
on public.employee_profiles
for each row
execute function
  public.sync_two_department_collaboration_members();

drop trigger if exists
  sync_two_department_collaboration_members_update
on public.employee_profiles;

create trigger
  sync_two_department_collaboration_members_update
after update of department,active
on public.employee_profiles
for each row
execute function
  public.sync_two_department_collaboration_members();


-- ============================================================
-- COLLABORATION RLS
-- ============================================================

alter table public.collaboration_spaces
  enable row level security;

alter table public.collaboration_space_members
  enable row level security;

alter table public.collaboration_invites
  enable row level security;

alter table public.collaboration_messages
  enable row level security;

alter table public.collaboration_space_departments
  enable row level security;


do $$
declare
  policy_record record;
begin
  for policy_record in
    select
      tablename,
      policyname
    from pg_policies
    where
      schemaname='public'
      and tablename in (
        'collaboration_spaces',
        'collaboration_space_members',
        'collaboration_invites',
        'collaboration_messages',
        'collaboration_space_departments'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;


create policy
  "collaboration spaces authorised metadata read"
on public.collaboration_spaces
for select
to authenticated
using (
  public.can_view_collaboration_space_metadata(id)
);


create policy
  "collaboration members authorised read"
on public.collaboration_space_members
for select
to authenticated
using (
  public.can_access_collaboration_space(space_id)
);


create policy
  "collaboration invites participant read"
on public.collaboration_invites
for select
to authenticated
using (
  inviter_id=auth.uid()
  or invitee_id=auth.uid()
);


create policy
  "collaboration messages authorised read"
on public.collaboration_messages
for select
to authenticated
using (
  public.can_access_collaboration_space(space_id)
);


create policy
  "collaboration messages authorised insert"
on public.collaboration_messages
for insert
to authenticated
with check (
  author_id=auth.uid()
  and public.can_access_collaboration_space(space_id)
);


create policy
  "collaboration department map authorised read"
on public.collaboration_space_departments
for select
to authenticated
using (
  public.can_access_collaboration_space(space_id)
);


revoke all
on
  public.collaboration_spaces,
  public.collaboration_space_members,
  public.collaboration_invites,
  public.collaboration_messages,
  public.collaboration_space_departments
from anon;

revoke all
on
  public.collaboration_spaces,
  public.collaboration_space_members,
  public.collaboration_invites,
  public.collaboration_messages,
  public.collaboration_space_departments
from authenticated;

grant select
on
  public.collaboration_spaces,
  public.collaboration_space_members,
  public.collaboration_invites,
  public.collaboration_messages,
  public.collaboration_space_departments
to authenticated;

grant insert
on public.collaboration_messages
to authenticated;


-- ============================================================
-- DEPARTMENT -> FINANCE REQUEST PIPELINE
-- ============================================================

create table if not exists
public.department_finance_requests (
  id uuid primary key default gen_random_uuid(),

  request_code text not null unique,

  requester_id uuid not null
    references public.employee_profiles(id),

  requesting_department text not null,

  title text not null
    check(length(trim(title)) between 2 and 160),

  purpose text not null
    check(length(trim(purpose)) between 2 and 4000),

  category text not null
    check(length(trim(category)) between 2 and 80),

  amount numeric(14,2) not null
    check(amount>0),

  currency text not null default 'NGN'
    check(currency='NGN'),

  needed_by date,

  idempotency_key text not null unique
    check(
      length(trim(idempotency_key))
        between 8 and 200
    ),

  status text not null default 'submitted'
    check(
      status in (
        'submitted',
        'finance_reviewed',
        'finance_rejected',
        'executive_approved',
        'executive_rejected',
        'executing',
        'executed',
        'execution_failed',
        'cancelled'
      )
    ),

  finance_reviewed_by uuid
    references public.employee_profiles(id),

  finance_reviewed_at timestamptz,

  finance_review_note text,

  executive_decided_by uuid
    references public.employee_profiles(id),

  executive_decided_at timestamptz,

  executive_note text,

  execution_by uuid
    references public.employee_profiles(id),

  execution_started_at timestamptz,

  execution_completed_at timestamptz,

  execution_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  department_finance_requests_department_idx
on public.department_finance_requests(
  requesting_department,
  created_at desc
);

create index if not exists
  department_finance_requests_status_idx
on public.department_finance_requests(
  status,
  created_at desc
);


-- ============================================================
-- APPEND-ONLY DEPARTMENT FINANCE REQUEST EVENT HISTORY
-- ============================================================

create table if not exists
public.department_finance_request_events (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null
    references public.department_finance_requests(id)
    on delete restrict,

  actor_id uuid
    references public.employee_profiles(id)
    on delete set null,

  event_type text not null
    check(
      event_type in (
        'submitted',
        'finance_reviewed',
        'finance_rejected',
        'executive_approved',
        'executive_rejected',
        'executing',
        'executed',
        'execution_failed',
        'cancelled'
      )
    ),

  previous_status text,

  new_status text not null,

  note text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists
department_finance_request_events_request_idx
on public.department_finance_request_events(
  request_id,
  created_at desc
);

create index if not exists
department_finance_request_events_actor_idx
on public.department_finance_request_events(
  actor_id,
  created_at desc
);

comment on table
public.department_finance_request_events
is
  'Append-only governed history of department Finance request lifecycle transitions.';

create or replace function
public.prevent_department_finance_request_event_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception
    'Finance request event history is append-only'
    using errcode='55000';

  return null;
end;
$$;

revoke all on function
public.prevent_department_finance_request_event_mutation()
from public,anon,authenticated;

drop trigger if exists
  department_finance_request_events_append_only
on public.department_finance_request_events;

create trigger
  department_finance_request_events_append_only
before update or delete
on public.department_finance_request_events
for each row
execute function
  public.prevent_department_finance_request_event_mutation();


create or replace function
public.touch_department_finance_request()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists
  department_finance_requests_touch
on public.department_finance_requests;

create trigger
  department_finance_requests_touch
before update
on public.department_finance_requests
for each row
execute function
  public.touch_department_finance_request();


create or replace function
public.is_finance_request_operator()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    where
      me.id=auth.uid()
      and me.active=true
      and (
        me.role='finance'
        or exists(
          select 1
          from public.workspace_workstation_assignments a
          where
            a.employee_id=me.id
            and a.workstation='finance'
            and a.active=true
        )
      )
  );
$$;

revoke all
on function public.is_finance_request_operator()
from public;

grant execute
on function public.is_finance_request_operator()
to authenticated;


create or replace function
public.can_read_department_finance_request(
  target_request uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.department_finance_requests r
      on r.id=target_request
    where
      me.id=auth.uid()
      and me.active=true
      and (
        lower(trim(coalesce(me.department,'')))=
          lower(trim(coalesce(r.requesting_department,'')))
        or public.is_finance_request_operator()
        or me.role in ('manager','admin')
      )
  );
$$;

revoke all
on function
  public.can_read_department_finance_request(uuid)
from public;

grant execute
on function
  public.can_read_department_finance_request(uuid)
to authenticated;


create or replace function
public.submit_department_finance_request(
  p_title text,
  p_purpose text,
  p_category text,
  p_amount numeric,
  p_idempotency_key text,
  p_needed_by date default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  me public.employee_profiles%rowtype;
  v_request uuid;
  v_code text;
  v_category text;
  v_idempotency_key text;
  v_existing public.department_finance_requests%rowtype;
begin
  select *
  into me
  from public.employee_profiles
  where
    id=auth.uid()
    and active=true;

  if not found then
    raise exception
      'Active employee profile required';
  end if;

  if nullif(trim(coalesce(me.department,'')),'') is null then
    raise exception
      'Your employee profile requires a department';
  end if;

  if length(trim(coalesce(p_title,'')))<2 then
    raise exception
      'Request title is required';
  end if;

  if length(trim(coalesce(p_purpose,'')))<2 then
    raise exception
      'Request purpose is required';
  end if;

  if p_amount is null or p_amount<=0 then
    raise exception
      'Request amount must be greater than zero';
  end if;

  v_idempotency_key=
    trim(coalesce(p_idempotency_key,''));

  if length(v_idempotency_key) not between 8 and 200 then
    raise exception
      'Finance request idempotency key is invalid'
      using errcode='22023';
  end if;

  v_category=
    lower(
      trim(
        coalesce(
          nullif(p_category,''),
          'other'
        )
      )
    );

  v_code=
    'FIN-'
    || to_char(clock_timestamp(),'YYYYMMDD')
    || '-'
    || upper(
      substr(
        replace(gen_random_uuid()::text,'-',''),
        1,
        8
      )
    );

  insert into public.department_finance_requests(
    request_code,
    requester_id,
    requesting_department,
    title,
    purpose,
    category,
    amount,
    needed_by,
    idempotency_key
  )
  values(
    v_code,
    me.id,
    me.department,
    trim(p_title),
    trim(p_purpose),
    v_category,
    p_amount,
    p_needed_by,
    v_idempotency_key
  )
  on conflict (idempotency_key)
  do nothing
  returning id
  into v_request;

  if v_request is null then
    select *
    into v_existing
    from public.department_finance_requests
    where idempotency_key=v_idempotency_key;

    if not found then
      raise exception
        'Finance idempotency conflict could not be resolved';
    end if;

    if (
      v_existing.requester_id=me.id
      and lower(
        trim(v_existing.requesting_department)
      )=lower(
        trim(me.department)
      )
      and v_existing.title=trim(p_title)
      and v_existing.purpose=trim(p_purpose)
      and v_existing.category=v_category
      and v_existing.amount=round(p_amount,2)
      and v_existing.needed_by
        is not distinct from p_needed_by
    ) then
      return v_existing.id;
    end if;

    raise exception
      'Finance idempotency key is already bound to another request'
      using errcode='23505';
  end if;

  insert into public.department_finance_request_events(
    request_id,
    actor_id,
    event_type,
    previous_status,
    new_status,
    metadata
  )
  values(
    v_request,
    auth.uid(),
    'submitted',
    null,
    'submitted',
    jsonb_build_object(
      'request_code',
      v_code,
      'requesting_department',
      me.department,
      'category',
      v_category,
      'amount',
      p_amount,
      'needed_by',
      p_needed_by
    )
  );

  return v_request;
end;
$$;

revoke all
on function
  public.submit_department_finance_request(
    text,
    text,
    text,
    numeric,
    text,
    date
  )
from public;

grant execute
on function
  public.submit_department_finance_request(
    text,
    text,
    text,
    numeric,
    text,
    date
  )
to authenticated;


create or replace function
public.finance_review_department_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  request_row public.department_finance_requests%rowtype;
begin
  if not public.is_finance_request_operator() then
    raise exception
      'Finance workstation authority required';
  end if;

  select *
  into request_row
  from public.department_finance_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Finance request not found';
  end if;

  -- The requester must not perform the independent
  -- Finance review of their own request.
  if request_row.requester_id=auth.uid() then
    raise exception
      'Requester cannot review their own finance request';
  end if;

  if request_row.status<>'submitted' then
    raise exception
      'Finance request is not awaiting Finance review';
  end if;

  update public.department_finance_requests
  set
    status=
      case
        when p_approve then 'finance_reviewed'
        else 'finance_rejected'
      end,
    finance_reviewed_by=auth.uid(),
    finance_reviewed_at=now(),
    finance_review_note=
      nullif(trim(coalesce(p_note,'')),'')
  where id=p_request_id;

  insert into public.department_finance_request_events(
    request_id,
    actor_id,
    event_type,
    previous_status,
    new_status,
    note,
    metadata
  )
  values(
    p_request_id,
    auth.uid(),
    case
      when p_approve then 'finance_reviewed'
      else 'finance_rejected'
    end,
    request_row.status,
    case
      when p_approve then 'finance_reviewed'
      else 'finance_rejected'
    end,
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'approved',
      p_approve
    )
  );
end;
$$;

revoke all
on function
  public.finance_review_department_request(uuid,boolean,text)
from public;

grant execute
on function
  public.finance_review_department_request(uuid,boolean,text)
to authenticated;


create or replace function
public.executive_approve_department_finance_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  request_row public.department_finance_requests%rowtype;
begin
  if not exists(
    select 1
    from public.employee_profiles me
    where
      me.id=auth.uid()
      and me.active=true
      and me.role in ('manager','admin')
  ) then
    raise exception
      'Executive approval authority required';
  end if;

  select *
  into request_row
  from public.department_finance_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Finance request not found';
  end if;

  -- Executive approval must remain independent
  -- from both the requester and the Finance reviewer.
  if request_row.requester_id=auth.uid() then
    raise exception
      'Requester cannot provide executive approval '
      'for their own finance request';
  end if;

  if request_row.finance_reviewed_by=auth.uid() then
    raise exception
      'Finance reviewer cannot also provide '
      'executive approval';
  end if;

  if request_row.status<>'finance_reviewed' then
    raise exception
      'Finance review must be completed first';
  end if;

  update public.department_finance_requests
  set
    status=
      case
        when p_approve then 'executive_approved'
        else 'executive_rejected'
      end,
    executive_decided_by=auth.uid(),
    executive_decided_at=now(),
    executive_note=
      nullif(trim(coalesce(p_note,'')),'')
  where id=p_request_id;

  insert into public.department_finance_request_events(
    request_id,
    actor_id,
    event_type,
    previous_status,
    new_status,
    note,
    metadata
  )
  values(
    p_request_id,
    auth.uid(),
    case
      when p_approve then 'executive_approved'
      else 'executive_rejected'
    end,
    request_row.status,
    case
      when p_approve then 'executive_approved'
      else 'executive_rejected'
    end,
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'approved',
      p_approve
    )
  );
end;
$$;

revoke all
on function
  public.executive_approve_department_finance_request(
    uuid,
    boolean,
    text
  )
from public;

grant execute
on function
  public.executive_approve_department_finance_request(
    uuid,
    boolean,
    text
  )
to authenticated;


create or replace function
public.set_department_finance_execution_status(
  p_request_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  request_row public.department_finance_requests%rowtype;
begin
  if not public.is_finance_request_operator() then
    raise exception
      'Finance workstation authority required';
  end if;

  if p_status not in (
    'executing',
    'executed',
    'execution_failed'
  ) then
    raise exception
      'Invalid execution status';
  end if;

  select *
  into request_row
  from public.department_finance_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Finance request not found';
  end if;

  if
    p_status='executing'
    and request_row.status not in (
      'executive_approved',
      'execution_failed'
    )
  then
    raise exception
      'Request is not ready for Finance execution';
  end if;

  if
    p_status in ('executed','execution_failed')
    and request_row.status<>'executing'
  then
    raise exception
      'Execution must be started before completion';
  end if;

  update public.department_finance_requests
  set
    status=p_status,
    execution_by=auth.uid(),
    execution_started_at=
      case
        when p_status='executing'
          then now()
        else execution_started_at
      end,
    execution_completed_at=
      case
        when p_status in (
          'executed',
          'execution_failed'
        )
          then now()
        else null
      end,
    execution_note=
      nullif(trim(coalesce(p_note,'')),'')
  where id=p_request_id;

  insert into public.department_finance_request_events(
    request_id,
    actor_id,
    event_type,
    previous_status,
    new_status,
    note,
    metadata
  )
  values(
    p_request_id,
    auth.uid(),
    p_status,
    request_row.status,
    p_status,
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'execution_transition',
      true
    )
  );
end;
$$;

revoke all
on function
  public.set_department_finance_execution_status(
    uuid,
    text,
    text
  )
from public;

grant execute
on function
  public.set_department_finance_execution_status(
    uuid,
    text,
    text
  )
to authenticated;


alter table public.department_finance_requests
  enable row level security;

drop policy if exists
  "department finance request authorised read"
on public.department_finance_requests;

create policy
  "department finance request authorised read"
on public.department_finance_requests
for select
to authenticated
using (
  public.can_read_department_finance_request(id)
);

revoke all
on public.department_finance_requests
from anon;

revoke all
on public.department_finance_requests
from authenticated;

grant select
on public.department_finance_requests
to authenticated;


-- ============================================================
-- DEPARTMENT FINANCE EVENT HISTORY ACCESS
-- ============================================================

alter table
public.department_finance_request_events
enable row level security;

drop policy if exists
  "department finance request event authorised read"
on public.department_finance_request_events;

create policy
  "department finance request event authorised read"
on public.department_finance_request_events
for select
to authenticated
using (
  public.can_read_department_finance_request(request_id)
);

revoke all
on public.department_finance_request_events
from public,anon,authenticated;

grant select
on public.department_finance_request_events
to authenticated;



-- ============================================================
-- DEVICE / SESSION PRIVACY
--
-- Employee: own assigned assets and own browser sessions.
-- Administration: company-wide registry and sessions.
-- ============================================================

do $$
declare
  policy_record record;
begin
  for policy_record in
    select
      tablename,
      policyname
    from pg_policies
    where
      schemaname='public'
      and tablename in (
        'company_devices',
        'employee_device_sessions'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;


create policy
  "company devices assigned employee read"
on public.company_devices
for select
to authenticated
using (
  assigned_employee_id=auth.uid()
);


create policy
  "company devices admin read"
on public.company_devices
for select
to authenticated
using (
  public.current_workspace_role()='admin'
);


create policy
  "company devices admin insert"
on public.company_devices
for insert
to authenticated
with check (
  public.current_workspace_role()='admin'
);


create policy
  "company devices admin update"
on public.company_devices
for update
to authenticated
using (
  public.current_workspace_role()='admin'
)
with check (
  public.current_workspace_role()='admin'
);


create policy
  "company devices admin delete"
on public.company_devices
for delete
to authenticated
using (
  public.current_workspace_role()='admin'
);


create policy
  "device sessions self read"
on public.employee_device_sessions
for select
to authenticated
using (
  employee_id=auth.uid()
);


create policy
  "device sessions admin read"
on public.employee_device_sessions
for select
to authenticated
using (
  public.current_workspace_role()='admin'
);


create policy
  "device sessions self insert"
on public.employee_device_sessions
for insert
to authenticated
with check (
  employee_id=auth.uid()
);


create policy
  "device sessions self update"
on public.employee_device_sessions
for update
to authenticated
using (
  employee_id=auth.uid()
)
with check (
  employee_id=auth.uid()
);


revoke all
on
  public.company_devices,
  public.employee_device_sessions
from anon;

grant
  select,
  insert,
  update,
  delete
on public.company_devices
to authenticated;

grant
  select,
  insert,
  update
on public.employee_device_sessions
to authenticated;



-- ------------------------------------------------------------
-- CTO COMPANY-WIDE WORK DELEGATION
--
-- Manager, Admin, Operations and CTO may delegate ordinary
-- work to any active employee.
--
-- This is delegation authority only. It does not grant CTO,
-- Manager, Admin or Operations implicit access to project or
-- collaboration-linked content. Those boundaries remain
-- enforced separately by collaboration-space authorization.
-- ------------------------------------------------------------

create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
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
        me.role in (
          'manager',
          'admin',
          'operations',
          'cto'
        )
        or target.id=me.id
      )
  );
$$;

revoke all
on function public.can_assign_work(uuid)
from public,anon;

grant execute
on function public.can_assign_work(uuid)
to authenticated;


-- ------------------------------------------------------------
-- LINKED CONTENT AUTHORIZATION HARDENING
--
-- Collaboration-space boundaries are authoritative for
-- project-linked work and marketing content.
--
-- Global workspace roles may support company-wide delegation,
-- but they do not implicitly grant read, edit, or mutation
-- access to collaboration-linked content.
-- ------------------------------------------------------------

create or replace function public.can_read_work_item(
  target_work_item uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.work_items w
    where
      w.id=target_work_item
      and (
        (
          w.project_space_id is null
          and (
            w.created_by=auth.uid()
            or exists(
              select 1
              from public.work_item_assignees a
              where
                a.work_item_id=w.id
                and a.assignee_id=auth.uid()
            )
            or public.has_workspace_role(
              array['manager','admin']
            )
          )
        )
        or
        (
          w.project_space_id is not null
          and public.can_access_collaboration_space(
            w.project_space_id
          )
        )
      )
  );
$$;

revoke all
on function public.can_read_work_item(uuid)
from public;

grant execute
on function public.can_read_work_item(uuid)
to authenticated;

create or replace function public.set_project_work_status(
  p_work_item uuid,
  p_status text,
  p_rank bigint default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  item public.work_items%rowtype;
  my_member_role text;
begin
  if p_status not in (
    'draft',
    'assigned',
    'in_progress',
    'blocked',
    'review',
    'completed',
    'cancelled'
  ) then
    raise exception 'Invalid work status';
  end if;

  select *
  into item
  from public.work_items
  where id=p_work_item;

  if
    not found
    or item.project_space_id is null
  then
    raise exception 'Project card not found';
  end if;

  if not public.can_access_collaboration_space(
    item.project_space_id
  ) then
    raise exception 'Project access required';
  end if;

  select m.member_role
  into my_member_role
  from public.collaboration_space_members m
  where
    m.space_id=item.project_space_id
    and m.user_id=auth.uid();

  if not (
    item.created_by=auth.uid()
    or exists(
      select 1
      from public.work_item_assignees a
      where
        a.work_item_id=item.id
        and a.assignee_id=auth.uid()
    )
    or coalesce(
      my_member_role,
      'viewer'
    ) in (
      'owner',
      'admin'
    )
  ) then
    raise exception
      'You are not allowed to move this project card';
  end if;

  update public.work_items
  set
    status=p_status,
    kanban_rank=coalesce(
      p_rank,
      kanban_rank
    ),
    completed_at=
      case
        when p_status='completed'
          then coalesce(
            completed_at,
            now()
          )
        else null
      end
  where id=p_work_item;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    p_work_item,
    auth.uid(),
    'project_card_status_changed',
    jsonb_build_object(
      'from',
      item.status,
      'to',
      p_status,
      'project_space_id',
      item.project_space_id
    )
  );
end;
$$;

revoke all
on function public.set_project_work_status(
  uuid,
  text,
  bigint
)
from public;

grant execute
on function public.set_project_work_status(
  uuid,
  text,
  bigint
)
to authenticated;

create or replace function
public.can_edit_marketing_mood_board_space(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    exists(
      select 1
      from public.employee_profiles me
      where
        me.id=auth.uid()
        and me.active=true
    )
    and
    public.can_access_collaboration_space(
      target_space
    )
    and
    exists(
      select 1
      from public.collaboration_spaces s
      where
        s.id=target_space
        and s.archived_at is null
        and (
          s.space_type='department'
          or exists(
            select 1
            from public.collaboration_space_members m
            where
              m.space_id=s.id
              and m.user_id=auth.uid()
              and m.member_role in (
                'owner',
                'admin',
                'member'
              )
          )
        )
    );
$$;

revoke all
on function public.can_edit_marketing_mood_board_space(
  uuid
)
from public;

grant execute
on function public.can_edit_marketing_mood_board_space(
  uuid
)
to authenticated;

-- ------------------------------------------------------------
-- CLIENT FUNCTION EXECUTE HARDENING
--
-- Public workspace functions are deny-by-default for anonymous
-- callers. Existing authenticated and service-role grants remain
-- intact; browser RPC access must be explicitly granted.
--
-- PostgreSQL grants EXECUTE to PUBLIC on new functions by
-- built-in default, so both the global PUBLIC default and the
-- public-schema anon/authenticated defaults must be removed.
-- ------------------------------------------------------------

revoke execute
on all functions in schema public
from public, anon;

alter default privileges
for role postgres
revoke execute
on functions
from public;

alter default privileges
for role postgres
in schema public
revoke execute
on functions
from anon, authenticated;

-- ------------------------------------------------------------
-- CLIENT TABLE PRIVILEGE HARDENING
--
-- PostgreSQL row-level security governs row operations but does
-- not make table-administration privileges such as TRUNCATE safe
-- for browser/client roles.
--
-- Keep application CRUD governed by each table's existing grants
-- and RLS policies, while removing privileges that application
-- clients do not require.
--
-- This also hardens the postgres-owned public-table default ACL
-- so future project migrations do not silently restore them.
-- ------------------------------------------------------------

revoke truncate, references, trigger
on all tables in schema public
from anon, authenticated;

-- MAINTAIN is a table privilege on PostgreSQL versions that
-- support it. Use dynamic SQL so the migration remains compatible
-- with servers that predate the privilege.
do $$
begin
  if
    current_setting(
      'server_version_num'
    )::integer >= 170000
  then
    execute
      'revoke maintain '
      'on all tables in schema public '
      'from anon, authenticated';
  end if;
end;
$$;

alter default privileges
for role postgres
in schema public
revoke truncate, references, trigger
on tables
from anon, authenticated;

do $$
begin
  if
    current_setting(
      'server_version_num'
    )::integer >= 170000
  then
    execute
      'alter default privileges '
      'for role postgres '
      'in schema public '
      'revoke maintain '
      'on tables '
      'from anon, authenticated';
  end if;
end;
$$;

commit;
