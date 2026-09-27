-- ROOM 7: let the meeting creator or an administrator remove someone from a
-- call and keep them out until they are let back in.
--
-- removed_at set  = blocked from rejoining this room (staff and guests).
-- removed_by      = who removed them (employee id). Plain uuid, no foreign
--                   key, so it never makes the employee_profiles join on
--                   user_id ambiguous.

alter table public.workspace_room_participants
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid;

alter table public.room7_guest_participants
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid;

alter table public.workspace_room_events
  drop constraint if exists workspace_room_events_event_type_check;

alter table public.workspace_room_events
  add constraint workspace_room_events_event_type_check
  check (event_type in ('created','joined','ended','removed','readmitted'));
