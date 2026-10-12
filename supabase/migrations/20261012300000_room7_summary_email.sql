-- ROOM 7: email the meeting summary to the people who were in the meeting.
--
-- Until now the AI summary sat in a table only administrators could read, so
-- the host never saw it unless an admin forwarded it. When a summary arrives
-- for a meeting that had AI notes turned on, the host and every RideArrivo
-- employee who joined that session get a notification, and the normal email
-- sweep (notifications-email-dispatch) sends it. Guests are not emailed.
--
-- Sent once per meeting session (summary_emailed_at), even if the provider
-- delivers the same summary twice. Safe to run twice.

begin;

alter table public.workspace_room_minutes
  add column if not exists summary_emailed_at timestamptz;

create or replace function public.room7_email_summary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  room public.workspace_rooms%rowtype;
  excerpt text;
begin
  if new.status <> 'ready'
     or new.summary_markdown is null
     or btrim(new.summary_markdown) = ''
     or new.summary_emailed_at is not null then
    return new;
  end if;

  select * into room from public.workspace_rooms where id = new.room_id;
  if not found or not room.ai_notes_enabled then
    return new;
  end if;

  -- Plain text, short enough for an email and a notification.
  excerpt := left(
    btrim(regexp_replace(new.summary_markdown, '[#*_`>]+', '', 'g')),
    1500
  );

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  select distinct e.id,
         'room_minutes',
         'Meeting summary: ' || left(room.title, 120),
         excerpt,
         'workspace_room',
         room.id
  from public.employee_profiles e
  where e.active
    and (
      e.id = room.created_by
      or e.id in (
        select a.user_id
        from public.workspace_room_attendance a
        where a.room_id = new.room_id and a.session_id = new.session_id
      )
    );

  update public.workspace_room_minutes
  set summary_emailed_at = now()
  where id = new.id;

  return new;
exception when others then
  -- Never block the webhook that stores the minutes because an email failed.
  raise warning 'room7_email_summary: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.room7_email_summary() from public, anon, authenticated;

drop trigger if exists room7_email_summary_trg on public.workspace_room_minutes;
create trigger room7_email_summary_trg
after insert or update of status, summary_markdown on public.workspace_room_minutes
for each row
execute function public.room7_email_summary();

commit;
