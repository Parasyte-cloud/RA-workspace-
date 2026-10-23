-- Task approvals: anyone can ask anyone.
--
-- Until now only the creator, a manager, an admin or a department head could
-- request approval. Now anyone who can open the task can, and the person asked
-- is added as a watcher so they can open the task and its files to decide.
-- Deciding stays with the approver (or a manager/admin), unchanged.
--
-- PArAsYtE

begin;

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

  -- Anyone who can open the task may ask anyone for approval.
  if not public.can_read_work_item(target_work_item) then
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

revoke all on function public.get_work_approval_candidates(uuid) from public, anon;
grant execute on function public.get_work_approval_candidates(uuid) to authenticated;
revoke all on function public.request_work_approval(uuid,uuid,text) from public, anon;
grant execute on function public.request_work_approval(uuid,uuid,text) to authenticated;

commit;
