-- ROOM 7 event documents: accept Word, Excel, PowerPoint, text and CSV files as
-- well as PDFs and images.
--
-- The picker, the Edge Function, this table's check constraint and the storage
-- bucket each had their own copy of the allowed types, so a Word or Excel file
-- from Downloads could not be chosen, and could not be uploaded either. All
-- four now list the same nine types. Legacy .doc, .xls and .ppt and the
-- macro-enabled .docm, .xlsm and .pptm are left out on purpose.
--
-- Word, Excel, PowerPoint, text and CSV cannot be shown in the ROOM 7 reader, so
-- guests can only download them. A second constraint keeps downloading on for
-- those types, otherwise a published file would be impossible to open.
--
-- Safe to run twice.

alter table public.room7_event_documents
  drop constraint if exists room7_event_documents_mime_check;

alter table public.room7_event_documents
  add constraint room7_event_documents_mime_check
  check (
    mime_type in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    )
  );

alter table public.room7_event_documents
  drop constraint if exists room7_event_documents_download_check;

alter table public.room7_event_documents
  add constraint room7_event_documents_download_check
  check (
    allow_download
    or mime_type in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    )
  );

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv'
]::text[]
where id = 'room7-event-documents';

do $$
declare
  bucket_record storage.buckets%rowtype;
begin
  select * into bucket_record
  from storage.buckets
  where id = 'room7-event-documents';

  if not found then
    raise exception 'ROOM 7 event document bucket is missing.';
  end if;

  if bucket_record.public is true then
    raise exception 'ROOM 7 event document bucket must remain private.';
  end if;

  if bucket_record.file_size_limit <> 26214400 then
    raise exception 'ROOM 7 event document bucket has an unsafe size limit.';
  end if;

  if cardinality(bucket_record.allowed_mime_types) <> 9 then
    raise exception 'ROOM 7 event document bucket should allow exactly nine types.';
  end if;
end;
$$;
