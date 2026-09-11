-- ROOM 7 external event document foundation.
--
-- Security model:
--   * dedicated private bucket
--   * no direct anon/authenticated table access
--   * no direct external Storage policy
--   * server-authorized signed preview URLs only
--   * maximum 10 active documents per ROOM 7 event
--   * no raw invitation or RealtimeKit credential storage
--   * access telemetry contains no IP address or user-agent data

create table public.room7_event_documents (
  id uuid primary key default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  title text not null,

  description text,

  category text not null
    default 'general',

  storage_path text not null
    unique,

  original_file_name text not null,

  mime_type text not null,

  file_size_bytes bigint not null,

  sha256_hex text,

  sort_order integer not null
    default 0,

  status text not null
    default 'published',

  available_before boolean not null
    default true,

  available_during boolean not null
    default true,

  available_after boolean not null
    default true,

  allow_download boolean not null
    default false,

  uploaded_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint room7_event_documents_room_id_id_key
    unique (room_id,id),

  constraint room7_event_documents_title_check
    check (
      char_length(btrim(title))
      between 1 and 180
    ),

  constraint room7_event_documents_description_check
    check (
      description is null
      or char_length(description) <= 2000
    ),

  constraint room7_event_documents_category_check
    check (
      category in (
        'general',
        'programme',
        'company',
        'investor',
        'brochure',
        'legal'
      )
    ),

  constraint room7_event_documents_storage_path_check
    check (
      char_length(storage_path)
      between 3 and 1024
      and storage_path !~ '(^|/)\.\.(/|$)'
    ),

  constraint room7_event_documents_file_name_check
    check (
      char_length(btrim(original_file_name))
      between 1 and 255
      and position('/' in original_file_name) = 0
      and position(chr(92) in original_file_name) = 0
    ),

  constraint room7_event_documents_mime_check
    check (
      mime_type in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    ),

  constraint room7_event_documents_size_check
    check (
      file_size_bytes
      between 1 and 26214400
    ),

  constraint room7_event_documents_sha256_check
    check (
      sha256_hex is null
      or sha256_hex ~ '^[0-9a-f]{64}$'
    ),

  constraint room7_event_documents_sort_check
    check (
      sort_order between 0 and 999
    ),

  constraint room7_event_documents_status_check
    check (
      status in (
        'draft',
        'published',
        'archived'
      )
    ),

  constraint room7_event_documents_visibility_check
    check (
      status <> 'published'
      or available_before
      or available_during
      or available_after
    )
);

create index room7_event_documents_room_idx
  on public.room7_event_documents(
    room_id,
    status,
    sort_order,
    created_at
  );

create index room7_event_documents_visibility_idx
  on public.room7_event_documents(
    room_id,
    available_before,
    available_during,
    available_after
  )
  where status = 'published';

create table public.room7_event_document_access (
  id uuid primary key
    default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  document_id uuid not null,

  invitation_id uuid
    references public.room7_guest_invitations(id)
    on delete set null,

  guest_participant_id uuid
    references public.room7_guest_participants(id)
    on delete set null,

  access_kind text not null,

  accessed_at timestamptz not null
    default now(),

  constraint room7_event_document_access_document_fk
    foreign key (room_id,document_id)
    references public.room7_event_documents(room_id,id)
    on delete cascade,

  constraint room7_event_document_access_kind_check
    check (
      access_kind in (
        'preview',
        'download'
      )
    )
);

create index room7_event_document_access_room_idx
  on public.room7_event_document_access(
    room_id,
    accessed_at desc
  );

create index room7_event_document_access_document_idx
  on public.room7_event_document_access(
    document_id,
    accessed_at desc
  );

create or replace function
  public.room7_touch_event_document_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger room7_event_documents_touch_updated_at
before update
on public.room7_event_documents
for each row
execute function
  public.room7_touch_event_document_updated_at();

create or replace function
  public.room7_enforce_event_document_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  active_count integer;
begin
  if new.status = 'archived' then
    return new;
  end if;

  -- Lock the parent room so concurrent uploads for the
  -- same event cannot race past the ten-document limit.
  perform 1
  from public.workspace_rooms
  where id = new.room_id
  for update;

  if not found then
    raise exception
      'ROOM 7 event does not exist.';
  end if;

  select count(*)
  into active_count
  from public.room7_event_documents d
  where d.room_id = new.room_id
    and d.status <> 'archived'
    and d.id <> new.id;

  if active_count >= 10 then
    raise exception
      'ROOM 7 supports a maximum of 10 active event documents.';
  end if;

  return new;
end;
$$;

create trigger room7_event_documents_limit
before insert
or update of room_id,status
on public.room7_event_documents
for each row
execute function
  public.room7_enforce_event_document_limit();

alter table
  public.room7_event_documents
enable row level security;

alter table
  public.room7_event_document_access
enable row level security;

revoke all
on public.room7_event_documents
from public, anon, authenticated;

revoke all
on public.room7_event_document_access
from public, anon, authenticated;

grant all
on public.room7_event_documents
to service_role;

grant all
on public.room7_event_document_access
to service_role;

revoke all
on function
  public.room7_touch_event_document_updated_at()
from public;

revoke all
on function
  public.room7_enforce_event_document_limit()
from public;

grant execute
on function
  public.room7_touch_event_document_updated_at()
to service_role;

grant execute
on function
  public.room7_enforce_event_document_limit()
to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'room7-event-documents',
  'room7-event-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id)
do nothing;

do $$
declare
  bucket_record storage.buckets%rowtype;
begin
  select *
  into bucket_record
  from storage.buckets
  where id = 'room7-event-documents';

  if not found then
    raise exception
      'ROOM 7 event document bucket was not created.';
  end if;

  if bucket_record.public is true then
    raise exception
      'ROOM 7 event document bucket must remain private.';
  end if;

  if bucket_record.file_size_limit <> 26214400 then
    raise exception
      'ROOM 7 event document bucket has an unsafe size limit.';
  end if;
end;
$$;

comment on table
  public.room7_event_documents
is
  'Private ROOM 7 event documents. External access is mediated by server-authorized short-lived signed URLs.';

comment on table
  public.room7_event_document_access
is
  'Privacy-minimal ROOM 7 document preview/download telemetry. No IP address or raw guest credential is stored.';

comment on column
  public.room7_event_documents.allow_download
is
  'Controls the ROOM 7 download affordance. It cannot prevent a recipient from saving bytes that their browser is authorized to render.';
