-- RideArrivo Marketing Campaign & Influencer Intelligence
--
-- Extends the existing marketing_campaigns, marketing_content and
-- marketing_attribution model. It does not duplicate booking revenue,
-- attribution spend or Marketing Wallet settlement records.
--
-- Privacy boundary:
--   * creator records contain professional/public identity only
--   * no creator private email/phone fields
--   * no customer identifiers or customer payloads
--   * no raw analytics query strings
--   * social performance is aggregate only
--
-- Existing attribution remains authoritative for:
--   spend, leads, bookings and attributed revenue.
--
-- Existing Marketing Wallet remains authoritative for:
--   funding, approvals, transfers, ledger and settlement.

create table public.marketing_creators (
  id uuid primary key default gen_random_uuid(),

  display_name text not null,
  creator_code text not null unique,

  creator_type text not null default 'influencer'
    check (
      creator_type in (
        'influencer',
        'creator',
        'affiliate',
        'ambassador',
        'media_partner'
      )
    ),

  agency_name text,
  sourced_via text,
  primary_platform text,
  public_handle text,
  profile_url text,

  status text not null default 'active'
    check (
      status in (
        'active',
        'paused',
        'archived'
      )
    ),

  notes text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_creators_display_name_check
    check (
      length(btrim(display_name))
      between 2 and 160
    ),

  constraint marketing_creators_code_check
    check (
      creator_code = lower(creator_code)
      and creator_code ~
        '^[a-z0-9][a-z0-9_-]{1,63}$'
    ),

  constraint marketing_creators_agency_check
    check (
      agency_name is null
      or length(btrim(agency_name)) <= 160
    ),

  constraint marketing_creators_source_check
    check (
      sourced_via is null
      or length(btrim(sourced_via)) <= 160
    ),

  constraint marketing_creators_platform_check
    check (
      primary_platform is null
      or length(btrim(primary_platform)) <= 64
    ),

  constraint marketing_creators_handle_check
    check (
      public_handle is null
      or length(btrim(public_handle)) <= 160
    ),

  constraint marketing_creators_profile_url_check
    check (
      profile_url is null
      or profile_url ~* '^https://'
    ),

  constraint marketing_creators_notes_check
    check (
      notes is null
      or length(notes) <= 4000
    )
);

create table public.marketing_campaign_creators (
  id uuid primary key default gen_random_uuid(),

  campaign_id uuid not null
    references public.marketing_campaigns(id)
    on delete restrict,

  creator_id uuid not null
    references public.marketing_creators(id)
    on delete restrict,

  relationship_type text not null default 'paid'
    check (
      relationship_type in (
        'paid',
        'affiliate',
        'ambassador',
        'barter',
        'earned',
        'other'
      )
    ),

  sourced_via text,

  agreed_fee numeric(14,2) not null default 0
    check (agreed_fee >= 0),

  currency text not null default 'NGN'
    check (currency ~ '^[A-Z]{3}$'),

  tracking_code text not null unique,

  promo_code text,
  brief text,

  status text not null default 'planned'
    check (
      status in (
        'planned',
        'contracted',
        'active',
        'completed',
        'cancelled'
      )
    ),

  started_at date,
  ended_at date,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_campaign_creators_tracking_code_check
    check (
      tracking_code = lower(tracking_code)
      and tracking_code ~
        '^[a-z0-9][a-z0-9_-]{1,95}$'
    ),

  constraint marketing_campaign_creators_dates_check
    check (
      ended_at is null
      or started_at is null
      or ended_at >= started_at
    ),

  constraint marketing_campaign_creators_brief_check
    check (
      brief is null
      or length(brief) <= 8000
    ),

  unique (campaign_id, creator_id),
  unique (id, campaign_id)
);

-- Allows child objects to prove that a content record belongs
-- to the same campaign without changing the existing content model.
create unique index
if not exists marketing_content_id_campaign_uidx
on public.marketing_content (
  id,
  campaign_id
);

create table public.marketing_content_creators (
  id uuid primary key default gen_random_uuid(),

  campaign_id uuid not null
    references public.marketing_campaigns(id)
    on delete restrict,

  content_id uuid not null,

  campaign_creator_id uuid not null,

  relationship_role text not null default 'primary'
    check (
      relationship_role in (
        'primary',
        'collaborator',
        'featured',
        'paid_partner'
      )
    ),

  platform_content_id text,
  post_url text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_content_creators_platform_id_check
    check (
      platform_content_id is null
      or length(btrim(platform_content_id)) <= 255
    ),

  constraint marketing_content_creators_post_url_check
    check (
      post_url is null
      or post_url ~* '^https://'
    ),

  foreign key (
    campaign_creator_id,
    campaign_id
  )
  references public.marketing_campaign_creators (
    id,
    campaign_id
  )
  on delete restrict,

  foreign key (
    content_id,
    campaign_id
  )
  references public.marketing_content (
    id,
    campaign_id
  )
  on delete restrict,

  unique (
    content_id,
    campaign_creator_id
  ),

  unique (
    id,
    campaign_id
  ),

  unique (
    id,
    campaign_id,
    campaign_creator_id
  )
);

create table public.marketing_tracking_links (
  id uuid primary key default gen_random_uuid(),

  campaign_id uuid not null
    references public.marketing_campaigns(id)
    on delete restrict,

  campaign_creator_id uuid,
  content_creator_id uuid,

  destination_url text not null,

  utm_source text not null,
  utm_medium text not null,
  utm_campaign text not null,
  utm_content text,
  utm_term text,

  tracking_code text not null unique,

  status text not null default 'active'
    check (
      status in (
        'active',
        'paused',
        'retired'
      )
    ),

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_tracking_links_destination_check
    check (
      destination_url ~*
        '^https://([a-z0-9-]+\.)*ridearrivo\.com(/|$)'
      and destination_url !~ '[?#]'
    ),

  constraint marketing_tracking_links_source_check
    check (
      length(btrim(utm_source))
      between 1 and 160
    ),

  constraint marketing_tracking_links_medium_check
    check (
      length(btrim(utm_medium))
      between 1 and 160
    ),

  constraint marketing_tracking_links_campaign_check
    check (
      length(btrim(utm_campaign))
      between 1 and 200
    ),

  constraint marketing_tracking_links_content_check
    check (
      utm_content is null
      or length(btrim(utm_content)) <= 200
    ),

  constraint marketing_tracking_links_term_check
    check (
      utm_term is null
      or length(btrim(utm_term)) <= 200
    ),

  constraint marketing_tracking_links_code_check
    check (
      tracking_code = lower(tracking_code)
      and tracking_code ~
        '^[a-z0-9][a-z0-9_-]{1,95}$'
    ),

  constraint marketing_tracking_links_content_creator_check
    check (
      content_creator_id is null
      or campaign_creator_id is not null
    ),

  foreign key (
    campaign_creator_id,
    campaign_id
  )
  references public.marketing_campaign_creators (
    id,
    campaign_id
  )
  on delete restrict,

  foreign key (
    content_creator_id,
    campaign_id,
    campaign_creator_id
  )
  references public.marketing_content_creators (
    id,
    campaign_id,
    campaign_creator_id
  )
  on delete restrict,

  unique (
    id,
    campaign_id
  ),

  unique (
    id,
    campaign_id,
    campaign_creator_id
  )
);

-- Social-platform snapshots are append-only.
-- Corrections create a new snapshot that points at the replaced one.
create table public.marketing_performance_snapshots (
  id uuid primary key default gen_random_uuid(),

  campaign_id uuid not null,
  campaign_creator_id uuid not null,
  content_creator_id uuid not null,

  platform text not null,

  source_system text not null default 'manual'
    check (
      source_system in (
        'manual',
        'instagram',
        'facebook',
        'meta',
        'tiktok',
        'youtube',
        'other'
      )
    ),

  metric_scope text not null default 'period'
    check (
      metric_scope in (
        'daily',
        'period',
        'campaign_to_date',
        'lifetime'
      )
    ),

  period_start date not null,
  period_end date not null,

  audience_followers bigint not null default 0
    check (audience_followers >= 0),

  reach bigint not null default 0
    check (reach >= 0),

  impressions bigint not null default 0
    check (impressions >= 0),

  views bigint not null default 0
    check (views >= 0),

  engagements bigint not null default 0
    check (engagements >= 0),

  likes bigint not null default 0
    check (likes >= 0),

  comments bigint not null default 0
    check (comments >= 0),

  shares bigint not null default 0
    check (shares >= 0),

  saves bigint not null default 0
    check (saves >= 0),

  link_clicks bigint not null default 0
    check (link_clicks >= 0),

  source_reference text,

  supersedes_snapshot_id uuid
    references public.marketing_performance_snapshots(id)
    on delete restrict,

  correction_reason text,

  created_by uuid not null default auth.uid(),
  recorded_at timestamptz not null default now(),

  constraint marketing_performance_period_check
    check (
      period_end >= period_start
    ),

  constraint marketing_performance_platform_check
    check (
      length(btrim(platform))
      between 1 and 64
    ),

  constraint marketing_performance_reference_check
    check (
      source_reference is null
      or length(btrim(source_reference)) <= 255
    ),

  constraint marketing_performance_supersedes_check
    check (
      supersedes_snapshot_id is null
      or supersedes_snapshot_id <> id
    ),

  constraint marketing_performance_correction_check
    check (
      supersedes_snapshot_id is null
      or (
        correction_reason is not null
        and length(btrim(correction_reason))
          between 3 and 500
      )
    ),

  foreign key (
    content_creator_id,
    campaign_id,
    campaign_creator_id
  )
  references public.marketing_content_creators (
    id,
    campaign_id,
    campaign_creator_id
  )
  on delete restrict
);

-- Bridges existing marketing_attribution rows to the creator/content
-- intelligence model. The actual spend/leads/bookings/revenue remain
-- stored only in marketing_attribution.
create table public.marketing_attribution_links (
  id uuid primary key default gen_random_uuid(),

  attribution_id uuid not null unique
    references public.marketing_attribution(id)
    on delete cascade,

  campaign_id uuid not null
    references public.marketing_campaigns(id)
    on delete restrict,

  campaign_creator_id uuid,
  content_creator_id uuid,
  tracking_link_id uuid,

  utm_content text,

  attribution_model text not null default 'last_non_direct'
    check (
      attribution_model in (
        'last_click',
        'first_click',
        'last_non_direct',
        'manual'
      )
    ),

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_attribution_links_content_check
    check (
      content_creator_id is null
      or campaign_creator_id is not null
    ),

  constraint marketing_attribution_links_utm_content_check
    check (
      utm_content is null
      or length(btrim(utm_content)) <= 200
    ),

  foreign key (
    campaign_creator_id,
    campaign_id
  )
  references public.marketing_campaign_creators (
    id,
    campaign_id
  )
  on delete restrict,

  foreign key (
    content_creator_id,
    campaign_id,
    campaign_creator_id
  )
  references public.marketing_content_creators (
    id,
    campaign_id,
    campaign_creator_id
  )
  on delete restrict,

  foreign key (
    tracking_link_id,
    campaign_id
  )
  references public.marketing_tracking_links (
    id,
    campaign_id
  )
  on delete restrict,

  foreign key (
    tracking_link_id,
    campaign_id,
    campaign_creator_id
  )
  references public.marketing_tracking_links (
    id,
    campaign_id,
    campaign_creator_id
  )
  on delete restrict
);

create index marketing_campaign_creators_campaign_idx
  on public.marketing_campaign_creators(campaign_id);

create index marketing_campaign_creators_creator_idx
  on public.marketing_campaign_creators(creator_id);

create index marketing_content_creators_campaign_idx
  on public.marketing_content_creators(campaign_id);

create index marketing_content_creators_content_idx
  on public.marketing_content_creators(content_id);

create index marketing_tracking_links_campaign_idx
  on public.marketing_tracking_links(campaign_id);

create index marketing_tracking_links_creator_idx
  on public.marketing_tracking_links(campaign_creator_id);

create index marketing_performance_content_idx
  on public.marketing_performance_snapshots(content_creator_id);

create index marketing_performance_period_idx
  on public.marketing_performance_snapshots(
    campaign_id,
    period_start,
    period_end
  );

create index marketing_attribution_links_campaign_idx
  on public.marketing_attribution_links(campaign_id);

create index marketing_attribution_links_creator_idx
  on public.marketing_attribution_links(campaign_creator_id);

create or replace function
public.touch_marketing_intelligence_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all
on function public.touch_marketing_intelligence_updated_at()
from public;

grant execute
on function public.touch_marketing_intelligence_updated_at()
to authenticated, service_role;

create trigger marketing_creators_touch_updated_at
before update on public.marketing_creators
for each row
execute function public.touch_marketing_intelligence_updated_at();

create trigger marketing_campaign_creators_touch_updated_at
before update on public.marketing_campaign_creators
for each row
execute function public.touch_marketing_intelligence_updated_at();

create trigger marketing_content_creators_touch_updated_at
before update on public.marketing_content_creators
for each row
execute function public.touch_marketing_intelligence_updated_at();

create trigger marketing_tracking_links_touch_updated_at
before update on public.marketing_tracking_links
for each row
execute function public.touch_marketing_intelligence_updated_at();

create trigger marketing_attribution_links_touch_updated_at
before update on public.marketing_attribution_links
for each row
execute function public.touch_marketing_intelligence_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'marketing_creators',
    'marketing_campaign_creators',
    'marketing_content_creators',
    'marketing_tracking_links',
    'marketing_attribution_links'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      t
    );

    execute format(
      'create policy %I on public.%I
       for select to authenticated
       using (
         public.has_workspace_role(
           array[''marketing'',''manager'',''admin'']
         )
       )',
      t || ' intelligence read',
      t
    );

    execute format(
      'create policy %I on public.%I
       for insert to authenticated
       with check (
         public.has_workspace_role(
           array[''marketing'',''admin'']
         )
       )',
      t || ' intelligence insert',
      t
    );

    execute format(
      'create policy %I on public.%I
       for update to authenticated
       using (
         public.has_workspace_role(
           array[''marketing'',''admin'']
         )
       )
       with check (
         public.has_workspace_role(
           array[''marketing'',''admin'']
         )
       )',
      t || ' intelligence update',
      t
    );

    execute format(
      'create policy %I on public.%I
       for delete to authenticated
       using (
         public.has_workspace_role(
           array[''marketing'',''admin'']
         )
       )',
      t || ' intelligence delete',
      t
    );
  end loop;
end
$$;

alter table public.marketing_performance_snapshots
enable row level security;

create policy "marketing performance snapshots read"
on public.marketing_performance_snapshots
for select
to authenticated
using (
  public.has_workspace_role(
    array['marketing','manager','admin']
  )
);

create policy "marketing performance snapshots insert"
on public.marketing_performance_snapshots
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['marketing','admin']
  )
);

-- Reset Supabase table privileges before granting the
-- intentionally narrow application surface below. New tables
-- may otherwise retain default authenticated CRUD privileges.
revoke all
on table
  public.marketing_creators,
  public.marketing_campaign_creators,
  public.marketing_content_creators,
  public.marketing_tracking_links,
  public.marketing_performance_snapshots,
  public.marketing_attribution_links
from public, anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on table
  public.marketing_creators,
  public.marketing_campaign_creators,
  public.marketing_content_creators,
  public.marketing_tracking_links,
  public.marketing_attribution_links
to authenticated;

grant
  select,
  insert
on table
  public.marketing_performance_snapshots
to authenticated;

grant all
on table
  public.marketing_creators,
  public.marketing_campaign_creators,
  public.marketing_content_creators,
  public.marketing_tracking_links,
  public.marketing_performance_snapshots,
  public.marketing_attribution_links
to service_role;

comment on table public.marketing_creators is
'Professional/public creator identity used for RideArrivo marketing intelligence. Private contact details are intentionally excluded.';

comment on table public.marketing_campaign_creators is
'Connects an existing RideArrivo campaign to a creator or influencer. Contractual fee is recorded here; actual payment settlement remains in Marketing Wallet.';

comment on table public.marketing_content_creators is
'Connects existing marketing content to the campaign creator responsible for or featured in that content.';

comment on table public.marketing_tracking_links is
'Privacy-safe RideArrivo tracking metadata. Destination URLs cannot contain query strings; UTM fields are stored separately.';

comment on table public.marketing_performance_snapshots is
'Append-only aggregate social performance snapshots. Contains no customer-level analytics or customer identifiers.';

comment on table public.marketing_attribution_links is
'Maps existing aggregate marketing_attribution records to campaigns, creators, content and tracking links without duplicating attribution metrics.';
