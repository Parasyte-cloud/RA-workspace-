-- Compulsory sign-off on tasks.
--
-- Work somebody else gave you can no longer be marked completed by you. When you
-- finish it, it goes back to the person it came from (status review, with a
-- pending approval for them, shown in red). Only that person can approve it, and
-- only then does it complete. Rejecting sends it back to in progress.
-- Tasks you gave only to yourself are unchanged. If the creator has left, a
-- manager or admin signs off instead.
--
-- PArAsYtE

begin;

-- Does this task need its creator's sign-off? Yes when somebody other than the
-- creator is working on it. A task you assigned only to yourself has nobody
-- else to sign it off.
create or replace function public.work_needs_creator_signoff(target_work_item uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.work_items w
    join public.work_item_assignees a on a.work_item_id=w.id
    where w.id=target_work_item
      and w.project_space_id is null  -- project boards keep their own flow
      and w.created_by is not null
      and a.assignee_id<>w.created_by
  );
$$;

-- The creator may be gone. Then a manager or admin signs off instead, so a task
-- never gets stuck forever.
create or replace function public.work_creator_available(target_work_item uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.work_items w
    join public.employee_profiles c on c.id=w.created_by
    where w.id=target_work_item
      and c.active=true
  );
$$;

revoke all on function public.work_needs_creator_signoff(uuid) from public, anon;
revoke all on function public.work_creator_available(uuid) from public, anon;
grant execute on function public.work_needs_creator_signoff(uuid) to authenticated;
grant execute on function public.work_creator_available(uuid) to authenticated;

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
    or public.is_department_head_of_work(target_work_item)
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
      or public.is_department_head_of_work(target_work_item)
    )
  then
    raise exception 'Only the creator, a department head, Manager or Admin can cancel work';
  end if;

  -- Compulsory sign-off: work somebody else gave you is finished only when the
  -- person it came from approves it. Send it for approval instead.
  if new_status='completed'
    and public.work_needs_creator_signoff(target_work_item)
    and public.work_creator_available(target_work_item)
    and not exists(
      select 1 from public.work_items w
      where w.id=target_work_item and w.created_by=actor
    )
  then
    raise exception 'This work needs approval from the person who assigned it before it can be completed. Send it for approval.';
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

  -- Moving to review sends it back to the person it came from, in red.
  if new_status='review'
    and public.work_needs_creator_signoff(target_work_item)
    and public.work_creator_available(target_work_item)
    and not exists(
      select 1 from public.work_items w
      where w.id=target_work_item and w.created_by=actor
    )
    and not exists(
      select 1
      from public.work_item_approvals a
      join public.work_items w on w.id=a.work_item_id
      where a.work_item_id=target_work_item
        and a.status='pending'
        and a.approver_id=w.created_by
    )
  then
    perform public.request_work_approval(
      target_work_item,
      (select created_by from public.work_items where id=target_work_item),
      'Finished and sent back for your approval'
    );
    return;
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

  -- Anyone who can open the task may ask anyone for approval.
  if not public.can_read_work_item(target_work_item) then
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

  -- The person the task came from always has to sign off as well.
  if public.work_needs_creator_signoff(target_work_item)
    and public.work_creator_available(target_work_item)
    and actor<>creator
    and target_approver<>creator
    and not exists(
      select 1 from public.work_item_approvals
      where work_item_id=target_work_item
        and approval_round=next_round
        and approver_id=creator
    )
  then
    insert into public.work_item_approvals(
      work_item_id,approver_id,requested_by,approval_round,request_note
    )
    values(
      target_work_item,creator,actor,next_round,
      'Creator sign-off is required for this work'
    );

    insert into public.work_item_watchers(work_item_id,user_id,added_by)
    values(target_work_item,creator,actor)
    on conflict(work_item_id,user_id) do nothing;

    insert into public.notifications(
      user_id,type,title,body,entity_type,entity_id
    )
    values(
      creator,'approval_required','Approval required',
      coalesce(task_title,'Work item'),'work_item',target_work_item
    );
  end if;

  -- The approver must be able to open the task to decide on it.
  insert into public.work_item_watchers(work_item_id,user_id,added_by)
  values(target_work_item,target_approver,actor)
  on conflict(work_item_id,user_id) do nothing;

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

  if exists(
    select 1 from public.work_items w
    where w.id=approval_row.work_item_id
      and w.created_by=approval_row.approver_id
  )
  and public.work_needs_creator_signoff(approval_row.work_item_id)
  and public.work_creator_available(approval_row.work_item_id)
  then
    -- The creator's sign-off cannot be given by anyone else.
    if approval_row.approver_id<>actor then
      raise exception 'Only the person who assigned this work can approve it';
    end if;
  elsif not (
    approval_row.approver_id=actor
    or public.has_workspace_role(array['manager','admin'])
    or (
      public.is_department_head_of_work(approval_row.work_item_id)
      and approval_row.requested_by<>actor
    )
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

commit;
