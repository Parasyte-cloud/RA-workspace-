-- Behaviour check for delete_workspace_room using stub tables (runs on any plain Postgres).
-- psql -v ON_ERROR_STOP=1 -f supabase/checks/room7-delete-meeting.sql
drop schema if exists dt cascade; create schema dt; set search_path=dt,public;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table employee_profiles(id uuid primary key, role text, active boolean);
create table workspace_rooms(id uuid primary key default gen_random_uuid(), status text, created_by uuid);
create table workspace_room_messages(id serial, room_id uuid references workspace_rooms(id) on delete cascade);
create table r7_records(id serial, room_id uuid references workspace_rooms(id) on delete set null);
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

create or replace function dt.delete_workspace_room(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = dt, pg_temp
as $$
declare
  me uuid := auth.uid();
  r dt.workspace_rooms%rowtype;
  is_admin boolean;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select * into r from dt.workspace_rooms where id = p_id for update;
  if not found then
    raise exception 'Meeting not found';
  end if;

  is_admin := exists (
    select 1 from dt.employee_profiles e
    where e.id = me and e.role = 'admin' and e.active = true
  );

  -- Same message for "not yours" and "does not exist" so ids cannot be probed.
  if r.created_by <> me and not is_admin then
    raise exception 'Meeting not found';
  end if;

  if r.status <> 'ended' then
    raise exception 'End this meeting before deleting it';
  end if;

  delete from dt.workspace_rooms where id = p_id;
end;
$$;


commit;
insert into employee_profiles values ('00000000-0000-0000-0000-000000000001','member',true),('00000000-0000-0000-0000-000000000002','member',true),('00000000-0000-0000-0000-000000000003','admin',true),('00000000-0000-0000-0000-000000000004','admin',false);
insert into workspace_rooms(id,status,created_by) values
('a0000000-0000-0000-0000-000000000001','ended','00000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000002','active','00000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000003','ended','00000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000004','ended','00000000-0000-0000-0000-000000000001');
insert into workspace_room_messages(room_id) values ('a0000000-0000-0000-0000-000000000001');
insert into r7_records(room_id) values ('a0000000-0000-0000-0000-000000000001');
do $$ declare ok int:=0; begin
 -- 1 not signed in
 begin perform set_config('test.uid','',false); perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000001'); raise exception 'FAIL1'; exception when others then if sqlerrm='Not signed in' then ok:=ok+1; else raise; end if; end;
 -- 2 other member cannot
 perform set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
 begin perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000001'); raise exception 'FAIL2'; exception when others then if sqlerrm='Meeting not found' then ok:=ok+1; else raise; end if; end;
 -- 3 inactive admin cannot
 perform set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
 begin perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000001'); raise exception 'FAIL3'; exception when others then if sqlerrm='Meeting not found' then ok:=ok+1; else raise; end if; end;
 -- 4 creator cannot delete active
 perform set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
 begin perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000002'); raise exception 'FAIL4'; exception when others then if sqlerrm='End this meeting before deleting it' then ok:=ok+1; else raise; end if; end;
 -- 5 creator deletes ended; cascade chat, record kept with null room
 perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000001');
 if (select count(*) from dt.workspace_rooms where id='a0000000-0000-0000-0000-000000000001')=0 and (select count(*) from dt.workspace_room_messages)=0 and (select count(*) from dt.r7_records where room_id is null)=1 then ok:=ok+1; else raise exception 'FAIL5'; end if;
 -- 6 active admin deletes someone else's
 perform set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
 perform dt.delete_workspace_room('a0000000-0000-0000-0000-000000000003');
 if (select count(*) from dt.workspace_rooms where id='a0000000-0000-0000-0000-000000000003')=0 then ok:=ok+1; else raise exception 'FAIL6'; end if;
 -- 7 unknown id
 begin perform dt.delete_workspace_room('a0000000-0000-0000-0000-0000000000ff'); raise exception 'FAIL7'; exception when others then if sqlerrm='Meeting not found' then ok:=ok+1; else raise; end if; end;
 raise notice 'delete checks passed: % of 7', ok;
end $$;
