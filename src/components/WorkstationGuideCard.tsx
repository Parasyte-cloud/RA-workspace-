import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  BookOpenCheck,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import {
  createWorkstationGuideUrl,
  DEFAULT_WORKSTATION_GUIDE_SLUG,
  WORKSTATION_GUIDE_BUCKET,
  WORKSTATION_GUIDE_VERSION,
  workstationGuidePath,
} from '../lib/workstationGuide'
import { supabase } from '../lib/supabase'
import '../workstation-guide.css'

export default function WorkstationGuideCard({
  slug = DEFAULT_WORKSTATION_GUIDE_SLUG,
  workstationLabel = 'This Workstation',
}: {
  slug?: string
  workstationLabel?: string
}) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [role, setRole] = useState('employee')
  const [replacing, setReplacing] = useState(false)
  const [replaceNotice, setReplaceNotice] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const canManageGuide = role === 'legal' || role === 'admin'

  useEffect(() => {
    let cancelled = false

    async function loadRole() {
      if (!supabase) return

      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id

      if (!userId) return

      const { data } = await supabase
        .from('employee_profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle()

      if (!cancelled) {
        setRole(String(data?.role || 'employee').toLowerCase())
      }
    }

    void loadRole()

    return () => {
      cancelled = true
    }
  }, [])

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
        await createWorkstationGuideUrl(slug)

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

  async function handleReplace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !supabase) return

    if (file.type !== 'application/pdf') {
      setReplaceNotice('The workstation guide must be a PDF file.')
      return
    }

    setReplacing(true)
    setReplaceNotice('')
    setError('')

    try {
      const { error: uploadError } = await supabase.storage
        .from(WORKSTATION_GUIDE_BUCKET)
        .upload(workstationGuidePath(slug), file, {
          upsert: true,
          contentType: 'application/pdf',
        })

      if (uploadError) throw uploadError

      setReplaceNotice(
        'Guide uploaded. Employees will see the new version next time they open it.'
      )
    } catch (caughtError) {
      console.error('Workstation guide replace failed', caughtError)
      setReplaceNotice(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to upload the guide.'
      )
    } finally {
      setReplacing(false)
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
            <span>Version {WORKSTATION_GUIDE_VERSION}</span>
            <span>
              <ShieldCheck size={12} />
              Internal use only
            </span>
          </div>
        </div>

        <h3>{workstationLabel} — README</h3>

        <p>
          Open this guide before using {workstationLabel} for
          the first time. It explains daily workflow, key
          tools, security boundaries and end-of-day
          procedures for this workstation.
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

        {canManageGuide && (
          <div className="workstationGuideAdminRow">
            <label
              className={
                replacing
                  ? 'workstationGuideAdminButton workstationGuideAdminButtonDisabled'
                  : 'workstationGuideAdminButton'
              }
            >
              {replacing ? (
                <LoaderCircle
                  className="workstationGuideSpinner"
                  size={13}
                />
              ) : (
                <UploadCloud size={13} />
              )}
              {replacing ? 'Uploading...' : 'Replace guide (PDF)'}

              <input
                ref={inputRef}
                hidden
                type="file"
                accept=".pdf,application/pdf"
                disabled={replacing}
                onChange={(event) => {
                  void handleReplace(event)
                }}
              />
            </label>

            {replaceNotice && (
              <span className="workstationGuideAdminNotice">
                {replaceNotice}
              </span>
            )}
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
