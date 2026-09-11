begin;

-- ============================================================
-- ROOM 7 EXTERNAL EVENT CONTENT
-- ============================================================

create or replace function public.room7_valid_story_points(
  value jsonb
)
returns boolean
language plpgsql
immutable
set search_path=pg_catalog,public,pg_temp
as $$
declare
  item jsonb;
  item_title text;
  item_description text;
begin
  if value is null
     or jsonb_typeof(value) <> 'array'
     or jsonb_array_length(value) > 6
  then
    return false;
  end if;

  for item in
    select element
    from jsonb_array_elements(value) as items(element)
  loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;

    if (item - 'title' - 'description') <> '{}'::jsonb then
      return false;
    end if;

    if not (item ? 'title')
       or jsonb_typeof(item -> 'title') <> 'string'
    then
      return false;
    end if;

    item_title :=
      btrim(
        coalesce(
          item ->> 'title',
          ''
        )
      );

    if char_length(item_title) not between 1 and 80 then
      return false;
    end if;

    if item ? 'description'
       and jsonb_typeof(item -> 'description')
           not in ('string','null')
    then
      return false;
    end if;

    item_description :=
      btrim(
        coalesce(
          item ->> 'description',
          ''
        )
      );

    if char_length(item_description) > 500 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.room7_valid_programme_items(
  value jsonb
)
returns boolean
language plpgsql
immutable
set search_path=pg_catalog,public,pg_temp
as $$
declare
  item jsonb;
  item_title text;
  item_description text;
  item_time text;
begin
  if value is null
     or jsonb_typeof(value) <> 'array'
     or jsonb_array_length(value) > 12
  then
    return false;
  end if;

  for item in
    select element
    from jsonb_array_elements(value) as items(element)
  loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;

    if (
      item
      - 'title'
      - 'description'
      - 'time_label'
    ) <> '{}'::jsonb then
      return false;
    end if;

    if not (item ? 'title')
       or jsonb_typeof(item -> 'title') <> 'string'
    then
      return false;
    end if;

    item_title :=
      btrim(
        coalesce(
          item ->> 'title',
          ''
        )
      );

    if char_length(item_title) not between 1 and 180 then
      return false;
    end if;

    if item ? 'description'
       and jsonb_typeof(item -> 'description')
           not in ('string','null')
    then
      return false;
    end if;

    item_description :=
      btrim(
        coalesce(
          item ->> 'description',
          ''
        )
      );

    if char_length(item_description) > 1000 then
      return false;
    end if;

    if item ? 'time_label'
       and jsonb_typeof(item -> 'time_label')
           not in ('string','null')
    then
      return false;
    end if;

    item_time :=
      btrim(
        coalesce(
          item ->> 'time_label',
          ''
        )
      );

    if char_length(item_time) > 80 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table public.room7_event_content (
  room_id uuid primary key
    references public.workspace_rooms(id)
    on delete cascade,

  story_headline text
    check (
      story_headline is null
      or char_length(btrim(story_headline))
         between 1 and 180
    ),

  story_body text
    check (
      story_body is null
      or char_length(btrim(story_body))
         between 1 and 5000
    ),

  story_points jsonb not null default '[]'::jsonb
    check (
      public.room7_valid_story_points(story_points)
    ),

  programme_items jsonb not null default '[]'::jsonb
    check (
      public.room7_valid_programme_items(programme_items)
    ),

  invest_headline text
    check (
      invest_headline is null
      or char_length(btrim(invest_headline))
         between 1 and 180
    ),

  invest_body text
    check (
      invest_body is null
      or char_length(btrim(invest_body))
         between 1 and 5000
    ),

  invest_cta_label text
    check (
      invest_cta_label is null
      or char_length(btrim(invest_cta_label))
         between 1 and 80
    ),

  qna_enabled boolean not null default true,

  investor_interest_enabled boolean not null default true,

  updated_by uuid
    references public.employee_profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);

-- Same-room identity integrity for engagement records.
create unique index if not exists
  room7_guest_invitations_room_id_id_uidx
  on public.room7_guest_invitations(room_id,id);

create unique index if not exists
  room7_guest_participants_room_id_id_uidx
  on public.room7_guest_participants(room_id,id);

-- ============================================================
-- MODERATED Q&A
--
-- Guest identity/contact remains private. Public question
-- projections must never expose email or guest identifiers.
-- ============================================================

create table public.room7_event_questions (
  id uuid primary key default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  invitation_id uuid,

  guest_id uuid,

  display_name text not null
    check (
      char_length(btrim(display_name))
      between 1 and 180
    ),

  email text not null
    check (
      char_length(email)
      between 3 and 320
      and email = lower(email)
    ),

  question text not null
    check (
      char_length(btrim(question))
      between 3 and 1200
    ),

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'approved',
        'answered',
        'dismissed'
      )
    ),

  answer_text text
    check (
      answer_text is null
      or char_length(btrim(answer_text))
         between 1 and 2000
    ),

  is_pinned boolean not null default false,

  moderated_by uuid
    references public.employee_profiles(id)
    on delete set null,

  moderated_at timestamptz,

  answered_at timestamptz,

  submitted_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  foreign key (room_id, invitation_id)
    references public.room7_guest_invitations(room_id,id)
    on delete set null (invitation_id),

  foreign key (room_id, guest_id)
    references public.room7_guest_participants(room_id,id)
    on delete set null (guest_id),

  check (
    status <> 'answered'
    or (
      answer_text is not null
      and answered_at is not null
    )
  ),

  check (
    answer_text is null
    or status = 'answered'
  )
);

create index room7_event_questions_room_status_idx
  on public.room7_event_questions(
    room_id,
    status,
    submitted_at
  );

create index room7_event_questions_room_email_idx
  on public.room7_event_questions(
    room_id,
    email,
    submitted_at desc
  );

-- ============================================================
-- INVESTOR / STAKEHOLDER INTEREST
--
-- Intentionally separate from event analytics and attendance.
-- This is contact/follow-up information, not audience telemetry.
-- ============================================================

create table public.room7_investor_interest (
  id uuid primary key default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  invitation_id uuid,

  guest_id uuid,

  display_name text not null
    check (
      char_length(btrim(display_name))
      between 1 and 180
    ),

  email text not null
    check (
      char_length(email)
      between 3 and 320
      and email = lower(email)
    ),

  company text
    check (
      company is null
      or char_length(btrim(company))
         between 1 and 180
    ),

  phone text
    check (
      phone is null
      or char_length(btrim(phone))
         between 3 and 40
    ),

  interest_type text not null
    check (
      interest_type in (
        'investment',
        'partnership',
        'information',
        'meeting'
      )
    ),

  investment_range text
    check (
      investment_range is null
      or char_length(btrim(investment_range))
         between 1 and 120
    ),

  message text
    check (
      message is null
      or char_length(btrim(message))
         between 1 and 2000
    ),

  contact_consent boolean not null
    check (contact_consent = true),

  consent_version text not null
    default 'room7-event-contact-v1'
    check (
      char_length(consent_version)
      between 1 and 80
    ),

  consent_at timestamptz not null,

  status text not null default 'new'
    check (
      status in (
        'new',
        'contacted',
        'qualified',
        'closed'
      )
    ),

  internal_notes text
    check (
      internal_notes is null
      or char_length(internal_notes) <= 5000
    ),

  assigned_to uuid
    references public.employee_profiles(id)
    on delete set null,

  submitted_at timestamptz not null default now(),

  last_submitted_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  foreign key (room_id, invitation_id)
    references public.room7_guest_invitations(room_id,id)
    on delete set null (invitation_id),

  foreign key (room_id, guest_id)
    references public.room7_guest_participants(room_id,id)
    on delete set null (guest_id),

  unique(room_id,email)
);

create index room7_investor_interest_room_status_idx
  on public.room7_investor_interest(
    room_id,
    status,
    last_submitted_at desc
  );

-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.touch_room7_event_engagement_updated_at()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger room7_event_content_updated_at
before update on public.room7_event_content
for each row
execute function public.touch_room7_event_engagement_updated_at();

create trigger room7_event_questions_updated_at
before update on public.room7_event_questions
for each row
execute function public.touch_room7_event_engagement_updated_at();

create trigger room7_investor_interest_updated_at
before update on public.room7_investor_interest
for each row
execute function public.touch_room7_event_engagement_updated_at();

-- ============================================================
-- RLS / DIRECT ACCESS
--
-- Guests never read/write these tables directly.
-- All public actions are server mediated.
-- ============================================================

alter table public.room7_event_content
  enable row level security;

alter table public.room7_event_questions
  enable row level security;

alter table public.room7_investor_interest
  enable row level security;

revoke all
on table public.room7_event_content
from public, anon, authenticated;

revoke all
on table public.room7_event_questions
from public, anon, authenticated;

revoke all
on table public.room7_investor_interest
from public, anon, authenticated;

grant select,insert,update,delete
on table public.room7_event_content
to service_role;

grant select,insert,update,delete
on table public.room7_event_questions
to service_role;

grant select,insert,update,delete
on table public.room7_investor_interest
to service_role;

revoke all
on function public.room7_valid_story_points(jsonb)
from public, anon, authenticated;

revoke all
on function public.room7_valid_programme_items(jsonb)
from public, anon, authenticated;

revoke all
on function public.touch_room7_event_engagement_updated_at()
from public, anon, authenticated;

grant execute
on function public.room7_valid_story_points(jsonb)
to service_role;

grant execute
on function public.room7_valid_programme_items(jsonb)
to service_role;

grant execute
on function public.touch_room7_event_engagement_updated_at()
to service_role;

comment on table public.room7_event_content is
  'Host-managed public Story, Programme and Invest content for ROOM 7 external events.';

comment on table public.room7_event_questions is
  'Moderated ROOM 7 guest questions. Guest identity remains private; only approved projections are public.';

comment on table public.room7_investor_interest is
  'ROOM 7 investor/stakeholder contact and follow-up interest, intentionally separate from event analytics and attendance.';

commit;
