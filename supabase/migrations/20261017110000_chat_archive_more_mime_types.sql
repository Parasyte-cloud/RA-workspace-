-- Same gap as Company Files: Chat attachments and the Archive only accepted a
-- short list, so Numbers/Pages/Keynote, OpenDocument and HEIC files failed
-- with "mime type ... is not supported". Widen both allow-lists. Buckets stay
-- private, size caps and access policies are unchanged.
update storage.buckets
set allowed_mime_types = allowed_mime_types || array[
  'application/rtf', 'text/rtf', 'text/markdown', 'application/json',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.apple.numbers', 'application/vnd.apple.pages', 'application/vnd.apple.keynote',
  'application/x-iwork-numbers-sffnumbers', 'application/x-iwork-pages-sffpages', 'application/x-iwork-keynote-sffkey',
  'image/heic', 'image/heif'
]::text[]
where id in ('chat-attachments', 'archive');

-- Remove duplicates the append may have created (archive already listed rtf).
update storage.buckets b
set allowed_mime_types = (select array_agg(distinct m order by m) from unnest(b.allowed_mime_types) m)
where id in ('chat-attachments', 'archive');
