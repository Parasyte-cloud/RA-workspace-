-- ============================================================
-- RideArrivo Work Management
-- Complete approval rounds, cancellation and deadline scheduling
-- ============================================================

begin;

alter table public.work_item_approvals
  add column if not exists approval_round integer not null default 1
  check (approval_round > 0);

create index if not exists idx_work_approvals_round
on public.work_item_approvals(work_item_id,approval_round,status);


create or replace function public.get_work_approval_candidates(
  target_work_item uuid
)
returns table(
  id uuid,
  full_name text,
  email text,
  department text,
  job_title text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  creator uuid;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select created_by
  into creator
  from public.work_items
  where work_items.id=target_work_item;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if not (
    actor=creator
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You cannot request approval for this work item';
  end if;

  return query
  select
    ep.id,
    ep.full_name,
    ep.email,
    ep.department,
    ep.job_title
  from public.employee_profiles ep
  where ep.active=true
    and ep.id<>actor
  order by ep.full_name,ep.email;
end;
$$;

revoke all
on function public.get_work_approval_candidates(uuid)
from public;

grant execute
on function public.get_work_approval_candidates(uuid)
to authenticated;


create or replace function public.request_work_approval(
  target_work_item uuid,
  target_approver uuid,
  note text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  creator uuid;
  task_title text;
  task_status text;
  new_approval uuid;
  latest_round integer;
  pending_in_latest integer;
  next_round integer;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select created_by,title,status
  into creator,task_title,task_status
  from public.work_items
  where id=target_work_item
  for update;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if task_status='cancelled' then
    raise exception 'A cancelled work item cannot be sent for approval';
  end if;

  if not (
    actor=creator
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You cannot request approval for this work item';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where id=target_approver and active=true
  ) then
    raise exception 'Approver is not an active employee';
  end if;

  if target_approver=actor then
    raise exception 'A requester cannot approve their own work';
  end if;

  select
    coalesce(max(approval_round),0),
    count(*) filter (
      where status='pending'
        and approval_round=(
          select coalesce(max(a2.approval_round),0)
          from public.work_item_approvals a2
          where a2.work_item_id=target_work_item
        )
    )
  into latest_round,pending_in_latest
  from public.work_item_approvals
  where work_item_id=target_work_item;

  next_round := case
    when latest_round=0 then 1
    when pending_in_latest>0 then latest_round
    else latest_round+1
  end;

  insert into public.work_item_approvals(
    work_item_id,
    approver_id,
    requested_by,
    approval_round,
    request_note
  )
  values(
    target_work_item,
    target_approver,
    actor,
    next_round,
    nullif(trim(coalesce(note,'')),'')
  )
  returning id into new_approval;

  update public.work_items
  set status='review',completed_at=null
  where id=target_work_item
    and status<>'cancelled';

  insert into public.notifications(
    user_id,type,title,body,entity_type,entity_id
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
    work_item_id,actor_id,action,metadata
  )
  values(
    target_work_item,
    actor,
    'approval_requested',
    jsonb_build_object(
      'approval_id',new_approval,
      'approver_id',target_approver,
      'approval_round',next_round
    )
  );

  return new_approval;
end;
$$;

revoke all
on function public.request_work_approval(uuid,uuid,text)
from public;

grant execute
on function public.request_work_approval(uuid,uuid,text)
to authenticated;


create or replace function public.decide_work_approval(
  target_approval uuid,
  decision text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  approval_row public.work_item_approvals%rowtype;
  pending_count integer;
  rejected_count integer;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  if decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select *
  into approval_row
  from public.work_item_approvals
  where id=target_approval
  for update;

  if approval_row.id is null then
    raise exception 'Approval not found';
  end if;

  if approval_row.status<>'pending' then
    raise exception 'Approval has already been decided';
  end if;

  if not (
    approval_row.approver_id=actor
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You cannot decide this approval';
  end if;

  perform 1
  from public.work_items
  where id=approval_row.work_item_id
  for update;

  update public.work_item_approvals
  set
    status=decision,
    decision_note=nullif(trim(coalesce(note,'')),''),
    decided_at=now()
  where id=target_approval;

  select
    count(*) filter (where status='pending'),
    count(*) filter (where status='rejected')
  into pending_count,rejected_count
  from public.work_item_approvals
  where work_item_id=approval_row.work_item_id
    and approval_round=approval_row.approval_round;

  if decision='rejected' or rejected_count>0 then
    update public.work_items
    set status='in_progress',completed_at=null
    where id=approval_row.work_item_id;
  elsif pending_count=0 then
    update public.work_items
    set status='completed',completed_at=now()
    where id=approval_row.work_item_id;
  end if;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    approval_row.work_item_id,
    actor,
    case when decision='approved'
      then 'approval_approved'
      else 'approval_rejected'
    end,
    jsonb_build_object(
      'approval_id',target_approval,
      'decision',decision,
      'approval_round',approval_row.approval_round
    )
  );

  insert into public.notifications(
    user_id,type,title,body,entity_type,entity_id
  )
  select
    w.created_by,
    case when decision='approved'
      then 'approval_completed'
      else 'approval_rejected'
    end,
    case when decision='approved'
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
on function public.decide_work_approval(uuid,text,text)
from public;

grant execute
on function public.decide_work_approval(uuid,text,text)
to authenticated;


create or replace function public.cancel_work_approval(
  target_approval uuid,
  note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  approval_row public.work_item_approvals%rowtype;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select *
  into approval_row
  from public.work_item_approvals
  where id=target_approval
  for update;

  if approval_row.id is null then
    raise exception 'Approval not found';
  end if;

  if approval_row.status<>'pending' then
    raise exception 'Only a pending approval can be cancelled';
  end if;

  if not (
    approval_row.requested_by=actor
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You cannot cancel this approval';
  end if;

  perform 1
  from public.work_items
  where id=approval_row.work_item_id
  for update;

  update public.work_item_approvals
  set
    status='cancelled',
    decision_note=nullif(trim(coalesce(note,'')),''),
    decided_at=now()
  where id=target_approval;

  if not exists(
    select 1
    from public.work_item_approvals
    where work_item_id=approval_row.work_item_id
      and approval_round=approval_row.approval_round
      and status='pending'
  ) then
    update public.work_items
    set status='in_progress',completed_at=null
    where id=approval_row.work_item_id
      and status='review';
  end if;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    approval_row.work_item_id,
    actor,
    'approval_cancelled',
    jsonb_build_object(
      'approval_id',target_approval,
      'approval_round',approval_row.approval_round
    )
  );
end;
$$;

revoke all
on function public.cancel_work_approval(uuid,text)
from public;

grant execute
on function public.cancel_work_approval(uuid,text)
to authenticated;


create or replace function public.update_work_status(
  target_work_item uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.work_items
  where id=target_work_item
  for update;

  if not found then
    raise exception 'Work item not found';
  end if;

  if new_status not in (
    'assigned','in_progress','blocked','review','completed','cancelled'
  ) then
    raise exception 'Invalid work status';
  end if;

  if not (
    exists(
      select 1
      from public.work_items w
      where w.id=target_work_item
        and w.created_by=actor
    )
    or exists(
      select 1
      from public.work_item_assignees a
      where a.work_item_id=target_work_item
        and a.assignee_id=actor
    )
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You cannot change this work item status';
  end if;

  if new_status='cancelled'
    and not (
      exists(
        select 1
        from public.work_items w
        where w.id=target_work_item
          and w.created_by=actor
      )
      or public.has_workspace_role(array['manager','admin'])
    )
  then
    raise exception 'Only the creator, Manager or Admin can cancel work';
  end if;

  if new_status='completed'
    and exists(
      select 1
      from public.work_item_approvals a
      where a.work_item_id=target_work_item
        and a.status='pending'
    )
  then
    raise exception 'Pending approvals must be decided before completion';
  end if;

  update public.work_items
  set
    status=new_status,
    completed_at=case
      when new_status='completed' then now()
      else null
    end
  where id=target_work_item;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    target_work_item,
    actor,
    'status_changed',
    jsonb_build_object('status',new_status)
  );
end;
$$;

revoke all
on function public.update_work_status(uuid,text)
from public;

grant execute
on function public.update_work_status(uuid,text)
to authenticated;


create extension if not exists pg_cron;

select cron.schedule(
  'ridearrivo-process-work-deadlines',
  '*/5 * * * *',
  'select public.process_work_deadlines();'
);

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.work_item_deadline_events;
  exception
    when duplicate_object then null;
  end;
end
$$;

commit;
