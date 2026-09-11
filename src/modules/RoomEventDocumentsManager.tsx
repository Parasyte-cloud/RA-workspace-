import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  FileText,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../room-event-documents.css'

const BUCKET =
  'room7-event-documents'

const MAX_DOCUMENTS =
  10

const MAX_FILE_BYTES =
  25 * 1024 * 1024

type DocumentStatus =
  | 'draft'
  | 'published'
  | 'archived'

type DocumentCategory =
  | 'general'
  | 'programme'
  | 'company'
  | 'investor'
  | 'brochure'
  | 'legal'

type DocumentRecord = {
  id: string
  room_id: string
  title: string
  description: string | null
  category: DocumentCategory
  storage_path: string
  original_file_name: string
  mime_type: string
  file_size_bytes: number
  sha256_hex: string | null
  sort_order: number
  status: DocumentStatus
  available_before: boolean
  available_during: boolean
  available_after: boolean
  allow_download: boolean
  created_at: string
  updated_at: string
}

type Props = {
  roomId: string
  roomTitle: string
}

const categories:
  Array<{
    value: DocumentCategory
    label: string
  }> = [
    {
      value: 'general',
      label: 'General',
    },
    {
      value: 'programme',
      label: 'Programme',
    },
    {
      value: 'company',
      label: 'Company',
    },
    {
      value: 'investor',
      label: 'Investor',
    },
    {
      value: 'brochure',
      label: 'Brochure',
    },
    {
      value: 'legal',
      label: 'Legal',
    },
  ]

function formatBytes(
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return '0 B'
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (
    value <
    1024 * 1024
  ) {
    return `${
      (
        value / 1024
      ).toFixed(1)
    } KB`
  }

  return `${
    (
      value /
      (1024 * 1024)
    ).toFixed(1)
  } MB`
}

function inferMimeType(
  file: File,
) {
  const supplied =
    file.type
      .trim()
      .toLowerCase()

  if (
    supplied ===
      'application/pdf' ||
    supplied ===
      'image/jpeg' ||
    supplied ===
      'image/png' ||
    supplied ===
      'image/webp'
  ) {
    return supplied
  }

  const lower =
    file.name
      .toLowerCase()

  if (
    lower.endsWith(
      '.pdf',
    )
  ) {
    return 'application/pdf'
  }

  if (
    lower.endsWith(
      '.jpg',
    ) ||
    lower.endsWith(
      '.jpeg',
    )
  ) {
    return 'image/jpeg'
  }

  if (
    lower.endsWith(
      '.png',
    )
  ) {
    return 'image/png'
  }

  if (
    lower.endsWith(
      '.webp',
    )
  ) {
    return 'image/webp'
  }

  return ''
}

function titleFromFile(
  fileName: string,
) {
  return (
    fileName
      .replace(
        /\.[^.]+$/,
        '',
      )
      .replace(
        /[-_]+/g,
        ' ',
      )
      .replace(
        /\s+/g,
        ' ',
      )
      .trim()
      .slice(
        0,
        180,
      ) ||
    'ROOM 7 document'
  )
}

async function sha256Hex(
  file: File,
) {
  const bytes =
    await file
      .arrayBuffer()

  const digest =
    await crypto.subtle
      .digest(
        'SHA-256',
        bytes,
      )

  return Array.from(
    new Uint8Array(
      digest,
    ),
  )
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
}

export default function RoomEventDocumentsManager({
  roomId,
  roomTitle,
}: Props) {
  const inputRef =
    useRef<HTMLInputElement>(
      null,
    )

  const [open, setOpen] =
    useState(false)

  const [
    documents,
    setDocuments,
  ] =
    useState<DocumentRecord[]>(
      [],
    )

  const [loading, setLoading] =
    useState(false)

  const [
    uploading,
    setUploading,
  ] =
    useState(false)

  const [
    savingId,
    setSavingId,
  ] =
    useState('')

  const [
    deletingId,
    setDeletingId,
  ] =
    useState('')

  const [
    progress,
    setProgress,
  ] =
    useState('')

  const [notice, setNotice] =
    useState('')

  const invokeDocuments =
    useCallback(
      async (
        body:
          Record<
            string,
            unknown
          >,
      ) => {
        const client =
          supabase

        if (!client) {
          throw new Error(
            'Workspace authentication is not configured.',
          )
        }

        const {
          data,
          error,
        } =
          await client.functions
            .invoke(
              'room-event-documents',
              {
                body,
              },
            )

        if (error) {
          throw new Error(
            error.message ||
            'ROOM 7 document service failed.',
          )
        }

        if (
          data &&
          typeof data ===
            'object' &&
          'error' in data &&
          typeof data.error ===
            'string'
        ) {
          throw new Error(
            data.error,
          )
        }

        return data
      },
      [],
    )

  const loadDocuments =
    useCallback(
      async () => {
        setLoading(true)
        setNotice('')

        try {
          const data =
            await invokeDocuments({
              action:
                'admin_list',

              room_id:
                roomId,
            })

          setDocuments(
            Array.isArray(
              data?.documents,
            )
              ? data.documents
              : [],
          )
        } catch (cause) {
          console.error(
            'ROOM 7 document list failed:',
            cause,
          )

          setNotice(
            cause instanceof Error
              ? cause.message
              : 'Unable to load ROOM 7 documents.',
          )
        } finally {
          setLoading(false)
        }
      },
      [
        invokeDocuments,
        roomId,
      ],
    )

  useEffect(() => {
    if (!open) {
      return
    }

    void loadDocuments()
  }, [
    loadDocuments,
    open,
  ])

  const updateLocal =
    (
      documentId: string,
      patch:
        Partial<DocumentRecord>,
    ) => {
      setDocuments(
        current =>
          current.map(
            document =>
              document.id ===
                documentId
                ? {
                    ...document,
                    ...patch,
                  }
                : document,
          ),
      )
    }

  const cleanupReservation =
    async (
      documentId: string,
    ) => {
      try {
        await invokeDocuments({
          action:
            'delete_document',

          room_id:
            roomId,

          document_id:
            documentId,
        })
      } catch (cause) {
        console.error(
          'ROOM 7 failed upload cleanup:',
          cause,
        )
      }
    }

  const uploadFiles =
    async (
      event:
        ChangeEvent<
          HTMLInputElement
        >,
    ) => {
      const files =
        Array.from(
          event.target.files ||
          [],
        )

      event.target.value = ''

      if (
        files.length === 0 ||
        uploading
      ) {
        return
      }

      const client =
        supabase

      if (!client) {
        setNotice(
          'Workspace authentication is not configured.',
        )
        return
      }

      const activeCount =
        documents.filter(
          document =>
            document.status !==
            'archived',
        ).length

      const remaining =
        Math.max(
          0,
          MAX_DOCUMENTS -
            activeCount,
        )

      if (
        files.length >
        remaining
      ) {
        setNotice(
          remaining === 0
            ? 'This ROOM 7 event already has 10 active documents.'
            : `You can upload ${remaining} more active document${
                remaining === 1
                  ? ''
                  : 's'
              }.`,
        )

        return
      }

      for (
        const file of files
      ) {
        const mimeType =
          inferMimeType(file)

        if (!mimeType) {
          setNotice(
            `${file.name}: use PDF, JPEG, PNG or WebP.`,
          )
          return
        }

        if (
          file.size < 1 ||
          file.size >
            MAX_FILE_BYTES
        ) {
          setNotice(
            `${file.name}: files must be no larger than 25 MB.`,
          )
          return
        }
      }

      setUploading(true)
      setNotice('')

      let completed = 0

      try {
        for (
          let index = 0;
          index < files.length;
          index += 1
        ) {
          const file =
            files[index]

          const mimeType =
            inferMimeType(file)

          setProgress(
            `Uploading ${
              index + 1
            } of ${
              files.length
            }: ${file.name}`,
          )

          const hash =
            await sha256Hex(
              file,
            )

          const prepared =
            await invokeDocuments({
              action:
                'prepare_upload',

              room_id:
                roomId,

              title:
                titleFromFile(
                  file.name,
                ),

              description:
                null,

              category:
                'general',

              original_file_name:
                file.name,

              mime_type:
                mimeType,

              file_size_bytes:
                file.size,

              sort_order:
                activeCount +
                index +
                1,

              available_before:
                true,

              available_during:
                true,

              available_after:
                true,

              allow_download:
                false,
            })

          const documentId =
            typeof prepared
              ?.document
              ?.id ===
              'string'
              ? prepared
                  .document
                  .id
              : ''

          const uploadPath =
            typeof prepared
              ?.upload
              ?.path ===
              'string'
              ? prepared
                  .upload
                  .path
              : ''

          const uploadToken =
            typeof prepared
              ?.upload
              ?.token ===
              'string'
              ? prepared
                  .upload
                  .token
              : ''

          if (
            !documentId ||
            !uploadPath ||
            !uploadToken
          ) {
            if (documentId) {
              await cleanupReservation(
                documentId,
              )
            }

            throw new Error(
              'ROOM 7 returned an incomplete secure upload grant.',
            )
          }

          try {
            const {
              error:
                uploadError,
            } =
              await client.storage
                .from(BUCKET)
                .uploadToSignedUrl(
                  uploadPath,
                  uploadToken,
                  file,
                  {
                    contentType:
                      mimeType,
                  },
                )

            if (uploadError) {
              throw uploadError
            }

            await invokeDocuments({
              action:
                'finalize_upload',

              room_id:
                roomId,

              document_id:
                documentId,

              status:
                'published',

              sha256_hex:
                hash,
            })

            completed += 1
          } catch (cause) {
            await cleanupReservation(
              documentId,
            )

            throw cause
          }
        }

        await loadDocuments()

        setNotice(
          `${completed} ROOM 7 document${
            completed === 1
              ? ''
              : 's'
          } published successfully.`,
        )
      } catch (cause) {
        console.error(
          'ROOM 7 document upload failed:',
          cause,
        )

        await loadDocuments()

        setNotice(
          cause instanceof Error
            ? cause.message
            : 'Unable to upload ROOM 7 documents.',
        )
      } finally {
        setUploading(false)
        setProgress('')
      }
    }

  const saveDocument =
    async (
      document:
        DocumentRecord,
    ) => {
      if (
        document.status ===
          'published' &&
        !document
          .available_before &&
        !document
          .available_during &&
        !document
          .available_after
      ) {
        setNotice(
          'A published document must be visible before, during or after the event.',
        )
        return
      }

      setSavingId(
        document.id,
      )

      setNotice('')

      try {
        const data =
          await invokeDocuments({
            action:
              'update_document',

            room_id:
              roomId,

            document_id:
              document.id,

            title:
              document.title,

            description:
              document.description,

            category:
              document.category,

            sort_order:
              document.sort_order,

            status:
              document.status,

            available_before:
              document
                .available_before,

            available_during:
              document
                .available_during,

            available_after:
              document
                .available_after,

            allow_download:
              document
                .allow_download,
          })

        if (data?.document) {
          updateLocal(
            document.id,
            data.document,
          )
        }

        setNotice(
          `"${document.title}" saved.`,
        )
      } catch (cause) {
        console.error(
          'ROOM 7 document update failed:',
          cause,
        )

        setNotice(
          cause instanceof Error
            ? cause.message
            : 'Unable to save ROOM 7 document.',
        )
      } finally {
        setSavingId('')
      }
    }

  const removeDocument =
    async (
      document:
        DocumentRecord,
    ) => {
      const confirmed =
        window.confirm(
          `Delete "${document.title}" from ROOM 7?\n\nThe private file and its access history for this document will be removed.`,
        )

      if (!confirmed) {
        return
      }

      setDeletingId(
        document.id,
      )

      setNotice('')

      try {
        await invokeDocuments({
          action:
            'delete_document',

          room_id:
            roomId,

          document_id:
            document.id,
        })

        setDocuments(
          current =>
            current.filter(
              item =>
                item.id !==
                document.id,
            ),
        )

        setNotice(
          `"${document.title}" deleted.`,
        )
      } catch (cause) {
        console.error(
          'ROOM 7 document deletion failed:',
          cause,
        )

        setNotice(
          cause instanceof Error
            ? cause.message
            : 'Unable to delete ROOM 7 document.',
        )
      } finally {
        setDeletingId('')
      }
    }

  const activeCount =
    documents.filter(
      document =>
        document.status !==
        'archived',
    ).length

  return (
    <>
      <button
        type="button"
        className="glassButton roomDocumentTrigger"
        onClick={() =>
          setOpen(true)
        }
      >
        <FileText size={16} />
        Documents
      </button>

      {open && (
        <div
          className="roomDocumentOverlay"
          role="presentation"
          onMouseDown={event => {
            if (
              event.target ===
                event.currentTarget &&
              !uploading
            ) {
              setOpen(false)
            }
          }}
        >
          <section
            className="roomDocumentManager"
            role="dialog"
            aria-modal="true"
            aria-labelledby={
              `room-documents-${roomId}`
            }
          >
            <header className="roomDocumentHeader">
              <div>
                <span className="eyebrow">
                  ROOM 7 EVENT LIBRARY
                </span>

                <h2
                  id={
                    `room-documents-${roomId}`
                  }
                >
                  Event documents
                </h2>

                <p>
                  {roomTitle}
                </p>
              </div>

              <button
                type="button"
                className="iconButton"
                aria-label="Close event documents"
                disabled={uploading}
                onClick={() =>
                  setOpen(false)
                }
              >
                <X size={18} />
              </button>
            </header>

            <div className="roomDocumentToolbar">
              <div className="roomDocumentCapacity">
                <strong>
                  {activeCount} / {MAX_DOCUMENTS}
                </strong>

                <span>
                  active event documents
                </span>
              </div>

              <div className="roomDocumentToolbarActions">
                <button
                  type="button"
                  className="glassButton"
                  disabled={
                    loading ||
                    uploading
                  }
                  onClick={() =>
                    void loadDocuments()
                  }
                >
                  <RefreshCw
                    size={16}
                    className={
                      loading
                        ? 'roomSpin'
                        : ''
                    }
                  />
                  Refresh
                </button>

                <input
                  ref={inputRef}
                  hidden
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={event =>
                    void uploadFiles(
                      event,
                    )
                  }
                />

                <button
                  type="button"
                  className="primaryButton"
                  disabled={
                    uploading ||
                    activeCount >=
                      MAX_DOCUMENTS
                  }
                  onClick={() =>
                    inputRef.current
                      ?.click()
                  }
                >
                  {uploading ? (
                    <LoaderCircle
                      size={16}
                      className="roomSpin"
                    />
                  ) : (
                    <Upload
                      size={16}
                    />
                  )}

                  {uploading
                    ? 'Uploading...'
                    : 'Upload documents'}
                </button>
              </div>
            </div>

            <div className="roomDocumentSecurityNote">
              <FileText size={17} />

              <div>
                <strong>
                  Private by default
                </strong>

                <span>
                  PDFs and images are stored in ROOM 7 private storage.
                  Guests receive short-lived previews only after event
                  access is verified. Downloads are off unless you
                  explicitly enable them.
                </span>
              </div>
            </div>

            {progress && (
              <div
                className="roomDocumentProgress"
                role="status"
              >
                <LoaderCircle
                  size={17}
                  className="roomSpin"
                />
                {progress}
              </div>
            )}

            {notice && (
              <div
                className="roomDocumentNotice"
                role="status"
              >
                {notice}
              </div>
            )}

            <div className="roomDocumentBody">
              {loading &&
               documents.length ===
                 0 && (
                <div className="roomDocumentEmpty">
                  <LoaderCircle
                    size={26}
                    className="roomSpin"
                  />
                  <strong>
                    Loading event documents
                  </strong>
                </div>
              )}

              {!loading &&
               documents.length ===
                 0 && (
                <div className="roomDocumentEmpty">
                  <FileText size={34} />

                  <strong>
                    No event documents yet
                  </strong>

                  <p>
                    Upload up to 10 PDFs or images. They can be
                    available before, during and/or after the event.
                  </p>

                  <button
                    type="button"
                    className="primaryButton"
                    disabled={uploading}
                    onClick={() =>
                      inputRef.current
                        ?.click()
                    }
                  >
                    <Upload
                      size={16}
                    />
                    Select files
                  </button>
                </div>
              )}

              {documents.map(
                document => (
                  <article
                    key={document.id}
                    className={
                      `roomDocumentCard ${
                        document.status ===
                          'archived'
                          ? 'archived'
                          : ''
                      }`
                    }
                  >
                    <div className="roomDocumentCardTop">
                      <div className="roomDocumentFileIcon">
                        <FileText
                          size={20}
                        />
                      </div>

                      <div className="roomDocumentFileMeta">
                        <strong>
                          {
                            document
                              .original_file_name
                          }
                        </strong>

                        <span>
                          {formatBytes(
                            document
                              .file_size_bytes,
                          )}
                          {' · '}
                          {
                            document
                              .mime_type
                          }
                        </span>
                      </div>

                      <span
                        className={
                          `roomDocumentStatus ${
                            document.status
                          }`
                        }
                      >
                        {
                          document
                            .status
                        }
                      </span>
                    </div>

                    <div className="roomDocumentFields">
                      <label className="roomDocumentField roomDocumentFieldWide">
                        <span>
                          Display title
                        </span>

                        <input
                          value={
                            document.title
                          }
                          maxLength={180}
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  title:
                                    event
                                      .target
                                      .value,
                                },
                              )
                          }
                        />
                      </label>

                      <label className="roomDocumentField roomDocumentFieldWide">
                        <span>
                          Description
                        </span>

                        <textarea
                          value={
                            document.description ||
                            ''
                          }
                          maxLength={2000}
                          rows={2}
                          placeholder="What should guests know about this document?"
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  description:
                                    event
                                      .target
                                      .value ||
                                    null,
                                },
                              )
                          }
                        />
                      </label>

                      <label className="roomDocumentField">
                        <span>
                          Category
                        </span>

                        <select
                          value={
                            document.category
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  category:
                                    event
                                      .target
                                      .value as
                                      DocumentCategory,
                                },
                              )
                          }
                        >
                          {categories.map(
                            option => (
                              <option
                                key={
                                  option.value
                                }
                                value={
                                  option.value
                                }
                              >
                                {
                                  option.label
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <label className="roomDocumentField">
                        <span>
                          Status
                        </span>

                        <select
                          value={
                            document.status
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  status:
                                    event
                                      .target
                                      .value as
                                      DocumentStatus,
                                },
                              )
                          }
                        >
                          <option value="draft">
                            Draft
                          </option>

                          <option value="published">
                            Published
                          </option>

                          <option value="archived">
                            Archived
                          </option>
                        </select>
                      </label>

                      <label className="roomDocumentField">
                        <span>
                          Order
                        </span>

                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={
                            document
                              .sort_order
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  sort_order:
                                    Number(
                                      event
                                        .target
                                        .value,
                                    ),
                                },
                              )
                          }
                        />
                      </label>
                    </div>

                    <div className="roomDocumentVisibility">
                      <span>
                        Guest visibility
                      </span>

                      <label>
                        <input
                          type="checkbox"
                          checked={
                            document
                              .available_before
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  available_before:
                                    event
                                      .target
                                      .checked,
                                },
                              )
                          }
                        />
                        Before event
                      </label>

                      <label>
                        <input
                          type="checkbox"
                          checked={
                            document
                              .available_during
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  available_during:
                                    event
                                      .target
                                      .checked,
                                },
                              )
                          }
                        />
                        During meeting
                      </label>

                      <label>
                        <input
                          type="checkbox"
                          checked={
                            document
                              .available_after
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  available_after:
                                    event
                                      .target
                                      .checked,
                                },
                              )
                          }
                        />
                        After event
                      </label>

                      <label className="roomDocumentDownloadToggle">
                        <input
                          type="checkbox"
                          checked={
                            document
                              .allow_download
                          }
                          onChange={
                            event =>
                              updateLocal(
                                document.id,
                                {
                                  allow_download:
                                    event
                                      .target
                                      .checked,
                                },
                              )
                          }
                        />
                        Allow download
                      </label>
                    </div>

                    <div className="roomDocumentCardActions">
                      <button
                        type="button"
                        className="glassButton"
                        disabled={
                          savingId ===
                            document.id ||
                          deletingId ===
                            document.id
                        }
                        onClick={() =>
                          void saveDocument(
                            document,
                          )
                        }
                      >
                        {savingId ===
                        document.id ? (
                          <LoaderCircle
                            size={15}
                            className="roomSpin"
                          />
                        ) : (
                          <Save
                            size={15}
                          />
                        )}

                        Save
                      </button>

                      <button
                        type="button"
                        className="roomDocumentDelete"
                        disabled={
                          savingId ===
                            document.id ||
                          deletingId ===
                            document.id
                        }
                        onClick={() =>
                          void removeDocument(
                            document,
                          )
                        }
                      >
                        {deletingId ===
                        document.id ? (
                          <LoaderCircle
                            size={15}
                            className="roomSpin"
                          />
                        ) : (
                          <Trash2
                            size={15}
                          />
                        )}

                        Delete
                      </button>
                    </div>
                  </article>
                ),
              )}
            </div>

            <footer className="roomDocumentFooter">
              <span>
                Maximum 10 active documents · 25 MB each
              </span>

              <span>
                PDF · JPEG · PNG · WebP
              </span>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
