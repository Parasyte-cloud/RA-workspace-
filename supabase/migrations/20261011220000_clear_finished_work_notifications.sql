-- Notifications about a task should disappear when the task is finished.
--
-- Before this, a notification could only be marked read. It stayed in the bell
-- forever, even after the work it pointed at was completed or cancelled.
--
-- This migration:
--   1. lets each person delete their own notifications (dismiss and clear read),
--   2. removes every notification about a work item the moment that item is
--      completed or cancelled,
--   3. cleans up the notifications that are already stale today.

begin;

-- 1. Delete your own notifications, never anyone else's.
drop policy if exists "notifications own delete" on public.notifications;

create policy "notifications own delete"
on public.notifications
for delete
to authenticated
using (user_id = auth.uid());

grant delete on public.notifications to authenticated;

-- 2. When work is completed or cancelled, remove its notifications for everyone.
create or replace function public.clear_finished_work_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('completed', 'cancelled')
     and old.status is distinct from new.status then
    delete from public.notifications
    where entity_type = 'work_item'
      and entity_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_finished_work_notifications() from public, anon, authenticated;

drop trigger if exists clear_finished_work_notifications on public.work_items;

create trigger clear_finished_work_notifications
after update of status on public.work_items
for each row
execute function public.clear_finished_work_notifications();

-- 3. One-off cleanup of notifications that are already stale.
delete from public.notifications n
using public.work_items w
where n.entity_type = 'work_item'
  and n.entity_id = w.id
  and w.status in ('completed', 'cancelled');

commit;
