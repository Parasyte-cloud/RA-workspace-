// PArAsYtE: the one list of ROOM 7 event document types the browser knows about.
//
// The same list is enforced in four more places, and they must stay equal (a
// test compares them): supabase/functions/room-event-documents/lib.ts,
// the room7_event_documents_mime_check constraint, the room7-event-documents
// storage bucket, and the file picker built from ACCEPT below.
//
// Why these types: they are what people keep in Downloads for a meeting (the
// PDF pack, the deck, the agenda, the budget). Legacy .doc/.xls/.ppt and the
// macro-enabled .docm/.xlsm/.pptm are left out on purpose: they can carry
// macros, and every guest downloads what is published here. Ask for a PDF or
// a .docx/.xlsx/.pptx instead.

export type Room7DocumentType = {
  mime: string
  extensions: string[]
  label: string
  // Only PDFs and images can be shown inside the ROOM 7 reader. Everything
  // else is download only, so it must always be downloadable.
  previewable: boolean
}

export const ROOM7_DOCUMENT_TYPES: Room7DocumentType[] = [
  { mime: 'application/pdf', extensions: ['pdf'], label: 'PDF', previewable: true },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], label: 'JPEG image', previewable: true },
  { mime: 'image/png', extensions: ['png'], label: 'PNG image', previewable: true },
  { mime: 'image/webp', extensions: ['webp'], label: 'WebP image', previewable: true },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    label: 'Word document',
    previewable: false,
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    label: 'Excel workbook',
    previewable: false,
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
    label: 'PowerPoint deck',
    previewable: false,
  },
  { mime: 'text/plain', extensions: ['txt'], label: 'Text file', previewable: false },
  { mime: 'text/csv', extensions: ['csv'], label: 'CSV file', previewable: false },
]

export const ROOM7_DOCUMENT_MIMES = ROOM7_DOCUMENT_TYPES.map(type => type.mime)

// For <input type="file" accept>. Extensions first: they are what the macOS and
// Windows pickers match on, and Windows often reports a wrong or empty MIME
// type for .csv and Office files.
export const ROOM7_DOCUMENT_ACCEPT = [
  ...ROOM7_DOCUMENT_TYPES.flatMap(type => type.extensions.map(extension => `.${extension}`)),
  ...ROOM7_DOCUMENT_MIMES,
].join(',')

export const ROOM7_DOCUMENT_HINT =
  'PDF, images (JPEG, PNG, WebP), Word, Excel, PowerPoint, text and CSV files, up to 25 MB each.'

function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(String(fileName || '').trim())
  return match ? match[1].toLowerCase() : ''
}

// The MIME type to reserve and upload with, or null when the file is not an
// allowed document. The extension wins over what the browser reports, because
// browsers report '', application/octet-stream, or something else entirely
// (Windows says application/vnd.ms-excel for a .csv).
export function inferRoom7DocumentMime(file: { name: string; type?: string }) {
  const extension = extensionOf(file.name)
  const byExtension = ROOM7_DOCUMENT_TYPES.find(type => type.extensions.includes(extension))
  if (byExtension) return byExtension.mime

  const supplied = String(file.type || '').trim().toLowerCase()
  const bySupplied = ROOM7_DOCUMENT_TYPES.find(type => type.mime === supplied)
  return bySupplied ? bySupplied.mime : null
}

export function isRoom7DocumentPreviewable(mime: string) {
  const type = ROOM7_DOCUMENT_TYPES.find(entry => entry.mime === String(mime || '').toLowerCase())
  return type ? type.previewable : false
}

export function room7DocumentLabel(mime: string) {
  const type = ROOM7_DOCUMENT_TYPES.find(entry => entry.mime === String(mime || '').toLowerCase())
  return type ? type.label : 'Document'
}
