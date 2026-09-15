import { useState } from 'react'
import {
  BookOpenCheck,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import {
  createWorkstationGuideUrl,
  WORKSTATION_GUIDE,
} from '../lib/workstationGuide'
import '../workstation-guide.css'

export default function WorkstationGuideCard() {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  async function openGuide() {
    if (opening) return

    setOpening(true)
    setError('')

    const guideWindow = window.open(
      'about:blank',
      '_blank'
    )

    if (!guideWindow) {
      setError(
        'Your browser blocked the README window. ' +
          'Allow pop-ups for RideArrivo and try again.'
      )
      setOpening(false)
      return
    }

    guideWindow.opener = null
    guideWindow.document.title =
      'Opening RideArrivo Workstation Guide'

    try {
      const signedUrl =
        await createWorkstationGuideUrl()

      guideWindow.location.replace(signedUrl)
    } catch (caughtError) {
      guideWindow.close()

      console.error(
        'Workstation guide open failed',
        caughtError
      )

      setError(
        'README is unavailable. Contact Administration.'
      )
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
            WORKSTATION GUIDE
          </span>

          <div className="workstationGuideBadges">
            <span>Version {WORKSTATION_GUIDE.version}</span>
            <span>
              <ShieldCheck size={12} />
              Internal use only
            </span>
          </div>
        </div>

        <h3>{WORKSTATION_GUIDE.label}</h3>

        <p>
          Open this guide before using your workstation for
          the first time. It explains daily workflow, key
          tools, security boundaries and end-of-day
          procedures across RideArrivo.
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
            <ExternalLink size={15} />
          </>
        )}
      </button>
    </section>
  )
}
