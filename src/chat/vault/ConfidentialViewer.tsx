import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, Lock, Timer, X } from 'lucide-react'
import type { Opened } from './vaultApi'
import { VIEWED_NOTE, countdownLabel, watermarkLabel } from './vaultFormat'

type Props = {
  opened: Opened
  onClose: (reason: 'closed' | 'expired') => void
}

// What stays on screen while a confidential message is open.
//
// Honest limit: a web page cannot stop a screenshot or a photo of the screen.
// What this does is make it deliberate and traceable (the viewer's name and the
// time are written across the content), hide the content the moment the person
// looks away, refuse copy, print, save and drag, and take everything away when
// the time is up. The real protection is on the server: the content is only
// ever handed out once, to one person, for the time the sender chose.
export default function ConfidentialViewer({ opened, onClose }: Props) {
  const [left, setLeft] = useState(() => Math.max(0, opened.seconds_left * 1000))
  const [away, setAway] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [pages, setPages] = useState(0)
  const pagesRef = useRef<HTMLDivElement>(null)
  const endsAt = useRef(performance.now() + opened.seconds_left * 1000)
  const closed = useRef(false)

  const finish = useCallback((reason: 'closed' | 'expired') => {
    if (closed.current) return
    closed.current = true
    onClose(reason)
  }, [onClose])

  // The clock runs on this device's own steady timer, started from the seconds
  // the server said were left, so a wrong phone clock cannot stretch the window.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = endsAt.current - performance.now()
      setLeft(Math.max(0, remaining))
      if (remaining <= 0) finish('expired')
    }, 250)
    return () => window.clearInterval(timer)
  }, [finish])

  // Looking away hides the content. The clock keeps running.
  useEffect(() => {
    const hide = () => setAway(true)
    const show = () => { if (document.visibilityState === 'visible') setAway(false) }
    const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', hide)
    window.addEventListener('focus', show)
    window.addEventListener('pagehide', hide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', hide)
      window.removeEventListener('focus', show)
      window.removeEventListener('pagehide', hide)
    }
  }, [])

  // No copy, cut, save, print, drag or select while it is open.
  useEffect(() => {
    const stop = (event: Event) => event.preventDefault()
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && ['c', 'x', 'p', 's', 'a', 'u'].includes(event.key.toLowerCase())) event.preventDefault()
      if (event.key === 'PrintScreen') {
        setAway(true)
        void navigator.clipboard?.writeText('').catch(() => undefined)
        window.setTimeout(() => setAway(false), 1500)
      }
    }
    for (const name of ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart']) document.addEventListener(name, stop)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onKey, true)
    return () => {
      for (const name of ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart']) document.removeEventListener(name, stop)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onKey, true)
    }
  }, [])

  // A document is fetched once, drawn from memory, and forgotten.
  useEffect(() => {
    if (opened.kind !== 'file') return
    let alive = true
    let objectUrl = ''
    let pdfDoc: { destroy: () => Promise<void> } | null = null
    const container = pagesRef.current
    void (async () => {
      try {
        const response = await fetch(opened.url, { cache: 'no-store' })
        if (!response.ok) throw new Error('fetch')
        const blob = await response.blob()
        if (!alive) return
        if (opened.mime === 'application/pdf') {
          const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
          const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
          pdf.GlobalWorkerOptions.workerSrc = worker.default
          const doc = await pdf.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise
          pdfDoc = doc
          if (!alive || !container) return
          const count = Math.min(doc.numPages, 40)
          setPages(count)
          const width = Math.min(container.clientWidth || 720, 900)
          const ratio = Math.min(window.devicePixelRatio || 1, 2)
          for (let n = 1; n <= count && alive; n++) {
            const page = await doc.getPage(n)
            const base = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: (width / base.width) * ratio })
            const canvas = document.createElement('canvas')
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
            canvas.style.width = `${Math.floor(viewport.width / ratio)}px`
            canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
            canvas.className = 'cvPage'
            container.appendChild(canvas)
            const context = canvas.getContext('2d')
            if (context) await page.render({ canvasContext: context, viewport } as never).promise
          }
        } else {
          objectUrl = URL.createObjectURL(blob)
          setImageUrl(objectUrl)
        }
      } catch {
        if (alive) setLoadError('Could not open this document. Close this and ask the sender or an administrator.')
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (container) {
        container.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0 })
        container.replaceChildren()
      }
      void pdfDoc?.destroy().catch(() => undefined)
    }
  }, [opened])

  const watermark = useMemo(() => {
    const label = watermarkLabel(opened.viewer.name, new Date())
    const safe = label.replace(/[<>&"']/g, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="140"><text x="10" y="80" transform="rotate(-24 130 70)" font-family="sans-serif" font-size="15" fill="rgba(120,120,120,0.30)">${safe}</text></svg>`
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  }, [opened.viewer.name])

  const soon = left <= 10_000

  return (
    <div className="cvOverlay" role="dialog" aria-modal="true" aria-label="Confidential message">
      <div className="cvPanel">
        <header className="cvHead">
          <span className="cvTitle"><Lock size={16} /> Confidential</span>
          <span className={`cvClock${soon ? ' soon' : ''}`} aria-live="off"><Timer size={15} /> {countdownLabel(left)}</span>
          {confirmClose ? (
            <span className="cvConfirm">
              <span>Close for good? {VIEWED_NOTE}</span>
              <button type="button" onClick={() => setConfirmClose(false)}>Keep reading</button>
              <button type="button" className="danger" onClick={() => finish('closed')}>Close</button>
            </span>
          ) : (
            <button type="button" className="cvClose" aria-label="Close" onClick={() => setConfirmClose(true)}><X size={18} /></button>
          )}
        </header>

        <div className="cvBody">
          <div className={`cvContent${away ? ' away' : ''}`}>
            {opened.kind === 'text' && <div className="cvText">{opened.text}</div>}
            {opened.kind === 'file' && (
              <>
                {loadError && <p className="cvError">{loadError}</p>}
                {!loadError && !imageUrl && pages === 0 && opened.mime !== 'application/pdf' && <p className="cvWait">Opening document...</p>}
                {!loadError && !imageUrl && pages === 0 && opened.mime === 'application/pdf' && <p className="cvWait">Opening document...</p>}
                {imageUrl && <img className="cvImage" src={imageUrl} alt="" draggable={false} />}
                <div ref={pagesRef} className="cvPages" />
              </>
            )}
            <div className="cvMark" style={{ backgroundImage: watermark }} aria-hidden="true" />
          </div>
          {away && (
            <div className="cvAway">
              <EyeOff size={26} />
              <strong>Hidden while you are away</strong>
              <span>Come back to this window to see it. The time keeps running.</span>
            </div>
          )}
        </div>

        <footer className="cvFoot">You can only open this once. It closes by itself when the time is up.</footer>
      </div>
    </div>
  )
}
