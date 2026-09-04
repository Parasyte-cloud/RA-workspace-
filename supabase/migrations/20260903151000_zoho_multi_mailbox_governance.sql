begin;

-- ============================================================
-- RideArrivo Zoho multi-mailbox governance
--
-- Additive migration.
--
-- Legacy public.zoho_mail_connections is intentionally
-- preserved until every Zoho Edge Function has been migrated
-- and execution-tested against the new resolver.
-- ============================================================


-- ------------------------------------------------------------
-- 1. OAuth credential connections
--
-- One employee may own/connect multiple Zoho OAuth grants.
-- Credentials remain server-only.
-- ------------------------------------------------------------

create table public.zoho_mail_oauth_connections (
  id uuid primary key default gen_random_uuid(),

  connection_owner_id uuid not null
    references auth.users(id)
    on delete cascade,

  legacy_user_id uuid unique
    references auth.users(id)
    on delete set null,

  provider_email text,

  refresh_token text not null,

  accounts_domain text not null
    default 'https://accounts.zoho.com',

  mail_api_base text not null
    default 'https://mail.zoho.com/api',

  status text not null
    default 'active'
    check (
      status in (
        'active',
        'reauthorization_required',
        'revoked',
        'error'
      )
    ),

  connected_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint zoho_mail_oauth_refresh_not_blank
    check (
      length(btrim(refresh_token)) > 0
    ),

  constraint zoho_mail_oauth_accounts_domain_not_blank
    check (
      length(btrim(accounts_domain)) > 0
    ),

  constraint zoho_mail_oauth_api_base_not_blank
    check (
      length(btrim(mail_api_base)) > 0
    )
);

create index zoho_mail_oauth_connections_owner_idx
  on public.zoho_mail_oauth_connections(
    connection_owner_id,
    status
  );

create unique index
  zoho_mail_oauth_connections_owner_email_unique
on public.zoho_mail_oauth_connections(
  connection_owner_id,
  lower(provider_email)
)
where
  provider_email is not null
  and status <> 'revoked';


-- ------------------------------------------------------------
-- 2. Logical mailboxes
--
-- A mailbox belongs to one provider connection, but access can
-- be granted to many RideArrivo employees.
-- ------------------------------------------------------------

create table public.zoho_mailboxes (
  id uuid primary key default gen_random_uuid(),

  connection_id uuid not null
    references public.zoho_mail_oauth_connections(id)
    on delete restrict,

  zoho_account_id text not null,

  primary_address text,

  display_name text,

  mailbox_type text not null
    default 'personal'
    check (
      mailbox_type in (
        'personal',
        'shared',
        'delegated'
      )
    ),

  active boolean not null
    default true,

  legacy_source boolean not null
    default false,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint zoho_mailboxes_account_not_blank
    check (
      length(btrim(zoho_account_id)) > 0
    ),

  unique(
    connection_id,
    zoho_account_id
  )
);

create index zoho_mailboxes_connection_idx
  on public.zoho_mailboxes(
    connection_id,
    active
  );

create index zoho_mailboxes_primary_address_idx
  on public.zoho_mailboxes(
    lower(primary_address)
  )
  where primary_address is not null;


-- ------------------------------------------------------------
-- 3. Sender identities
--
-- Primary address, aliases and delegated From identities are
-- separate from mailbox ownership.
-- ------------------------------------------------------------

create table public.zoho_mailbox_identities (
  id uuid primary key default gen_random_uuid(),

  mailbox_id uuid not null
    references public.zoho_mailboxes(id)
    on delete cascade,

  email_address text not null,

  display_name text,

  identity_type text not null
    default 'primary'
    check (
      identity_type in (
        'primary',
        'alias',
        'delegated'
      )
    ),

  is_primary boolean not null
    default false,

  can_send boolean not null
    default true,

  active boolean not null
    default true,

  signature_html text,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint zoho_mailbox_identity_email_not_blank
    check (
      length(btrim(email_address)) > 0
    )
);

create unique index
  zoho_mailbox_identity_email_unique
on public.zoho_mailbox_identities(
  mailbox_id,
  lower(email_address)
);

create unique index
  zoho_mailbox_one_primary_identity
on public.zoho_mailbox_identities(mailbox_id)
where
  is_primary = true
  and active = true;


-- ------------------------------------------------------------
-- 4. Explicit employee mailbox entitlements
--
-- A workstation/department assignment alone never grants
-- mailbox access.
-- ------------------------------------------------------------

create table public.zoho_mailbox_access (
  id uuid primary key default gen_random_uuid(),

  mailbox_id uuid not null
    references public.zoho_mailboxes(id)
    on delete cascade,

  employee_id uuid not null
    references auth.users(id)
    on delete cascade,

  can_read boolean not null
    default false,

  can_send boolean not null
    default false,

  can_manage boolean not null
    default false,

  can_send_as boolean not null
    default false,

  can_send_on_behalf boolean not null
    default false,

  default_identity_id uuid
    references public.zoho_mailbox_identities(id)
    on delete set null,

  is_default boolean not null
    default false,

  is_favorite boolean not null
    default false,

  active boolean not null
    default true,

  granted_by uuid
    references auth.users(id)
    on delete set null,

  granted_at timestamptz not null
    default now(),

  revoked_at timestamptz,

  access_note text,

  updated_at timestamptz not null
    default now(),

  unique(
    mailbox_id,
    employee_id
  ),

  constraint zoho_mailbox_send_as_requires_send
    check (
      not can_send_as
      or can_send
    ),

  constraint zoho_mailbox_send_on_behalf_requires_send
    check (
      not can_send_on_behalf
      or can_send
    ),

  constraint zoho_mailbox_default_requires_read
    check (
      not is_default
      or (
        active
        and can_read
      )
    )
);

create index zoho_mailbox_access_employee_idx
  on public.zoho_mailbox_access(
    employee_id,
    active
  );

create index zoho_mailbox_access_mailbox_idx
  on public.zoho_mailbox_access(
    mailbox_id,
    active
  );

create unique index
  zoho_mailbox_one_default_per_employee
on public.zoho_mailbox_access(employee_id)
where
  is_default = true
  and active = true;


-- ------------------------------------------------------------
-- 5. Per-employee UI preference
--
-- This is convenience state only. It never grants access.
-- ------------------------------------------------------------

create table public.zoho_mailbox_preferences (
  employee_id uuid primary key
    references auth.users(id)
    on delete cascade,

  preferred_mailbox_id uuid
    references public.zoho_mailboxes(id)
    on delete set null,

  updated_at timestamptz not null
    default now()
);


-- ------------------------------------------------------------
-- 6. Mail security / access audit
-- ------------------------------------------------------------

create table public.zoho_mail_audit_events (
  id uuid primary key default gen_random_uuid(),

  mailbox_id uuid
    references public.zoho_mailboxes(id)
    on delete set null,

  actor_id uuid
    references auth.users(id)
    on delete set null,

  action text not null,

  target_employee_id uuid
    references auth.users(id)
    on delete set null,

  identity_id uuid
    references public.zoho_mailbox_identities(id)
    on delete set null,

  metadata jsonb not null
    default '{}'::jsonb,

  created_at timestamptz not null
    default now(),

  constraint zoho_mail_audit_action_not_blank
    check (
      length(btrim(action)) > 0
    )
);

create index zoho_mail_audit_mailbox_created_idx
  on public.zoho_mail_audit_events(
    mailbox_id,
    created_at desc
  );

create index zoho_mail_audit_actor_created_idx
  on public.zoho_mail_audit_events(
    actor_id,
    created_at desc
  );


-- ------------------------------------------------------------
-- Updated-at helper
-- ------------------------------------------------------------

create or replace function
  public.touch_zoho_multi_mail_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function
  public.touch_zoho_multi_mail_updated_at()
from public, anon, authenticated;


create trigger
  zoho_mail_oauth_connections_touch
before update on public.zoho_mail_oauth_connections
for each row
execute function
  public.touch_zoho_multi_mail_updated_at();


create trigger
  zoho_mailboxes_touch
before update on public.zoho_mailboxes
for each row
execute function
  public.touch_zoho_multi_mail_updated_at();


create trigger
  zoho_mailbox_identities_touch
before update on public.zoho_mailbox_identities
for each row
execute function
  public.touch_zoho_multi_mail_updated_at();


create trigger
  zoho_mailbox_access_touch
before update on public.zoho_mailbox_access
for each row
execute function
  public.touch_zoho_multi_mail_updated_at();


create trigger
  zoho_mailbox_preferences_touch
before update on public.zoho_mailbox_preferences
for each row
execute function
  public.touch_zoho_multi_mail_updated_at();


-- ------------------------------------------------------------
-- Append-only security audit
-- ------------------------------------------------------------

create or replace function
  public.protect_zoho_mail_audit_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception
    'Zoho mailbox audit history is append-only';
end;
$$;

revoke all on function
  public.protect_zoho_mail_audit_history()
from public, anon, authenticated;


create trigger
  protect_zoho_mail_audit_events
before update or delete
on public.zoho_mail_audit_events
for each row
execute function
  public.protect_zoho_mail_audit_history();


-- ------------------------------------------------------------
-- Capability resolver for authenticated RLS
--
-- IMPORTANT:
-- Admin is NOT implicitly treated as a mailbox reader/sender.
-- Explicit entitlement is still required for message content.
-- ------------------------------------------------------------

create or replace function
  public.zoho_mailbox_has_capability(
    p_mailbox_id uuid,
    p_capability text
  )
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.zoho_mailbox_access a
    join public.employee_profiles p
      on p.id = a.employee_id
    where a.mailbox_id = p_mailbox_id
      and a.employee_id = auth.uid()
      and a.active = true
      and p.active = true
      and case p_capability
        when 'read'
          then a.can_read
        when 'send'
          then a.can_send
        when 'manage'
          then a.can_manage
        when 'send_as'
          then a.can_send_as
        when 'send_on_behalf'
          then a.can_send_on_behalf
        else false
      end
  );
$$;

revoke all on function
  public.zoho_mailbox_has_capability(uuid, text)
from public, anon;

grant execute on function
  public.zoho_mailbox_has_capability(uuid, text)
to authenticated, service_role;


create or replace function
  public.zoho_mailbox_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_workspace_role(
    array['admin']
  );
$$;

revoke all on function
  public.zoho_mailbox_is_admin()
from public, anon;

grant execute on function
  public.zoho_mailbox_is_admin()
to authenticated, service_role;


-- ------------------------------------------------------------
-- Server-only mailbox credential resolver
--
-- Edge Functions first authenticate the employee JWT, then
-- pass the authenticated employee UUID here.
--
-- This function is NEVER granted to authenticated users.
-- ------------------------------------------------------------

create or replace function
  public.resolve_zoho_mailbox_connection(
    p_employee_id uuid,
    p_mailbox_id uuid,
    p_capability text
  )
returns table (
  mailbox_id uuid,
  connection_id uuid,
  zoho_account_id text,
  primary_address text,
  mailbox_type text,
  refresh_token text,
  accounts_domain text,
  mail_api_base text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    c.id,
    m.zoho_account_id,
    m.primary_address,
    m.mailbox_type,
    c.refresh_token,
    c.accounts_domain,
    c.mail_api_base
  from public.zoho_mailboxes m
  join public.zoho_mail_oauth_connections c
    on c.id = m.connection_id
  join public.zoho_mailbox_access a
    on a.mailbox_id = m.id
  join public.employee_profiles p
    on p.id = a.employee_id
  where m.id = p_mailbox_id
    and a.employee_id = p_employee_id
    and a.active = true
    and p.active = true
    and m.active = true
    and c.status = 'active'
    and case p_capability
      when 'read'
        then a.can_read
      when 'send'
        then a.can_send
      when 'manage'
        then a.can_manage
      when 'send_as'
        then a.can_send_as
      when 'send_on_behalf'
        then a.can_send_on_behalf
      else false
    end
  limit 1;
$$;

revoke all on function
  public.resolve_zoho_mailbox_connection(
    uuid,
    uuid,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.resolve_zoho_mailbox_connection(
    uuid,
    uuid,
    text
  )
to service_role;


-- ------------------------------------------------------------
-- Server-only sending identity resolver
-- ------------------------------------------------------------

create or replace function
  public.resolve_zoho_send_identity(
    p_employee_id uuid,
    p_mailbox_id uuid,
    p_identity_id uuid
  )
returns table (
  identity_id uuid,
  email_address text,
  display_name text,
  identity_type text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i.id,
    i.email_address,
    i.display_name,
    i.identity_type
  from public.zoho_mailbox_identities i
  join public.zoho_mailbox_access a
    on a.mailbox_id = i.mailbox_id
  join public.employee_profiles p
    on p.id = a.employee_id
  where i.id = p_identity_id
    and i.mailbox_id = p_mailbox_id
    and a.employee_id = p_employee_id
    and a.active = true
    and a.can_send = true
    and p.active = true
    and i.active = true
    and i.can_send = true
    and (
      i.identity_type = 'primary'
      or (
        i.identity_type = 'alias'
        and a.can_send_as = true
      )
      or (
        i.identity_type = 'delegated'
        and (
          a.can_send_as = true
          or a.can_send_on_behalf = true
        )
      )
    )
  limit 1;
$$;

revoke all on function
  public.resolve_zoho_send_identity(
    uuid,
    uuid,
    uuid
  )
from public, anon, authenticated;

grant execute on function
  public.resolve_zoho_send_identity(
    uuid,
    uuid,
    uuid
  )
to service_role;



-- ------------------------------------------------------------
-- Cross-table mailbox integrity
--
-- Foreign keys alone cannot guarantee that an employee's
-- default sender identity belongs to the same mailbox.
-- Preferences likewise never become an authorization grant.
-- ------------------------------------------------------------

create or replace function
  public.validate_zoho_mailbox_access_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_mailbox_id uuid;
begin
  if new.default_identity_id is null then
    return new;
  end if;

  select i.mailbox_id
    into v_identity_mailbox_id
  from public.zoho_mailbox_identities i
  where i.id = new.default_identity_id
    and i.active = true;

  if v_identity_mailbox_id is null then
    raise exception
      'Default Zoho sender identity is unavailable';
  end if;

  if v_identity_mailbox_id <> new.mailbox_id then
    raise exception
      'Default Zoho sender identity belongs to another mailbox';
  end if;

  return new;
end;
$$;

revoke all on function
  public.validate_zoho_mailbox_access_integrity()
from public, anon, authenticated;

grant execute on function
  public.validate_zoho_mailbox_access_integrity()
to service_role;

create trigger
  validate_zoho_mailbox_access_integrity
before insert or update
on public.zoho_mailbox_access
for each row
execute function
  public.validate_zoho_mailbox_access_integrity();


create or replace function
  public.validate_zoho_mailbox_preference_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.preferred_mailbox_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.zoho_mailbox_access a
    where a.employee_id = new.employee_id
      and a.mailbox_id = new.preferred_mailbox_id
      and a.active = true
      and a.can_read = true
  ) then
    raise exception
      'Preferred Zoho mailbox is not an active readable entitlement';
  end if;

  return new;
end;
$$;

revoke all on function
  public.validate_zoho_mailbox_preference_integrity()
from public, anon, authenticated;

grant execute on function
  public.validate_zoho_mailbox_preference_integrity()
to service_role;

create trigger
  validate_zoho_mailbox_preference_integrity
before insert or update
on public.zoho_mailbox_preferences
for each row
execute function
  public.validate_zoho_mailbox_preference_integrity();


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.zoho_mail_oauth_connections
  enable row level security;

alter table public.zoho_mailboxes
  enable row level security;

alter table public.zoho_mailbox_identities
  enable row level security;

alter table public.zoho_mailbox_access
  enable row level security;

alter table public.zoho_mailbox_preferences
  enable row level security;

alter table public.zoho_mail_audit_events
  enable row level security;


-- Credential table intentionally has NO authenticated policy.


create policy
  "zoho mailboxes entitled metadata read"
on public.zoho_mailboxes
for select
to authenticated
using (
  public.zoho_mailbox_has_capability(
    id,
    'read'
  )
  or public.zoho_mailbox_has_capability(
    id,
    'send'
  )
  or public.zoho_mailbox_has_capability(
    id,
    'manage'
  )
  or public.zoho_mailbox_is_admin()
);


create policy
  "zoho mailbox identities entitled read"
on public.zoho_mailbox_identities
for select
to authenticated
using (
  public.zoho_mailbox_has_capability(
    mailbox_id,
    'read'
  )
  or public.zoho_mailbox_has_capability(
    mailbox_id,
    'send'
  )
  or public.zoho_mailbox_has_capability(
    mailbox_id,
    'manage'
  )
  or public.zoho_mailbox_is_admin()
);


create policy
  "zoho mailbox access own or admin read"
on public.zoho_mailbox_access
for select
to authenticated
using (
  employee_id = auth.uid()
  or public.zoho_mailbox_is_admin()
);


create policy
  "zoho mailbox preferences own or admin read"
on public.zoho_mailbox_preferences
for select
to authenticated
using (
  employee_id = auth.uid()
  or public.zoho_mailbox_is_admin()
);


create policy
  "zoho mail audit manager or admin read"
on public.zoho_mail_audit_events
for select
to authenticated
using (
  public.zoho_mailbox_is_admin()
  or (
    mailbox_id is not null
    and public.zoho_mailbox_has_capability(
      mailbox_id,
      'manage'
    )
  )
);


-- ------------------------------------------------------------
-- Direct-table privilege lockdown
-- ------------------------------------------------------------

revoke all on
  public.zoho_mail_oauth_connections,
  public.zoho_mailboxes,
  public.zoho_mailbox_identities,
  public.zoho_mailbox_access,
  public.zoho_mailbox_preferences,
  public.zoho_mail_audit_events
from public, anon, authenticated;


grant select on
  public.zoho_mailboxes,
  public.zoho_mailbox_identities,
  public.zoho_mailbox_access,
  public.zoho_mailbox_preferences,
  public.zoho_mail_audit_events
to authenticated;


grant all on
  public.zoho_mail_oauth_connections,
  public.zoho_mailboxes,
  public.zoho_mailbox_identities,
  public.zoho_mailbox_access,
  public.zoho_mailbox_preferences
to service_role;


grant select, insert on
  public.zoho_mail_audit_events
to service_role;


revoke update, delete, truncate
on public.zoho_mail_audit_events
from service_role;


-- ------------------------------------------------------------
-- Legacy single-mailbox backfill
--
-- No source row is deleted or modified.
-- ------------------------------------------------------------

insert into public.zoho_mail_oauth_connections(
  connection_owner_id,
  legacy_user_id,
  provider_email,
  refresh_token,
  accounts_domain,
  mail_api_base,
  status,
  connected_at,
  updated_at
)
select
  l.user_id,
  l.user_id,
  l.email,
  l.refresh_token,
  l.accounts_domain,
  l.mail_api_base,
  'active',
  l.connected_at,
  l.updated_at
from public.zoho_mail_connections l
on conflict (legacy_user_id)
do update
set
  provider_email = excluded.provider_email,
  refresh_token = excluded.refresh_token,
  accounts_domain = excluded.accounts_domain,
  mail_api_base = excluded.mail_api_base,
  updated_at = excluded.updated_at;


insert into public.zoho_mailboxes(
  connection_id,
  zoho_account_id,
  primary_address,
  display_name,
  mailbox_type,
  active,
  legacy_source,
  created_at,
  updated_at
)
select
  c.id,
  l.zoho_account_id,
  l.email,
  coalesce(
    nullif(
      btrim(l.email),
      ''
    ),
    'Zoho Mailbox'
  ),
  'personal',
  true,
  true,
  l.connected_at,
  l.updated_at
from public.zoho_mail_connections l
join public.zoho_mail_oauth_connections c
  on c.legacy_user_id = l.user_id
on conflict (
  connection_id,
  zoho_account_id
)
do update
set
  primary_address =
    excluded.primary_address,
  display_name =
    excluded.display_name,
  active = true,
  legacy_source = true,
  updated_at =
    excluded.updated_at;


insert into public.zoho_mailbox_identities(
  mailbox_id,
  email_address,
  display_name,
  identity_type,
  is_primary,
  can_send,
  active
)
select
  m.id,
  l.email,
  l.email,
  'primary',
  true,
  true,
  true
from public.zoho_mail_connections l
join public.zoho_mail_oauth_connections c
  on c.legacy_user_id = l.user_id
join public.zoho_mailboxes m
  on m.connection_id = c.id
  and m.zoho_account_id =
    l.zoho_account_id
where
  l.email is not null
  and length(btrim(l.email)) > 0
on conflict do nothing;


insert into public.zoho_mailbox_access(
  mailbox_id,
  employee_id,
  can_read,
  can_send,
  can_manage,
  can_send_as,
  can_send_on_behalf,
  default_identity_id,
  is_default,
  is_favorite,
  active,
  granted_by,
  access_note
)
select
  m.id,
  l.user_id,
  true,
  true,
  true,
  true,
  false,
  i.id,
  true,
  true,
  true,
  l.user_id,
  'Backfilled from legacy single-mailbox Zoho connection.'
from public.zoho_mail_connections l
join public.zoho_mail_oauth_connections c
  on c.legacy_user_id = l.user_id
join public.zoho_mailboxes m
  on m.connection_id = c.id
  and m.zoho_account_id =
    l.zoho_account_id
left join public.zoho_mailbox_identities i
  on i.mailbox_id = m.id
  and i.is_primary = true
  and i.active = true
on conflict (
  mailbox_id,
  employee_id
)
do update
set
  can_read = true,
  can_send = true,
  can_manage = true,
  can_send_as = true,
  default_identity_id =
    excluded.default_identity_id,
  active = true,
  updated_at = now();


insert into public.zoho_mailbox_preferences(
  employee_id,
  preferred_mailbox_id
)
select
  l.user_id,
  m.id
from public.zoho_mail_connections l
join public.zoho_mail_oauth_connections c
  on c.legacy_user_id = l.user_id
join public.zoho_mailboxes m
  on m.connection_id = c.id
  and m.zoho_account_id =
    l.zoho_account_id
on conflict (employee_id)
do nothing;


insert into public.zoho_mail_audit_events(
  mailbox_id,
  actor_id,
  action,
  target_employee_id,
  metadata
)
select
  m.id,
  l.user_id,
  'legacy_mailbox_backfilled',
  l.user_id,
  jsonb_build_object(
    'source',
    'zoho_mail_connections',
    'legacy_preserved',
    true
  )
from public.zoho_mail_connections l
join public.zoho_mail_oauth_connections c
  on c.legacy_user_id = l.user_id
join public.zoho_mailboxes m
  on m.connection_id = c.id
  and m.zoho_account_id =
    l.zoho_account_id;



-- ------------------------------------------------------------
-- Server-only transactional Zoho OAuth completion.
-- ------------------------------------------------------------

create or replace function
  public.complete_zoho_mail_oauth_connection(
    p_owner_id uuid,
    p_provider_email text,
    p_zoho_account_id text,
    p_refresh_token text,
    p_accounts_domain text,
    p_mail_api_base text
  )
returns table (
    connection_id uuid,
    mailbox_id uuid,
    identity_id uuid
  )
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_email text :=
    lower(
      btrim(
        coalesce(p_provider_email,'')
      )
    );

  v_account text :=
    btrim(
      coalesce(p_zoho_account_id,'')
    );

  v_refresh text :=
    btrim(
      coalesce(p_refresh_token,'')
    );

  v_accounts_domain text :=
    btrim(
      coalesce(p_accounts_domain,'')
    );

  v_mail_api_base text :=
    btrim(
      coalesce(p_mail_api_base,'')
    );

  v_connection uuid;
  v_mailbox uuid;
  v_identity uuid;
  v_make_default boolean;
begin
  if p_owner_id is null then
    raise exception
      'OAuth connection owner is required'
      using errcode='22023';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id=p_owner_id
  ) then
    raise exception
      'OAuth connection owner does not exist'
      using errcode='23503';
  end if;

  if
    v_email=''
    or v_account=''
    or v_refresh=''
    or v_accounts_domain=''
    or v_mail_api_base=''
  then
    raise exception
      'Complete Zoho OAuth provider data is required'
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text
      || '|'
      || v_email,
      0
    )
  );

  select c.id
  into v_connection
  from public.zoho_mail_oauth_connections c
  where
    c.connection_owner_id=p_owner_id
    and lower(
      coalesce(
        c.provider_email,
        ''
      )
    )=v_email
    and c.status <> 'revoked'
  order by c.connected_at desc
  limit 1
  for update;

  if v_connection is null then
    insert into public.zoho_mail_oauth_connections (
      connection_owner_id,
      legacy_user_id,
      provider_email,
      refresh_token,
      accounts_domain,
      mail_api_base,
      status
    )
    values (
      p_owner_id,
      null,
      v_email,
      v_refresh,
      v_accounts_domain,
      v_mail_api_base,
      'active'
    )
    returning id
    into v_connection;
  else
    update public.zoho_mail_oauth_connections
    set
      provider_email=v_email,
      refresh_token=v_refresh,
      accounts_domain=v_accounts_domain,
      mail_api_base=v_mail_api_base,
      status='active',
      updated_at=now()
    where id=v_connection;
  end if;

  select m.id
  into v_mailbox
  from public.zoho_mailboxes m
  where
    m.connection_id=v_connection
    and m.zoho_account_id=v_account
  for update;

  if v_mailbox is null then
    insert into public.zoho_mailboxes (
      connection_id,
      zoho_account_id,
      primary_address,
      display_name,
      mailbox_type,
      active,
      legacy_source
    )
    values (
      v_connection,
      v_account,
      v_email,
      v_email,
      'personal',
      true,
      false
    )
    returning id
    into v_mailbox;
  else
    update public.zoho_mailboxes
    set
      primary_address=v_email,
      active=true,
      updated_at=now()
    where id=v_mailbox;
  end if;

  select i.id
  into v_identity
  from public.zoho_mailbox_identities i
  where
    i.mailbox_id=v_mailbox
    and lower(i.email_address)=v_email
  limit 1
  for update;

  update public.zoho_mailbox_identities as zmi
  set
    is_primary=false,
    updated_at=now()
  where
    zmi.mailbox_id=v_mailbox
    and zmi.active=true
    and zmi.is_primary=true
    and (
      v_identity is null
      or zmi.id <> v_identity
    );

  if v_identity is null then
    insert into public.zoho_mailbox_identities (
      mailbox_id,
      email_address,
      display_name,
      identity_type,
      is_primary,
      can_send,
      active
    )
    values (
      v_mailbox,
      v_email,
      v_email,
      'primary',
      true,
      true,
      true
    )
    returning id
    into v_identity;
  else
    update public.zoho_mailbox_identities
    set
      display_name=v_email,
      identity_type='primary',
      is_primary=true,
      can_send=true,
      active=true,
      updated_at=now()
    where id=v_identity;
  end if;

  select not exists (
    select 1
    from public.zoho_mailbox_access a
    where
      a.employee_id=p_owner_id
      and a.active=true
      and a.is_default=true
  )
  into v_make_default;

  insert into public.zoho_mailbox_access as a (
    mailbox_id,
    employee_id,
    can_read,
    can_send,
    can_manage,
    can_send_as,
    can_send_on_behalf,
    default_identity_id,
    is_default,
    is_favorite,
    active,
    granted_by,
    granted_at,
    revoked_at,
    access_note
  )
  values (
    v_mailbox,
    p_owner_id,
    true,
    true,
    true,
    true,
    false,
    v_identity,
    v_make_default,
    false,
    true,
    p_owner_id,
    now(),
    null,
    'Granted by successful Zoho OAuth connection.'
  )
  on conflict on constraint zoho_mailbox_access_mailbox_id_employee_id_key
  do update
  set
    can_read=true,
    can_send=true,
    can_manage=true,
    can_send_as=true,
    can_send_on_behalf=false,
    default_identity_id=excluded.default_identity_id,
    is_default=
      a.is_default
      or excluded.is_default,
    active=true,
    granted_by=excluded.granted_by,
    revoked_at=null,
    access_note=excluded.access_note,
    updated_at=now();

  return query
  select
    v_connection,
    v_mailbox,
    v_identity;
end;
$$;

revoke all on function
  public.complete_zoho_mail_oauth_connection(
    uuid,
    text,
    text,
    text,
    text,
    text
  )
from public,anon,authenticated;

grant execute on function
  public.complete_zoho_mail_oauth_connection(
    uuid,
    text,
    text,
    text,
    text,
    text
  )
to service_role;


commit;
