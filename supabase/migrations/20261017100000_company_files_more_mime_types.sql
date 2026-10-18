-- Company Files rejected common office formats ("mime type
-- application/x-iwork-numbers-sffnumbers is not supported"). The bucket only
-- allowed a short Microsoft/PDF/image list, so a Numbers, Pages, Keynote,
-- OpenDocument, RTF or HEIC file failed at upload. Widen the allow-list.
-- Still private, same 50 MB cap, same Legal/Admin-only insert policy: this
-- changes which file types are accepted, not who can upload or download.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/vnd.apple.keynote',
  'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-pages-sffpages',
  'application/x-iwork-keynote-sffkey',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'application/zip',
  'application/octet-stream'
]::text[]
where id = 'company-files';
