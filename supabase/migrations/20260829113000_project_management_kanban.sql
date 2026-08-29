-- ============================================================
-- RideArrivo Projects + Kanban
-- Reuses collaboration_spaces as the project membership boundary
-- and work_items as the accountable task/evidence boundary.
-- ============================================================

begin;

alter table public.work_items
  add column if not exists project_space_id uuid
    references public.collaboration_spaces(id)
    on delete set null;

alter table public.work_items
  add column if not exists kanban_rank bigint not null default 0;

create index if not exists idx_work_items_project_space
on public.work_items(project_space_id,status,kanban_rank,created_at);

-- Project members may read project cards in addition to existing
-- creator/assignee/management access. The helper is SECURITY DEFINER
-- to avoid RLS recursion through project membership lookups.
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
    where w.id=target_work_item
      and (
        w.created_by=auth.uid()
        or exists(
          select 1
          from public.work_item_assignees a
          where a.work_item_id=w.id
            and a.assignee_id=auth.uid()
        )
        or public.has_workspace_role(array['manager','admin'])
        or (
          w.project_space_id is not null
          and public.can_access_collaboration_space(w.project_space_id)
        )
      )
  );
$$;

revoke all on function public.can_read_work_item(uuid) from public;
grant execute on function public.can_read_work_item(uuid) to authenticated;

-- Create one accountable card inside a project. Project owners/admins
-- may assign any active non-viewer project member. Ordinary members can
-- create work for themselves, preserving the existing assignment model.
create or replace function public.create_project_work_item(
  p_space_id uuid,
  p_title text,
  p_description text default '',
  p_assignee_id uuid default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  new_id uuid;
  target_user uuid;
  target_department text;
  my_member_role text;
begin
  if not exists(
    select 1 from public.employee_profiles
    where id=auth.uid() and active=true
  ) then
    raise exception 'Active workspace profile required';
  end if;

  if nullif(trim(coalesce(p_title,'')),'') is null then
    raise exception 'Card title is required';
  end if;

  if p_priority not in ('low','normal','high','urgent') then
    raise exception 'Invalid priority';
  end if;

  if not exists(
    select 1 from public.collaboration_spaces s
    where s.id=p_space_id
      and s.archived_at is null
      and s.space_type in ('project','cross_department')
  ) then
    raise exception 'Active project workspace not found';
  end if;

  if not public.can_access_collaboration_space(p_space_id) then
    raise exception 'Project access required';
  end if;

  select m.member_role into my_member_role
  from public.collaboration_space_members m
  where m.space_id=p_space_id and m.user_id=auth.uid();

  if coalesce(my_member_role,'viewer')='viewer'
     and not public.has_workspace_role(array['manager','admin']) then
    raise exception 'Viewer members cannot create project cards';
  end if;

  target_user:=p_assignee_id;

  if target_user is not null then
    select p.department into target_department
    from public.employee_profiles p
    where p.id=target_user and p.active=true;

    if not found then
      raise exception 'Assignee is not an active employee';
    end if;

    if not exists(
      select 1 from public.collaboration_space_members m
      where m.space_id=p_space_id
        and m.user_id=target_user
        and m.member_role<>'viewer'
    ) then
      raise exception 'Assignee must be an active project member';
    end if;

    if target_user<>auth.uid()
       and not public.can_manage_collaboration_space(p_space_id)
       and not public.has_workspace_role(array['manager','admin']) then
      raise exception 'Only project owners/admins can assign another employee';
    end if;
  end if;

  insert into public.work_items(
    title,description,status,priority,department,created_by,due_at,
    project_space_id,kanban_rank
  ) values(
    trim(p_title),coalesce(p_description,''),
    case when target_user is null then 'draft' else 'assigned' end,
    p_priority,target_department,auth.uid(),p_due_at,p_space_id,
    (extract(epoch from clock_timestamp())*1000)::bigint
  ) returning id into new_id;

  if target_user is not null then
    insert into public.work_item_assignees(work_item_id,assignee_id,assigned_by)
    values(new_id,target_user,auth.uid());
  end if;

  insert into public.work_item_activity(work_item_id,actor_id,action,metadata)
  values(new_id,auth.uid(),'project_card_created',jsonb_build_object('project_space_id',p_space_id));

  return new_id;
end;
$$;

revoke all on function public.create_project_work_item(uuid,text,text,uuid,text,timestamptz) from public;
grant execute on function public.create_project_work_item(uuid,text,text,uuid,text,timestamptz) to authenticated;

-- Move a card through the Kanban lifecycle without granting broad update
-- rights over every field in work_items.
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
  if p_status not in ('draft','assigned','in_progress','blocked','review','completed','cancelled') then
    raise exception 'Invalid work status';
  end if;

  select * into item from public.work_items where id=p_work_item;
  if not found or item.project_space_id is null then
    raise exception 'Project card not found';
  end if;

  select m.member_role into my_member_role
  from public.collaboration_space_members m
  where m.space_id=item.project_space_id and m.user_id=auth.uid();

  if not (
    item.created_by=auth.uid()
    or exists(
      select 1 from public.work_item_assignees a
      where a.work_item_id=item.id and a.assignee_id=auth.uid()
    )
    or coalesce(my_member_role,'viewer') in ('owner','admin')
    or public.has_workspace_role(array['manager','admin'])
  ) then
    raise exception 'You are not allowed to move this project card';
  end if;

  update public.work_items
  set status=p_status,
      kanban_rank=coalesce(p_rank,kanban_rank),
      completed_at=case
        when p_status='completed' then coalesce(completed_at,now())
        else null
      end
  where id=p_work_item;

  insert into public.work_item_activity(work_item_id,actor_id,action,metadata)
  values(p_work_item,auth.uid(),'project_card_status_changed',jsonb_build_object('from',item.status,'to',p_status,'project_space_id',item.project_space_id));
end;
$$;

revoke all on function public.set_project_work_status(uuid,text,bigint) from public;
grant execute on function public.set_project_work_status(uuid,text,bigint) to authenticated;

commit;
