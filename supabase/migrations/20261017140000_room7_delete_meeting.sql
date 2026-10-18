-- Let people delete old (ended) ROOM 7 meetings from the history list.
--
-- Why a function and not a plain DELETE policy: workspace_rooms has no delete
-- policy on purpose, so the browser can never remove rows directly. This function
-- is the single, checked way to do it:
--   * the caller must be signed in,
--   * the meeting must already be ended (a live meeting has to be ended first),
--   * the caller must be the person who created it, or an active admin.
-- Deleting the row cascades to the meeting's participants, events, minutes,
-- attendance, team chat, notes and guest/event records (all declared
-- "on delete cascade"). R7 AI recordings and webhook delivery logs are kept: their
-- room_id is "on delete set null", so a recording's transcript and notes survive.
begin;

create or replace function public.delete_workspace_room(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  r public.workspace_rooms%rowtype;
  is_admin boolean;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select * into r from public.workspace_rooms where id = p_id for update;
  if not found then
    raise exception 'Meeting not found';
  end if;

  is_admin := exists (
    select 1 from public.employee_profiles e
    where e.id = me and e.role = 'admin' and e.active = true
  );

  -- Same message for "not yours" and "does not exist" so ids cannot be probed.
  if r.created_by <> me and not is_admin then
    raise exception 'Meeting not found';
  end if;

  if r.status <> 'ended' then
    raise exception 'End this meeting before deleting it';
  end if;

  delete from public.workspace_rooms where id = p_id;
end;
$$;

revoke all on function public.delete_workspace_room(uuid) from public, anon;
grant execute on function public.delete_workspace_room(uuid) to authenticated;

commit;
