-- My Leave: people can follow and cancel their own leave requests, and the
-- people who decide are told when a request arrives.
--
-- Already in place from an earlier migration: the person is notified when a
-- request is approved or declined. Not in place: nobody was told about a new
-- request unless an approver was picked on it, and the My Profile form does not
-- pick one. So this adds:
--   * A new request with no approver notifies the person's manager (if set) and
--     all active HR and admin staff.
--   * cancel_leave_request(id): the owner cancels their own PENDING request.
--   * Deciding or cancelling a request clears the "needs your decision" alerts.
--
-- Safe to run twice.

begin;

create or replace function public.cancel_leave_request(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  row public.leave_requests%rowtype;
begin
  select * into row from public.leave_requests where id = p_id for update;
  if not found or row.employee_id is distinct from auth.uid() then
    raise exception 'Leave request not found';
  end if;
  if row.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled. Ask HR to change one that was decided.';
  end if;

  update public.leave_requests set status = 'cancelled' where id = p_id;
  return 'cancelled';
end;
$$;

revoke all on function public.cancel_leave_request(uuid) from public, anon;
grant execute on function public.cancel_leave_request(uuid) to authenticated;

create or replace function public.notify_leave_deciders()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  who text;
  boss uuid;
begin
  if tg_op = 'INSERT' and new.approver_id is null then
    select coalesce(nullif(btrim(full_name), ''), email), manager_id into who, boss
    from public.employee_profiles where id = new.employee_id;

    insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
    select p.id,
           'leave_request_pending',
           'Leave request: ' || coalesce(who, 'Employee'),
           new.leave_type || ' (' || new.start_date || ' to ' || new.end_date || ')',
           'leave_request',
           new.id
    from public.employee_profiles p
    where p.active = true
      and p.id <> new.employee_id
      and (p.id = boss or lower(p.role) in ('hr', 'admin'));

  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' then
    delete from public.notifications
    where type = 'leave_request_pending' and entity_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_leave_deciders() from public, anon, authenticated;

drop trigger if exists notify_leave_deciders on public.leave_requests;
create trigger notify_leave_deciders
after insert or update of status on public.leave_requests
for each row execute function public.notify_leave_deciders();

commit;
