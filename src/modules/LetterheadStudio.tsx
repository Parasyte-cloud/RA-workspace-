import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Download, ExternalLink, FileSignature, RotateCcw, Wand2 } from 'lucide-react'

import { supabase } from '../lib/supabase'
import {
  buildLetterheadPdf,
  documentFilename,
  emptyInput,
  suggestReference,
} from '../lib/letterhead'
import type { ClosingKind, DocKind, LetterheadInput } from '../lib/letterhead'
import { canUseLetterhead } from '../lib/letterheadAccess'

import '../letterhead.css'

type Props = {
  role: string
  fullName: string
  jobTitle: string
  email: string
  // True when an administrator added this person individually (Administration > Letterhead).
  granted?: boolean
}

const KINDS: Array<{ value: DocKind; label: string; hint: string }> = [
  { value: 'letter', label: 'Letter', hint: 'Addressed letter with salutation and sign-off' },
  { value: 'email', label: 'Email', hint: 'Print an email with its From, To and Subject block' },
  { value: 'memo', label: 'Memo', hint: 'Internal memorandum' },
  { value: 'notice', label: 'Notice', hint: 'Notice, statement or any free-form document' },
]

const CLOSINGS: Array<{ value: ClosingKind; label: string }> = [
  { value: 'faithfully', label: 'Yours faithfully, (Dear Sir/Madam)' },
  { value: 'sincerely', label: 'Yours sincerely, (Dear Mr or Ms Name)' },
  { value: 'regards', label: 'Kind regards,' },
  { value: 'none', label: 'No closing line' },
]

type LogState = 'idle' | 'recorded' | 'unavailable' | 'denied'

export default function LetterheadStudio({ role, fullName, jobTitle, email, granted = false }: Props) {
  const allowed = canUseLetterhead(role) || granted

  const [input, setInput] = useState<LetterheadInput>(() => ({
    ...emptyInput(),
    signatoryName: fullName,
    signatoryTitle: jobTitle,
    from: email ? `${fullName} <${email}>` : fullName,
  }))
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [unsupported, setUnsupported] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [logState, setLogState] = useState<LogState>('idle')
  const [confirmClear, setConfirmClear] = useState(false)
  const generation = useRef(0)
  const urlRef = useRef<string | null>(null)

  const set = useCallback(<K extends keyof LetterheadInput>(key: K, value: LetterheadInput[K]) => {
    setInput(current => ({ ...current, [key]: value }))
    setLogState('idle')
  }, [])

  const bind = (key: keyof LetterheadInput) => ({
    value: input[key] as string,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, event.target.value as never),
  })

  const hasContent = input.body.trim().length > 0

  // Re-draw the preview a moment after the last keystroke.
  useEffect(() => {
    if (!allowed) return
    const ticket = ++generation.current
    setBusy(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await buildLetterheadPdf(input, fullName)
        if (ticket !== generation.current) return
        const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setPreviewUrl(url)
        setPageCount(result.pageCount)
        setUnsupported(result.unsupported)
        setError('')
      } catch (problem) {
        if (ticket !== generation.current) return
        setError(problem instanceof Error ? problem.message : 'Could not build the preview.')
      } finally {
        if (ticket === generation.current) setBusy(false)
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [input, allowed, fullName])

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  // Warn before a refresh throws away typed work. Nothing is stored anywhere.
  useEffect(() => {
    if (!hasContent) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [hasContent])

  // Every download is written to the issue log first. A role the database does
  // not allow is refused; if the log table is not installed yet, the download
  // still goes ahead and the screen says it was not recorded.
  const recordIssue = useCallback(async (): Promise<LogState> => {
    if (!supabase) return 'unavailable'
    const recipient = (input.kind === 'letter' ? input.recipient : input.to).split('\n')[0]?.trim() || null
    const { error: logError } = await supabase.from('letterhead_issues').insert({
      doc_type: input.kind,
      reference: input.reference.trim() || null,
      subject: input.subject.trim() || null,
      recipient,
      page_count: pageCount || null,
    })
    if (!logError) return 'recorded'
    if (logError.code === '42501') return 'denied'
    return 'unavailable'
  }, [input, pageCount])

  const download = useCallback(async () => {
    if (!hasContent || busy) return
    setError('')
    const logged = await recordIssue()
    setLogState(logged)
    if (logged === 'denied') {
      setError('Your account is not permitted to issue documents on the letterhead.')
      return
    }
    try {
      const result = await buildLetterheadPdf(input, fullName)
      const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = documentFilename(input)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not build the PDF.')
    }
  }, [busy, fullName, hasContent, input, recordIssue])

  const clearAll = () => {
    if (!confirmClear) { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 4000); return }
    setConfirmClear(false)
    setInput({
      ...emptyInput(),
      kind: input.kind,
      signatoryName: fullName,
      signatoryTitle: jobTitle,
      from: email ? `${fullName} <${email}>` : fullName,
    })
    setLogState('idle')
  }

  const kindInfo = useMemo(() => KINDS.find(k => k.value === input.kind)!, [input.kind])

  if (!allowed) {
    return (
      <div className="letterheadStudio">
        <div className="lhRestricted">
          <FileSignature size={28} />
          <h2>Letterhead is restricted</h2>
          <p>Only the Administrator, Legal, Operations and Finance can issue documents on the RideArrivo letterhead.</p>
        </div>
      </div>
    )
  }

  const subjectLabel = input.kind === 'notice' ? 'Title' : 'Subject'

  return (
    <div className="letterheadStudio">
      <header className="lhHero">
        <div>
          <span className="lhEyebrow">Official letterhead</span>
          <h2>Letterhead</h2>
          <p>Type or paste your content, check the preview, download the PDF. Nothing you type is stored or sent anywhere.</p>
        </div>
        <div className="lhHeroActions">
          <button type="button" className="lhPrimary" onClick={download} disabled={!hasContent || busy}>
            <Download size={16} /> Download PDF
          </button>
          {previewUrl && hasContent && (
            <a className="lhGhost" href={previewUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} /> Open to print
            </a>
          )}
        </div>
      </header>

      {logState === 'recorded' && <p className="lhNote lhOk" role="status">Recorded in the issue log.</p>}
      {logState === 'unavailable' && (
        <p className="lhNote lhWarn" role="status">
          Downloaded, but this issue was not written to the issue log (the log is not available yet). Keep the reference on your own file.
        </p>
      )}
      {error && <p className="lhNote lhBad" role="alert">{error}</p>}

      <div className="lhGrid">
        <section className="lhForm" aria-label="Document details">
          <div className="lhKinds" role="tablist" aria-label="Document type">
            {KINDS.map(kind => (
              <button
                key={kind.value}
                type="button"
                role="tab"
                aria-selected={input.kind === kind.value}
                className={input.kind === kind.value ? 'active' : ''}
                onClick={() => set('kind', kind.value)}
              >
                {kind.label}
              </button>
            ))}
          </div>
          <p className="lhHint">{kindInfo.hint}</p>

          <div className="lhRow">
            <label className="lhField">
              <span>Reference</span>
              <div className="lhInline">
                <input type="text" placeholder="e.g. RA/LGL/2026/1008-1412" {...bind('reference')} />
                <button type="button" className="lhIcon" title="Suggest a reference" aria-label="Suggest a reference" onClick={() => set('reference', suggestReference(role))}>
                  <Wand2 size={15} />
                </button>
              </div>
            </label>
            <label className="lhField">
              <span>Date</span>
              <input type="date" {...bind('dateISO')} />
            </label>
          </div>

          {input.kind === 'letter' && (
            <>
              <label className="lhField">
                <span>Addressee (name, title, organisation, address)</span>
                <textarea rows={4} placeholder={'Mrs Adaeze Okonkwo\nHead of Compliance\nLagos State Ministry of Transportation\n12 Obafemi Awolowo Way, Ikeja'} {...bind('recipient')} />
              </label>
              <label className="lhField">
                <span>Salutation</span>
                <input type="text" {...bind('salutation')} />
              </label>
            </>
          )}

          {input.kind === 'email' && (
            <>
              <label className="lhField"><span>From</span><input type="text" {...bind('from')} /></label>
              <label className="lhField"><span>To</span><input type="text" {...bind('to')} /></label>
              <div className="lhRow">
                <label className="lhField"><span>Cc</span><input type="text" {...bind('cc')} /></label>
                <label className="lhField"><span>Sent (as shown on the email)</span><input type="text" placeholder="Wed, 7 Oct 2026, 16:42" {...bind('sentAt')} /></label>
              </div>
            </>
          )}

          {input.kind === 'memo' && (
            <>
              <div className="lhRow">
                <label className="lhField"><span>To</span><input type="text" {...bind('to')} /></label>
                <label className="lhField"><span>From</span><input type="text" {...bind('from')} /></label>
              </div>
              <label className="lhField"><span>Cc</span><input type="text" {...bind('cc')} /></label>
            </>
          )}

          <label className="lhField">
            <span>{subjectLabel}</span>
            <input type="text" {...bind('subject')} />
          </label>

          <label className="lhField lhBody">
            <span>{input.kind === 'email' ? 'Email text (paste it here)' : 'Body'}</span>
            <textarea rows={16} placeholder="Type or paste your text. A blank line starts a new paragraph." {...bind('body')} />
          </label>
          <details className="lhTips">
            <summary>Formatting tips</summary>
            <ul>
              <li>Blank line: new paragraph. Single line breaks are kept as typed.</li>
              <li><code>**bold**</code> and <code>*italic*</code></li>
              <li><code># Heading</code> for a heading line</li>
              <li><code>- item</code> for bullets and <code>1. item</code> for numbered lists</li>
              <li><code>&gt; quoted text</code> for quoted email threads</li>
              <li><code>---</code> on its own line for a divider</li>
            </ul>
          </details>

          {input.kind === 'letter' && (
            <>
              <label className="lhField">
                <span>Closing</span>
                <select {...bind('closing')}>
                  {CLOSINGS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <div className="lhRow">
                <label className="lhField"><span>Signatory name</span><input type="text" {...bind('signatoryName')} /></label>
                <label className="lhField"><span>Signatory title</span><input type="text" {...bind('signatoryTitle')} /></label>
              </div>
              <div className="lhRow">
                <label className="lhField"><span>Enclosures</span><input type="text" {...bind('enclosures')} /></label>
                <label className="lhField"><span>Cc</span><input type="text" {...bind('cc')} /></label>
              </div>
            </>
          )}

          {(input.kind === 'memo' || input.kind === 'notice') && (
            <div className="lhRow">
              <label className="lhField"><span>Signed by (optional)</span><input type="text" {...bind('signatoryName')} /></label>
              <label className="lhField"><span>Title (optional)</span><input type="text" {...bind('signatoryTitle')} /></label>
            </div>
          )}

          <label className="lhCheck">
            <input type="checkbox" checked={input.confidential} onChange={event => set('confidential', event.target.checked)} />
            <span>Mark as private and confidential</span>
          </label>

          <button type="button" className="lhGhost lhClear" onClick={clearAll}>
            <RotateCcw size={15} /> {confirmClear ? 'Click again to clear everything' : 'Clear and start again'}
          </button>
        </section>

        <section className="lhPreview" aria-label="Preview">
          <div className="lhPreviewBar">
            <strong>Preview</strong>
            <span>{busy ? 'Updating…' : hasContent ? `${pageCount} page${pageCount === 1 ? '' : 's'}, A4` : 'Waiting for text'}</span>
          </div>
          {unsupported.length > 0 && (
            <p className="lhNote lhWarn">
              These characters cannot be printed and appear as "?": {unsupported.slice(0, 12).join(' ')}
            </p>
          )}
          {previewUrl ? (
            <iframe title="Letterhead preview" src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`} />
          ) : (
            <div className="lhEmpty">Preparing the preview…</div>
          )}
        </section>
      </div>
    </div>
  )
}
