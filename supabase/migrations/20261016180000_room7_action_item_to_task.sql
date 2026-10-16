-- ROOM 7: turn a meeting action item into a real task in Work Desk.
-- Uses the existing create_work_assignment rules, so assignment permissions
-- are unchanged. Safe to run twice.

begin;

alter table public.workspace_room_action_items
  add column if not exists work_item_id uuid references public.work_items(id) on delete set null;

create or replace function public.room_action_to_task(p_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  item public.workspace_room_action_items%rowtype;
  room_title text;
  target uuid;
  task_id uuid;
  detail text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select * into item from public.workspace_room_action_items where id = p_id for update;
  if not found or not public.can_use_room_chat(item.room_id) then
    raise exception 'Action item not found';
  end if;

  -- Second tap returns the task that already exists.
  if item.work_item_id is not null and exists (select 1 from public.work_items w where w.id = item.work_item_id) then
    return item.work_item_id;
  end if;

  select coalesce(nullif(btrim(r.title), ''), 'ROOM 7 meeting') into room_title
  from public.workspace_rooms r where r.id = item.room_id;

  -- Give it to the named owner when you are allowed to assign to them,
  -- otherwise to yourself.
  target := me;
  if item.owner_id is not null and item.owner_id <> me and public.can_assign_work(item.owner_id) then
    target := item.owner_id;
  end if;

  detail := 'From the meeting "' || coalesce(room_title, 'ROOM 7') || '".'
    || case when item.owner_name is not null then E'\nOwner in the notes: ' || item.owner_name else '' end
    || case when item.due_text is not null then E'\nDue: ' || item.due_text else '' end;

  task_id := public.create_work_assignment(
    left(item.body, 200),
    detail,
    target,
    'normal',
    null,
    null
  );

  update public.workspace_room_action_items set work_item_id = task_id where id = p_id;
  return task_id;
end;
$$;
revoke all on function public.room_action_to_task(uuid) from public, anon;
grant execute on function public.room_action_to_task(uuid) to authenticated;

commit;
