-- ============================================================
-- RideArrivo Work Management
-- Approvals, deadline alerts and automatic escalation
-- ============================================================

begin;

-- ------------------------------------------------------------
-- APPROVALS
-- ------------------------------------------------------------

create table if not exists public.work_item_approvals (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  approver_id uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  requested_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'approved',
        'rejected',
        'cancelled'
      )
    ),

  request_note text,
  decision_note text,

  requested_at timestamptz not null default now(),
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  idx_work_approvals_item
on public.work_item_approvals(
  work_item_id,
  status
);

create index if not exists
  idx_work_approvals_approver
on public.work_item_approvals(
  approver_id,
  status,
  requested_at desc
);

create unique index if not exists
  idx_work_approval_one_pending
on public.work_item_approvals(
  work_item_id,
  approver_id
)
where status='pending';


-- ------------------------------------------------------------
-- DEADLINE EVENT LEDGER
--
-- Prevents duplicate notifications/escalations.
-- ------------------------------------------------------------

create table if not exists public.work_item_deadline_events (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  event_type text not null
    check (
      event_type in (
        'due_24h',
        'overdue',
        'overdue_24h_escalation'
      )
    ),

  created_at timestamptz not null default now(),

  unique(
    work_item_id,
    event_type
  )
);


-- ------------------------------------------------------------
-- UPDATED_AT
-- ------------------------------------------------------------

drop trigger if exists
  work_approvals_set_updated_at
on public.work_item_approvals;

create trigger
  work_approvals_set_updated_at
before update
on public.work_item_approvals
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- REQUEST APPROVAL
--
-- Creator / Manager / Admin.
-- ------------------------------------------------------------

create or replace function public.request_work_approval(
  target_work_item uuid,
  target_approver uuid,
  note text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  creator uuid;
  task_title text;
  new_approval uuid;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Authentication required';
  end if;

  select
    created_by,
    title
  into
    creator,
    task_title
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
      'You cannot request approval for this work item';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where
      id = target_approver
      and active = true
  ) then
    raise exception 'Approver is not an active employee';
  end if;

  insert into public.work_item_approvals(
    work_item_id,
    approver_id,
    requested_by,
    request_note
  )
  values(
    target_work_item,
    target_approver,
    actor,
    nullif(trim(note),'')
  )
  returning id
  into new_approval;

  update public.work_items
  set status='review'
  where id=target_work_item
    and status not in (
      'completed',
      'cancelled'
    );

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  values(
    target_approver,
    'approval_required',
    'Approval required',
    coalesce(task_title,'Work item'),
    'work_item',
    target_work_item
  );

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    actor,
    'approval_requested',
    jsonb_build_object(
      'approval_id',
      new_approval,
      'approver_id',
      target_approver
    )
  );

  return new_approval;
end;
$$;

revoke all
on function public.request_work_approval(
  uuid,
  uuid,
  text
)
from public;

grant execute
on function public.request_work_approval(
  uuid,
  uuid,
  text
)
to authenticated;


-- ------------------------------------------------------------
-- APPROVAL DECISION
-- ------------------------------------------------------------

create or replace function public.decide_work_approval(
  target_approval uuid,
  decision text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  approval_row public.work_item_approvals%rowtype;
  pending_count integer;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Authentication required';
  end if;

  if decision not in (
    'approved',
    'rejected'
  ) then
    raise exception
      'Decision must be approved or rejected';
  end if;

  select *
  into approval_row
  from public.work_item_approvals
  where id=target_approval;

  if approval_row.id is null then
    raise exception 'Approval not found';
  end if;

  if approval_row.status <> 'pending' then
    raise exception 'Approval has already been decided';
  end if;

  if not (
    approval_row.approver_id = actor
    or public.has_workspace_role(
      array['manager','admin']
    )
  ) then
    raise exception
      'You cannot decide this approval';
  end if;

  update public.work_item_approvals
  set
    status=decision,
    decision_note=nullif(trim(note),''),
    decided_at=now()
  where id=target_approval;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    approval_row.work_item_id,
    actor,
    case
      when decision='approved'
        then 'approval_approved'
      else 'approval_rejected'
    end,
    jsonb_build_object(
      'approval_id',
      target_approval,
      'decision',
      decision
    )
  );

  if decision='rejected' then

    update public.work_items
    set
      status='in_progress',
      completed_at=null
    where id=approval_row.work_item_id;

  else

    select count(*)
    into pending_count
    from public.work_item_approvals
    where
      work_item_id=approval_row.work_item_id
      and status='pending';

    if pending_count=0 then
      update public.work_items
      set
        status='completed',
        completed_at=now()
      where id=approval_row.work_item_id;
    end if;

  end if;

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  select
    w.created_by,
    case
      when decision='approved'
        then 'approval_completed'
      else 'approval_rejected'
    end,
    case
      when decision='approved'
        then 'Work approved'
      else 'Approval rejected'
    end,
    w.title,
    'work_item',
    w.id
  from public.work_items w
  where w.id=approval_row.work_item_id;

end;
$$;

revoke all
on function public.decide_work_approval(
  uuid,
  text,
  text
)
from public;

grant execute
on function public.decide_work_approval(
  uuid,
  text,
  text
)
to authenticated;


-- ------------------------------------------------------------
-- DEADLINE PROCESSOR
--
-- Idempotent:
-- running this repeatedly does not create duplicate alerts.
-- ------------------------------------------------------------

create or replace function public.process_work_deadlines()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  task record;

  due_soon_count integer := 0;
  overdue_count integer := 0;
  escalated_count integer := 0;
begin

  -- If called by an authenticated user, require Manager/Admin.
  if auth.uid() is not null
     and not public.has_workspace_role(
       array['manager','admin']
     )
  then
    raise exception
      'Deadline processing requires Manager or Admin';
  end if;


  -- ----------------------------------------------------------
  -- DUE WITHIN 24 HOURS
  -- ----------------------------------------------------------

  for task in
    select *
    from public.work_items
    where
      due_at is not null
      and due_at > now()
      and due_at <= now() + interval '24 hours'
      and status not in (
        'completed',
        'cancelled'
      )
  loop

    begin
      insert into public.work_item_deadline_events(
        work_item_id,
        event_type
      )
      values(
        task.id,
        'due_24h'
      );

    exception
      when unique_violation then
        continue;
    end;

    insert into public.notifications(
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id
    )
    select
      a.assignee_id,
      'work_due_soon',
      'Work due within 24 hours',
      task.title,
      'work_item',
      task.id
    from public.work_item_assignees a
    where a.work_item_id=task.id;

    due_soon_count :=
      due_soon_count + 1;

  end loop;


  -- ----------------------------------------------------------
  -- OVERDUE
  -- ----------------------------------------------------------

  for task in
    select *
    from public.work_items
    where
      due_at is not null
      and due_at < now()
      and status not in (
        'completed',
        'cancelled'
      )
  loop

    begin
      insert into public.work_item_deadline_events(
        work_item_id,
        event_type
      )
      values(
        task.id,
        'overdue'
      );

    exception
      when unique_violation then
        continue;
    end;

    insert into public.notifications(
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id
    )
    select
      a.assignee_id,
      'work_overdue',
      'Work item overdue',
      task.title,
      'work_item',
      task.id
    from public.work_item_assignees a
    where a.work_item_id=task.id;

    if task.created_by is not null then
      insert into public.notifications(
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id
      )
      values(
        task.created_by,
        'work_overdue',
        'Assigned work is overdue',
        task.title,
        'work_item',
        task.id
      );
    end if;

    insert into public.work_item_activity(
      work_item_id,
      actor_id,
      action,
      metadata
    )
    values(
      task.id,
      null,
      'deadline_overdue',
      jsonb_build_object(
        'due_at',
        task.due_at
      )
    );

    overdue_count :=
      overdue_count + 1;

  end loop;


  -- ----------------------------------------------------------
  -- AUTOMATIC ESCALATION AFTER 24 HOURS OVERDUE
  -- ----------------------------------------------------------

  for task in
    select *
    from public.work_items
    where
      due_at is not null
      and due_at < now() - interval '24 hours'
      and status not in (
        'completed',
        'cancelled'
      )
  loop

    begin
      insert into public.work_item_deadline_events(
        work_item_id,
        event_type
      )
      values(
        task.id,
        'overdue_24h_escalation'
      );

    exception
      when unique_violation then
        continue;
    end;

    update public.work_items
    set
      escalation_level=
        least(escalation_level + 1,5),

      escalated_at=now(),

      escalation_reason=
        'Automatically escalated after remaining overdue for 24 hours'
    where id=task.id;

    insert into public.work_item_activity(
      work_item_id,
      actor_id,
      action,
      metadata
    )
    values(
      task.id,
      null,
      'automatic_escalation',
      jsonb_build_object(
        'reason',
        '24_hours_overdue'
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
      a.assignee_id,
      'work_escalated',
      'Overdue work escalated',
      task.title,
      'work_item',
      task.id
    from public.work_item_assignees a
    where a.work_item_id=task.id;

    if task.created_by is not null then
      insert into public.notifications(
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id
      )
      values(
        task.created_by,
        'work_escalated',
        'Overdue work automatically escalated',
        task.title,
        'work_item',
        task.id
      );
    end if;

    escalated_count :=
      escalated_count + 1;

  end loop;


  return jsonb_build_object(
    'due_soon',
    due_soon_count,
    'overdue',
    overdue_count,
    'escalated',
    escalated_count
  );

end;
$$;

revoke all
on function public.process_work_deadlines()
from public;

grant execute
on function public.process_work_deadlines()
to authenticated;


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.work_item_approvals
  enable row level security;

alter table public.work_item_deadline_events
  enable row level security;


drop policy if exists
  "work approvals read"
on public.work_item_approvals;

create policy "work approvals read"
on public.work_item_approvals
for select
to authenticated
using (
  approver_id=auth.uid()

  or requested_by=auth.uid()

  or public.can_read_work_item(
    work_item_id
  )
);


drop policy if exists
  "work deadline events read"
on public.work_item_deadline_events;

create policy "work deadline events read"
on public.work_item_deadline_events
for select
to authenticated
using (
  public.can_read_work_item(
    work_item_id
  )
);


grant select
on public.work_item_approvals
to authenticated;

grant select
on public.work_item_deadline_events
to authenticated;

revoke all
on public.work_item_approvals
from anon;

revoke all
on public.work_item_deadline_events
from anon;


-- ------------------------------------------------------------
-- REALTIME
-- ------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.work_item_approvals;
  exception
    when duplicate_object then null;
  end;
end
$$;


commit;
