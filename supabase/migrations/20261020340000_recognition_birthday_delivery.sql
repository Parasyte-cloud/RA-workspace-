begin;

create or replace function public.materialize_birthday_ceremony_delivery(p_employee_id uuid,p_year integer,p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.employee_profiles%rowtype; v_id uuid; v_key text;
begin
  select * into p from public.employee_profiles where id=p_employee_id and active=true;
  if not found then return null; end if;
  v_key := 'birthday:'||p_employee_id::text||':'||p_year::text;
  insert into public.recognition_ceremony_deliveries(source_kind,source_key,recipient_id,audience_type,priority,eligible_at,expires_at,presentation)
  values('birthday',v_key,p_employee_id,'individual',85,p_now,p_now+interval '2 days',jsonb_build_object(
    'title','Happy Birthday '||split_part(coalesce(nullif(btrim(p.full_name),''),'there'),' ',1)||'!',
    'message','Everyone at RideArrivo is celebrating you. Thank you for the energy, ideas and care you bring to the team.',
    'employee_name',coalesce(nullif(btrim(p.full_name),''),'RideArrivo teammate'),
    'detail',concat_ws(' · ',nullif(btrim(p.job_title),''),nullif(btrim(p.department),''))
  )) on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.recognition_ceremony_deliveries where source_kind='birthday' and source_key=v_key and recipient_id=p_employee_id; end if;
  return v_id;
end; $$;
revoke all on function public.materialize_birthday_ceremony_delivery(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.materialize_birthday_ceremony_delivery(uuid,integer,timestamptz) to service_role;

create or replace function public.trigger_birthday_ceremony_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.materialize_birthday_ceremony_delivery(new.employee_id,new.year,new.sent_at); return new; end; $$;
revoke all on function public.trigger_birthday_ceremony_delivery() from public,anon,authenticated;
drop trigger if exists birthday_greeting_materialize_ceremony on public.birthday_greetings_sent;
create trigger birthday_greeting_materialize_ceremony after insert on public.birthday_greetings_sent
for each row execute function public.trigger_birthday_ceremony_delivery();

create or replace function public.ensure_my_birthday_delivery()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.employee_profiles%rowtype; v_today date:=(now() at time zone 'Africa/Lagos')::date; v_year integer:=extract(year from (now() at time zone 'Africa/Lagos'))::integer; before_count bigint; after_count bigint;
begin
  if not public.is_active_employee() then return 0; end if;
  select * into p from public.employee_profiles where id=auth.uid() and active=true;
  if not found or not public.is_birthday_on(p.date_of_birth,v_today) then return 0; end if;
  select count(*) into before_count from public.recognition_ceremony_deliveries where source_kind='birthday' and source_key='birthday:'||auth.uid()::text||':'||v_year::text and recipient_id=auth.uid();
  perform public.materialize_birthday_ceremony_delivery(auth.uid(),v_year,now());
  select count(*) into after_count from public.recognition_ceremony_deliveries where source_kind='birthday' and source_key='birthday:'||auth.uid()::text||':'||v_year::text and recipient_id=auth.uid();
  return (after_count-before_count)::integer;
end; $$;
revoke all on function public.ensure_my_birthday_delivery() from public,anon;
grant execute on function public.ensure_my_birthday_delivery() to authenticated;

create or replace function public.claim_next_recognition_ceremony()
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_delivery public.recognition_ceremony_deliveries%rowtype;
begin
  if not public.is_active_employee() then return null; end if;
  perform public.ensure_my_due_seasonal_deliveries();
  perform public.ensure_my_birthday_delivery();
  update public.recognition_ceremony_deliveries set state='expired',updated_at=now()
   where recipient_id=auth.uid() and state='pending' and expires_at is not null and expires_at<=now();
  select d.* into v_delivery from public.recognition_ceremony_deliveries d
   where d.recipient_id=auth.uid() and d.state='pending' and d.eligible_at<=now() and (d.expires_at is null or d.expires_at>now())
   order by d.priority desc,d.eligible_at,d.created_at,d.id limit 1 for update skip locked;
  if not found then return null; end if;
  perform public.refresh_due_seasonal_delivery_variant(v_delivery.id,now());
  update public.recognition_ceremony_deliveries set state='claimed',claimed_at=now(),updated_at=now()
   where id=v_delivery.id and recipient_id=auth.uid() and state='pending' returning * into v_delivery;
  if not found then return null; end if;
  return v_delivery.presentation || jsonb_build_object('delivery_id',v_delivery.id,'source_kind',v_delivery.source_kind,'source_id',v_delivery.source_id,'source_key',v_delivery.source_key,'audience_type',v_delivery.audience_type,'priority',v_delivery.priority,'department',v_delivery.department_snapshot,'revision',v_delivery.revision);
end; $$;
revoke all on function public.claim_next_recognition_ceremony() from public,anon;
grant execute on function public.claim_next_recognition_ceremony() to authenticated;

-- Backfill only the current calendar-year greeting log. It has an authoritative recipient.
select public.materialize_birthday_ceremony_delivery(g.employee_id,g.year,g.sent_at)
from public.birthday_greetings_sent g
where g.year=extract(year from (now() at time zone 'Africa/Lagos'))::integer;

commit;
