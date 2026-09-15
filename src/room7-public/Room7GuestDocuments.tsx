import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  Download,
  FileImage,
  FileText,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

export type Room7GuestLocator = {
  slug?: string
  room_code?: string
}

export type Room7GuestAccessMode =
  | 'invitation'
  | 'passcode'
  | 'open'

export type Room7GuestEventState =
  | 'draft'
  | 'pre_event'
  | 'doors_open'
  | 'live'
  | 'intermission'
  | 'ended'
  | 'replay'

type GuestDocument = {
  id: string
  title: string
  description: string | null
  category: string
  mime_type: string
  file_size_bytes: number
  sort_order: number
  allow_download: boolean
  created_at: string
  updated_at: string
}

type PanelState = {
  open: boolean
  maximized: boolean
}

type Props = {
  locator: Room7GuestLocator | null
  accessMode: Room7GuestAccessMode
  inviteToken: string
  passcode: string
  email: string
  eventState: Room7GuestEventState
  title: string
  context: 'lobby' | 'meeting'
  onEmailChange?: (
    value: string,
  ) => void
  onPanelStateChange?: (
    state: PanelState,
  ) => void
}

function formatBytes(
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return '0 B'
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

function phaseLabel(
  state: Room7GuestEventState,
) {
  if (state === 'pre_event') {
    return 'Before event'
  }

  if (
    state === 'doors_open' ||
    state === 'live' ||
    state === 'intermission'
  ) {
    return 'During event'
  }

  if (
    state === 'ended' ||
    state === 'replay'
  ) {
    return 'After event'
  }

  return 'Event library'
}

function resolveSignedPath(
  signedPath: string,
) {
  const configured =
    String(
      import.meta.env
        .VITE_SUPABASE_URL ||
      '',
    )
      .trim()
      .replace(
        /\/+$/,
        '',
      )

  if (!configured) {
    throw new Error(
      'ROOM 7 document preview is not configured.',
    )
  }

  if (
    !signedPath.startsWith(
      '/storage/v1/object/',
    )
  ) {
    throw new Error(
      'ROOM 7 returned an invalid document preview.',
    )
  }

  const base =
    new URL(
      configured,
    )

  const resolved =
    new URL(
      signedPath,
      `${base.origin}/`,
    )

  if (
    resolved.origin !==
    base.origin
  ) {
    throw new Error(
      'ROOM 7 document preview left the approved storage origin.',
    )
  }

  return resolved.toString()
}

export default function Room7GuestDocuments({
  locator,
  accessMode,
  inviteToken,
  passcode,
  email,
  eventState,
  title,
  context,
  onEmailChange,
  onPanelStateChange,
}: Props) {
  const [
    open,
    setOpen,
  ] =
    useState(false)

  const [
    minimized,
    setMinimized,
  ] =
    useState(false)

  const [
    maximized,
    setMaximized,
  ] =
    useState(false)

  const [
    documents,
    setDocuments,
  ] =
    useState<
      GuestDocument[]
    >([])

  const [
    selected,
    setSelected,
  ] =
    useState<
      GuestDocument | null
    >(null)

  const [
    previewUrl,
    setPreviewUrl,
  ] =
    useState('')

  const [
    previewExpiresAt,
    setPreviewExpiresAt,
  ] =
    useState(0)

  const [
    loading,
    setLoading,
  ] =
    useState(false)

  const [
    previewing,
    setPreviewing,
  ] =
    useState(false)

  const [
    downloading,
    setDownloading,
  ] =
    useState(false)

  const [
    error,
    setError,
  ] =
    useState('')

  const notify =
    useCallback(
      (
        nextOpen: boolean,
        nextMinimized:
          boolean,
        nextMaximized:
          boolean,
      ) => {
        onPanelStateChange?.({
          open:
            nextOpen &&
            !nextMinimized,

          maximized:
            nextOpen &&
            !nextMinimized &&
            nextMaximized,
        })
      },
      [
        onPanelStateChange,
      ],
    )

  const request =
    useCallback(
      async <
        T extends
          Record<
            string,
            unknown
          >
      >(
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
            'ROOM 7 document access is not configured.',
          )
        }

        const {
          data,
          error:
            functionError,
        } =
          await client
            .functions
            .invoke(
              'room-event-documents',
              {
                body,
              },
            )

        if (functionError) {
          throw new Error(
            functionError.message ||
            'ROOM 7 document request failed.',
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

        return data as T
      },
      [],
    )

  const guestAccessBody =
    useCallback(
      () => {
        if (!locator) {
          throw new Error(
            'ROOM 7 event link is incomplete.',
          )
        }

        const guestEmail =
          email
            .trim()
            .toLowerCase()

        if (
          accessMode ===
            'invitation'
        ) {
          if (!inviteToken) {
            throw new Error(
              'This event library requires a valid RideArrivo invitation.',
            )
          }

          return {
            ...locator,

            invite_token:
              inviteToken,

            email:
              guestEmail,
          }
        }

        if (!guestEmail) {
          throw new Error(
            'Enter your event email address to unlock ROOM 7 documents.',
          )
        }

        if (
          accessMode ===
            'passcode'
        ) {
          const eventPasscode =
            passcode.trim()

          if (
            eventPasscode.length <
            4
          ) {
            throw new Error(
              'Enter the ROOM 7 event passcode to unlock documents.',
            )
          }

          return {
            ...locator,

            email:
              guestEmail,

            passcode:
              eventPasscode,
          }
        }

        if (
          accessMode ===
            'open'
        ) {
          return {
            ...locator,

            email:
              guestEmail,
          }
        }

        throw new Error(
          'This ROOM 7 document access mode is unavailable.',
        )
      },
      [
        accessMode,
        email,
        inviteToken,
        locator,
        passcode,
      ],
    )

  const loadDocuments =
    useCallback(
      async () => {
        setLoading(true)
        setError('')

        try {
          const access =
            guestAccessBody()

          const data =
            await request<{
              documents:
                GuestDocument[]
            }>({
              action:
                'public_list',

              ...access,
            })

          const nextDocuments =
            Array.isArray(
              data?.documents,
            )
              ? data.documents
              : []

          setDocuments(
            nextDocuments,
          )

          if (
            selected &&
            !nextDocuments.some(
              document =>
                document.id ===
                selected.id,
            )
          ) {
            setSelected(null)
            setPreviewUrl('')
          }
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to open the ROOM 7 event library.',
          )
        } finally {
          setLoading(false)
        }
      },
      [
        guestAccessBody,
        request,
        selected,
      ],
    )

  const openPanel =
    () => {
      setOpen(true)
      setMinimized(false)

      notify(
        true,
        false,
        maximized,
      )

      void loadDocuments()
    }

  const closePanel =
    () => {
      setOpen(false)
      setMinimized(false)
      setMaximized(false)
      setPreviewUrl('')
      setPreviewExpiresAt(0)

      notify(
        false,
        false,
        false,
      )
    }

  const minimizePanel =
    () => {
      setMinimized(true)

      notify(
        true,
        true,
        maximized,
      )
    }

  const restorePanel =
    () => {
      setMinimized(false)

      notify(
        true,
        false,
        maximized,
      )
    }

  const toggleMaximize =
    () => {
      const next =
        !maximized

      setMaximized(next)

      notify(
        true,
        false,
        next,
      )
    }

  const previewDocument =
    async (
      documentRecord:
        GuestDocument,
    ) => {
      setPreviewing(true)
      setError('')

      try {
        const access =
          guestAccessBody()

        const data =
          await request<{
            signed_path:
              string
            expires_in_seconds:
              number
          }>({
            action:
              'public_preview',

            ...access,

            document_id:
              documentRecord.id,

            download:
              false,
          })

        if (
          typeof data
            ?.signed_path !==
            'string'
        ) {
          throw new Error(
            'ROOM 7 did not return a document preview.',
          )
        }

        setSelected(
          documentRecord,
        )

        setPreviewUrl(
          resolveSignedPath(
            data.signed_path,
          ),
        )

        const ttlSeconds =
          Number(
            data.expires_in_seconds,
          )

        setPreviewExpiresAt(
          Date.now() +
          (
            Number.isFinite(
              ttlSeconds,
            ) &&
            ttlSeconds > 30
              ? ttlSeconds
              : 300
          ) *
            1000,
        )
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to preview this ROOM 7 document.',
        )
      } finally {
        setPreviewing(false)
      }
    }

  useEffect(() => {
    if (
      !open ||
      minimized ||
      !selected ||
      !previewUrl ||
      previewExpiresAt <= 0
    ) {
      return
    }

    /*
     * Signed previews live for five minutes.
     * Refresh one minute early while the reader
     * is actively visible. Minimizing pauses
     * renewal so we do not generate needless
     * access telemetry in the background.
     */
    const delay =
      Math.max(
        250,
        previewExpiresAt -
          Date.now() -
          60_000,
      )

    const timer =
      window.setTimeout(
        () => {
          void (
            async () => {
              try {
                const access =
                  guestAccessBody()

                const data =
                  await request<{
                    signed_path:
                      string
                    expires_in_seconds:
                      number
                  }>({
                    action:
                      'public_preview',

                    ...access,

                    document_id:
                      selected.id,

                    download:
                      false,
                  })

                if (
                  typeof data
                    ?.signed_path !==
                    'string'
                ) {
                  throw new Error(
                    'ROOM 7 did not renew the secure document preview.',
                  )
                }

                const ttlSeconds =
                  Number(
                    data.expires_in_seconds,
                  )

                setPreviewUrl(
                  resolveSignedPath(
                    data.signed_path,
                  ),
                )

                setPreviewExpiresAt(
                  Date.now() +
                  (
                    Number.isFinite(
                      ttlSeconds,
                    ) &&
                    ttlSeconds > 30
                      ? ttlSeconds
                      : 300
                  ) *
                    1000,
                )
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'ROOM 7 could not renew the secure document preview.',
                )
              }
            }
          )()
        },
        delay,
      )

    return () => {
      window.clearTimeout(
        timer,
      )
    }
  }, [
    guestAccessBody,
    minimized,
    open,
    previewExpiresAt,
    previewUrl,
    request,
    selected,
  ])

  const downloadDocument =
    async (
      documentRecord:
        GuestDocument,
    ) => {
      if (
        !documentRecord
          .allow_download
      ) {
        return
      }

      /*
       * Open a separate browsing context while
       * still inside the user's click gesture.
       * This guarantees an allowed download can
       * never navigate away from the live meeting.
       */
      const downloadWindow =
        window.open(
          'about:blank',
          '_blank',
        )

      if (!downloadWindow) {
        setError(
          'Your browser blocked the ROOM 7 download window. Allow pop-ups for this event and try again.',
        )
        return
      }

      try {
        downloadWindow.opener =
          null
      } catch {
        // Browser already isolated the new window.
      }

      setDownloading(true)
      setError('')

      try {
        const access =
          guestAccessBody()

        const data =
          await request<{
            signed_path:
              string
          }>({
            action:
              'public_preview',

            ...access,

            document_id:
              documentRecord.id,

            download:
              true,
          })

        if (
          typeof data
            ?.signed_path !==
            'string'
        ) {
          throw new Error(
            'ROOM 7 did not return a download grant.',
          )
        }

        const url =
          resolveSignedPath(
            data.signed_path,
          )

        downloadWindow
          .location
          .replace(
            url,
          )
      } catch (cause) {
        try {
          downloadWindow.close()
        } catch {
          // Nothing else to clean up.
        }

        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to download this ROOM 7 document.',
        )
      } finally {
        setDownloading(false)
      }
    }

  const isImage =
    selected
      ?.mime_type
      .startsWith(
        'image/',
      ) === true

  return (
    <div
      className={
        `room7GuestDocuments room7GuestDocuments-${context}`
      }
    >
      <button
        type="button"
        className="room7GuestDocumentTrigger"
        onClick={openPanel}
        aria-haspopup="dialog"
      >
        <FileText size={16} />

        Documents

        {documents.length >
          0 && (
          <span>
            {
              documents.length
            }
          </span>
        )}
      </button>

      {open &&
       minimized && (
        <button
          type="button"
          className={
            `room7GuestDocumentRestore room7GuestDocumentRestore-${context}`
          }
          onClick={
            restorePanel
          }
          aria-label="Restore ROOM 7 document reader"
        >
          <FileText size={16} />
          Event documents
        </button>
      )}

      {open && (
        <aside
          className={
            `room7GuestDocumentPanel room7GuestDocumentPanel-${context} ${
              minimized
                ? 'minimized'
                : ''
            } ${
              maximized
                ? 'maximized'
                : ''
            }`
          }
          role="dialog"
          aria-modal={
            context ===
            'lobby'
          }
          aria-hidden={
            minimized
          }
          aria-label="ROOM 7 event documents"
        >
          <header className="room7GuestDocumentHeader">
            <div>
              <span>
                {
                  phaseLabel(
                    eventState,
                  )
                }
              </span>

              <strong>
                Event documents
              </strong>

              <small>
                {title}
              </small>
            </div>

            <div className="room7GuestDocumentHeaderActions">
              {context ===
                'meeting' && (
                <>
                  <button
                    type="button"
                    onClick={
                      minimizePanel
                    }
                    aria-label="Minimize document reader"
                  >
                    <Minimize2
                      size={16}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={
                      toggleMaximize
                    }
                    aria-label={
                      maximized
                        ? 'Restore document reader size'
                        : 'Maximize document reader'
                    }
                  >
                    <Maximize2
                      size={16}
                    />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={
                  closePanel
                }
                aria-label="Close document reader"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          {context ===
            'lobby' &&
           onEmailChange && (
            <div className="room7GuestDocumentIdentity">
              <label>
                <span>
                  {accessMode ===
                    'invitation'
                    ? 'Invitation email'
                    : 'Event email'}
                </span>

                <input
                  type="email"
                  value={email}
                  maxLength={320}
                  autoComplete="email"
                  placeholder="name@example.com"
                  onChange={
                    event =>
                      onEmailChange(
                        event
                          .target
                          .value,
                      )
                  }
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  void loadDocuments()
                }
                disabled={loading}
              >
                <RefreshCw
                  size={15}
                  className={
                    loading
                      ? 'room7PublicSpinIcon'
                      : ''
                  }
                />

                Unlock library
              </button>
            </div>
          )}

          <div className="room7GuestDocumentToolbar">
            <span>
              {
                documents.length
              } available
            </span>

            <button
              type="button"
              onClick={() =>
                void loadDocuments()
              }
              disabled={loading}
              aria-label="Refresh event documents"
            >
              <RefreshCw
                size={15}
                className={
                  loading
                    ? 'room7PublicSpinIcon'
                    : ''
                }
              />
              Refresh
            </button>
          </div>

          {error && (
            <div
              className="room7GuestDocumentError"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="room7GuestDocumentWorkspace">
            <nav
              className="room7GuestDocumentList"
              aria-label="Event document list"
            >
              {loading &&
               documents.length ===
                 0 && (
                <div className="room7GuestDocumentEmpty">
                  <div className="room7PublicSpinner" />
                  <span>
                    Loading documents
                  </span>
                </div>
              )}

              {!loading &&
               documents.length ===
                 0 && (
                <div className="room7GuestDocumentEmpty">
                  <FileText
                    size={26}
                  />

                  <strong>
                    No documents available
                  </strong>

                  <span>
                    The host has not published documents for this event phase yet.
                  </span>
                </div>
              )}

              {documents.map(
                documentRecord => (
                  <button
                    key={
                      documentRecord.id
                    }
                    type="button"
                    className={
                      selected?.id ===
                      documentRecord.id
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      void previewDocument(
                        documentRecord,
                      )
                    }
                  >
                    {documentRecord
                      .mime_type
                      .startsWith(
                        'image/',
                      ) ? (
                      <FileImage
                        size={18}
                      />
                    ) : (
                      <FileText
                        size={18}
                      />
                    )}

                    <span>
                      <strong>
                        {
                          documentRecord
                            .title
                        }
                      </strong>

                      <small>
                        {
                          documentRecord
                            .category
                        }
                        {' · '}
                        {
                          formatBytes(
                            documentRecord
                              .file_size_bytes,
                          )
                        }
                      </small>
                    </span>
                  </button>
                ),
              )}
            </nav>

            <section className="room7GuestDocumentReader">
              {!selected && (
                <div className="room7GuestDocumentReaderEmpty">
                  <FileText
                    size={38}
                  />

                  <strong>
                    Select a document
                  </strong>

                  <span>
                    Read event material without leaving ROOM 7.
                  </span>
                </div>
              )}

              {selected && (
                <>
                  <div className="room7GuestDocumentReaderHead">
                    <div>
                      <strong>
                        {
                          selected.title
                        }
                      </strong>

                      <span>
                        {
                          selected.description ||
                          'RideArrivo ROOM 7 event material'
                        }
                      </span>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          void previewDocument(
                            selected,
                          )
                        }
                        disabled={
                          previewing
                        }
                        aria-label="Refresh document preview"
                      >
                        <RefreshCw
                          size={15}
                          className={
                            previewing
                              ? 'room7PublicSpinIcon'
                              : ''
                          }
                        />
                      </button>

                      {selected
                        .allow_download && (
                        <button
                          type="button"
                          onClick={() =>
                            void downloadDocument(
                              selected,
                            )
                          }
                          disabled={
                            downloading
                          }
                          aria-label="Download document"
                        >
                          <Download
                            size={15}
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="room7GuestDocumentCanvas">
                    {previewing &&
                     !previewUrl && (
                      <div className="room7GuestDocumentReaderEmpty">
                        <div className="room7PublicSpinner" />
                        <span>
                          Preparing secure preview
                        </span>
                      </div>
                    )}

                    {!previewUrl &&
                     !previewing && (
                      <div className="room7GuestDocumentReaderEmpty">
                        <FileText
                          size={32}
                        />

                        <span>
                          Select or refresh this document to prepare a secure preview.
                        </span>
                      </div>
                    )}

                    {previewUrl &&
                     isImage && (
                      <img
                        src={
                          previewUrl
                        }
                        alt={
                          selected.title
                        }
                        referrerPolicy="no-referrer"
                      />
                    )}

                    {previewUrl &&
                     !isImage && (
                      <iframe
                        src={
                          previewUrl
                        }
                        title={
                          selected.title
                        }
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          <footer className="room7GuestDocumentFooter">
            <span>
              Secure preview
            </span>

            <span>
              Downloading {
                selected
                  ?.allow_download
                  ? 'permitted'
                  : 'restricted'
              }
            </span>
          </footer>
        </aside>
      )}
    </div>
  )
}
