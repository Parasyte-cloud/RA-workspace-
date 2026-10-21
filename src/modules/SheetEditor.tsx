import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, AlertTriangle, ArrowLeft, Bold, Check, ChevronDown, Database, Loader2,
  Download, Plus, Redo2, Sigma, Undo2, Upload,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCelebrationBlocker } from '../celebrations/CelebrationBlockerContext'
import { Calc, SUPPORTED_FUNCTIONS, isErr } from '../lib/sheetFormula'
import {
  DEFAULT_COL_WIDTH, MAX_COLS, MAX_COL_WIDTH, MAX_ROWS, MIN_COL_WIDTH,
  colName, inferFormat, normRect, parseCsv, parseRef, parseTsv, rectLabel, refKey, sheetFromRows,
  shiftFormula, toTsv, uniqueSheetName, usedExtent,
} from '../lib/sheetModel'
import type { Cell, NumberFormat, Rect, Sheet, WorkbookData } from '../lib/sheetModel'
import { deleteLines, insertLines, renameSheet } from '../lib/sheetOps'
import { FINANCE_SOURCES, loadFinanceSheet } from '../lib/financeSheetsData'
import '../finance-sheets.css'

const ROW_H = 26
const HEAD_H = 26
const RH_W = 52
const OVERSCAN = 3
const SAVE_DELAY = 1200
const MAX_PAYLOAD = 5_500_000

type Sel = { ar: number; ac: number; fr: number; fc: number }
type Edit = { row: number; col: number; text: string; typed: boolean; src: 'cell' | 'bar'; ref?: { start: number; end: number }; pointer?: { row: number; col: number } }
type Status = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict'
type Clip = { si: number; rect: Rect; tsv: string; cells: (Cell | undefined)[][]; cut: boolean }
type Menu = { x: number; y: number; kind: 'cell' | 'row' | 'col' }

export type SheetEditorProps = {
  id: string
  initialTitle: string
  initialVersion: number
  initialData: WorkbookData
  onBack: () => void
  onTitle: (title: string) => void
  onOpen: (id: string) => void
}

const NF_LABEL: Record<NumberFormat, string> = { gen: 'General', num: 'Number', ngn: 'Naira', pct: 'Percent', date: 'Date' }

function withCells(wb: WorkbookData, si: number, updates: [string, Cell | null][]): WorkbookData {
  const sheet = wb.sheets[si]
  const cells = { ...sheet.cells }
  for (const [key, cell] of updates) {
    if (cell === null || (cell.v === '' && !cell.b && !cell.al && !cell.nf)) delete cells[key]
    else cells[key] = cell
  }
  return { sheets: wb.sheets.map((s, i) => (i === si ? { ...s, cells } : s)) }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const FORMULA_LEAD = /[=+\-*/^(,&<>;:]$/

export default function SheetEditor({ id, initialTitle, initialVersion, initialData, onBack, onTitle, onOpen }: SheetEditorProps) {
  const [wb, setWb] = useState<WorkbookData>(initialData)
  const wbRef = useRef(wb)
  const [si, setSi] = useState(0)
  const [sel, setSel] = useState<Sel>({ ar: 1, ac: 1, fr: 1, fc: 1 })
  const [edit, setEdit] = useState<Edit | null>(null)
  const editRef = useRef<Edit | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [view, setView] = useState({ w: 900, h: 480 })
  const [liveW, setLiveW] = useState<{ col: number; w: number } | null>(null)
  const [title, setTitle] = useState(initialTitle)
  const titleRef = useRef(initialTitle)
  const [status, setStatus] = useState<Status>('saved')
  useCelebrationBlocker('critical_unsaved_form', status !== 'saved')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dataMenu, setDataMenu] = useState(false)
  const [busy, setBusy] = useState('')
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [nameBox, setNameBox] = useState('')
  const [histTick, setHistTick] = useState(0)
  const [clipMark, setClipMark] = useState<Clip | null>(null)

  const past = useRef<WorkbookData[]>([])
  const future = useRef<WorkbookData[]>([])
  const clip = useRef<Clip | null>(null)
  const rev = useRef(0)
  const versionRef = useRef(initialVersion)
  const saving = useRef(false)
  const saveAgain = useRef(false)
  const timer = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const cellInput = useRef<HTMLInputElement | null>(null)
  const barInput = useRef<HTMLInputElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const dragging = useRef<'sel' | 'ref' | null>(null)
  const pendingCaret = useRef<number | null>(null)

  wbRef.current = wb
  editRef.current = edit
  const sIdx = Math.min(si, wb.sheets.length - 1)
  const sheet: Sheet = wb.sheets[sIdx]
  const calc = useMemo(() => new Calc(wb), [wb])
  const extent = useMemo(() => usedExtent(sheet), [sheet])
  const rowCount = Math.min(MAX_ROWS, Math.max(100, extent.rows + 60))
  const colCount = Math.min(MAX_COLS, Math.max(14, extent.cols + 4))

  const widthOf = useCallback((col: number) => {
    if (liveW && liveW.col === col) return liveW.w
    return sheet.widths?.[String(col)] ?? DEFAULT_COL_WIDTH
  }, [sheet.widths, liveW])

  const offsets = useMemo(() => {
    const o = [0]
    for (let c = 1; c <= colCount; c += 1) o.push(o[c - 1] + widthOf(c))
    return o
  }, [colCount, widthOf])

  // ------------------------------------------------------------- history and saving

  const markChanged = useCallback(() => {
    rev.current += 1
    setStatus(s => (s === 'conflict' ? s : 'dirty'))
    setMessage('')
  }, [])

  const commit = useCallback((next: WorkbookData) => {
    if (next === wbRef.current) return
    past.current.push(wbRef.current)
    if (past.current.length > 100) past.current.shift()
    future.current = []
    wbRef.current = next
    setWb(next)
    setHistTick(t => t + 1)
    markChanged()
  }, [markChanged])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(wbRef.current)
    wbRef.current = prev
    setWb(prev)
    setHistTick(t => t + 1)
    markChanged()
  }, [markChanged])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(wbRef.current)
    wbRef.current = next
    setWb(next)
    setHistTick(t => t + 1)
    markChanged()
  }, [markChanged])

  const saveNow = useCallback(async () => {
    if (!supabase) return
    if (saving.current) { saveAgain.current = true; return }
    const atRev = rev.current
    const payload = { data: wbRef.current, title: titleRef.current.trim() || 'Untitled workbook' }
    if (JSON.stringify(payload.data).length > MAX_PAYLOAD) {
      setStatus('error')
      setMessage('This workbook is too large to save. Remove some rows or split it into two workbooks.')
      return
    }
    saving.current = true
    setStatus('saving')
    const { data, error } = await supabase
      .from('finance_sheets')
      .update(payload)
      .eq('id', id)
      .eq('version', versionRef.current)
      .select('version')
      .maybeSingle()
    saving.current = false
    if (error) {
      setStatus('error')
      setMessage(`Not saved: ${error.message}`)
      return
    }
    if (!data) {
      setStatus('conflict')
      setMessage('Someone else saved a newer version of this workbook, or your access changed. Your edits are not saved yet.')
      return
    }
    versionRef.current = (data as { version: number }).version
    if (rev.current !== atRev || saveAgain.current) {
      saveAgain.current = false
      void saveNow()
    } else {
      setStatus('saved')
      setMessage('')
    }
  }, [id])

  useEffect(() => {
    if (status !== 'dirty') return
    timer.current = window.setTimeout(() => { void saveNow() }, SAVE_DELAY)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [status, histTick, title, saveNow])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (status === 'dirty' || status === 'saving' || status === 'error' || status === 'conflict') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  const saveCopy = async () => {
    if (!supabase) return
    setBusy('Saving your copy...')
    const { data, error } = await supabase
      .from('finance_sheets')
      .insert({ title: `${titleRef.current.trim() || 'Workbook'} (my copy)`, data: wbRef.current })
      .select('id')
      .single()
    setBusy('')
    if (error || !data) { setMessage(`Could not save a copy: ${error?.message ?? 'unknown error'}`); return }
    onOpen((data as { id: string }).id)
  }

  const loadLatest = async () => {
    if (!supabase) return
    setBusy('Loading the latest version...')
    const { data, error } = await supabase.from('finance_sheets').select('id').eq('id', id).maybeSingle()
    setBusy('')
    if (error || !data) { setMessage('Could not load the latest version.'); return }
    onOpen(id)
  }

  const onTitleBlur = () => {
    const t = title.trim() || 'Untitled workbook'
    setTitle(t)
    if (t !== titleRef.current) {
      titleRef.current = t.slice(0, 120)
      onTitle(titleRef.current)
      markChanged()
      setHistTick(n => n + 1)
    }
  }

  // ------------------------------------------------------------- measuring and scrolling

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const revealCell = useCallback((row: number, col: number) => {
    const el = scroller.current
    if (!el) return
    const top = (row - 1) * ROW_H
    const bottom = top + ROW_H
    const left = offsets[col - 1]
    const right = offsets[col]
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }, [offsets])

  useEffect(() => { revealCell(sel.fr, sel.fc) }, [sel.fr, sel.fc, revealCell])

  const rect = useMemo(() => normRect({ row: sel.ar, col: sel.ac }, { row: sel.fr, col: sel.fc }), [sel])

  useEffect(() => { setNameBox(rectLabel(rect)) }, [rect])

  const colAtX = useCallback((x: number) => {
    let lo = 1
    let hi = colCount
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid - 1] <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }, [colCount, offsets])

  const cellFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = scroller.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    const x = clientX - box.left + el.scrollLeft
    const y = clientY - box.top + el.scrollTop
    return { row: clamp(Math.floor(y / ROW_H) + 1, 1, rowCount), col: colAtX(clamp(x, 0, offsets[colCount] - 1)) }
  }, [colAtX, colCount, offsets, rowCount])

  // ------------------------------------------------------------- reading and writing cells

  const rawOf = useCallback((row: number, col: number) => sheet.cells[refKey(row, col)]?.v ?? '', [sheet.cells])

  const writeValue = useCallback((row: number, col: number, raw: string, base: WorkbookData = wbRef.current) => {
    const key = refKey(row, col)
    const existing = base.sheets[sIdx].cells[key]
    const nf = existing?.nf ?? inferFormat(raw)
    const cell: Cell = { ...existing, v: raw }
    if (nf && !existing?.nf) cell.nf = nf
    return withCells(base, sIdx, [[key, cell]])
  }, [sIdx])

  const setSelection = useCallback((row: number, col: number, extend = false) => {
    const r = clamp(row, 1, rowCount)
    const c = clamp(col, 1, colCount)
    setSel(s => (extend ? { ...s, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c }))
  }, [colCount, rowCount])

  const focusGrid = useCallback(() => { container.current?.focus({ preventScroll: true }) }, [])

  const startEdit = useCallback((row: number, col: number, replace?: string, src: 'cell' | 'bar' = 'cell') => {
    const text = replace ?? rawOf(row, col)
    const next: Edit = { row, col, text, typed: replace !== undefined, src }
    editRef.current = next
    setEdit(next)
  }, [rawOf])

  // Move focus into the input the moment it exists, before the next keystroke can arrive.
  // (A timer here once dropped the second character of fast typing.)
  const editing = edit !== null
  const editSrc = edit?.src
  const editRow = edit?.row
  const editCol = edit?.col
  const editText = edit?.text
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    const input = editSrc === 'bar' ? barInput.current : cellInput.current
    if (input) input.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [editText, editSrc])

  const wasEditing = useRef(false)
  useLayoutEffect(() => {
    if (!editing && wasEditing.current && refocusAfterEdit.current) container.current?.focus({ preventScroll: true })
    wasEditing.current = editing
    if (!editing) return
    const input = editSrc === 'bar' ? barInput.current : cellInput.current
    if (input && document.activeElement !== input) {
      input.focus()
      const n = input.value.length
      input.setSelectionRange(n, n)
    }
  }, [editing, editSrc, editRow, editCol])

  const refocusAfterEdit = useRef(true)
  const finishEdit = useCallback((save: boolean, move?: [number, number], refocus = true) => {
    refocusAfterEdit.current = refocus
    const e = editRef.current
    if (!e) return
    if (save && e.text !== rawOf(e.row, e.col)) commit(writeValue(e.row, e.col, e.text))
    setEdit(null)
    editRef.current = null
    if (move) {
      const r = clamp(e.row + move[0], 1, rowCount)
      const c = clamp(e.col + move[1], 1, colCount)
      setSel({ ar: r, ac: c, fr: r, fc: c })
    }
  }, [colCount, commit, rawOf, rowCount, writeValue])

  // A formula being typed can take a clicked cell as a reference, like Excel.
  const canPoint = (e: Edit) => {
    if (!e.text.startsWith('=')) return false
    const input = e.src === 'bar' ? barInput.current : cellInput.current
    const caret = input?.selectionStart ?? e.text.length
    if (e.ref) return true
    return FORMULA_LEAD.test(e.text.slice(0, caret).trimEnd()) || caret === 1
  }

  const insertRefText = (e: Edit, text: string): Edit => {
    const input = e.src === 'bar' ? barInput.current : cellInput.current
    const caret = input?.selectionStart ?? e.text.length
    const start = e.ref ? e.ref.start : caret
    const end = e.ref ? e.ref.end : caret
    const next = e.text.slice(0, start) + text + e.text.slice(end)
    const ref = { start, end: start + text.length }
    pendingCaret.current = ref.end
    return { ...e, text: next, ref }
  }

  // ------------------------------------------------------------- selection actions

  const eachCellIn = (r: Rect, fn: (row: number, col: number) => void) => {
    for (let row = r.r1; row <= r.r2; row += 1) for (let col = r.c1; col <= r.c2; col += 1) fn(row, col)
  }

  const formatSelection = (patch: (c: Cell) => Cell) => {
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1)
    const updates: [string, Cell | null][] = []
    if (area > 6000) {
      for (const [key, cell] of Object.entries(sheet.cells)) {
        const ref = parseRef(key)
        if (ref && ref.row >= rect.r1 && ref.row <= rect.r2 && ref.col >= rect.c1 && ref.col <= rect.c2) updates.push([key, patch(cell)])
      }
    } else eachCellIn(rect, (row, col) => { const key = refKey(row, col); updates.push([key, patch(sheet.cells[key] ?? { v: '' })]) })
    commit(withCells(wbRef.current, sIdx, updates))
  }

  const toggleBold = () => {
    const first = sheet.cells[refKey(rect.r1, rect.c1)]
    const on = !first?.b
    formatSelection(c => { const n = { ...c }; if (on) n.b = 1; else delete n.b; return n })
  }
  const setAlign = (al: 'l' | 'c' | 'r') => formatSelection(c => ({ ...c, al }))
  const setFormat = (nf: NumberFormat) => formatSelection(c => { const n = { ...c }; if (nf === 'gen') delete n.nf; else n.nf = nf; return n })

  const clearSelection = () => {
    const updates: [string, Cell | null][] = []
    eachCellIn(rect, (row, col) => {
      const key = refKey(row, col)
      const c = sheet.cells[key]
      if (c && c.v !== '') updates.push([key, { ...c, v: '' }])
    })
    if (updates.length) commit(withCells(wbRef.current, sIdx, updates))
  }

  const fill = (axis: 'down' | 'right') => {
    const updates: [string, Cell | null][] = []
    if (axis === 'down') {
      if (rect.r2 === rect.r1) return
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        const src = sheet.cells[refKey(rect.r1, col)]
        for (let row = rect.r1 + 1; row <= rect.r2; row += 1) {
          updates.push([refKey(row, col), src ? { ...src, v: src.v.startsWith('=') ? `=${shiftFormula(src.v.slice(1), row - rect.r1, 0)}` : src.v } : null])
        }
      }
    } else {
      if (rect.c2 === rect.c1) return
      for (let row = rect.r1; row <= rect.r2; row += 1) {
        const src = sheet.cells[refKey(row, rect.c1)]
        for (let col = rect.c1 + 1; col <= rect.c2; col += 1) {
          updates.push([refKey(row, col), src ? { ...src, v: src.v.startsWith('=') ? `=${shiftFormula(src.v.slice(1), 0, col - rect.c1)}` : src.v } : null])
        }
      }
    }
    commit(withCells(wbRef.current, sIdx, updates))
  }

  const autoSum = () => {
    const { ar, ac } = sel
    const isNum = (row: number, col: number) => typeof calc.value(sIdx, row, col) === 'number'
    if (rect.r2 > rect.r1 || rect.c2 > rect.c1) {
      // A block is selected: put the total in the row below, one SUM per column.
      const updates: [string, Cell | null][] = []
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        updates.push([refKey(rect.r2 + 1, col), { ...(sheet.cells[refKey(rect.r2 + 1, col)] ?? {}), v: `=SUM(${refKey(rect.r1, col)}:${refKey(rect.r2, col)})`, b: 1 }])
      }
      commit(withCells(wbRef.current, sIdx, updates))
      setSelection(rect.r2 + 1, rect.c1)
      return
    }
    let top = ar - 1
    while (top >= 1 && isNum(top, ac)) top -= 1
    if (top < ar - 1) {
      commit(withCells(wbRef.current, sIdx, [[refKey(ar, ac), { ...(sheet.cells[refKey(ar, ac)] ?? {}), v: `=SUM(${refKey(top + 1, ac)}:${refKey(ar - 1, ac)})` }]]))
      return
    }
    let left = ac - 1
    while (left >= 1 && isNum(ar, left)) left -= 1
    if (left < ac - 1) {
      commit(withCells(wbRef.current, sIdx, [[refKey(ar, ac), { ...(sheet.cells[refKey(ar, ac)] ?? {}), v: `=SUM(${refKey(ar, left + 1)}:${refKey(ar, ac - 1)})` }]]))
      return
    }
    startEdit(ar, ac, '=SUM(')
  }

  // ------------------------------------------------------------- copy, cut, paste

  const buildClip = (cut: boolean): Clip => {
    const cells: (Cell | undefined)[][] = []
    const text: string[][] = []
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      const crow: (Cell | undefined)[] = []
      const trow: string[] = []
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        crow.push(sheet.cells[refKey(row, col)])
        trow.push(calc.display(sIdx, row, col))
      }
      cells.push(crow)
      text.push(trow)
    }
    return { si: sIdx, rect, tsv: toTsv(text), cells, cut }
  }

  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut = false) => {
    if (editRef.current) return
    e.preventDefault()
    const c = buildClip(cut)
    clip.current = c
    setClipMark(c)
    e.clipboardData.setData('text/plain', c.tsv)
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editRef.current) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const updates: [string, Cell | null][] = []
    const internal = clip.current && clip.current.tsv === text ? clip.current : null
    let landed: Rect
    if (internal) {
      const h = internal.cells.length
      const w = internal.cells[0]?.length ?? 0
      const single = h === 1 && w === 1
      const rows = single ? rect.r2 - rect.r1 + 1 : h
      const cols = single ? rect.c2 - rect.c1 + 1 : w
      for (let i = 0; i < rows; i += 1) {
        for (let j = 0; j < cols; j += 1) {
          const row = rect.r1 + i
          const col = rect.c1 + j
          if (row > MAX_ROWS || col > MAX_COLS) continue
          const src = internal.cells[single ? 0 : i][single ? 0 : j]
          const dRow = row - (internal.rect.r1 + (single ? 0 : i))
          const dCol = col - (internal.rect.c1 + (single ? 0 : j))
          updates.push([refKey(row, col), src ? { ...src, v: src.v.startsWith('=') ? `=${shiftFormula(src.v.slice(1), dRow, dCol)}` : src.v } : null])
        }
      }
      landed = { r1: rect.r1, c1: rect.c1, r2: Math.min(MAX_ROWS, rect.r1 + rows - 1), c2: Math.min(MAX_COLS, rect.c1 + cols - 1) }
      if (internal.cut && internal.si === sIdx) {
        const moved = new Set(updates.map(u => u[0]))
        eachCellIn(internal.rect, (row, col) => { const k = refKey(row, col); if (!moved.has(k)) updates.push([k, null]) })
      }
    } else {
      const grid = parseTsv(text)
      grid.forEach((line, i) => line.forEach((raw, j) => {
        const row = rect.r1 + i
        const col = rect.c1 + j
        if (row > MAX_ROWS || col > MAX_COLS) return
        const key = refKey(row, col)
        const existing = sheet.cells[key]
        const clean = raw.replace(/ /g, ' ')
        const nf = existing?.nf ?? inferFormat(clean)
        updates.push([key, clean === '' ? (existing ? { ...existing, v: '' } : null) : { ...existing, v: clean, ...(nf && !existing?.nf ? { nf } : {}) }])
      }))
      landed = { r1: rect.r1, c1: rect.c1, r2: Math.min(MAX_ROWS, rect.r1 + grid.length - 1), c2: Math.min(MAX_COLS, rect.c1 + Math.max(...grid.map(r => r.length)) - 1) }
    }
    commit(withCells(wbRef.current, sIdx, updates))
    if (internal?.cut) { clip.current = null; setClipMark(null) }
    setSel({ ar: landed.r1, ac: landed.c1, fr: landed.r2, fc: landed.c2 })
  }

  // ------------------------------------------------------------- structure

  const structure = (what: 'insert-row' | 'insert-row-below' | 'delete-row' | 'insert-col' | 'insert-col-right' | 'delete-col') => {
    const rows = rect.r2 - rect.r1 + 1
    const cols = rect.c2 - rect.c1 + 1
    let next = wbRef.current
    if (what === 'insert-row') next = insertLines(next, sIdx, 'row', rect.r1, rows)
    else if (what === 'insert-row-below') next = insertLines(next, sIdx, 'row', rect.r2 + 1, rows)
    else if (what === 'delete-row') next = deleteLines(next, sIdx, 'row', rect.r1, rows)
    else if (what === 'insert-col') next = insertLines(next, sIdx, 'col', rect.c1, cols)
    else if (what === 'insert-col-right') next = insertLines(next, sIdx, 'col', rect.c2 + 1, cols)
    else next = deleteLines(next, sIdx, 'col', rect.c1, cols)
    clip.current = null
    setClipMark(null)
    commit(next)
    setMenu(null)
  }

  // ------------------------------------------------------------- sheets

  const addSheet = (name = 'Sheet', data?: Sheet) => {
    const cur = wbRef.current
    const wanted = data ? data.name : name === 'Sheet' ? `Sheet${cur.sheets.length + 1}` : name
    const unique = uniqueSheetName(cur, wanted)
    const nextSheet: Sheet = data ? { ...data, name: unique } : { name: unique, cells: {} }
    commit({ sheets: [...cur.sheets, nextSheet] })
    setSi(cur.sheets.length)
    setSel({ ar: 1, ac: 1, fr: 1, fc: 1 })
    return unique
  }

  const duplicateSheet = () => {
    const cur = wbRef.current
    const name = uniqueSheetName(cur, `${sheet.name} copy`)
    commit({ sheets: [...cur.sheets, { ...sheet, name, cells: { ...sheet.cells } }] })
    setSi(cur.sheets.length)
  }

  const deleteSheet = () => {
    if (wb.sheets.length < 2) { setNotice('A workbook needs at least one sheet.'); return }
    if (!window.confirm(`Delete the sheet "${sheet.name}"? Formulas on other sheets that point to it will show #REF!. You can undo this straight afterwards.`)) return
    commit({ sheets: wb.sheets.filter((_, i) => i !== sIdx) })
    setSi(Math.max(0, sIdx - 1))
  }

  const finishRename = () => {
    if (renaming === null) return
    const name = renameText.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)
    const taken = wb.sheets.some((s, i) => i !== renaming && s.name.toLowerCase() === name.toLowerCase())
    if (name && !taken && name !== wb.sheets[renaming].name) commit(renameSheet(wbRef.current, renaming, name))
    else if (taken) setNotice('Another sheet already has that name.')
    setRenaming(null)
  }

  // ------------------------------------------------------------- data in and out

  const addFinanceData = async (key: string) => {
    setDataMenu(false)
    const source = FINANCE_SOURCES.find(s => s.key === key)
    setBusy(`Loading ${source?.label.toLowerCase() ?? 'data'}...`)
    try {
      const { sheet: loaded, rows, truncated } = await loadFinanceSheet(key)
      const name = addSheet(loaded.name, loaded)
      setNotice(`Added ${rows.toLocaleString()} rows from ${source?.label ?? key} as "${name}"${truncated ? ` (the newest ${rows.toLocaleString()} only)` : ''}. This is a snapshot: pull it again for fresh numbers.`)
    } catch (err) {
      setNotice(`Could not load that data: ${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(`Reading ${file.name}...`)
    try {
      const lower = file.name.toLowerCase()
      if (file.size > 12 * 1024 * 1024) throw new Error('That file is larger than 12 MB.')
      let sheets: Sheet[]
      let notes: string[] = []
      if (lower.endsWith('.csv')) {
        sheets = [sheetFromRows(file.name.replace(/\.csv$/i, '').slice(0, 31) || 'Imported', parseCsv(await file.text()), { header: true })]
      } else if (lower.endsWith('.xlsx')) {
        const { xlsxToWorkbook } = await import('../lib/sheetExcel')
        const result = await xlsxToWorkbook(await file.arrayBuffer())
        sheets = result.data.sheets
        notes = result.notes
      } else throw new Error('Choose an .xlsx or .csv file.')
      let cur = wbRef.current
      const firstNew = cur.sheets.length
      let renamed = false
      for (const s of sheets) {
        const name = uniqueSheetName(cur, s.name)
        if (name !== s.name) renamed = true
        cur = { sheets: [...cur.sheets, { ...s, name }] }
      }
      if (renamed) notes.push('Some sheets were renamed because those names were already used here. A formula that points at another imported sheet still uses the original name.')
      commit(cur)
      setSi(firstNew)
      setSel({ ar: 1, ac: 1, fr: 1, fc: 1 })
      setNotice(`Imported ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} from ${file.name}. ${notes.join(' ')}`.trim())
    } catch (err) {
      setNotice(`Could not import: ${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const exportExcel = async () => {
    setBusy('Preparing your Excel file...')
    try {
      const { workbookToXlsx } = await import('../lib/sheetExcel')
      const blob = await workbookToXlsx(wbRef.current)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(titleRef.current || 'workbook').replace(/[^\w\- ]+/g, '').trim() || 'workbook'}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (err) {
      setNotice(`Could not export: ${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  // ------------------------------------------------------------- keyboard

  const jump = (row: number, col: number, dr: number, dc: number) => {
    // Ctrl+Arrow: move to the edge of the block of data, like Excel.
    const filled = (r: number, c: number) => calc.value(sIdx, r, c) !== null
    let r = row
    let c = col
    const inBounds = (rr: number, cc: number) => rr >= 1 && cc >= 1 && rr <= rowCount && cc <= colCount
    if (!inBounds(r + dr, c + dc)) return { row, col }
    if (filled(r, c) && filled(r + dr, c + dc)) {
      while (inBounds(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc }
    } else {
      r += dr; c += dc
      while (inBounds(r + dr, c + dc) && !filled(r, c)) { r += dr; c += dc }
    }
    return { row: r, col: c }
  }

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editRef.current) return
    if (e.target !== container.current) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      if (mod) {
        const t = jump(sel.fr, sel.fc, dr, dc)
        setSelection(t.row, t.col, e.shiftKey)
      } else setSelection(sel.fr + dr, sel.fc + dc, e.shiftKey)
    }
    if (mod) {
      const k = key.toLowerCase()
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (k === 'y') { e.preventDefault(); redo(); return }
      if (k === 'b') { e.preventDefault(); toggleBold(); return }
      if (k === 'd') { e.preventDefault(); fill('down'); return }
      if (k === 'r') { e.preventDefault(); fill('right'); return }
      if (k === 's') { e.preventDefault(); if (timer.current) window.clearTimeout(timer.current); void saveNow(); return }
      if (k === 'a') { e.preventDefault(); setSel({ ar: 1, ac: 1, fr: rowCount, fc: colCount }); return }
      if (key === 'Home') { e.preventDefault(); setSelection(1, 1, e.shiftKey); return }
      if (key.startsWith('Arrow')) { /* handled below */ } else return
    }
    switch (key) {
      case 'ArrowUp': return move(-1, 0)
      case 'ArrowDown': return move(1, 0)
      case 'ArrowLeft': return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Tab': e.preventDefault(); return setSelection(sel.ar + 0, sel.ac + (e.shiftKey ? -1 : 1))
      case 'Enter': e.preventDefault(); return setSelection(sel.ar + (e.shiftKey ? -1 : 1), sel.ac)
      case 'Home': e.preventDefault(); return setSelection(sel.fr, 1, e.shiftKey)
      case 'PageDown': e.preventDefault(); return setSelection(sel.fr + Math.floor(view.h / ROW_H) - 1, sel.fc, e.shiftKey)
      case 'PageUp': e.preventDefault(); return setSelection(sel.fr - Math.floor(view.h / ROW_H) + 1, sel.fc, e.shiftKey)
      case 'F2': e.preventDefault(); return startEdit(sel.ar, sel.ac)
      case 'Delete':
      case 'Backspace': e.preventDefault(); return clearSelection()
      case 'Escape': clip.current = null; setClipMark(null); setMenu(null); return
      default:
        if (key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(sel.ar, sel.ac, key) }
    }
  }

  const onEditKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const cur = editRef.current
    if (!cur) return
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, [e.shiftKey ? -1 : 1, 0]); return }
    if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, [0, e.shiftKey ? -1 : 1]); return }
    if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); return }
    if (e.key.startsWith('Arrow') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (cur.text.startsWith('=') && canPoint(cur)) {
        e.preventDefault()
        const p = cur.pointer ?? { row: cur.row, col: cur.col }
        const np = { row: clamp(p.row + (e.key === 'ArrowDown' ? 1 : -1), 1, rowCount), col: p.col }
        setEdit({ ...insertRefText(cur, refKey(np.row, np.col)), pointer: np })
        return
      }
      if (cur.typed) { e.preventDefault(); finishEdit(true, [e.key === 'ArrowDown' ? 1 : -1, 0]) }
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (cur.text.startsWith('=') && canPoint(cur)) {
        e.preventDefault()
        const p = cur.pointer ?? { row: cur.row, col: cur.col }
        const np = { row: p.row, col: clamp(p.col + (e.key === 'ArrowRight' ? 1 : -1), 1, colCount) }
        setEdit({ ...insertRefText(cur, refKey(np.row, np.col)), pointer: np })
        return
      }
      if (cur.typed && !cur.text.startsWith('=')) { e.preventDefault(); finishEdit(true, [0, e.key === 'ArrowRight' ? 1 : -1]) }
    }
  }

  const onEditChange = (text: string) => setEdit(e => (e ? { ...e, text, ref: undefined, pointer: undefined } : e))

  // ------------------------------------------------------------- mouse

  const onCellDown = (e: ReactMouseEvent, row: number, col: number) => {
    if (e.button === 2) {
      setMenu({ x: e.clientX, y: e.clientY, kind: 'cell' })
      if (row < rect.r1 || row > rect.r2 || col < rect.c1 || col > rect.c2) setSelection(row, col)
      e.preventDefault()
      return
    }
    setMenu(null)
    const cur = editRef.current
    if (cur) {
      if (cur.text.startsWith('=') && canPoint(cur) && !(row === cur.row && col === cur.col)) {
        e.preventDefault()
        setEdit({ ...insertRefText({ ...cur, ref: undefined }, refKey(row, col)), pointer: { row, col } })
        dragging.current = 'ref'
        return
      }
      finishEdit(true)
    }
    e.preventDefault()
    dragging.current = 'sel'
    setSelection(row, col, e.shiftKey)
    focusGrid()
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const p = cellFromPoint(e.clientX, e.clientY)
      if (!p) return
      if (dragging.current === 'sel') setSel(s => (s.fr === p.row && s.fc === p.col ? s : { ...s, fr: p.row, fc: p.col }))
      else {
        const cur = editRef.current
        if (!cur?.ref || !cur.pointer) return
        const a = refKey(cur.pointer.row, cur.pointer.col)
        const b = refKey(p.row, p.col)
        const text = a === b ? a : `${a}:${b}`
        if (cur.text.slice(cur.ref.start, cur.ref.end) !== text) setEdit({ ...insertRefText(cur, text), pointer: cur.pointer })
      }
    }
    const onUp = () => { dragging.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  })

  const onHeaderDown = (e: ReactMouseEvent, kind: 'col' | 'row', n: number) => {
    if (editRef.current) finishEdit(true)
    if (e.button === 2) {
      setMenu({ x: e.clientX, y: e.clientY, kind })
      const inside = kind === 'col' ? n >= rect.c1 && n <= rect.c2 : n >= rect.r1 && n <= rect.r2
      if (!inside) setSel(kind === 'col' ? { ar: 1, ac: n, fr: rowCount, fc: n } : { ar: n, ac: 1, fr: n, fc: colCount })
      e.preventDefault()
      return
    }
    setMenu(null)
    if (kind === 'col') setSel(s => (e.shiftKey ? { ...s, ar: 1, fr: rowCount, fc: n } : { ar: 1, ac: n, fr: rowCount, fc: n }))
    else setSel(s => (e.shiftKey ? { ...s, ac: 1, fc: colCount, fr: n } : { ar: n, ac: 1, fr: n, fc: colCount }))
    focusGrid()
  }

  const startResize = (e: ReactMouseEvent, col: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(col)
    let latest = startW
    const move = (ev: MouseEvent) => { latest = clamp(startW + ev.clientX - startX, MIN_COL_WIDTH, MAX_COL_WIDTH); setLiveW({ col, w: latest }) }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLiveW(null)
      if (latest !== startW) {
        const cur = wbRef.current
        commit({ sheets: cur.sheets.map((s, i) => (i === sIdx ? { ...s, widths: { ...(s.widths ?? {}), [String(col)]: Math.round(latest) } } : s)) })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    // Registered on the next tick so the very click that opened the menu cannot close it.
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('scroll', close, true)
    }, 0)
    return () => { window.clearTimeout(t); window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true) }
  }, [menu])

  useEffect(() => {
    if (!dataMenu) return
    const close = () => setDataMenu(false)
    const t = window.setTimeout(() => window.addEventListener('mousedown', close), 0)
    return () => { window.clearTimeout(t); window.removeEventListener('mousedown', close) }
  }, [dataMenu])

  // ------------------------------------------------------------- rendering

  const firstRow = Math.max(1, Math.floor(scroll.top / ROW_H) + 1 - OVERSCAN)
  const lastRow = Math.min(rowCount, Math.ceil((scroll.top + view.h) / ROW_H) + OVERSCAN)
  const firstCol = Math.max(1, colAtX(scroll.left) - 1)
  const lastCol = Math.min(colCount, colAtX(scroll.left + view.w) + 1)

  const cellsOut: JSX.Element[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      const cell = sheet.cells[refKey(row, col)]
      const text = cell && cell.v !== '' ? calc.display(sIdx, row, col) : ''
      if (!text && !cell) {
        cellsOut.push(<div key={`${row}:${col}`} data-ref={refKey(row, col)} className="fs-cell" style={{ left: offsets[col - 1], top: (row - 1) * ROW_H, width: widthOf(col) }} onMouseDown={e => onCellDown(e, row, col)} onDoubleClick={() => startEdit(row, col)} />)
        continue
      }
      const v = text ? calc.value(sIdx, row, col) : null
      const numeric = typeof v === 'number'
      const cls = ['fs-cell']
      if (cell?.b) cls.push('b')
      if (isErr(v)) cls.push('err')
      const align = cell?.al ?? (numeric || (v !== null && typeof v === 'boolean') ? 'r' : 'l')
      cls.push(`al-${align}`)
      cellsOut.push(
        <div key={`${row}:${col}`} data-ref={refKey(row, col)} className={cls.join(' ')} style={{ left: offsets[col - 1], top: (row - 1) * ROW_H, width: widthOf(col) }} title={text.length > 18 ? text : undefined} onMouseDown={e => onCellDown(e, row, col)} onDoubleClick={() => startEdit(row, col)}>
          {text}
        </div>,
      )
    }
  }

  const box = (r: Rect) => ({ left: offsets[r.c1 - 1], top: (r.r1 - 1) * ROW_H, width: offsets[r.c2] - offsets[r.c1 - 1], height: (r.r2 - r.r1 + 1) * ROW_H })
  const multi = rect.r2 > rect.r1 || rect.c2 > rect.c1

  const headCols: JSX.Element[] = []
  for (let col = firstCol; col <= lastCol; col += 1) {
    const on = col >= rect.c1 && col <= rect.c2
    headCols.push(
      <div key={col} className={`fs-colhead${on ? ' on' : ''}`} style={{ left: offsets[col - 1], width: widthOf(col) }} onMouseDown={e => onHeaderDown(e, 'col', col)}>
        {colName(col)}
        <span className="fs-grip" onMouseDown={e => startResize(e, col)} />
      </div>,
    )
  }
  const headRows: JSX.Element[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    const on = row >= rect.r1 && row <= rect.r2
    headRows.push(<div key={row} className={`fs-rowhead${on ? ' on' : ''}`} style={{ top: (row - 1) * ROW_H }} onMouseDown={e => onHeaderDown(e, 'row', row)}>{row}</div>)
  }

  const stats = useMemo(() => {
    if (!multi) return null
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1)
    if (area > 20000) return null
    let sum = 0
    let n = 0
    let count = 0
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        const v = calc.value(sIdx, row, col)
        if (v !== null && v !== '') count += 1
        if (typeof v === 'number') { sum += v; n += 1 }
      }
    }
    return { sum, avg: n ? sum / n : 0, n, count }
  }, [calc, multi, rect, sIdx])

  const active = sheet.cells[refKey(sel.ar, sel.ac)]
  const fmtNow: NumberFormat = active?.nf ?? 'gen'
  const barText = edit ? edit.text : rawOf(sel.ar, sel.ac)
  const canUndo = past.current.length > 0
  const canRedo = future.current.length > 0
  void histTick

  const goTo = (text: string) => {
    const t = text.trim().toUpperCase().replace(/\$/g, '')
    const [a, b] = t.split(':')
    const pa = parseRef(a)
    const pb = b ? parseRef(b) : pa
    if (pa && pb) setSel({ ar: pa.row, ac: pa.col, fr: pb.row, fc: pb.col })
    focusGrid()
  }

  const statusLabel = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving...' : status === 'dirty' ? 'Unsaved changes' : status === 'conflict' ? 'Conflict' : 'Not saved'

  return (
    <div className="fs-editor">
      <div className="fs-topbar">
        <button className="glassButton" onClick={onBack} title="Back to workbooks"><ArrowLeft size={15} />Workbooks</button>
        <input className="fs-title" value={title} maxLength={120} aria-label="Workbook title" onChange={e => setTitle(e.target.value)} onBlur={onTitleBlur} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <span className={`fs-status ${status}`} role="status">
          {status === 'saving' ? <Loader2 size={13} className="fs-spin" /> : status === 'saved' ? <Check size={13} /> : <AlertTriangle size={13} />}
          {statusLabel}
        </span>
      </div>

      <div className="fs-toolbar" role="toolbar" aria-label="Spreadsheet tools">
        <button className="fs-tool" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={15} /></button>
        <button className="fs-tool" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 size={15} /></button>
        <span className="fs-sep" />
        <button className={`fs-tool${active?.b ? ' on' : ''}`} onClick={toggleBold} title="Bold (Ctrl+B)" aria-label="Bold"><Bold size={15} /></button>
        <button className={`fs-tool${active?.al === 'l' ? ' on' : ''}`} onClick={() => setAlign('l')} title="Align left" aria-label="Align left"><AlignLeft size={15} /></button>
        <button className={`fs-tool${active?.al === 'c' ? ' on' : ''}`} onClick={() => setAlign('c')} title="Align centre" aria-label="Align centre"><AlignCenter size={15} /></button>
        <button className={`fs-tool${active?.al === 'r' ? ' on' : ''}`} onClick={() => setAlign('r')} title="Align right" aria-label="Align right"><AlignRight size={15} /></button>
        <select className="fs-select" value={fmtNow} onChange={e => setFormat(e.target.value as NumberFormat)} aria-label="Number format" title="Number format">
          {(Object.keys(NF_LABEL) as NumberFormat[]).map(k => <option key={k} value={k}>{NF_LABEL[k]}</option>)}
        </select>
        <span className="fs-sep" />
        <button className="fs-tool" onClick={autoSum} title="AutoSum" aria-label="AutoSum"><Sigma size={15} />Sum</button>
        <span className="fs-sep" />
        <div className="fs-dropwrap">
          <button className="fs-tool" onClick={() => setDataMenu(v => !v)} aria-haspopup="menu" aria-expanded={dataMenu}><Database size={15} />Add Finance data<ChevronDown size={13} /></button>
          {dataMenu && (
            <div className="fs-drop" role="menu" onMouseDown={e => e.stopPropagation()}>
              <p>Adds a snapshot as a new sheet.</p>
              {FINANCE_SOURCES.map(s => <button key={s.key} role="menuitem" onClick={() => void addFinanceData(s.key)}>{s.label}</button>)}
            </div>
          )}
        </div>
        <button className="fs-tool" onClick={() => fileInput.current?.click()} title="Import an Excel or CSV file as new sheets"><Upload size={15} />Import</button>
        <input ref={fileInput} type="file" accept=".xlsx,.csv" hidden onChange={e => void importFile(e)} />
        <button className="fs-tool" onClick={exportExcel} disabled={!!busy} title="Download as an Excel file" aria-label="Export Excel"><Download size={15} />Export Excel</button>
      </div>

      <div className="fs-formulabar">
        <input className="fs-namebox" value={nameBox} aria-label="Cell reference" onChange={e => setNameBox(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') goTo(nameBox) }} onFocus={e => e.target.select()} />
        <span className="fs-fx">fx</span>
        <input
          ref={barInput}
          className="fs-bar"
          value={barText}
          aria-label="Formula bar"
          placeholder="Type a value or a formula such as =SUM(B2:B9)"
          onFocus={() => { if (!editRef.current) startEdit(sel.ar, sel.ac, undefined, 'bar') }}
          onChange={e => { if (!editRef.current) startEdit(sel.ar, sel.ac, e.target.value, 'bar'); else onEditChange(e.target.value) }}
          onKeyDown={onEditKey}
          list="fs-functions"
        />
        <datalist id="fs-functions">{SUPPORTED_FUNCTIONS.map(f => <option key={f} value={`=${f}(`} />)}</datalist>
      </div>

      {(message || notice) && (
        <div className={`fs-banner${status === 'conflict' || status === 'error' ? ' warn' : ''}`} role="alert">
          <span>{message || notice}</span>
          {status === 'conflict' && (<>
            <button className="primaryButton" onClick={() => void saveCopy()}>Save mine as a copy</button>
            <button className="glassButton" onClick={() => void loadLatest()}>Load the latest (discard mine)</button>
          </>)}
          {status === 'error' && <button className="glassButton" onClick={() => void saveNow()}>Try again</button>}
          {!message && notice && <button className="fs-x" onClick={() => setNotice('')} aria-label="Dismiss">x</button>}
        </div>
      )}

      <div className="fs-grid" ref={container} tabIndex={0} onKeyDown={onGridKey} onCopy={e => onCopy(e)} onCut={e => onCopy(e, true)} onPaste={onPaste} onContextMenu={e => e.preventDefault()} aria-label={`${sheet.name} spreadsheet. Use arrow keys to move, type to edit.`}>
        <div className="fs-corner" onMouseDown={() => { setSel({ ar: 1, ac: 1, fr: rowCount, fc: colCount }); focusGrid() }} />
        <div className="fs-colheads"><div style={{ transform: `translateX(${-scroll.left}px)`, width: offsets[colCount], height: HEAD_H, position: 'relative' }}>{headCols}</div></div>
        <div className="fs-rowheads"><div style={{ transform: `translateY(${-scroll.top}px)`, height: rowCount * ROW_H, position: 'relative' }}>{headRows}</div></div>
        <div className="fs-scroller" ref={scroller} onScroll={e => { const t = e.currentTarget; setScroll({ top: t.scrollTop, left: t.scrollLeft }) }}>
          <div className="fs-content" style={{ width: offsets[colCount], height: rowCount * ROW_H }}>
            {cellsOut}
            {clipMark && clipMark.si === sIdx && <div className={`fs-clip${clipMark.cut ? ' cut' : ''}`} style={box(clipMark.rect)} />}
            {multi && <div className="fs-range" style={box(rect)} />}
            <div className="fs-active" style={box({ r1: sel.ar, c1: sel.ac, r2: sel.ar, c2: sel.ac })} />
            {edit && edit.src === 'cell' && (
              <input
                ref={cellInput}
                className="fs-editor-input"
                style={{ left: offsets[edit.col - 1], top: (edit.row - 1) * ROW_H, minWidth: Math.max(widthOf(edit.col), 120), height: ROW_H }}
                value={edit.text}
                onChange={e => onEditChange(e.target.value)}
                onKeyDown={onEditKey}
                onBlur={() => { window.setTimeout(() => { const cur = editRef.current; if (cur && cur.src === 'cell' && document.activeElement !== barInput.current && !dragging.current) finishEdit(true, undefined, false) }, 0) }}
                aria-label={`Editing ${refKey(edit.row, edit.col)}`}
              />
            )}
          </div>
        </div>
      </div>

      <div className="fs-footer">
        <div className="fs-tabs" role="tablist">
          {wb.sheets.map((s, i) => (
            <div key={`${s.name}-${i}`} className={`fs-tab${i === sIdx ? ' on' : ''}`} role="tab" aria-selected={i === sIdx}>
              {renaming === i ? (
                <input autoFocus className="fs-tabinput" value={renameText} onChange={e => setRenameText(e.target.value)} onBlur={finishRename} onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <button onClick={() => { if (editRef.current) finishEdit(true); setSi(i); setSel({ ar: 1, ac: 1, fr: 1, fc: 1 }); clip.current = null; setClipMark(null) }} onDoubleClick={() => { setRenaming(i); setRenameText(s.name) }} title="Double-click to rename">{s.name}</button>
              )}
            </div>
          ))}
          <button className="fs-tool" onClick={() => addSheet()} title="Add a sheet" aria-label="Add a sheet"><Plus size={14} /></button>
          <button className="fs-tool" onClick={duplicateSheet} title="Duplicate this sheet">Duplicate</button>
          <button className="fs-tool" onClick={deleteSheet} title="Delete this sheet">Delete sheet</button>
        </div>
        <div className="fs-stats">
          {stats ? <span>Sum {Number(stats.sum.toFixed(2)).toLocaleString('en-NG')} | Average {Number(stats.avg.toFixed(2)).toLocaleString('en-NG')} | Count {stats.count}</span> : <span>Ready</span>}
        </div>
      </div>

      {menu && (
        <div className="fs-menu" style={{ left: menu.x, top: menu.y }} role="menu" onMouseDown={e => e.stopPropagation()}>
          {menu.kind !== 'col' && <><button role="menuitem" onClick={() => structure('insert-row')}>Insert row above</button><button role="menuitem" onClick={() => structure('insert-row-below')}>Insert row below</button><button role="menuitem" onClick={() => structure('delete-row')}>Delete row{rect.r2 > rect.r1 ? 's' : ''}</button></>}
          {menu.kind !== 'row' && <><button role="menuitem" onClick={() => structure('insert-col')}>Insert column left</button><button role="menuitem" onClick={() => structure('insert-col-right')}>Insert column right</button><button role="menuitem" onClick={() => structure('delete-col')}>Delete column{rect.c2 > rect.c1 ? 's' : ''}</button></>}
          <button role="menuitem" onClick={() => { clearSelection(); setMenu(null) }}>Clear contents</button>
        </div>
      )}

      {busy && <div className="fs-busy" role="status"><Loader2 size={18} className="fs-spin" />{busy}</div>}
    </div>
  )
}
