-- Support Command Centre: complaints, approval levels, customer record control, reports.
--
-- Adds, without changing what already works:
--   1. Rider / driver typing on customers and tickets.
--   2. A complaint record per ticket (what, who, which ride, severity, root
--      cause, resolution, compensation). Works for tickets that a call created.
--   3. Approval levels. Agents ask, supervisors approve sensitive ticket and
--      customer changes, managers approve money (refund, compensation).
--      Nobody approves their own request.
--   4. Customer edit and merge through approval, so one person is one record.
--   5. support_report_complaints(): SLA, response and resolution times, calls,
--      complaints by party, type, severity, repeat complainants, approvals.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Rider / driver typing, merge bookkeeping
-- ---------------------------------------------------------------------------

alter table public.support_customers add column if not exists party_type text
  check (party_type is null or party_type in ('rider','driver','other'));
alter table public.support_customers add column if not exists driver_ref text;
alter table public.support_customers add column if not exists merged_into uuid references public.support_customers(id) on delete set null;
alter table public.support_customers add column if not exists merged_at timestamptz;
create index if not exists support_customers_party_idx on public.support_customers (party_type) where merged_into is null;

alter table public.support_tickets add column if not exists party_type text
  check (party_type is null or party_type in ('rider','driver','other'));
alter table public.support_tickets add column if not exists kind text not null default 'enquiry'
  check (kind in ('enquiry','complaint'));
create index if not exists support_tickets_kind_idx on public.support_tickets (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Complaint record
-- ---------------------------------------------------------------------------

create table if not exists public.support_complaints (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  party_type text not null check (party_type in ('rider','driver','other')),
  complaint_type text not null default 'other'
    check (complaint_type in ('driver_conduct','rider_conduct','late_or_no_show','safety','payment_or_fare','refund','app_or_booking','vehicle','lost_item','service_quality','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  ride_ref text,
  booking_ref text,
  against_name text,
  against_ref text,
  description text not null check (char_length(btrim(description)) between 1 and 6000),
  root_cause text check (root_cause is null or char_length(root_cause) <= 2000),
  resolution text check (resolution is null or char_length(resolution) <= 2000),
  compensation_minor bigint not null default 0 check (compensation_minor >= 0),
  compensation_currency text not null default 'NGN' check (compensation_currency in ('NGN','USD','GBP','EUR')),
  compensation_status text not null default 'none' check (compensation_status in ('none','requested','approved','denied','paid')),
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_complaints_type_idx on public.support_complaints (complaint_type, severity);
create index if not exists support_complaints_party_idx on public.support_complaints (party_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Approval levels
-- ---------------------------------------------------------------------------

create table if not exists public.support_approvals (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('close_critical_ticket','reopen_ticket','edit_customer','merge_customers','compensation','refund')),
  level text not null check (level in ('supervisor','manager')),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  customer_id uuid references public.support_customers(id) on delete cascade,
  amount_minor bigint check (amount_minor is null or amount_minor > 0),
  currency text not null default 'NGN',
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid not null references public.employee_profiles(id) on delete restrict,
  decided_by uuid references public.employee_profiles(id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status = 'pending') = (decided_at is null) or status = 'cancelled')
);
create index if not exists support_approvals_status_idx on public.support_approvals (status, level, created_at desc);
create index if not exists support_approvals_ticket_idx on public.support_approvals (ticket_id);
-- One open request per action and record, so the same ask is not filed twice.
create unique index if not exists support_approvals_one_pending_idx
  on public.support_approvals (action, coalesce(ticket_id, customer_id))
  where status = 'pending';

-- Managers: administrators, managers, Head of Support, Support Manager.
-- (Support leads and flagged supervisors are supervisors but not managers.)
create or replace function public.support_is_manager(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.employee_profiles ep
     where ep.id = p_user and ep.active
       and (ep.role in ('manager','admin') or lower(ep.job_title) ~ '(head of support|support manager)')
  );
$$;

-- The level an action needs. Decided here, never by the browser.
create or replace function public.support_approval_level(p_action text)
returns text
language sql
immutable
as $$
  select case
    when p_action in ('refund','compensation') then 'manager'
    when p_action in ('close_critical_ticket','reopen_ticket','edit_customer','merge_customers') then 'supervisor'
    else null end;
$$;

create or replace function public.support_can_decide(p_user uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_level
    when 'manager' then public.support_is_manager(p_user)
    when 'supervisor' then public.support_is_supervisor(p_user)
    else false end;
$$;

-- P0 and P1, safety, and complaints marked critical cannot be closed on one
-- person's say-so.
create or replace function public.support_ticket_is_critical(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.support_tickets t
     where t.id = p_ticket
       and (t.priority in ('P0','P1') or t.category = 'safety'
            or exists (select 1 from public.support_complaints c where c.ticket_id = t.id and c.severity = 'critical'))
  );
$$;

-- Ask for approval.
create or replace function public.support_request_approval(
  p_action text,
  p_ticket uuid default null,
  p_customer uuid default null,
  p_amount_minor bigint default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_level text := public.support_approval_level(p_action);
  v_ticket public.support_tickets%rowtype;
  v_id uuid;
  v_label text;
  v_person record;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if v_level is null then raise exception 'unknown action %', p_action; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'say why in a few words'; end if;

  if p_action in ('close_critical_ticket','reopen_ticket','compensation','refund') then
    if p_ticket is null then raise exception 'a ticket is required'; end if;
    select * into v_ticket from public.support_tickets where id = p_ticket;
    if not found then raise exception 'ticket not found'; end if;
  end if;

  if p_action = 'close_critical_ticket' then
    if not public.support_ticket_is_critical(p_ticket) then raise exception 'this ticket does not need approval to close'; end if;
    if v_ticket.status <> 'resolved' then raise exception 'resolve the ticket first, then ask for it to be closed'; end if;
  elsif p_action = 'reopen_ticket' then
    if v_ticket.status not in ('resolved','closed') then raise exception 'only resolved or closed tickets can be reopened'; end if;
  elsif p_action in ('compensation','refund') then
    if coalesce(p_amount_minor, 0) <= 0 then raise exception 'enter an amount greater than zero'; end if;
    if not exists (select 1 from public.support_complaints where ticket_id = p_ticket) then
      raise exception 'record the complaint details before asking for money to be approved';
    end if;
  elsif p_action in ('edit_customer','merge_customers') then
    if p_customer is null then raise exception 'a customer is required'; end if;
    if not exists (select 1 from public.support_customers where id = p_customer and merged_into is null) then
      raise exception 'customer not found';
    end if;
    if p_action = 'merge_customers' then
      if coalesce(p_payload ->> 'into', '') = '' or (p_payload ->> 'into')::uuid = p_customer then
        raise exception 'choose a different customer to keep';
      end if;
      if not exists (select 1 from public.support_customers where id = (p_payload ->> 'into')::uuid and merged_into is null) then
        raise exception 'the customer to keep was not found';
      end if;
    end if;
  end if;

  begin
    insert into public.support_approvals (action, level, ticket_id, customer_id, amount_minor, currency, reason, payload, requested_by)
    values (p_action, v_level, p_ticket, p_customer, p_amount_minor,
            coalesce(nullif(p_payload ->> 'currency', ''), 'NGN'), btrim(p_reason), coalesce(p_payload, '{}'::jsonb), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this has already been sent for approval and is waiting';
  end;

  if p_action in ('compensation','refund') then
    update public.support_complaints
       set compensation_status = 'requested', compensation_minor = p_amount_minor,
           compensation_currency = coalesce(nullif(p_payload ->> 'currency', ''), 'NGN'), updated_at = now()
     where ticket_id = p_ticket;
  end if;
  if p_ticket is not null then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (p_ticket, auth.uid(), 'approval_requested', jsonb_build_object('approval', v_id, 'action', p_action, 'level', v_level));
  end if;
  perform public.support_write_audit(auth.uid(), 'approval_requested', 'approval', v_id::text,
    jsonb_build_object('action', p_action, 'level', v_level, 'ticket', p_ticket, 'customer', p_customer, 'amount_minor', p_amount_minor));

  v_label := case p_action
    when 'close_critical_ticket' then 'Close a critical ticket'
    when 'reopen_ticket' then 'Reopen a ticket'
    when 'edit_customer' then 'Change a customer record'
    when 'merge_customers' then 'Merge two customer records'
    when 'compensation' then 'Compensation'
    else 'Refund' end;
  for v_person in
    select ep.id from public.employee_profiles ep
     where ep.active and ep.id <> auth.uid() and public.support_can_decide(ep.id, v_level)
  loop
    insert into public.support_notifications (recipient_id, kind, severity, title, body, entity_type, entity_id, level, data)
    values (v_person.id, 'approval_requested', 'info', 'Approval needed: ' || v_label,
            left(btrim(p_reason), 300), 'approval', v_id::text, 0, jsonb_build_object('tab', 'approvals'));
  end loop;
  return v_id;
end;
$$;

-- Internal: do what an approved request asked for.
create or replace function public.support_apply_approval(p_row public.support_approvals)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from uuid; v_into uuid;
  v_name text; v_phone text; v_email text;
  r record;
begin
  if p_row.action = 'close_critical_ticket' then
    update public.support_tickets set status = 'closed' where id = p_row.ticket_id and status = 'resolved';
    if not found then raise exception 'the ticket is no longer resolved, so it cannot be closed'; end if;

  elsif p_row.action = 'reopen_ticket' then
    update public.support_tickets set status = 'reopened' where id = p_row.ticket_id and status in ('resolved','closed');
    if not found then raise exception 'the ticket is already open'; end if;

  elsif p_row.action in ('compensation','refund') then
    update public.support_complaints
       set compensation_status = 'approved', compensation_minor = p_row.amount_minor, compensation_currency = p_row.currency, updated_at = now()
     where ticket_id = p_row.ticket_id;

  elsif p_row.action = 'edit_customer' then
    v_name := nullif(btrim(coalesce(p_row.payload ->> 'display_name', '')), '');
    v_phone := nullif(btrim(coalesce(p_row.payload ->> 'phone', '')), '');
    v_email := nullif(lower(btrim(coalesce(p_row.payload ->> 'email', ''))), '');
    if v_phone is not null then v_phone := coalesce(public.support_normalize_phone(v_phone), v_phone); end if;
    update public.support_customers
       set display_name = coalesce(v_name, display_name),
           primary_phone = coalesce(v_phone, primary_phone),
           primary_email = coalesce(v_email, primary_email),
           party_type = coalesce(nullif(p_row.payload ->> 'party_type', ''), party_type),
           driver_ref = coalesce(nullif(btrim(coalesce(p_row.payload ->> 'driver_ref', '')), ''), driver_ref),
           updated_at = now()
     where id = p_row.customer_id and merged_into is null;
    if v_phone is not null then
      insert into public.support_customer_identities (customer_id, identity_type, identity_value)
      values (p_row.customer_id, 'phone', v_phone) on conflict (identity_type, identity_value) do nothing;
    end if;
    if v_email is not null then
      insert into public.support_customer_identities (customer_id, identity_type, identity_value)
      values (p_row.customer_id, 'email', v_email) on conflict (identity_type, identity_value) do nothing;
    end if;

  elsif p_row.action = 'merge_customers' then
    v_from := p_row.customer_id;
    v_into := (p_row.payload ->> 'into')::uuid;
    if not exists (select 1 from public.support_customers where id = v_from and merged_into is null)
       or not exists (select 1 from public.support_customers where id = v_into and merged_into is null) then
      raise exception 'one of the customers was already merged or removed';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(least(v_from, v_into)::text, 0));
    -- Move every row in the schema that points at the old record, whatever table
    -- it is in, so a table added later is covered without editing this function.
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.contype = 'f' and c.confrelid = 'public.support_customers'::regclass
         and c.conrelid <> 'public.support_customers'::regclass and array_length(c.conkey, 1) = 1
    loop
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using v_into, v_from;
    end loop;
    update public.support_customers k
       set display_name = coalesce(k.display_name, o.display_name),
           primary_phone = coalesce(k.primary_phone, o.primary_phone),
           primary_email = coalesce(k.primary_email, o.primary_email),
           party_type = coalesce(k.party_type, o.party_type),
           driver_ref = coalesce(k.driver_ref, o.driver_ref),
           rider_id = coalesce(k.rider_id, o.rider_id),
           updated_at = now()
      from public.support_customers o
     where k.id = v_into and o.id = v_from;
    update public.support_customers set merged_into = v_into, merged_at = now(), updated_at = now() where id = v_from;
  end if;
end;
$$;

create or replace function public.support_decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.support_approvals%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_row from public.support_approvals where id = p_id for update;
  if not found then raise exception 'approval not found'; end if;
  if v_row.status <> 'pending' then raise exception 'this request has already been decided'; end if;
  if v_row.requested_by = auth.uid() then raise exception 'you cannot approve your own request'; end if;
  if not public.support_can_decide(auth.uid(), v_row.level) then
    raise exception 'only a % can decide this request', v_row.level;
  end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why it was declined'; end if;

  if p_approve then
    perform public.support_apply_approval(v_row);
  elsif v_row.action in ('compensation','refund') then
    update public.support_complaints set compensation_status = 'denied', updated_at = now() where ticket_id = v_row.ticket_id;
  end if;

  update public.support_approvals
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  if v_row.ticket_id is not null then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_row.ticket_id, auth.uid(), case when p_approve then 'approval_granted' else 'approval_denied' end,
            jsonb_build_object('approval', p_id, 'action', v_row.action));
  end if;
  perform public.support_write_audit(auth.uid(), case when p_approve then 'approval_granted' else 'approval_denied' end,
    'approval', p_id::text, jsonb_build_object('action', v_row.action, 'requested_by', v_row.requested_by, 'note', left(coalesce(p_note, ''), 200)));
  insert into public.support_notifications (recipient_id, kind, severity, title, body, entity_type, entity_id, level, data)
  values (v_row.requested_by, 'approval_decided', 'info',
          case when p_approve then 'Approved' else 'Declined' end || ': ' || replace(v_row.action, '_', ' '),
          left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_row.reason), 300), 'approval', p_id::text, 0, jsonb_build_object('tab', 'approvals'));
end;
$$;

create or replace function public.support_cancel_approval(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.support_approvals%rowtype;
begin
  select * into v_row from public.support_approvals where id = p_id for update;
  if not found or v_row.status <> 'pending' then raise exception 'nothing to cancel'; end if;
  if v_row.requested_by <> auth.uid() and not public.support_is_supervisor(auth.uid()) then raise exception 'only the requester or a supervisor can cancel'; end if;
  update public.support_approvals set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
  if v_row.action in ('compensation','refund') then
    update public.support_complaints set compensation_status = 'none', updated_at = now()
     where ticket_id = v_row.ticket_id and compensation_status = 'requested';
  end if;
  perform public.support_write_audit(auth.uid(), 'approval_cancelled', 'approval', p_id::text, jsonb_build_object('action', v_row.action));
end;
$$;

-- Money leaves through Finance. A manager records that it was paid.
create or replace function public.support_mark_compensation_paid(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_manager(auth.uid()) then raise exception 'manager access required'; end if;
  update public.support_complaints set compensation_status = 'paid', updated_at = now()
   where ticket_id = p_ticket and compensation_status = 'approved';
  if not found then raise exception 'there is no approved compensation on this ticket'; end if;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload) values (p_ticket, auth.uid(), 'compensation_paid', '{}'::jsonb);
  perform public.support_write_audit(auth.uid(), 'compensation_paid', 'ticket', p_ticket::text, '{}'::jsonb);
end;
$$;

-- The list the Approvals tab shows. Supervisors and managers see what they can
-- decide plus everything they asked for; agents see only their own requests.
create or replace function public.support_approvals_list(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_out from (
    select a.id, a.action, a.level, a.status, a.ticket_id, t.public_id, t.subject, a.customer_id,
           coalesce(c.display_name, c.primary_phone, c.primary_email) as customer_name,
           a.amount_minor, a.currency, a.reason, a.payload, a.decision_note, a.created_at, a.decided_at,
           rq.full_name as requested_by_name, dc.full_name as decided_by_name,
           (a.status = 'pending' and a.requested_by <> auth.uid() and public.support_can_decide(auth.uid(), a.level)) as can_decide,
           (a.requested_by = auth.uid()) as mine
      from public.support_approvals a
      left join public.support_tickets t on t.id = a.ticket_id
      left join public.support_customers c on c.id = a.customer_id
      left join public.employee_profiles rq on rq.id = a.requested_by
      left join public.employee_profiles dc on dc.id = a.decided_by
     where (p_status = 'all' or a.status = p_status)
       and (a.requested_by = auth.uid() or public.support_can_decide(auth.uid(), a.level) or public.support_is_supervisor(auth.uid()))
     order by a.created_at desc
     limit 200
  ) x;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ticket rules that need approval (replaces support_update_ticket)
-- ---------------------------------------------------------------------------

create or replace function public.support_update_ticket(
  p_ticket uuid,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_subject text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_super boolean := public.support_is_supervisor(auth.uid());
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'ticket not found'; end if;

  if not v_super and v_ticket.assigned_agent_id is not null and v_ticket.assigned_agent_id <> auth.uid() then
    raise exception 'this ticket belongs to another officer';
  end if;

  if p_status is not null then
    if p_status not in ('in_progress','waiting_customer','waiting_internal','escalated','resolved','closed','reopened') then
      raise exception 'status % cannot be set manually', p_status;
    end if;
    if p_status = 'reopened' then
      if v_ticket.status not in ('resolved','closed') then
        raise exception 'only resolved or closed tickets can be reopened';
      end if;
      if not v_super then
        raise exception 'reopening needs a supervisor. Use "Ask to reopen" so one can approve it.';
      end if;
    end if;
    if p_status = 'closed' then
      if v_ticket.status <> 'resolved' and not v_super then
        raise exception 'resolve the ticket before closing it';
      end if;
      if public.support_ticket_is_critical(p_ticket) then
        raise exception 'this is a critical ticket (P0, P1, safety or a critical complaint). Use "Ask to close" so a second person approves it.';
      end if;
    end if;
  end if;
  if p_priority is not null and p_priority not in ('P0','P1','P2','P3','P4') then
    raise exception 'invalid priority';
  end if;
  if p_category is not null and p_category !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'invalid category';
  end if;

  update public.support_tickets
     set status = coalesce(p_status, status),
         priority = coalesce(p_priority, priority),
         category = coalesce(p_category, category),
         subject = coalesce(nullif(btrim(p_subject), ''), subject),
         assigned_agent_id = case
           when assigned_agent_id is null and exists (select 1 from public.support_agents where employee_id = auth.uid() and enabled)
             then auth.uid()
           else assigned_agent_id end
   where id = p_ticket;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Raise a complaint, from scratch or on the ticket a call already created
-- ---------------------------------------------------------------------------

create or replace function public.support_raise_complaint(
  p_party text,
  p_description text,
  p_ticket uuid default null,
  p_customer_name text default null,
  p_phone text default null,
  p_email text default null,
  p_subject text default null,
  p_complaint_type text default 'other',
  p_severity text default 'medium',
  p_ride_ref text default null,
  p_booking_ref text default null,
  p_against_name text default null,
  p_against_ref text default null,
  p_channel text default 'form'
) returns table (ticket_id uuid, public_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_customer uuid;
  v_phone text;
  v_priority text;
  v_queue uuid;
  v_subject text;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if p_party not in ('rider','driver','other') then raise exception 'choose rider, driver or other'; end if;
  if p_severity not in ('low','medium','high','critical') then raise exception 'invalid severity'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 5 then raise exception 'describe the complaint'; end if;
  if p_channel not in ('voice','whatsapp','web_chat','email','sms','form') then raise exception 'invalid channel'; end if;

  v_priority := case p_severity when 'critical' then 'P0' when 'high' then 'P1' when 'medium' then 'P2' else 'P3' end;
  v_subject := left(coalesce(nullif(btrim(coalesce(p_subject, '')), ''), 'Complaint: ' || replace(p_complaint_type, '_', ' ')), 200);

  if p_ticket is not null then
    select * into v_ticket from public.support_tickets where id = p_ticket for update;
    if not found then raise exception 'ticket not found'; end if;
    v_customer := v_ticket.customer_id;
    update public.support_tickets
       set kind = 'complaint', party_type = p_party,
           category = case when category in ('general_enquiry','driver','complaint') then 'complaint' else category end,
           priority = case when v_priority < priority then v_priority else priority end,
           subject = case when subject in ('Support call','Support request') then v_subject else subject end
     where id = p_ticket
    returning * into v_ticket;
  else
    v_phone := nullif(btrim(coalesce(p_phone, '')), '');
    if v_phone is not null then v_phone := coalesce(public.support_normalize_phone(v_phone), v_phone); end if;
    if v_phone is not null then
      v_customer := public.support_resolve_customer('phone', v_phone, p_customer_name);
    elsif nullif(btrim(coalesce(p_email, '')), '') is not null then
      v_customer := public.support_resolve_customer('email', p_email, p_customer_name);
    else
      raise exception 'a phone number or an email is needed to find or create the customer';
    end if;
    if nullif(btrim(coalesce(p_email, '')), '') is not null then
      insert into public.support_customer_identities (customer_id, identity_type, identity_value)
      values (v_customer, 'email', lower(btrim(p_email))) on conflict (identity_type, identity_value) do nothing;
      update public.support_customers set primary_email = coalesce(primary_email, lower(btrim(p_email))) where id = v_customer;
    end if;
    select q.id into v_queue from public.support_queues q
     where q.active and (case when p_severity = 'critical' then q.name = 'Safety & Emergency' else q.channel = p_channel end)
     order by q.priority, q.name limit 1;
    insert into public.support_tickets (customer_id, subject, category, channel, priority, status, queue_id, kind, party_type)
    values (v_customer, v_subject, case when p_complaint_type = 'safety' then 'safety' else 'complaint' end,
            p_channel, v_priority, 'queued', v_queue, 'complaint', p_party)
    returning * into v_ticket;
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_ticket.id, auth.uid(), 'ticket_created', jsonb_build_object('channel', p_channel, 'kind', 'complaint', 'priority', v_priority));
  end if;

  insert into public.support_complaints (ticket_id, party_type, complaint_type, severity, ride_ref, booking_ref, against_name, against_ref, description, created_by)
  values (v_ticket.id, p_party, p_complaint_type, p_severity, nullif(btrim(coalesce(p_ride_ref, '')), ''), nullif(btrim(coalesce(p_booking_ref, '')), ''),
          nullif(btrim(coalesce(p_against_name, '')), ''), nullif(btrim(coalesce(p_against_ref, '')), ''), btrim(p_description), auth.uid())
  on conflict on constraint support_complaints_pkey do update
     set party_type = excluded.party_type, complaint_type = excluded.complaint_type, severity = excluded.severity,
         ride_ref = excluded.ride_ref, booking_ref = excluded.booking_ref, against_name = excluded.against_name,
         against_ref = excluded.against_ref, description = excluded.description, updated_at = now();

  update public.support_customers set party_type = p_party, updated_at = now() where id = v_customer and party_type is null;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (v_ticket.id, auth.uid(), 'complaint_recorded', jsonb_build_object('party', p_party, 'type', p_complaint_type, 'severity', p_severity));
  perform public.support_write_audit(auth.uid(), 'complaint_recorded', 'ticket', v_ticket.id::text,
    jsonb_build_object('party', p_party, 'type', p_complaint_type, 'severity', p_severity));
  return query select v_ticket.id, v_ticket.public_id;
end;
$$;

-- Root cause and resolution, written while handling the ticket.
create or replace function public.support_update_complaint(p_ticket uuid, p_root_cause text default null, p_resolution text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_t public.support_tickets%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_t from public.support_tickets where id = p_ticket;
  if not found then raise exception 'ticket not found'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_t.assigned_agent_id is not null and v_t.assigned_agent_id <> auth.uid() then
    raise exception 'this ticket belongs to another officer';
  end if;
  update public.support_complaints
     set root_cause = coalesce(left(nullif(btrim(p_root_cause), ''), 2000), root_cause),
         resolution = coalesce(left(nullif(btrim(p_resolution), ''), 2000), resolution), updated_at = now()
   where ticket_id = p_ticket;
  if not found then raise exception 'this ticket has no complaint record'; end if;
end;
$$;

-- Complaint, approvals and customer for the ticket drawer.
create or replace function public.support_complaint_detail(p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select jsonb_build_object(
    'complaint', (select to_jsonb(c) from public.support_complaints c where c.ticket_id = p_ticket),
    'critical', public.support_ticket_is_critical(p_ticket),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'status', a.status, 'level', a.level,
        'amount_minor', a.amount_minor, 'created_at', a.created_at) order by a.created_at desc)
       from public.support_approvals a where a.ticket_id = p_ticket), '[]'::jsonb),
    'party_type', (select t.party_type from public.support_tickets t where t.id = p_ticket),
    'customer_id', (select t.customer_id from public.support_tickets t where t.id = p_ticket)
  ) into v_out;
  return v_out;
end;
$$;

-- Complaints list with filters.
create or replace function public.support_complaints_list(
  p_party text default null, p_status text default null, p_from timestamptz default null, p_to timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_out from (
    select t.id as ticket_id, t.public_id, t.subject, t.status, t.priority, t.channel, t.created_at,
           c.party_type, c.complaint_type, c.severity, c.ride_ref, c.booking_ref, c.against_name, c.compensation_status,
           c.compensation_minor, c.compensation_currency,
           coalesce(cu.display_name, cu.primary_phone, cu.primary_email) as customer_name,
           ep.full_name as agent_name
      from public.support_complaints c
      join public.support_tickets t on t.id = c.ticket_id
      left join public.support_customers cu on cu.id = t.customer_id
      left join public.employee_profiles ep on ep.id = t.assigned_agent_id
     where (p_party is null or c.party_type = p_party)
       and (p_status is null or (p_status = 'open' and t.status not in ('resolved','closed')) or (p_status = 'done' and t.status in ('resolved','closed')))
       and t.created_at >= coalesce(p_from, now() - interval '90 days')
       and t.created_at <= coalesce(p_to, now())
     order by t.created_at desc
     limit 300
  ) x;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Customer records: one person, one record
-- ---------------------------------------------------------------------------

-- Supervisors change a record directly (audited). Everyone else asks.
-- Filling in a missing party type is always direct.
create or replace function public.support_edit_customer(
  p_customer uuid,
  p_display_name text default null,
  p_phone text default null,
  p_email text default null,
  p_party_type text default null,
  p_driver_ref text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.support_customers%rowtype;
  v_payload jsonb;
  v_id uuid;
  v_row public.support_approvals%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_c from public.support_customers where id = p_customer and merged_into is null for update;
  if not found then raise exception 'customer not found'; end if;
  if p_party_type is not null and p_party_type not in ('rider','driver','other') then raise exception 'invalid party type'; end if;

  if p_party_type is not null and v_c.party_type is null
     and p_display_name is null and p_phone is null and p_email is null and p_driver_ref is null then
    update public.support_customers set party_type = p_party_type, updated_at = now() where id = p_customer;
    perform public.support_write_audit(auth.uid(), 'customer_party_set', 'customer', p_customer::text, jsonb_build_object('party_type', p_party_type));
    return jsonb_build_object('applied', true);
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object('display_name', nullif(btrim(coalesce(p_display_name, '')), ''),
    'phone', nullif(btrim(coalesce(p_phone, '')), ''), 'email', nullif(btrim(coalesce(p_email, '')), ''),
    'party_type', p_party_type, 'driver_ref', nullif(btrim(coalesce(p_driver_ref, '')), '')));
  if v_payload = '{}'::jsonb then raise exception 'nothing to change'; end if;

  if public.support_is_supervisor(auth.uid()) then
    v_row.action := 'edit_customer'; v_row.customer_id := p_customer; v_row.payload := v_payload; v_row.currency := 'NGN';
    perform public.support_apply_approval(v_row);
    perform public.support_write_audit(auth.uid(), 'customer_edited', 'customer', p_customer::text,
      jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(v_payload) k), 'reason', left(coalesce(p_reason, ''), 200)));
    return jsonb_build_object('applied', true);
  end if;

  v_id := public.support_request_approval('edit_customer', null, p_customer, null, coalesce(p_reason, ''), v_payload);
  return jsonb_build_object('applied', false, 'approval_id', v_id);
end;
$$;

create or replace function public.support_request_merge(p_from uuid, p_into uuid, p_reason text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.support_request_approval('merge_customers', null, p_from, null, p_reason, jsonb_build_object('into', p_into));
$$;

-- Likely duplicates for a customer: same last 9 digits of a phone, or same email.
create or replace function public.support_customer_duplicates(p_customer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_out from (
    select c.id, coalesce(c.display_name, c.primary_phone, c.primary_email) as name, c.primary_phone, c.primary_email, c.party_type,
           (select count(*) from public.support_tickets t where t.customer_id = c.id) as tickets
      from public.support_customers c
      join public.support_customers me on me.id = p_customer
     where c.id <> me.id and c.merged_into is null
       and ((me.primary_email is not null and lower(c.primary_email) = lower(me.primary_email))
            or (me.primary_phone is not null and c.primary_phone is not null and right(regexp_replace(c.primary_phone, '\D', '', 'g'), 9) = right(regexp_replace(me.primary_phone, '\D', '', 'g'), 9)))
     limit 10
  ) x;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reporting
-- ---------------------------------------------------------------------------

create or replace function public.support_report_complaints(
  p_from timestamptz default null, p_to timestamptz default null, p_party text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_from timestamptz; v_to timestamptz; v_out jsonb;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '30 days');
  if v_from >= v_to then raise exception 'the start of the range must be before the end'; end if;
  if v_to - v_from > interval '366 days' then raise exception 'ranges longer than 366 days are not supported'; end if;
  if p_party is not null and p_party not in ('rider','driver','other') then raise exception 'invalid party'; end if;

  with t as (
    select t.*, c.complaint_type, c.severity, c.compensation_minor, c.compensation_status, c.compensation_currency
      from public.support_tickets t
      left join public.support_complaints c on c.ticket_id = t.id
     where t.created_at >= v_from and t.created_at < v_to
       and (p_party is null or t.party_type = p_party)
  ), calls as (
    select sc.*, tk.party_type as tparty
      from public.support_calls sc
      left join public.support_tickets tk on tk.id = sc.ticket_id
     where sc.created_at >= v_from and sc.created_at < v_to
       and (p_party is null or tk.party_type = p_party)
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'totals', (select jsonb_build_object(
        'tickets', count(*), 'complaints', count(*) filter (where kind = 'complaint'),
        'open', count(*) filter (where status not in ('resolved','closed')),
        'resolved', count(*) filter (where status in ('resolved','closed')),
        'reopened', count(*) filter (where reopen_count > 0)) from t),
    'sla', (select jsonb_build_object(
        'first_response_met', count(*) filter (where first_responded_at is not null and first_responded_at <= first_response_due_at),
        'first_response_missed', count(*) filter (where (first_responded_at is not null and first_responded_at > first_response_due_at)
                                                  or (first_responded_at is null and first_response_due_at < now() and status not in ('resolved','closed'))),
        'resolution_met', count(*) filter (where resolved_at is not null and resolved_at <= resolution_due_at),
        'resolution_missed', count(*) filter (where (resolved_at is not null and resolved_at > resolution_due_at)
                                                  or (resolved_at is null and resolution_due_at < now() and status not in ('resolved','closed'))),
        'avg_first_response_minutes', round(avg(extract(epoch from (first_responded_at - created_at)) / 60) filter (where first_responded_at is not null)::numeric, 1),
        'avg_resolution_minutes', round(avg(extract(epoch from (resolved_at - created_at)) / 60) filter (where resolved_at is not null)::numeric, 1)) from t),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'tickets', n, 'complaints', k) order by d)
        from (select (created_at at time zone 'Africa/Lagos')::date as d, count(*) as n, count(*) filter (where kind = 'complaint') as k from t group by 1) s), '[]'::jsonb),
    'by_party', coalesce((select jsonb_agg(jsonb_build_object('party', coalesce(party_type, 'unknown'), 'tickets', n, 'complaints', k, 'open', o) order by n desc)
        from (select party_type, count(*) as n, count(*) filter (where kind = 'complaint') as k, count(*) filter (where status not in ('resolved','closed')) as o from t group by 1) s), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'tickets', n, 'open', o) order by n desc)
        from (select category, count(*) as n, count(*) filter (where status not in ('resolved','closed')) as o from t group by 1) s), '[]'::jsonb),
    'by_channel', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'tickets', n) order by n desc)
        from (select channel, count(*) as n from t group by 1) s), '[]'::jsonb),
    'complaints_by_type', coalesce((select jsonb_agg(jsonb_build_object('type', complaint_type, 'count', n) order by n desc)
        from (select complaint_type, count(*) as n from t where kind = 'complaint' group by 1) s), '[]'::jsonb),
    'complaints_by_severity', coalesce((select jsonb_agg(jsonb_build_object('severity', severity, 'count', n) order by array_position(array['critical','high','medium','low'], severity))
        from (select severity, count(*) as n from t where kind = 'complaint' group by 1) s), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'handled', n, 'resolved', r, 'avg_resolution_minutes', m) order by n desc)
        from (select coalesce(ep.full_name, 'Unassigned') as name, count(*) as n,
                     count(*) filter (where t.status in ('resolved','closed')) as r,
                     round(avg(extract(epoch from (t.resolved_at - t.created_at)) / 60) filter (where t.resolved_at is not null)::numeric, 1) as m
                from t left join public.employee_profiles ep on ep.id = t.assigned_agent_id group by 1) s), '[]'::jsonb),
    'calls', (select jsonb_build_object(
        'total', count(*), 'inbound', count(*) filter (where direction = 'inbound'), 'outbound', count(*) filter (where direction = 'outbound'),
        'answered', count(*) filter (where answered_at is not null), 'abandoned', count(*) filter (where abandoned),
        'with_ticket', count(*) filter (where ticket_id is not null),
        'avg_duration_seconds', round(avg(duration_seconds) filter (where duration_seconds is not null)::numeric, 0),
        'avg_wait_seconds', round(avg(wait_seconds) filter (where wait_seconds is not null)::numeric, 0)) from calls),
    'repeat_complainants', coalesce((select jsonb_agg(jsonb_build_object('customer_id', customer_id, 'name', name, 'party', party, 'complaints', n) order by n desc)
        from (select t.customer_id, coalesce(cu.display_name, cu.primary_phone, cu.primary_email) as name, cu.party_type as party, count(*) as n
                from t join public.support_customers cu on cu.id = t.customer_id
               where t.kind = 'complaint' group by 1, 2, 3 having count(*) >= 2 order by n desc limit 10) s), '[]'::jsonb),
    'most_complained_about', coalesce((select jsonb_agg(jsonb_build_object('name', against, 'complaints', n) order by n desc)
        from (select coalesce(nullif(c.against_name, ''), c.against_ref) as against, count(*) as n
                from public.support_complaints c join t on t.id = c.ticket_id
               where coalesce(nullif(c.against_name, ''), c.against_ref) is not null group by 1 having count(*) >= 2 order by n desc limit 10) s), '[]'::jsonb),
    'compensation', (select jsonb_build_object(
        'approved_minor', coalesce(sum(compensation_minor) filter (where compensation_status in ('approved','paid')), 0),
        'paid_minor', coalesce(sum(compensation_minor) filter (where compensation_status = 'paid'), 0),
        'requested_minor', coalesce(sum(compensation_minor) filter (where compensation_status = 'requested'), 0)) from t),
    'approvals', (select jsonb_build_object(
        'requested', count(*), 'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'), 'denied', count(*) filter (where status = 'denied'),
        'avg_decision_minutes', round(avg(extract(epoch from (decided_at - created_at)) / 60) filter (where status in ('approved','denied'))::numeric, 1))
        from public.support_approvals where created_at >= v_from and created_at < v_to)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Security: RLS, grants
-- ---------------------------------------------------------------------------

alter table public.support_complaints enable row level security;
alter table public.support_approvals enable row level security;
revoke all on table public.support_complaints from public, anon, authenticated;
revoke all on table public.support_approvals from public, anon, authenticated;
drop policy if exists support_staff_read on public.support_complaints;
create policy support_staff_read on public.support_complaints for select to authenticated using (public.support_is_staff(auth.uid()));
grant select on public.support_complaints to authenticated;
drop policy if exists support_approvals_read on public.support_approvals;
create policy support_approvals_read on public.support_approvals for select to authenticated
  using (requested_by = auth.uid() or public.support_is_supervisor(auth.uid()));
grant select on public.support_approvals to authenticated;

revoke all on function public.support_is_manager(uuid) from public, anon;
revoke all on function public.support_approval_level(text) from public, anon;
revoke all on function public.support_can_decide(uuid, text) from public, anon;
revoke all on function public.support_ticket_is_critical(uuid) from public, anon;
revoke all on function public.support_request_approval(text,uuid,uuid,bigint,text,jsonb) from public, anon;
revoke all on function public.support_apply_approval(public.support_approvals) from public, anon, authenticated;
revoke all on function public.support_decide_approval(uuid,boolean,text) from public, anon;
revoke all on function public.support_cancel_approval(uuid) from public, anon;
revoke all on function public.support_mark_compensation_paid(uuid) from public, anon;
revoke all on function public.support_approvals_list(text) from public, anon;
revoke all on function public.support_update_ticket(uuid,text,text,text,text) from public, anon;
revoke all on function public.support_raise_complaint(text,text,uuid,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.support_update_complaint(uuid,text,text) from public, anon;
revoke all on function public.support_complaint_detail(uuid) from public, anon;
revoke all on function public.support_complaints_list(text,text,timestamptz,timestamptz) from public, anon;
revoke all on function public.support_edit_customer(uuid,text,text,text,text,text,text) from public, anon;
revoke all on function public.support_request_merge(uuid,uuid,text) from public, anon;
revoke all on function public.support_customer_duplicates(uuid) from public, anon;
revoke all on function public.support_report_complaints(timestamptz,timestamptz,text) from public, anon;

grant execute on function public.support_is_manager(uuid) to authenticated, service_role;
grant execute on function public.support_approval_level(text) to authenticated, service_role;
grant execute on function public.support_can_decide(uuid, text) to authenticated, service_role;
grant execute on function public.support_ticket_is_critical(uuid) to authenticated, service_role;
grant execute on function public.support_request_approval(text,uuid,uuid,bigint,text,jsonb) to authenticated;
grant execute on function public.support_decide_approval(uuid,boolean,text) to authenticated;
grant execute on function public.support_cancel_approval(uuid) to authenticated;
grant execute on function public.support_mark_compensation_paid(uuid) to authenticated;
grant execute on function public.support_approvals_list(text) to authenticated;
grant execute on function public.support_update_ticket(uuid,text,text,text,text) to authenticated;
grant execute on function public.support_raise_complaint(text,text,uuid,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.support_update_complaint(uuid,text,text) to authenticated;
grant execute on function public.support_complaint_detail(uuid) to authenticated;
grant execute on function public.support_complaints_list(text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.support_edit_customer(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.support_request_merge(uuid,uuid,text) to authenticated;
grant execute on function public.support_customer_duplicates(uuid) to authenticated;
grant execute on function public.support_report_complaints(timestamptz,timestamptz,text) to authenticated;

-- Guard the install: stop with a clear message if any of this did not land.
do $$
begin
  if to_regclass('public.support_complaints') is null or to_regclass('public.support_approvals') is null then
    raise exception 'support complaints migration incomplete: tables missing';
  end if;
  if public.support_approval_level('refund') <> 'manager' or public.support_approval_level('merge_customers') <> 'supervisor' then
    raise exception 'support complaints migration incomplete: approval levels wrong';
  end if;
end $$;
