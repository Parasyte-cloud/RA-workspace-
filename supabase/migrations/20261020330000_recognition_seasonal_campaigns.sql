begin;

alter table public.recognition_governance_audit_events
  drop constraint if exists recognition_governance_audit_events_action_check;
alter table public.recognition_governance_audit_events
  add constraint recognition_governance_audit_events_action_check check (action in (
    'RECOGNITION_CEREMONY_REISSUED','AWARD_ISSUED','AWARD_VISIBILITY_CHANGED','AWARD_REVOKED',
    'SEASONAL_CAMPAIGN_SAVED','SEASONAL_CAMPAIGN_SCHEDULED','SEASONAL_CAMPAIGN_CANCELLED'
  ));
alter table public.recognition_governance_audit_events
  drop constraint if exists recognition_governance_audit_events_entity_type_check;
alter table public.recognition_governance_audit_events
  add constraint recognition_governance_audit_events_entity_type_check check (
    entity_type in ('ceremony_delivery','employee_award','seasonal_campaign')
  );

create table public.recognition_seasonal_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_type text not null check (campaign_type in ('christmas','new_year')),
  campaign_year integer not null check (campaign_year between 2020 and 2200),
  audience_scope text not null default 'company' check (audience_scope in ('company')),
  state text not null default 'draft' check (state in ('draft','scheduled','published','materialized','cancelled','completed')),
  timezone text not null default 'Africa/Lagos',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  live_window_starts_at timestamptz,
  live_window_ends_at timestamptz,
  greeting_title text not null check (char_length(btrim(greeting_title)) between 1 and 120),
  greeting_message text not null check (char_length(btrim(greeting_message)) between 1 and 500),
  enabled boolean not null default true,
  created_by uuid not null references public.employee_profiles(id) on delete restrict,
  updated_by uuid not null references public.employee_profiles(id) on delete restrict,
  published_at timestamptz,
  materialized_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_type, campaign_year, audience_scope),
  constraint recognition_seasonal_campaign_window_check check (ends_at > starts_at),
  constraint recognition_seasonal_live_window_check check (
    (campaign_type = 'christmas' and live_window_starts_at is null and live_window_ends_at is null)
    or
    (campaign_type = 'new_year' and live_window_starts_at is not null and live_window_ends_at is not null
      and live_window_ends_at > live_window_starts_at
      and live_window_starts_at >= starts_at and live_window_ends_at <= ends_at)
  )
);

alter table public.recognition_seasonal_campaigns enable row level security;
alter table public.recognition_seasonal_campaigns force row level security;
revoke all on public.recognition_seasonal_campaigns from public, anon, authenticated;
grant all on public.recognition_seasonal_campaigns to service_role;

create or replace function public.touch_recognition_seasonal_campaign_updated_at()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.updated_at := now(); return new; end; $$;
revoke all on function public.touch_recognition_seasonal_campaign_updated_at() from public,anon,authenticated;
create trigger recognition_seasonal_campaign_touch before update on public.recognition_seasonal_campaigns
for each row execute function public.touch_recognition_seasonal_campaign_updated_at();

create or replace function public.list_recognition_seasonal_campaigns(p_year integer default null)
returns table(
  campaign_id uuid, campaign_type text, campaign_year integer, audience_scope text,
  state text, timezone text, starts_at timestamptz, ends_at timestamptz,
  live_window_starts_at timestamptz, live_window_ends_at timestamptz,
  greeting_title text, greeting_message text, enabled boolean,
  recipient_count bigint, presented_count bigint, updated_at timestamptz
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  return query
  select c.id,c.campaign_type,c.campaign_year,c.audience_scope,c.state,c.timezone,
    c.starts_at,c.ends_at,c.live_window_starts_at,c.live_window_ends_at,
    c.greeting_title,c.greeting_message,c.enabled,
    count(d.id)::bigint,
    count(d.id) filter (where d.state in ('presented','dismissed'))::bigint,
    c.updated_at
  from public.recognition_seasonal_campaigns c
  left join public.recognition_ceremony_deliveries d
    on d.source_kind='seasonal_campaign' and d.source_id=c.id
  where p_year is null or c.campaign_year=p_year
  group by c.id order by c.campaign_year desc,c.campaign_type,c.created_at desc;
end; $$;

create or replace function public.save_recognition_seasonal_campaign(
  p_payload jsonb, p_request_id uuid default gen_random_uuid()
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid; v_existing uuid; v_type text; v_year integer; v_timezone text;
  v_starts timestamptz; v_ends timestamptz; v_live_start timestamptz; v_live_end timestamptz;
  v_title text; v_message text; v_state text; v_expected timestamptz; v_current public.recognition_seasonal_campaigns%rowtype;
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text||':SEASONAL_CAMPAIGN_SAVED',0));
  select entity_id into v_existing from public.recognition_governance_audit_events
   where actor_id=auth.uid() and request_id=p_request_id and action='SEASONAL_CAMPAIGN_SAVED';
  if found then return v_existing; end if;

  begin v_id := nullif(p_payload->>'campaign_id','')::uuid; exception when others then raise exception 'Invalid campaign id'; end;
  begin v_expected := nullif(p_payload->>'expected_updated_at','')::timestamptz; exception when others then raise exception 'Invalid expected update timestamp'; end;
  v_type := lower(btrim(coalesce(p_payload->>'campaign_type','')));
  begin v_year := (p_payload->>'campaign_year')::integer; exception when others then raise exception 'Invalid campaign year'; end;
  v_timezone := btrim(coalesce(p_payload->>'timezone','Africa/Lagos'));
  if v_type not in ('christmas','new_year') then raise exception 'Unsupported seasonal campaign type'; end if;
  if v_year not between 2020 and 2200 then raise exception 'Invalid campaign year'; end if;
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then raise exception 'Invalid IANA timezone'; end if;
  begin v_starts := (p_payload->>'starts_at')::timestamptz; v_ends := (p_payload->>'ends_at')::timestamptz;
    v_live_start := nullif(p_payload->>'live_window_starts_at','')::timestamptz;
    v_live_end := nullif(p_payload->>'live_window_ends_at','')::timestamptz;
  exception when others then raise exception 'Invalid campaign window'; end;
  if v_ends <= v_starts then raise exception 'Campaign end must be after start'; end if;
  if v_type='new_year' and (v_live_start is null or v_live_end is null or v_live_end<=v_live_start or v_live_start<v_starts or v_live_end>v_ends) then
    raise exception 'Invalid New Year live window';
  end if;
  if v_type='christmas' then v_live_start:=null; v_live_end:=null; end if;
  v_title := nullif(btrim(p_payload->>'greeting_title'),'');
  v_message := nullif(btrim(p_payload->>'greeting_message'),'');
  if v_title is null or char_length(v_title)>120 then raise exception 'Greeting title must be 1 to 120 characters'; end if;
  if v_message is null or char_length(v_message)>500 then raise exception 'Greeting message must be 1 to 500 characters'; end if;

  if v_id is null then
    insert into public.recognition_seasonal_campaigns(
      campaign_type,campaign_year,audience_scope,state,timezone,starts_at,ends_at,
      live_window_starts_at,live_window_ends_at,greeting_title,greeting_message,created_by,updated_by
    ) values(v_type,v_year,'company','draft',v_timezone,v_starts,v_ends,v_live_start,v_live_end,v_title,v_message,auth.uid(),auth.uid())
    returning id into v_id;
  else
    select * into v_current from public.recognition_seasonal_campaigns where id=v_id for update;
    if not found then raise exception 'Campaign not found'; end if;
    if v_expected is null or v_current.updated_at<>v_expected then raise exception 'Campaign changed; refresh and try again'; end if;
    v_state:=v_current.state;
    if v_state not in ('draft','scheduled') then raise exception 'Materialized campaign identity is immutable'; end if;
    update public.recognition_seasonal_campaigns set
      campaign_type=v_type,campaign_year=v_year,timezone=v_timezone,starts_at=v_starts,ends_at=v_ends,
      live_window_starts_at=v_live_start,live_window_ends_at=v_live_end,greeting_title=v_title,greeting_message=v_message,updated_by=auth.uid()
    where id=v_id;
  end if;

  insert into public.recognition_governance_audit_events(actor_id,action,entity_type,entity_id,request_id,reason,metadata)
  values(auth.uid(),'SEASONAL_CAMPAIGN_SAVED','seasonal_campaign',v_id,p_request_id,'Seasonal campaign saved',jsonb_build_object('campaign_type',v_type,'campaign_year',v_year));
  return v_id;
end; $$;

create or replace function public.publish_recognition_seasonal_campaign(
  p_campaign_id uuid,p_expected_updated_at timestamptz,p_request_id uuid default gen_random_uuid()
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.recognition_seasonal_campaigns%rowtype;
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text||':SEASONAL_CAMPAIGN_SCHEDULED',0));
  if exists(select 1 from public.recognition_governance_audit_events where actor_id=auth.uid() and request_id=p_request_id and action='SEASONAL_CAMPAIGN_SCHEDULED') then return; end if;
  select * into v from public.recognition_seasonal_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if v.updated_at<>p_expected_updated_at then raise exception 'Campaign changed; refresh and try again'; end if;
  if v.state not in ('draft','scheduled') then raise exception 'Campaign cannot be scheduled from current state'; end if;
  if v.ends_at<=now() then raise exception 'Campaign window has elapsed'; end if;
  update public.recognition_seasonal_campaigns set state='scheduled',published_at=coalesce(published_at,now()),updated_by=auth.uid() where id=p_campaign_id;
  insert into public.recognition_governance_audit_events(actor_id,action,entity_type,entity_id,request_id,reason,metadata)
  values(auth.uid(),'SEASONAL_CAMPAIGN_SCHEDULED','seasonal_campaign',p_campaign_id,p_request_id,'Seasonal campaign scheduled','{}');
end; $$;

create or replace function public.cancel_recognition_seasonal_campaign(
  p_campaign_id uuid,p_reason text,p_expected_updated_at timestamptz default null,p_request_id uuid default gen_random_uuid()
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.recognition_seasonal_campaigns%rowtype; v_reason text:=nullif(btrim(p_reason),'');
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if v_reason is null or char_length(v_reason)<8 then raise exception 'A reason of at least 8 characters is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text||':SEASONAL_CAMPAIGN_CANCELLED',0));
  if exists(select 1 from public.recognition_governance_audit_events where actor_id=auth.uid() and request_id=p_request_id and action='SEASONAL_CAMPAIGN_CANCELLED') then return; end if;
  select * into v from public.recognition_seasonal_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if p_expected_updated_at is null or v.updated_at<>p_expected_updated_at then raise exception 'Campaign changed; refresh and try again'; end if;
  if v.state in ('cancelled','completed') then raise exception 'Campaign is already terminal'; end if;
  update public.recognition_seasonal_campaigns set state='cancelled',cancelled_at=now(),cancel_reason=v_reason,updated_by=auth.uid() where id=p_campaign_id;
  update public.recognition_ceremony_deliveries set state='revoked',revoked_at=now(),revocation_reason='seasonal_campaign_cancelled',updated_at=now()
   where source_kind='seasonal_campaign' and source_id=p_campaign_id and state='pending';
  insert into public.recognition_governance_audit_events(actor_id,action,entity_type,entity_id,request_id,reason,metadata)
  values(auth.uid(),'SEASONAL_CAMPAIGN_CANCELLED','seasonal_campaign',p_campaign_id,p_request_id,v_reason,jsonb_build_object('prior_state',v.state));
end; $$;

create or replace function public.seasonal_campaign_variant(c public.recognition_seasonal_campaigns,p_now timestamptz)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when c.campaign_type='new_year' and p_now>=c.live_window_starts_at and p_now<c.live_window_ends_at then 'live_midnight'
              when c.campaign_type='new_year' then 'delayed' else 'christmas' end;
$$;
revoke all on function public.seasonal_campaign_variant(public.recognition_seasonal_campaigns,timestamptz) from public,anon,authenticated;

create or replace function public.materialize_one_seasonal_campaign(p_campaign_id uuid,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.recognition_seasonal_campaigns%rowtype; v_count integer:=0; v_variant text;
begin
  select * into c from public.recognition_seasonal_campaigns where id=p_campaign_id for update;
  if not found or not c.enabled or c.state in ('cancelled','completed') or p_now<c.starts_at or p_now>=c.ends_at then return 0; end if;
  v_variant:=public.seasonal_campaign_variant(c,p_now);
  insert into public.recognition_ceremony_deliveries(source_kind,source_id,recipient_id,audience_type,priority,eligible_at,expires_at,presentation)
  select 'seasonal_campaign',c.id,ep.id,'company',95,p_now,c.ends_at,
    jsonb_build_object('title',c.greeting_title,'message',c.greeting_message,'campaign_type',c.campaign_type,'campaign_year',c.campaign_year,'variant',v_variant)
  from public.employee_profiles ep where ep.active=true
  on conflict do nothing;
  get diagnostics v_count=row_count;
  update public.recognition_seasonal_campaigns set state='materialized',materialized_at=coalesce(materialized_at,p_now) where id=c.id;
  return v_count;
end; $$;
revoke all on function public.materialize_one_seasonal_campaign(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.materialize_one_seasonal_campaign(uuid,timestamptz) to service_role;

create or replace function public.materialize_due_recognition_seasonal_campaigns(p_now timestamptz default now())
returns table(campaign_id uuid,recipient_count integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; v_count integer;
begin
  update public.recognition_seasonal_campaigns set state='completed',completed_at=coalesce(completed_at,p_now)
   where state in ('scheduled','published','materialized') and ends_at<=p_now;
  update public.recognition_ceremony_deliveries d set state='expired',updated_at=p_now
   where d.source_kind='seasonal_campaign' and d.state='pending' and d.expires_at<=p_now;
  for r in select c.id from public.recognition_seasonal_campaigns c
    where c.enabled and c.state in ('scheduled','published','materialized') and c.starts_at<=p_now and c.ends_at>p_now
    order by c.starts_at,c.id for update skip locked
  loop
    update public.recognition_seasonal_campaigns set state='published',published_at=coalesce(published_at,p_now) where id=r.id and state='scheduled';
    v_count:=public.materialize_one_seasonal_campaign(r.id,p_now);
    campaign_id:=r.id; recipient_count:=v_count; return next;
  end loop;
end; $$;
revoke all on function public.materialize_due_recognition_seasonal_campaigns(timestamptz) from public,anon,authenticated;
grant execute on function public.materialize_due_recognition_seasonal_campaigns(timestamptz) to service_role;

create or replace function public.ensure_my_due_seasonal_deliveries()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c record; v_count integer:=0;
begin
  if not public.is_active_employee() then return 0; end if;
  for c in select * from public.recognition_seasonal_campaigns
    where enabled and state in ('scheduled','published') and starts_at<=now() and ends_at>now()
  loop
    insert into public.recognition_ceremony_deliveries(source_kind,source_id,recipient_id,audience_type,priority,eligible_at,expires_at,presentation)
    values('seasonal_campaign',c.id,auth.uid(),'company',95,now(),c.ends_at,
      jsonb_build_object('title',c.greeting_title,'message',c.greeting_message,'campaign_type',c.campaign_type,'campaign_year',c.campaign_year,'variant',public.seasonal_campaign_variant(c,now())))
    on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end; $$;
revoke all on function public.ensure_my_due_seasonal_deliveries() from public,anon;
grant execute on function public.ensure_my_due_seasonal_deliveries() to authenticated;

create or replace function public.refresh_due_seasonal_delivery_variant(p_delivery_id uuid,p_now timestamptz default now())
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_campaign public.recognition_seasonal_campaigns%rowtype;
begin
  select sc.* into v_campaign from public.recognition_ceremony_deliveries d join public.recognition_seasonal_campaigns sc on sc.id=d.source_id
   where d.id=p_delivery_id and d.source_kind='seasonal_campaign' and d.recipient_id=auth.uid();
  if not found then return; end if;
  update public.recognition_ceremony_deliveries
  set presentation=jsonb_set(presentation,'{variant}',to_jsonb(public.seasonal_campaign_variant(v_campaign,p_now)),true),updated_at=p_now
  where id=p_delivery_id and recipient_id=auth.uid();
end; $$;
revoke all on function public.refresh_due_seasonal_delivery_variant(uuid,timestamptz) from public,anon,authenticated;

create or replace function public.claim_next_recognition_ceremony()
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_delivery public.recognition_ceremony_deliveries%rowtype;
begin
  if not public.is_active_employee() then return null; end if;
  perform public.ensure_my_due_seasonal_deliveries();
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

revoke all on function public.list_recognition_seasonal_campaigns(integer) from public,anon;
revoke all on function public.save_recognition_seasonal_campaign(jsonb,uuid) from public,anon;
revoke all on function public.publish_recognition_seasonal_campaign(uuid,timestamptz,uuid) from public,anon;
revoke all on function public.cancel_recognition_seasonal_campaign(uuid,text,timestamptz,uuid) from public,anon;
revoke all on function public.claim_next_recognition_ceremony() from public,anon;
grant execute on function public.list_recognition_seasonal_campaigns(integer) to authenticated;
grant execute on function public.save_recognition_seasonal_campaign(jsonb,uuid) to authenticated;
grant execute on function public.publish_recognition_seasonal_campaign(uuid,timestamptz,uuid) to authenticated;
grant execute on function public.cancel_recognition_seasonal_campaign(uuid,text,timestamptz,uuid) to authenticated;
grant execute on function public.claim_next_recognition_ceremony() to authenticated;

-- Hardened one-minute dispatcher. Vault holds the secret; SQL never embeds it.
do $$
begin
  if exists(select 1 from pg_namespace where nspname='cron')
     and exists(select 1 from pg_namespace where nspname='net')
     and exists(select 1 from pg_namespace where nspname='vault') then
    if exists(select 1 from cron.job where jobname='ridearrivo-recognition-seasonal-dispatch') then
      perform cron.unschedule('ridearrivo-recognition-seasonal-dispatch');
    end if;
    if exists(select 1 from vault.decrypted_secrets where name='cron_dispatch_secret') then
      perform cron.schedule('ridearrivo-recognition-seasonal-dispatch','* * * * *',$cmd$
        select net.http_post(
          url := (select value from public.system_config where key='functions_base_url') || '/recognition-seasonal-dispatch',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_dispatch_secret' limit 1)),
          body := '{}'::jsonb
        );
      $cmd$);
    else
      raise notice 'seasonal recognition schedule skipped: Vault secret cron_dispatch_secret is missing';
    end if;
  end if;
exception when others then
  raise notice 'seasonal recognition schedule skipped: %',sqlerrm;
end; $$;

commit;
