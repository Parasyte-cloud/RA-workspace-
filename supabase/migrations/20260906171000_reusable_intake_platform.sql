begin;

-- ============================================================
-- RideArrivo reusable intake / form platform
--
-- Design:
--   intake_categories
--       -> intake_forms
--           -> intake_form_versions
--               -> intake_submissions
--                   -> intake_submission_events
--
-- Public browsers never write directly to these tables.
-- A later Edge Function will validate public form submissions
-- and write using the service role.
--
-- Workstation visibility reuses RideArrivo's existing
-- workspace_workstation_assignments / has_workstation_access().
-- ============================================================


-- ============================================================
-- 1. CATEGORIES
-- ============================================================

create table public.intake_categories (
  id uuid primary key default gen_random_uuid(),

  slug text not null unique,

  title text not null,

  description text,

  default_workstation text not null,

  active boolean not null default true,

  created_by uuid,
  updated_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint intake_categories_slug_format
    check (
      slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),

  constraint intake_categories_title_not_blank
    check (
      char_length(btrim(title)) between 1 and 120
    ),

  constraint intake_categories_workstation_format
    check (
      default_workstation
        ~ '^[a-z][a-z0-9_-]{1,63}$'
    )
);


-- ============================================================
-- 2. FORM DEFINITIONS
--
-- The master form contains routing and lifecycle information.
-- User-facing title/description/fields live in versions.
-- ============================================================

create table public.intake_forms (
  id uuid primary key default gen_random_uuid(),

  category_id uuid not null
    references public.intake_categories(id)
    on delete restrict,

  slug text not null unique,

  internal_name text not null,

  public_slug text unique,

  destination_workstation text not null,

  default_assignee_id uuid
    references public.employee_profiles(id)
    on delete set null,

  visibility text not null default 'internal'
    check (
      visibility in ('internal', 'public')
    ),

  lifecycle_status text not null default 'draft'
    check (
      lifecycle_status in (
        'draft',
        'published',
        'disabled'
      )
    ),

  published_version_id uuid,

  created_by uuid,
  updated_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint intake_forms_slug_format
    check (
      slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),

  constraint intake_forms_public_slug_format
    check (
      public_slug is null
      or public_slug
        ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),

  constraint intake_forms_internal_name_not_blank
    check (
      char_length(btrim(internal_name))
        between 1 and 160
    ),

  constraint intake_forms_workstation_format
    check (
      destination_workstation
        ~ '^[a-z][a-z0-9_-]{1,63}$'
    )
);


-- ============================================================
-- 3. VERSIONED FORM SCHEMAS
--
-- A version owns:
--   - visible form title/header
--   - description
--   - dynamic field schema
--
-- Historical submissions reference the exact version used.
-- ============================================================

create table public.intake_form_versions (
  id uuid primary key default gen_random_uuid(),

  form_id uuid not null
    references public.intake_forms(id)
    on delete cascade,

  version_number integer not null
    check (version_number > 0),

  title text not null,

  description text,

  field_schema jsonb not null
    default '{"fields":[]}'::jsonb,

  published_at timestamptz,

  created_by uuid,
  updated_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint intake_form_versions_unique_version
    unique (form_id, version_number),

  constraint intake_form_versions_title_not_blank
    check (
      char_length(btrim(title))
        between 1 and 160
    ),

  constraint intake_form_versions_schema_object
    check (
      jsonb_typeof(field_schema) = 'object'
      and field_schema ? 'fields'
      and jsonb_typeof(
        field_schema -> 'fields'
      ) = 'array'
    )
);


alter table public.intake_forms
  add constraint intake_forms_published_version_fk
  foreign key (published_version_id)
  references public.intake_form_versions(id)
  on delete restrict;


-- ============================================================
-- 4. SUBMISSIONS
--
-- The title/category snapshots intentionally preserve the
-- exact submission context even if a form is renamed later.
-- ============================================================

create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),

  form_id uuid not null
    references public.intake_forms(id)
    on delete restrict,

  form_version_id uuid not null
    references public.intake_form_versions(id)
    on delete restrict,

  category_id uuid not null
    references public.intake_categories(id)
    on delete restrict,

  form_title_snapshot text not null,

  category_title_snapshot text not null,

  payload jsonb not null,

  source text not null default 'form',

  source_reference text,

  destination_workstation text not null,

  assigned_employee_id uuid
    references public.employee_profiles(id)
    on delete set null,

  submitted_by_user_id uuid,

  -- Existing Support WhatsApp foundation.
  -- Null for normal forms; available for future conversation
  -- -> intake linking without creating duplicate chat tables.
  whatsapp_conversation_id uuid
    references public.support_whatsapp_conversations(id)
    on delete set null,

  status text not null default 'new'
    check (
      status in (
        'new',
        'in_progress',
        'followed_up',
        'resolved',
        'closed'
      )
    ),

  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  followed_up_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,

  search_text text not null default '',

  constraint intake_submissions_payload_object
    check (
      jsonb_typeof(payload) = 'object'
    ),

  constraint intake_submissions_workstation_format
    check (
      destination_workstation
        ~ '^[a-z][a-z0-9_-]{1,63}$'
    )
);


-- ============================================================
-- 5. IMMUTABLE ACTIVITY HISTORY
-- ============================================================

create table public.intake_submission_events (
  id uuid primary key default gen_random_uuid(),

  submission_id uuid not null
    references public.intake_submissions(id)
    on delete cascade,

  event_type text not null,

  actor_user_id uuid,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint intake_submission_events_type_not_blank
    check (
      char_length(btrim(event_type))
        between 1 and 80
    ),

  constraint intake_submission_events_metadata_object
    check (
      jsonb_typeof(metadata) = 'object'
    )
);


-- ============================================================
-- 6. INDEXES
-- ============================================================

create index intake_categories_active_idx
  on public.intake_categories(active, title);

create index intake_forms_category_idx
  on public.intake_forms(
    category_id,
    lifecycle_status
  );

create index intake_forms_workstation_idx
  on public.intake_forms(
    destination_workstation,
    lifecycle_status
  );

create index intake_form_versions_form_idx
  on public.intake_form_versions(
    form_id,
    version_number desc
  );

create index intake_submissions_category_status_idx
  on public.intake_submissions(
    category_id,
    status,
    submitted_at desc
  );

create index intake_submissions_workstation_status_idx
  on public.intake_submissions(
    destination_workstation,
    status,
    submitted_at desc
  );

create index intake_submissions_assignee_status_idx
  on public.intake_submissions(
    assigned_employee_id,
    status,
    submitted_at desc
  );

create index intake_submissions_form_idx
  on public.intake_submissions(
    form_id,
    submitted_at desc
  );

create index intake_submissions_whatsapp_idx
  on public.intake_submissions(
    whatsapp_conversation_id
  )
  where whatsapp_conversation_id is not null;

create index intake_submissions_search_idx
  on public.intake_submissions
  using gin (
    to_tsvector(
      'simple'::regconfig,
      search_text
    )
  );

create index intake_submission_events_submission_idx
  on public.intake_submission_events(
    submission_id,
    created_at desc
  );


-- ============================================================
-- 7. ACTIVE EMPLOYEE / WORKSTATION ACCESS HELPERS
-- ============================================================

create or replace function public.intake_is_active_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
  );
$$;


create or replace function public.can_access_intake_route(
  p_workstation text,
  p_assignee uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.intake_is_active_employee()
    and (
      auth.uid() = p_assignee
      or public.current_workspace_role()
        in ('manager', 'admin')
      or public.has_workstation_access(
        array[p_workstation]
      )
    ),
    false
  );
$$;


create or replace function public.can_access_intake_submission(
  p_submission_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_submissions s
    where s.id = p_submission_id
      and public.can_access_intake_route(
        s.destination_workstation,
        s.assigned_employee_id
      )
  );
$$;


revoke all
on function public.intake_is_active_employee()
from public, anon;

revoke all
on function public.can_access_intake_route(text, uuid)
from public, anon;

revoke all
on function public.can_access_intake_submission(uuid)
from public, anon;

grant execute
on function public.intake_is_active_employee()
to authenticated;

grant execute
on function public.can_access_intake_route(text, uuid)
to authenticated;

grant execute
on function public.can_access_intake_submission(uuid)
to authenticated;


-- ============================================================
-- 8. DEFINITION AUDIT TIMESTAMPS
-- ============================================================

create or replace function public.intake_touch_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();

  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;

    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;


create trigger intake_categories_touch
before insert or update
on public.intake_categories
for each row
execute function public.intake_touch_definition();


create trigger intake_forms_touch
before insert or update
on public.intake_forms
for each row
execute function public.intake_touch_definition();


create trigger intake_form_versions_touch
before insert or update
on public.intake_form_versions
for each row
execute function public.intake_touch_definition();


revoke all
on function public.intake_touch_definition()
from public, anon, authenticated;


-- ============================================================
-- 9. PROTECT PUBLISHED FORM VERSIONS
-- ============================================================

create or replace function public.intake_guard_form_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    if new.form_id is distinct from old.form_id
      or new.version_number
        is distinct from old.version_number
      or new.title
        is distinct from old.title
      or new.description
        is distinct from old.description
      or new.field_schema
        is distinct from old.field_schema
      or new.published_at
        is distinct from old.published_at
    then
      raise exception
        'Published intake form versions are immutable';
    end if;
  end if;

  return new;
end;
$$;


create trigger intake_form_versions_guard
before update
on public.intake_form_versions
for each row
execute function public.intake_guard_form_version();


revoke all
on function public.intake_guard_form_version()
from public, anon, authenticated;


-- ============================================================
-- 10. VALIDATE PUBLISHED VERSION POINTER
-- ============================================================

create or replace function public.intake_guard_form_publish_pointer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_form_id uuid;
  v_published_at timestamptz;
begin
  if new.lifecycle_status = 'published'
    and new.published_version_id is null
  then
    raise exception
      'Published intake forms require a published version';
  end if;

  if new.lifecycle_status = 'published'
    and new.visibility = 'public'
    and new.public_slug is null
  then
    raise exception
      'Published public intake forms require a public slug';
  end if;

  if new.published_version_id is not null then
    select
      v.form_id,
      v.published_at
    into
      v_form_id,
      v_published_at
    from public.intake_form_versions v
    where v.id = new.published_version_id;

    if v_form_id is null
      or v_form_id <> new.id
    then
      raise exception
        'Published version does not belong to this intake form';
    end if;

    if new.lifecycle_status = 'published'
      and v_published_at is null
    then
      raise exception
        'Published intake version has not been activated';
    end if;
  end if;

  return new;
end;
$$;


create trigger intake_forms_publish_pointer_guard
before insert or update
on public.intake_forms
for each row
execute function public.intake_guard_form_publish_pointer();


revoke all
on function public.intake_guard_form_publish_pointer()
from public, anon, authenticated;


-- ============================================================
-- 11. ADMIN-ONLY VERSION PUBLISH RPC
-- ============================================================

create or replace function public.publish_intake_form_version(
  p_form_id uuid,
  p_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_version_form_id uuid;
begin
  if not public.intake_is_active_employee() then
    raise exception
      'Active RideArrivo employee account required';
  end if;

  v_role := public.current_workspace_role();

  if v_role <> 'admin' then
    raise exception
      'Only Administration can publish intake forms';
  end if;

  select v.form_id
  into v_version_form_id
  from public.intake_form_versions v
  where v.id = p_version_id;

  if v_version_form_id is null
    or v_version_form_id <> p_form_id
  then
    raise exception
      'Form version does not belong to the requested form';
  end if;

  update public.intake_form_versions
  set
    published_at = coalesce(
      published_at,
      now()
    )
  where id = p_version_id;

  update public.intake_forms
  set
    published_version_id = p_version_id,
    lifecycle_status = 'published'
  where id = p_form_id;

  if not found then
    raise exception
      'Intake form was not found';
  end if;

  return p_form_id;
end;
$$;


revoke all
on function public.publish_intake_form_version(uuid, uuid)
from public, anon;

grant execute
on function public.publish_intake_form_version(uuid, uuid)
to authenticated;


-- ============================================================
-- 12. PREPARE SUBMISSIONS SERVER-SIDE
--
-- Callers do not decide:
--   - category
--   - published version
--   - visible title snapshot
--   - workstation route
--   - initial status
--
-- Those values are derived from the published form.
-- ============================================================

create or replace function public.intake_prepare_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_category_title text;
  v_destination_workstation text;
  v_default_assignee uuid;
  v_published_version_id uuid;
  v_form_title text;
  v_default_assignee_active boolean;
begin
  select
    f.category_id,
    c.title,
    f.destination_workstation,
    f.default_assignee_id,
    f.published_version_id,
    v.title
  into
    v_category_id,
    v_category_title,
    v_destination_workstation,
    v_default_assignee,
    v_published_version_id,
    v_form_title
  from public.intake_forms f
  join public.intake_categories c
    on c.id = f.category_id
  join public.intake_form_versions v
    on v.id = f.published_version_id
  where f.id = new.form_id
    and f.lifecycle_status = 'published'
    and c.active = true
    and v.published_at is not null;

  if v_published_version_id is null then
    raise exception
      'Intake form is not currently published';
  end if;

  new.form_version_id :=
    v_published_version_id;

  new.category_id :=
    v_category_id;

  new.form_title_snapshot :=
    v_form_title;

  new.category_title_snapshot :=
    v_category_title;

  new.destination_workstation :=
    v_destination_workstation;

  new.status := 'new';

  new.submitted_at := now();
  new.updated_at := new.submitted_at;

  if nullif(btrim(new.source), '') is null then
    new.source := 'form';
  end if;

  if v_default_assignee is not null then
    select exists (
      select 1
      from public.employee_profiles ep
      where ep.id = v_default_assignee
        and ep.active = true
    )
    into v_default_assignee_active;

    if v_default_assignee_active then
      new.assigned_employee_id :=
        v_default_assignee;
    else
      new.assigned_employee_id := null;
    end if;
  else
    new.assigned_employee_id := null;
  end if;

  new.search_text :=
    lower(
      concat_ws(
        ' ',
        new.form_title_snapshot,
        new.category_title_snapshot,
        new.source_reference,
        new.payload::text
      )
    );

  return new;
end;
$$;


create trigger intake_submissions_prepare
before insert
on public.intake_submissions
for each row
execute function public.intake_prepare_submission();


revoke all
on function public.intake_prepare_submission()
from public, anon, authenticated;


-- ============================================================
-- 13. PROTECT ORIGINAL SUBMITTED INFORMATION
--
-- Staff may manage operational status and assignment.
-- They may not rewrite the original submitted payload,
-- form/category snapshots, source, route, or WhatsApp link.
-- ============================================================

create or replace function public.intake_guard_submission_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_service boolean;
  v_assignee_active boolean;
begin
  v_role :=
    public.current_workspace_role();

  v_service :=
    coalesce(auth.role(), '') = 'service_role';

  if new.form_id is distinct from old.form_id
    or new.form_version_id
      is distinct from old.form_version_id
    or new.category_id
      is distinct from old.category_id
    or new.form_title_snapshot
      is distinct from old.form_title_snapshot
    or new.category_title_snapshot
      is distinct from old.category_title_snapshot
    or new.payload
      is distinct from old.payload
    or new.source
      is distinct from old.source
    or new.source_reference
      is distinct from old.source_reference
    or new.destination_workstation
      is distinct from old.destination_workstation
    or new.submitted_by_user_id
      is distinct from old.submitted_by_user_id
    or new.whatsapp_conversation_id
      is distinct from old.whatsapp_conversation_id
    or new.submitted_at
      is distinct from old.submitted_at
  then
    raise exception
      'Original intake submission data is immutable';
  end if;

  if new.assigned_employee_id
    is distinct from old.assigned_employee_id
  then
    if new.assigned_employee_id is not null then
      select exists (
        select 1
        from public.employee_profiles ep
        where ep.id = new.assigned_employee_id
          and ep.active = true
      )
      into v_assignee_active;

      if not v_assignee_active then
        raise exception
          'Intake submission assignee must be an active employee';
      end if;
    end if;

    if not v_service
      and coalesce(v_role, '')
        not in ('manager', 'admin')
    then
      if old.assigned_employee_id is not null
        or new.assigned_employee_id
          is distinct from auth.uid()
      then
        raise exception
          'Only Management or Administration can reassign intake submissions';
      end if;
    end if;
  end if;

  new.followed_up_at :=
    old.followed_up_at;

  new.resolved_at :=
    old.resolved_at;

  new.closed_at :=
    old.closed_at;

  if new.status is distinct from old.status then
    if new.status = 'followed_up'
      and old.followed_up_at is null
    then
      new.followed_up_at := now();
    end if;

    if new.status = 'resolved'
      and old.resolved_at is null
    then
      new.resolved_at := now();
    end if;

    if new.status = 'closed'
      and old.closed_at is null
    then
      new.closed_at := now();
    end if;
  end if;

  new.search_text := old.search_text;
  new.updated_at := now();

  return new;
end;
$$;


create trigger intake_submissions_update_guard
before update
on public.intake_submissions
for each row
execute function public.intake_guard_submission_update();


revoke all
on function public.intake_guard_submission_update()
from public, anon, authenticated;


-- ============================================================
-- 14. AUTOMATIC SUBMISSION AUDIT EVENTS
-- ============================================================

create or replace function public.intake_record_submission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.intake_submission_events (
      submission_id,
      event_type,
      actor_user_id,
      metadata
    )
    values (
      new.id,
      'created',
      auth.uid(),
      jsonb_strip_nulls(
        jsonb_build_object(
          'status',
          new.status,
          'source',
          new.source,
          'workstation',
          new.destination_workstation,
          'assignee',
          new.assigned_employee_id
        )
      )
    );

    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.intake_submission_events (
      submission_id,
      event_type,
      actor_user_id,
      metadata
    )
    values (
      new.id,
      'status_changed',
      auth.uid(),
      jsonb_build_object(
        'from',
        old.status,
        'to',
        new.status
      )
    );
  end if;

  if new.assigned_employee_id
    is distinct from old.assigned_employee_id
  then
    insert into public.intake_submission_events (
      submission_id,
      event_type,
      actor_user_id,
      metadata
    )
    values (
      new.id,
      case
        when old.assigned_employee_id is null
          then 'assigned'
        else 'reassigned'
      end,
      auth.uid(),
      jsonb_strip_nulls(
        jsonb_build_object(
          'from',
          old.assigned_employee_id,
          'to',
          new.assigned_employee_id
        )
      )
    );
  end if;

  return new;
end;
$$;


create trigger intake_submissions_event_log
after insert or update
on public.intake_submissions
for each row
execute function public.intake_record_submission_event();


revoke all
on function public.intake_record_submission_event()
from public, anon, authenticated;


-- ============================================================
-- 15. ROW LEVEL SECURITY
-- ============================================================

alter table public.intake_categories
  enable row level security;

alter table public.intake_forms
  enable row level security;

alter table public.intake_form_versions
  enable row level security;

alter table public.intake_submissions
  enable row level security;

alter table public.intake_submission_events
  enable row level security;


-- Categories:
-- active employees see active categories;
-- Management/Admin can also inspect inactive categories.

create policy "intake categories employee read"
on public.intake_categories
for select
to authenticated
using (
  public.intake_is_active_employee()
  and (
    active = true
    or public.current_workspace_role()
      in ('manager', 'admin')
  )
);


create policy "intake categories admin manage"
on public.intake_categories
for all
to authenticated
using (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
)
with check (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
);


-- Forms:
-- employees can see published definitions;
-- Management/Admin can inspect draft/disabled definitions.

create policy "intake forms employee read"
on public.intake_forms
for select
to authenticated
using (
  public.intake_is_active_employee()
  and (
    lifecycle_status = 'published'
    or public.current_workspace_role()
      in ('manager', 'admin')
  )
);


create policy "intake forms admin manage"
on public.intake_forms
for all
to authenticated
using (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
)
with check (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
);


-- Versions:
-- employees see only the currently published version.
-- Management/Admin can inspect version history.

create policy "intake form versions employee read"
on public.intake_form_versions
for select
to authenticated
using (
  public.intake_is_active_employee()
  and exists (
    select 1
    from public.intake_forms f
    where f.id = intake_form_versions.form_id
      and (
        public.current_workspace_role()
          in ('manager', 'admin')
        or (
          f.lifecycle_status = 'published'
          and f.published_version_id
            = intake_form_versions.id
        )
      )
  )
);


create policy "intake form versions admin manage"
on public.intake_form_versions
for all
to authenticated
using (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
)
with check (
  public.intake_is_active_employee()
  and public.current_workspace_role() = 'admin'
);


-- Submissions:
-- assignee, destination workstation, Management/Admin.

create policy "intake submissions scoped read"
on public.intake_submissions
for select
to authenticated
using (
  public.can_access_intake_route(
    destination_workstation,
    assigned_employee_id
  )
);


create policy "intake submissions scoped update"
on public.intake_submissions
for update
to authenticated
using (
  public.can_access_intake_route(
    destination_workstation,
    assigned_employee_id
  )
)
with check (
  public.can_access_intake_route(
    destination_workstation,
    assigned_employee_id
  )
);


-- Events inherit submission visibility.

create policy "intake submission events scoped read"
on public.intake_submission_events
for select
to authenticated
using (
  public.can_access_intake_submission(
    submission_id
  )
);


-- ============================================================
-- 16. PRIVILEGES
--
-- anon receives no direct table privileges.
--
-- authenticated:
--   - reads form definitions
--   - Admin manages definitions through RLS
--   - scoped employees read/update submission workflow state
--   - cannot directly insert/delete submissions/events
--
-- service_role:
--   used later by validated Edge Function intake endpoint.
-- ============================================================

revoke all
on public.intake_categories,
   public.intake_forms,
   public.intake_form_versions,
   public.intake_submissions,
   public.intake_submission_events
from public, anon, authenticated;


grant
  select,
  insert,
  update,
  delete
on public.intake_categories,
   public.intake_forms,
   public.intake_form_versions
to authenticated;


grant
  select,
  update
on public.intake_submissions
to authenticated;


grant
  select
on public.intake_submission_events
to authenticated;


grant all
on public.intake_categories,
   public.intake_forms,
   public.intake_form_versions,
   public.intake_submissions,
   public.intake_submission_events
to service_role;


-- ============================================================
-- 17. INITIAL REUSABLE CATEGORIES
--
-- These are category defaults only.
-- Individual forms may override the destination workstation.
-- No hard-coded form fields are created here.
-- ============================================================

insert into public.intake_categories (
  slug,
  title,
  description,
  default_workstation
)
values
  (
    'potential-investors',
    'Potential Investors',
    'Prospective investors and investment enquiries.',
    'partnerships'
  ),
  (
    'customer-support',
    'Customer Support',
    'Customer service requests and support enquiries.',
    'support'
  ),
  (
    'business-partners',
    'Business Partners',
    'Prospective and existing strategic business partners.',
    'partnerships'
  ),
  (
    'corporate-clients',
    'Corporate Clients',
    'Corporate transport prospects, accounts and enquiries.',
    'partnerships'
  ),
  (
    'driver-applications',
    'Driver Applications',
    'Driver interest, application and onboarding information.',
    'operations'
  ),
  (
    'complaints',
    'Complaints',
    'Customer complaints and service recovery information.',
    'support'
  ),
  (
    'general-enquiries',
    'General Enquiries',
    'General RideArrivo enquiries requiring staff follow-up.',
    'support'
  );


-- ============================================================
-- 18. REALTIME WORKSTATION SYNCHRONIZATION
--
-- Add the operational tables to Supabase Realtime only when
-- the standard publication exists and the table is not already
-- a member.
-- ============================================================

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'intake_submissions'
    ) then
      alter publication supabase_realtime
        add table public.intake_submissions;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'intake_submission_events'
    ) then
      alter publication supabase_realtime
        add table public.intake_submission_events;
    end if;

  end if;
end;
$$;


comment on table public.intake_categories is
  'Reusable RideArrivo intake categories and default workstation routing.';

comment on table public.intake_forms is
  'Reusable RideArrivo form definitions and routing configuration.';

comment on table public.intake_form_versions is
  'Versioned user-facing form headers, descriptions and dynamic field schemas.';

comment on table public.intake_submissions is
  'Immutable submitted intake data plus controlled workflow status and assignment.';

comment on table public.intake_submission_events is
  'Append-only operational history for intake submissions.';


commit;
