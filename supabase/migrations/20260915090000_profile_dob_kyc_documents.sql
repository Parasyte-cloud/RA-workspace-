-- ============================================================
-- RideArrivo Workspace Profile: Date of Birth + KYC Document Uploads
-- Per Engineering Brief 2026-09-14 (Wuraola Awotungase, Head of Operations)
-- ============================================================

begin;

-- ------------------------------------------------------------
-- DATE OF BIRTH
-- ------------------------------------------------------------

alter table public.employee_profiles
  add column if not exists date_of_birth date;

-- ------------------------------------------------------------
-- KYC DOCUMENT METADATA
-- One row per uploaded file. Storage bytes live in the
-- private 'employee-kyc-documents' bucket below; this table
-- is what the UI/HR actually query and enforce the 3-file cap
-- against, since Postgres RLS can't cap storage.objects rows
-- by folder count on its own.
-- ------------------------------------------------------------

create table if not exists public.employee_kyc_documents (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  document_type text not null
    check (
      document_type in (
        'means_of_identification',
        'home_address_proof',
        'account_details_form',
        'guarantors_form',
        'reference_letters'
      )
    ),

  storage_path text not null unique,
  original_filename text not null,
  file_size bigint not null default 0,
  content_type text,

  uploaded_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  created_at timestamptz not null default now()
);

create index if not exists
  idx_employee_kyc_documents_employee
on public.employee_kyc_documents(employee_id, document_type);

-- ------------------------------------------------------------
-- 3-FILES-PER-TYPE CAP
-- Enforced server-side, not just in the UI, since RLS alone
-- can't express a count constraint.
-- ------------------------------------------------------------

create or replace function
public.enforce_employee_kyc_document_limit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  existing_count integer;
begin
  select count(*)
  into existing_count
  from public.employee_kyc_documents
  where
    employee_id = new.employee_id
    and document_type = new.document_type;

  if existing_count >= 3 then
    raise exception
      'Only 3 files are allowed for % per employee. Delete one before uploading another.',
      new.document_type;
  end if;

  return new;
end;
$$;

drop trigger if exists
  employee_kyc_documents_enforce_limit
on public.employee_kyc_documents;

create trigger
  employee_kyc_documents_enforce_limit
before insert
on public.employee_kyc_documents
for each row
execute function public.enforce_employee_kyc_document_limit();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner: full access to their own documents.
-- HR / Admin: read-only, for onboarding review.
-- Nobody else, including Manager, can see these — this is
-- government ID + bank account + guarantor data.
-- ------------------------------------------------------------

alter table public.employee_kyc_documents
  enable row level security;

drop policy if exists
  "kyc documents owner read"
on public.employee_kyc_documents;

create policy "kyc documents owner read"
on public.employee_kyc_documents
for select
to authenticated
using (
  employee_id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

drop policy if exists
  "kyc documents owner insert"
on public.employee_kyc_documents;

create policy "kyc documents owner insert"
on public.employee_kyc_documents
for insert
to authenticated
with check (
  employee_id = auth.uid()
  and uploaded_by = auth.uid()
);

drop policy if exists
  "kyc documents owner delete"
on public.employee_kyc_documents;

create policy "kyc documents owner delete"
on public.employee_kyc_documents
for delete
to authenticated
using (
  employee_id = auth.uid()
);

revoke all
on public.employee_kyc_documents
from anon;

grant select, insert, delete
on public.employee_kyc_documents
to authenticated;

-- ------------------------------------------------------------
-- PRIVATE STORAGE BUCKET
-- Path format: <employee_id>/<document_type>/<filename>
-- ------------------------------------------------------------

insert into storage.buckets(
  id, name, public, file_size_limit, allowed_mime_types
)
values(
  'employee-kyc-documents',
  'employee-kyc-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg'
  ]
)
on conflict(id)
do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg'
  ];

drop policy if exists
  "kyc storage owner read"
on storage.objects;

create policy "kyc storage owner read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'employee-kyc-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_workspace_role(array['hr','admin'])
  )
);

drop policy if exists
  "kyc storage owner upload"
on storage.objects;

create policy "kyc storage owner upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists
  "kyc storage owner delete"
on storage.objects;

create policy "kyc storage owner delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'employee-kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ------------------------------------------------------------
-- EXTEND update_my_employee_profile WITH DATE OF BIRTH
-- Postgres treats a changed parameter list as a new overload,
-- not a replacement, so the old 10-arg signature is dropped
-- explicitly rather than left dangling alongside this one.
-- ------------------------------------------------------------

drop function if exists public.update_my_employee_profile(
  text,text,text,text,text,text,text,text,text,text
);

create or replace function public.update_my_employee_profile(
  p_phone text default null,
  p_whatsapp text default null,
  p_avatar_path text default null,
  p_linkedin_url text default null,
  p_bio text default null,
  p_office_address text default null,
  p_website text default null,
  p_x_url text default null,
  p_instagram_url text default null,
  p_working_hours text default null,
  p_date_of_birth date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.employee_profiles
  set
    phone = nullif(btrim(p_phone), ''),
    whatsapp = nullif(btrim(p_whatsapp), ''),
    avatar_path = nullif(btrim(p_avatar_path), ''),
    linkedin_url = nullif(btrim(p_linkedin_url), ''),
    bio = nullif(btrim(p_bio), ''),
    office_address = nullif(btrim(p_office_address), ''),
    website = nullif(btrim(p_website), ''),
    x_url = nullif(btrim(p_x_url), ''),
    instagram_url = nullif(btrim(p_instagram_url), ''),
    working_hours = coalesce(
      nullif(btrim(p_working_hours), ''),
      'Mon - Fri: 9:00 AM - 5:00 PM'
    ),
    date_of_birth = coalesce(p_date_of_birth, date_of_birth),
    updated_at = now()
  where id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Active employee profile not found';
  end if;
end;
$$;

revoke all
on function public.update_my_employee_profile(
  text,text,text,text,text,text,text,text,text,text,date
)
from public, anon;

grant execute
on function public.update_my_employee_profile(
  text,text,text,text,text,text,text,text,text,text,date
)
to authenticated;

commit;
