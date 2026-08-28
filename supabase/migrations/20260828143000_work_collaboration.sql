-- ============================================================
-- RideArrivo Work Collaboration
-- Multiple assignees, watchers, attachments and escalation
-- ============================================================

begin;

-- ------------------------------------------------------------
-- WATCHERS
-- ------------------------------------------------------------

create table if not exists public.work_item_watchers (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  added_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  created_at timestamptz not null default now(),

  unique(work_item_id,user_id)
);

create index if not exists
  idx_work_watchers_user
on public.work_item_watchers(user_id);

create index if not exists
  idx_work_watchers_item
on public.work_item_watchers(work_item_id);


-- ------------------------------------------------------------
-- ATTACHMENTS
-- ------------------------------------------------------------

create table if not exists public.work_item_attachments (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  uploaded_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,

  created_at timestamptz not null default now()
);

create index if not exists
  idx_work_attachments_item
on public.work_item_attachments(
  work_item_id,
  created_at
);


-- ------------------------------------------------------------
-- ESCALATION
-- ------------------------------------------------------------

alter table public.work_items
  add column if not exists escalation_level integer
    not null default 0
    check (
      escalation_level between 0 and 5
    );

alter table public.work_items
  add column if not exists escalated_at timestamptz;

alter table public.work_items
  add column if not exists escalation_reason text;


-- ------------------------------------------------------------
-- ACCESS HELPER
--
-- Work is visible if:
-- creator
-- assignee
-- watcher
-- manager/admin
-- ------------------------------------------------------------

create or replace function public.can_read_work_item(
  target_work_item uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.work_items w
    where
      w.id = target_work_item
      and (
        w.created_by = auth.uid()

        or exists(
          select 1
          from public.work_item_assignees a
          where
            a.work_item_id = w.id
            and a.assignee_id = auth.uid()
        )

        or exists(
          select 1
          from public.work_item_watchers wt
          where
            wt.work_item_id = w.id
            and wt.user_id = auth.uid()
        )

        or public.has_workspace_role(
          array['manager','admin']
        )
      )
  );
$$;


-- ------------------------------------------------------------
-- ADD ASSIGNEE
-- ------------------------------------------------------------

create or replace function public.add_work_assignee(
  target_work_item uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_read_work_item(target_work_item) then
    raise exception 'Work item not accessible';
  end if;

  if not public.can_assign_work(target_user) then
    raise exception
      'You cannot assign work to this employee';
  end if;

  insert into public.work_item_assignees(
    work_item_id,
    assignee_id,
    assigned_by
  )
  values(
    target_work_item,
    target_user,
    actor
  )
  on conflict(
    work_item_id,
    assignee_id
  )
  do nothing;
end;
$$;

revoke all
on function public.add_work_assignee(uuid,uuid)
from public;

grant execute
on function public.add_work_assignee(uuid,uuid)
to authenticated;


-- ------------------------------------------------------------
-- REMOVE ASSIGNEE
-- Creator / Manager / Admin only.
-- ------------------------------------------------------------

create or replace function public.remove_work_assignee(
  target_work_item uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  creator uuid;
begin
  actor := auth.uid();

  select created_by
  into creator
  from public.work_items
  where id = target_work_item;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if not (
    actor = creator
    or public.has_workspace_role(
      array['manager','admin']
    )
  ) then
    raise exception
      'You cannot remove assignees from this work item';
  end if;

  delete from public.work_item_assignees
  where
    work_item_id = target_work_item
    and assignee_id = target_user;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    actor,
    'assignee_removed',
    jsonb_build_object(
      'assignee_id',
      target_user
    )
  );
end;
$$;

revoke all
on function public.remove_work_assignee(uuid,uuid)
from public;

grant execute
on function public.remove_work_assignee(uuid,uuid)
to authenticated;


-- ------------------------------------------------------------
-- ADD WATCHER
-- ------------------------------------------------------------

create or replace function public.add_work_watcher(
  target_work_item uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_read_work_item(target_work_item) then
    raise exception 'Work item not accessible';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where
      id = target_user
      and active = true
  ) then
    raise exception 'Watcher is not an active employee';
  end if;

  insert into public.work_item_watchers(
    work_item_id,
    user_id,
    added_by
  )
  values(
    target_work_item,
    target_user,
    actor
  )
  on conflict(
    work_item_id,
    user_id
  )
  do nothing;

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  select
    target_user,
    'work_watcher_added',
    'You are watching a work item',
    title,
    'work_item',
    id
  from public.work_items
  where id = target_work_item;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    actor,
    'watcher_added',
    jsonb_build_object(
      'user_id',
      target_user
    )
  );
end;
$$;

revoke all
on function public.add_work_watcher(uuid,uuid)
from public;

grant execute
on function public.add_work_watcher(uuid,uuid)
to authenticated;


-- ------------------------------------------------------------
-- REMOVE WATCHER
-- ------------------------------------------------------------

create or replace function public.remove_work_watcher(
  target_work_item uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.can_read_work_item(target_work_item) then
    raise exception 'Work item not accessible';
  end if;

  if not (
    target_user = auth.uid()
    or public.has_workspace_role(
      array['manager','admin']
    )
    or exists(
      select 1
      from public.work_items w
      where
        w.id = target_work_item
        and w.created_by = auth.uid()
    )
  ) then
    raise exception 'Not permitted';
  end if;

  delete from public.work_item_watchers
  where
    work_item_id = target_work_item
    and user_id = target_user;
end;
$$;

grant execute
on function public.remove_work_watcher(uuid,uuid)
to authenticated;


-- ------------------------------------------------------------
-- ADD COMMENT RPC
--
-- Inserts comment + audit record.
-- ------------------------------------------------------------

create or replace function public.add_work_comment(
  target_work_item uuid,
  comment_body text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  new_comment uuid;
begin
  if not public.can_read_work_item(target_work_item) then
    raise exception 'Work item not accessible';
  end if;

  if nullif(trim(comment_body),'') is null then
    raise exception 'Comment cannot be empty';
  end if;

  insert into public.work_item_comments(
    work_item_id,
    author_id,
    body
  )
  values(
    target_work_item,
    auth.uid(),
    trim(comment_body)
  )
  returning id
  into new_comment;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    auth.uid(),
    'comment_added',
    jsonb_build_object(
      'comment_id',
      new_comment
    )
  );

  return new_comment;
end;
$$;

revoke all
on function public.add_work_comment(uuid,text)
from public;

grant execute
on function public.add_work_comment(uuid,text)
to authenticated;


-- ------------------------------------------------------------
-- ESCALATE WORK
--
-- Manager/Admin or task creator.
-- ------------------------------------------------------------

create or replace function public.escalate_work_item(
  target_work_item uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  creator uuid;
  new_level integer;
begin
  actor := auth.uid();

  select
    created_by,
    least(escalation_level + 1,5)
  into
    creator,
    new_level
  from public.work_items
  where id = target_work_item;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if not (
    actor = creator
    or public.has_workspace_role(
      array['manager','admin']
    )
  ) then
    raise exception 'Escalation not permitted';
  end if;

  update public.work_items
  set
    escalation_level = new_level,
    escalated_at = now(),
    escalation_reason = nullif(trim(reason),'')
  where id = target_work_item;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    actor,
    'escalated',
    jsonb_build_object(
      'level',
      new_level,
      'reason',
      reason
    )
  );

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  select
    assignee_id,
    'work_escalated',
    'Work item escalated',
    coalesce(reason,'Priority escalation'),
    'work_item',
    target_work_item
  from public.work_item_assignees
  where work_item_id = target_work_item;
end;
$$;

revoke all
on function public.escalate_work_item(uuid,text)
from public;

grant execute
on function public.escalate_work_item(uuid,text)
to authenticated;


-- ------------------------------------------------------------
-- WATCHER RLS
-- ------------------------------------------------------------

alter table public.work_item_watchers
  enable row level security;

drop policy if exists
  "work watchers read"
on public.work_item_watchers;

create policy "work watchers read"
on public.work_item_watchers
for select
to authenticated
using (
  public.can_read_work_item(work_item_id)
);


-- ------------------------------------------------------------
-- ATTACHMENT RLS
-- ------------------------------------------------------------

alter table public.work_item_attachments
  enable row level security;

drop policy if exists
  "work attachments read"
on public.work_item_attachments;

create policy "work attachments read"
on public.work_item_attachments
for select
to authenticated
using (
  public.can_read_work_item(work_item_id)
);

drop policy if exists
  "work attachments create"
on public.work_item_attachments;

create policy "work attachments create"
on public.work_item_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_read_work_item(work_item_id)
);


-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------

grant select
on public.work_item_watchers
to authenticated;

grant select,insert
on public.work_item_attachments
to authenticated;

revoke all
on public.work_item_watchers
from anon;

revoke all
on public.work_item_attachments
from anon;


-- ------------------------------------------------------------
-- REALTIME
-- ------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.work_item_comments;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime
      add table public.work_item_watchers;
  exception
    when duplicate_object then null;
  end;
end
$$;

commit;
