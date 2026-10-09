/*
 * The same header behaviour as ridearrivo.com (header-move.js), for the public
 * forms. The header starts as a compact floating pill at the top of the page.
 *
 *   - drag it from empty space to move it anywhere;
 *   - drag it to the left or right edge of the window and it turns into a
 *     vertical pill of icon buttons (labels show on hover or keyboard focus);
 *   - drag it away from the edge and it turns horizontal again;
 *   - double-click empty space to dock it back into the page, or unpin it again.
 *
 * Desktop only: below MIN_W the existing menu button takes over. Position and
 * the docked choice are remembered for the tab session.
 */
const KEY = 'arrivo_forms_header_pos'
const DOCKED_KEY = 'arrivo_forms_header_docked'
const MIN_W = 981 // the stylesheet swaps in the menu button at 980px and below
const MIN_H = 560 // a vertical pill needs this much height
const MARGIN = 12
const EDGE_IN = 64
const EDGE_OUT = 160

type Side = 'left' | 'right' | null

const LABELLED =
  '.formsNav > a, .formsNavTrigger, .formsThemeBtn, .formsCta, .formsLogoLink'

export function attachHeaderMove(header: HTMLElement): () => void {
  let spacer: HTMLElement | null = null
  let side: Side = null
  let drag: { dx: number; dy: number; id: number } | null = null

  const vw = () => document.documentElement.clientWidth || window.innerWidth
  const wide = () => window.innerWidth >= MIN_W
  const sideOK = () => wide() && window.innerHeight >= MIN_H
  const floating = () => header.classList.contains('is-floating')
  const interactive = (el: EventTarget | null) =>
    !!(el instanceof Element && el.closest('a, button, input, select, textarea, ul, .formsMobilePanel'))

  const store = {
    get(k: string) {
      try { return sessionStorage.getItem(k) } catch { return null }
    },
    set(k: string, v: string) {
      try { sessionStorage.setItem(k, v) } catch { /* ignore */ }
    },
    del(k: string) {
      try { sessionStorage.removeItem(k) } catch { /* ignore */ }
    },
  }
  const userDocked = () => store.get(DOCKED_KEY) === '1'
  const setDocked = (on: boolean) => (on ? store.set(DOCKED_KEY, '1') : store.del(DOCKED_KEY))
  const load = (): { x: number; y: number; side: Side } | null => {
    try { return JSON.parse(store.get(KEY) || 'null') } catch { return null }
  }
  const save = (x: number, y: number) => store.set(KEY, JSON.stringify({ x, y, side }))

  function clamp(x: number, y: number) {
    const r = header.getBoundingClientRect()
    return {
      x: Math.min(Math.max(0, x), Math.max(0, vw() - r.width)),
      y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - r.height)),
    }
  }
  function place(x: number, y: number) {
    const p = clamp(x, y)
    const r = header.getBoundingClientRect()
    if (side === 'left') p.x = MARGIN
    else if (side === 'right') p.x = Math.max(0, vw() - r.width - MARGIN)
    header.style.left = p.x + 'px'
    header.style.top = p.y + 'px'
    return p
  }

  function labelControls() {
    header.querySelectorAll<HTMLElement>(LABELLED).forEach((el) => {
      const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) el.setAttribute('data-tip', text)
    })
  }
  function setSide(next: Side) {
    if (next === side) return
    side = next
    header.classList.toggle('is-side', !!next)
    header.classList.toggle('is-side-left', next === 'left')
    header.classList.toggle('is-side-right', next === 'right')
    if (next) labelControls()
  }
  function sideFor(x: number): Side {
    if (!sideOK()) return null
    const w = vw()
    if (side === 'left') return x < EDGE_OUT ? 'left' : x > w - EDGE_IN ? 'right' : null
    if (side === 'right') return x > w - EDGE_OUT ? 'right' : x < EDGE_IN ? 'left' : null
    return x < EDGE_IN ? 'left' : x > w - EDGE_IN ? 'right' : null
  }

  function float(x?: number | null, y?: number | null, s?: Side) {
    if (floating()) return
    setDocked(false)
    const r = header.getBoundingClientRect()
    // Keep the page layout where it is while the header leaves the flow.
    spacer = document.createElement('div')
    spacer.style.height = r.height + 'px'
    spacer.setAttribute('aria-hidden', 'true')
    header.parentNode?.insertBefore(spacer, header)
    header.classList.add('is-floating')
    if (s && sideOK()) setSide(s)
    const r2 = header.getBoundingClientRect()
    return place(x == null ? r.left + (r.width - r2.width) / 2 : x, y == null ? r.top : y)
  }
  function dock(auto = false) {
    if (!floating()) return
    if (!auto) setDocked(true)
    setSide(null)
    header.classList.remove('is-floating')
    header.style.left = header.style.top = ''
    spacer?.remove()
    spacer = null
    store.del(KEY)
  }

  const onDbl = (e: MouseEvent) => {
    if (!wide() || interactive(e.target)) return
    if (floating()) dock()
    else {
      const p = float(null, MARGIN)
      if (p) save(p.x, p.y)
    }
  }
  const onDown = (e: PointerEvent) => {
    if (!floating() || e.button !== 0 || interactive(e.target)) return
    const r = header.getBoundingClientRect()
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }
    header.classList.add('is-dragging')
    try { header.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const want = sideFor(e.clientX)
    if (want !== side) {
      setSide(want)
      // The pill changed shape under the pointer: hold it by its middle.
      const r = header.getBoundingClientRect()
      drag.dx = r.width / 2
      drag.dy = r.height / 2
    }
    place(e.clientX - drag.dx, e.clientY - drag.dy)
  }
  const onEnd = () => {
    if (!drag) return
    drag = null
    header.classList.remove('is-dragging')
    save(parseFloat(header.style.left) || 0, parseFloat(header.style.top) || 0)
  }
  const onResize = () => {
    if (!floating()) {
      if (wide() && !userDocked()) float(null, MARGIN)
      return
    }
    if (!wide()) { dock(true); return }
    if (side && !sideOK()) setSide(null)
    place(parseFloat(header.style.left) || 0, parseFloat(header.style.top) || 0)
  }

  header.addEventListener('dblclick', onDbl)
  header.addEventListener('pointerdown', onDown)
  header.addEventListener('pointermove', onMove)
  header.addEventListener('pointerup', onEnd)
  header.addEventListener('pointercancel', onEnd)
  window.addEventListener('resize', onResize)

  const saved = load()
  if (saved && wide()) float(saved.x, saved.y, saved.side)
  else if (wide() && !userDocked()) float(null, MARGIN)

  return () => {
    header.removeEventListener('dblclick', onDbl)
    header.removeEventListener('pointerdown', onDown)
    header.removeEventListener('pointermove', onMove)
    header.removeEventListener('pointerup', onEnd)
    header.removeEventListener('pointercancel', onEnd)
    window.removeEventListener('resize', onResize)
    setSide(null)
    header.classList.remove('is-floating', 'is-dragging')
    header.style.left = header.style.top = ''
    spacer?.remove()
    spacer = null
  }
}
