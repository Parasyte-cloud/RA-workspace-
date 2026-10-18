import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpenCheck,
  LoaderCircle,
  Maximize2,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  DEFAULT_WORKSTATION_GUIDE_SLUG,
  loadWorkstationGuideBlobUrl,
  WORKSTATION_GUIDE_VERSION,
} from '../lib/workstationGuide'
import '../workstation-guide.css'

export default function WorkstationGuideCard({
  slug = DEFAULT_WORKSTATION_GUIDE_SLUG,
  workstationLabel = 'This Workstation',
  title,
  description,
  eyebrow = 'WORKSTATION GUIDE',
}: {
  slug?: string
  workstationLabel?: string
  title?: string
  description?: string
  eyebrow?: string
}) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  // Object URL of the PDF while the in-workspace viewer is open.
  const [viewerUrl, setViewerUrl] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const guideTitle = title ?? `${workstationLabel}: README`

  const closeViewer = useCallback(() => {
    setViewerUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
  }, [])

  // Escape closes the viewer; the page behind does not scroll while it is open.
  useEffect(() => {
    if (!viewerUrl) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeViewer()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [viewerUrl, closeViewer])

  // Free the PDF if the card unmounts while it is open.
  useEffect(() => () => {
    setViewerUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
  }, [])

  async function openGuide() {
    if (opening) return

    setOpening(true)
    setError('')

    try {
      // The PDF is fetched with the signed-in session and shown from a local
      // blob: URL, so it opens inside the workspace and never needs a new tab.
      const url = await loadWorkstationGuideBlobUrl(slug)
      setViewerUrl(url)
    } catch (caughtError) {
      console.error('Workstation guide open failed', caughtError)
      setError('This guide is unavailable. Contact Administration.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <section
      className="workstationGuideCard glassCard"
      aria-label="RideArrivo workstation guide"
    >
      <div
        className="workstationGuideIcon"
        aria-hidden="true"
      >
        <BookOpenCheck size={23} />
      </div>

      <div className="workstationGuideContent">
        <div className="workstationGuideHeading">
          <span className="eyebrow">
            {eyebrow}
          </span>

          <div className="workstationGuideBadges">
            <span>Version {WORKSTATION_GUIDE_VERSION}</span>
            <span>
              <ShieldCheck size={12} />
              Internal use only
            </span>
          </div>
        </div>

        <h3>{guideTitle}</h3>

        <p>
          {description ??
            `Open this guide before using ${workstationLabel} for the first time. It explains daily workflow, key tools, security boundaries and end-of-day procedures for this workstation.`}
        </p>

        {error && (
          <div
            className="workstationGuideError"
            role="status"
            aria-live="polite"
          >
            {error}
          </div>
        )}

      </div>

      <button
        type="button"
        className="primaryButton workstationGuideButton"
        onClick={() => {
          void openGuide()
        }}
        disabled={opening}
        aria-busy={opening}
      >
        {opening ? (
          <>
            <LoaderCircle
              className="workstationGuideSpinner"
              size={16}
            />
            Opening...
          </>
        ) : (
          <>
            Open Guide
            <Maximize2 size={15} />
          </>
        )}
      </button>

      {viewerUrl && createPortal(
        <div
          className="workstationGuideViewerBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label={guideTitle}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer()
          }}
        >
          <div className="workstationGuideViewer">
            <header>
              <div>
                <span className="eyebrow">{eyebrow}</span>
                <strong>{guideTitle}</strong>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="workstationGuideViewerClose"
                onClick={closeViewer}
                aria-label="Close guide"
              >
                <X size={16} />
                Close
              </button>
            </header>
            <iframe
              title={guideTitle}
              src={`${viewerUrl}#view=FitH`}
              className="workstationGuideFrame"
            />
          </div>
        </div>,
        document.body
      )}
    </section>
  )
}
