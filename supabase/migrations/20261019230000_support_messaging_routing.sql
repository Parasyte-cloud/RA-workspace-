-- PArAsYtE | RA-Workspace support module
-- RA Support Command Centre: load balancer for messaging channels
-- (WhatsApp, SMS, email, web chat, forms). Voice is balanced by TaskRouter;
-- this is the equivalent for tickets. Idempotent.
--
-- An officer receives a ticket only if ALL of these are true right now:
--   * enabled, and enabled for that channel
--   * presence is Available and their browser has checked in recently
--   * their shift is running (evaluated live, not from a stored flag)
--   * they are below their messaging capacity
-- Among the eligible, the winner is chosen by: specialist for the category,
-- then the officer already handling this customer, then the lightest load,
-- then whoever has waited longest for work.

begin;

create or replace function public.support_category_skill(p_category text)
returns text
language sql
immutable
as $$
  select case p_category
    when 'safety' then 'safety'
    when 'active_ride' then 'active_ride'
    when 'payment' then 'payments'
    when 'refund' then 'payments'
    when 'driver' then 'driver_support'
    when 'booking' then 'booking'
    else null end;
$$;

create or replace function public.support_eligible_agents(p_channel text, p_category text, p_customer uuid default null)
returns table (employee_id uuid, open_load integer, last_assigned_at timestamptz, sticky boolean, skilled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.employee_id,
         l.load,
         a.last_assigned_at,
         exists (
           select 1 from public.support_tickets st
            where st.customer_id = p_customer and p_customer is not null
              and st.assigned_agent_id = a.employee_id
              and st.status not in ('resolved','closed')
         ) as sticky,
         (public.support_category_skill(p_category) is null
           or public.support_category_skill(p_category) = any (a.skills)) as skilled
    from public.support_agents a
    join public.employee_profiles ep on ep.id = a.employee_id and ep.active
    join public.support_agent_presence p on p.employee_id = a.employee_id
    cross join lateral (
      select count(*)::int as load
        from public.support_tickets mt
       where mt.assigned_agent_id = a.employee_id and mt.channel <> 'voice'
         and mt.status in ('assigned','in_progress','escalated','waiting_internal')
    ) l
   where a.enabled and a.messaging_enabled
     and case p_channel
           when 'whatsapp' then a.whatsapp_enabled
           when 'sms' then a.sms_enabled
           when 'email' then a.email_enabled
           when 'web_chat' then a.web_chat_enabled
           else true end
     and p.state = 'available'
     and p.last_seen_at > now() - interval '120 seconds'
     and public.support_is_employee_on_shift(a.employee_id, now())
     and l.load < a.messaging_capacity;
$$;

create or replace function public.support_try_assign_ticket(p_ticket uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.support_tickets%rowtype;
  v_agent uuid;
begin
  -- Lock order is always: global assignment lock, then the ticket row.
  -- Serialising assignment keeps two callers from filling the same last slot.
  perform pg_advisory_xact_lock(hashtextextended('support_assign', 0));

  select * into v_t from public.support_tickets where id = p_ticket for update skip locked;
  if not found then return null; end if;
  if v_t.channel = 'voice' or v_t.assigned_agent_id is not null or v_t.status not in ('new','queued') then
    return null;
  end if;

  select e.employee_id into v_agent
    from public.support_eligible_agents(v_t.channel, v_t.category, v_t.customer_id) e
   order by e.skilled desc, e.sticky desc, e.open_load asc, e.last_assigned_at asc nulls first, e.employee_id
   limit 1;
  if v_agent is null then return null; end if;

  update public.support_tickets set assigned_agent_id = v_agent, status = 'assigned' where id = v_t.id;
  update public.support_agents set last_assigned_at = now() where employee_id = v_agent;
  insert into public.support_ticket_events (ticket_id, event_type, payload)
  values (v_t.id, 'auto_assigned', jsonb_build_object('agent', v_agent, 'channel', v_t.channel, 'category', v_t.category));
  return v_agent;
end;
$$;

-- Hand out whatever is waiting. Most urgent first, oldest first within a priority.
create or replace function public.support_assign_waiting(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('support_assign', 0));
  for r in
    select t.id from public.support_tickets t
     where t.status in ('new','queued') and t.assigned_agent_id is null and t.channel <> 'voice'
     order by t.priority, t.created_at
     limit greatest(1, p_limit)
  loop
    if public.support_try_assign_ticket(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- An officer who was given a ticket and then vanished (offline, away, break)
-- must not hold a customer hostage. Untouched tickets go back to the queue.
create or replace function public.support_requeue_orphaned(p_after interval default interval '5 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  with moved as (
    update public.support_tickets t
       set assigned_agent_id = null, status = 'queued'
     where t.status = 'assigned' and t.channel <> 'voice'
       and t.updated_at < now() - p_after
       and not exists (
         select 1 from public.support_agent_presence p
          where p.employee_id = t.assigned_agent_id
            and p.state in ('available','on_call','wrap_up')
            and p.last_seen_at > now() - interval '120 seconds')
    returning t.id
  )
  select count(*) into n from moved;
  return n;
end;
$$;

-- Route messaging tickets the moment a customer message lands.
create or replace function public.support_after_ingest_route()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.channel <> 'voice' and new.direction = 'inbound' and new.ticket_id is not null then
    begin
      perform public.support_try_assign_ticket(new.ticket_id);
    exception when others then
      raise warning 'support_after_ingest_route failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists support_after_ingest_route_trg on public.support_interactions;
create trigger support_after_ingest_route_trg
  after insert on public.support_interactions
  for each row execute function public.support_after_ingest_route();

-- Freeing capacity should pull the next waiting ticket straight away.
create or replace function public.support_tickets_capacity_freed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.channel <> 'voice'
     and new.status in ('resolved','closed','waiting_customer')
     and old.status is distinct from new.status then
    begin
      perform public.support_assign_waiting(20);
    exception when others then
      raise warning 'support_tickets_capacity_freed failed: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists support_tickets_capacity_freed_trg on public.support_tickets;
create trigger support_tickets_capacity_freed_trg
  after update of status on public.support_tickets
  for each row execute function public.support_tickets_capacity_freed();

revoke all on function public.support_category_skill(text) from public, anon, authenticated;
revoke all on function public.support_eligible_agents(text,text,uuid) from public, anon, authenticated;
revoke all on function public.support_try_assign_ticket(uuid) from public, anon, authenticated;
revoke all on function public.support_assign_waiting(integer) from public, anon, authenticated;
revoke all on function public.support_requeue_orphaned(interval) from public, anon, authenticated;
grant execute on function public.support_category_skill(text) to service_role;
grant execute on function public.support_eligible_agents(text,text,uuid) to service_role;
grant execute on function public.support_try_assign_ticket(uuid) to service_role;
grant execute on function public.support_assign_waiting(integer) to service_role;
grant execute on function public.support_requeue_orphaned(interval) to service_role;

commit;
