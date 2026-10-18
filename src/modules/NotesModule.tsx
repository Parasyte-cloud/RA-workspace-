import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, Brush, Eraser, ListChecks, List, NotebookPen, Pin, PinOff, Plus, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  daysLeftInTrash,
  fitSketch,
  isEmptyListLine,
  isInTrash,
  matchesSearch,
  nextLineAfter,
  noteDate,
  notePreview,
  noteTitle,
  parseBody,
  serializeBody,
  sortNotes,
  strokePath,
  toggleKind,
  trashExpired,
  checklistProgress,
  type Note,
  type NoteLine,
  type Stroke
} from '../lib/notes'
import '../notes.css'

const COLUMNS = 'id,title,body,sketch,pinned,deleted_at,created_at,updated_at'
const DRAFT_PREFIX = 'ra-note-draft-'
const SAVE_DELAY_MS = 700
const INK = 'ink'
const COLOURS: Array<{ id: string; label: string }> = [
  { id: INK, label: 'Ink' },
  { id: '#e03131', label: 'Red' },
  { id: '#1971c2', label: 'Blue' },
  { id: '#f08c00', label: 'Amber' }
]

type SaveState = 'saved' | 'saving' | 'offline'
type Folder = 'all' | 'trash'

function readDraft(id: string): Partial<Note> | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + id)
    return raw ? (JSON.parse(raw) as Partial<Note>) : null
  } catch {
    return null
  }
}
function writeDraft(id: string, value: Partial<Note> | null) {
  try {
    if (value) window.localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(value))
    else window.localStorage.removeItem(DRAFT_PREFIX + id)
  } catch { /* storage can be blocked; saving to the server still works */ }
}

// ---- The scribble pad -------------------------------------------------------

function SketchPad({
  strokes,
  editing,
  onChange
}: {
  strokes: Stroke[]
  editing: boolean
  onChange: (next: Stroke[]) => void
}) {
  const [colour, setColour] = useState(INK)
  const [erase, setErase] = useState(false)
  const [live, setLive] = useState<Stroke | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drawing = useRef(false)

  const point = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const box = svgRef.current!.getBoundingClientRect()
    return [
      Math.round(((event.clientX - box.left) / box.width) * 600),
      Math.round(((event.clientY - box.top) / box.height) * 400)
    ]
  }

  const eraseAt = (at: [number, number]) => {
    const hit = strokes.findIndex(stroke => stroke.p.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < 16))
    if (hit >= 0) onChange(strokes.filter((_, index) => index !== hit))
  }

  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!editing) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const at = point(event)
    if (erase) { eraseAt(at); return }
    setLive({ c: colour, w: 3, p: [at] })
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!editing || !drawing.current) return
    const at = point(event)
    if (erase) { eraseAt(at); return }
    setLive(current => (current ? { ...current, p: [...current.p, at] } : current))
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    if (live && live.p.length) onChange(fitSketch([...strokes, live]))
    setLive(null)
  }

  return (
    <div className={`notesSketch${editing ? ' editing' : ''}`}>
      {editing && (
        <div className="notesSketchTools" role="toolbar" aria-label="Drawing tools">
          {COLOURS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`notesInk${!erase && colour === item.id ? ' on' : ''}`}
              style={{ background: item.id === INK ? 'var(--notes-ink)' : item.id }}
              aria-label={item.label}
              aria-pressed={!erase && colour === item.id}
              onClick={() => { setColour(item.id); setErase(false) }}
            />
          ))}
          <button type="button" className={`notesTool${erase ? ' on' : ''}`} aria-label="Eraser" aria-pressed={erase} onClick={() => setErase(value => !value)}><Eraser size={16} /></button>
          <button type="button" className="notesTool" aria-label="Undo last stroke" disabled={!strokes.length} onClick={() => onChange(strokes.slice(0, -1))}><Undo2 size={16} /></button>
          <button type="button" className="notesTool" aria-label="Clear drawing" disabled={!strokes.length} onClick={() => onChange([])}><Trash2 size={16} /></button>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox="0 0 600 400"
        className="notesCanvas"
        role="img"
        aria-label="Drawing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {[...strokes, ...(live ? [live] : [])].map((stroke, index) => (
          <path
            key={index}
            d={strokePath(stroke)}
            fill="none"
            stroke={stroke.c === INK ? 'var(--notes-ink)' : stroke.c}
            strokeWidth={stroke.w}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  )
}

// ---- One line of a note -----------------------------------------------------

function Line({
  line,
  index,
  autoFocus,
  onText,
  onDone,
  onKey,
  onFocusLine,
  onPaste
}: {
  line: NoteLine
  index: number
  autoFocus: { pos: number } | null
  onText: (index: number, text: string) => void
  onDone: (index: number) => void
  onKey: (index: number, event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onFocusLine: (index: number) => void
  onPaste: (index: number, text: string) => boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [line.text])
  useEffect(() => {
    if (!autoFocus || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(autoFocus.pos, autoFocus.pos)
  }, [autoFocus])
  return (
    <div className={`notesLine ${line.kind}${line.done ? ' done' : ''}`}>
      {line.kind === 'todo' && (
        <button type="button" className="notesCheck" role="checkbox" aria-checked={line.done} aria-label={line.done ? 'Mark not done' : 'Mark done'} onClick={() => onDone(index)}>
          {line.done ? '✓' : ''}
        </button>
      )}
      {line.kind === 'bullet' && <span className="notesDot" aria-hidden="true">•</span>}
      <textarea
        ref={ref}
        rows={1}
        value={line.text}
        data-line={index}
        aria-label={`Line ${index + 1}`}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onText(index, event.target.value.replace(/\n/g, ''))}
        onKeyDown={event => onKey(index, event)}
        onFocus={() => onFocusLine(index)}
        onPaste={event => {
          const text = event.clipboardData.getData('text')
          if (text.includes('\n') && onPaste(index, text)) event.preventDefault()
        }}
      />
    </div>
  )
}

// ---- The note being written -------------------------------------------------

function Editor({
  note,
  readOnly,
  onChange,
  onPin,
  onTrash,
  onRestore,
  onForget,
  onBack,
  saveState
}: {
  note: Note
  readOnly: boolean
  onChange: (patch: Partial<Pick<Note, 'title' | 'body' | 'sketch'>>) => void
  onPin: () => void
  onTrash: () => void
  onRestore: () => void
  onForget: () => void
  onBack: () => void
  saveState: SaveState
}) {
  const [lines, setLines] = useState<NoteLine[]>(() => parseBody(note.body))
  const [active, setActive] = useState(0)
  const [focus, setFocus] = useState<{ index: number; pos: number; n: number } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const bodyRef = useRef(note.body)

  // A different note (or a reload from the server) replaces what is on screen.
  useEffect(() => {
    if (note.body !== bodyRef.current) {
      bodyRef.current = note.body
      setLines(parseBody(note.body))
    }
  }, [note.body])
  useEffect(() => {
    bodyRef.current = note.body
    setLines(parseBody(note.body))
    setActive(0)
    setDrawing(false)
    setFocus(null)
  }, [note.id])

  const commit = useCallback((next: NoteLine[], focusAt?: { index: number; pos: number }) => {
    const safe = next.length ? next : [{ kind: 'text' as const, done: false, text: '' }]
    setLines(safe)
    const body = serializeBody(safe)
    bodyRef.current = body
    onChange({ body })
    if (focusAt) setFocus({ ...focusAt, n: Date.now() })
  }, [onChange])

  const setText = (index: number, text: string) => commit(lines.map((line, i) => (i === index ? { ...line, text } : line)))
  const toggleDone = (index: number) => commit(lines.map((line, i) => (i === index ? { ...line, done: !line.done } : line)))

  const onKey = (index: number, event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget
    const line = lines[index]
    if (event.key === 'Enter') {
      event.preventDefault()
      if (isEmptyListLine(line)) {
        commit(lines.map((item, i) => (i === index ? { kind: 'text', done: false, text: '' } : item)), { index, pos: 0 })
        return
      }
      const before = line.text.slice(0, el.selectionStart)
      const after = line.text.slice(el.selectionEnd)
      const next = { ...nextLineAfter(line), text: after }
      commit([...lines.slice(0, index), { ...line, text: before }, next, ...lines.slice(index + 1)], { index: index + 1, pos: 0 })
    } else if (event.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (line.kind !== 'text') {
        event.preventDefault()
        commit(lines.map((item, i) => (i === index ? { ...item, kind: 'text', done: false } : item)), { index, pos: 0 })
      } else if (index > 0) {
        event.preventDefault()
        const prev = lines[index - 1]
        commit([...lines.slice(0, index - 1), { ...prev, text: prev.text + line.text }, ...lines.slice(index + 1)], { index: index - 1, pos: prev.text.length })
      }
    } else if (event.key === 'ArrowUp' && el.selectionStart === 0 && index > 0) {
      event.preventDefault()
      setFocus({ index: index - 1, pos: lines[index - 1].text.length, n: Date.now() })
    } else if (event.key === 'ArrowDown' && el.selectionStart === line.text.length && index < lines.length - 1) {
      event.preventDefault()
      setFocus({ index: index + 1, pos: 0, n: Date.now() })
    }
  }

  const paste = (index: number, text: string): boolean => {
    const pieces = parseBody(text.replace(/\r/g, ''))
    if (pieces.length < 2) return false
    const first = pieces[0]
    commit(
      [...lines.slice(0, index), { ...lines[index], text: lines[index].text + first.text }, ...pieces.slice(1), ...lines.slice(index + 1)],
      { index: index + pieces.length - 1, pos: pieces[pieces.length - 1].text.length }
    )
    return true
  }

  const setKind = (kind: 'todo' | 'bullet') => {
    const index = Math.min(active, lines.length - 1)
    commit(lines.map((line, i) => (i === index ? toggleKind(line, kind) : line)), { index, pos: lines[index].text.length })
  }

  const progress = checklistProgress(note.body)
  const strokes = note.sketch || []

  return (
    <section className="notesEditor" aria-label="Note">
      <header className="notesEditorBar">
        <button type="button" className="notesBack" onClick={onBack} aria-label="Back to notes"><ArrowLeft size={18} /></button>
        <span className={`notesSave ${saveState}`} role="status">
          {saveState === 'saving' ? 'Saving…' : saveState === 'offline' ? 'Not saved yet. Will retry.' : 'Saved'}
        </span>
        <span className="notesBarSpacer" />
        {!readOnly && (
          <>
            <button type="button" className="notesTool" onClick={() => setKind('todo')} aria-label="Checklist" title="Checklist"><ListChecks size={18} /></button>
            <button type="button" className="notesTool" onClick={() => setKind('bullet')} aria-label="Bulleted list" title="Bulleted list"><List size={18} /></button>
            <button type="button" className={`notesTool${drawing ? ' on' : ''}`} onClick={() => setDrawing(value => !value)} aria-label="Scribble" aria-pressed={drawing} title="Scribble"><Brush size={18} /></button>
            <button type="button" className={`notesTool${note.pinned ? ' on' : ''}`} onClick={onPin} aria-label={note.pinned ? 'Unpin' : 'Pin'} title={note.pinned ? 'Unpin' : 'Pin'}>{note.pinned ? <PinOff size={18} /> : <Pin size={18} />}</button>
            <button type="button" className="notesTool danger" onClick={onTrash} aria-label="Delete note" title="Delete"><Trash2 size={18} /></button>
          </>
        )}
      </header>

      {readOnly && (
        <div className="notesTrashBar">
          <span>In Recently Deleted. {daysLeftInTrash(note)} days left.</span>
          <button type="button" className="notesPill" onClick={onRestore}><RotateCcw size={14} /> Restore</button>
          <button type="button" className="notesPill danger" onClick={onForget}><Trash2 size={14} /> Delete now</button>
        </div>
      )}

      <div className="notesPaper">
        <input
          className="notesTitle"
          value={note.title}
          placeholder="Title"
          maxLength={200}
          readOnly={readOnly}
          aria-label="Title"
          onChange={event => onChange({ title: event.target.value })}
        />
        <p className="notesMeta">
          {noteDate(note.updated_at)}
          {progress.total > 0 && <> &middot; {progress.done} of {progress.total} done</>}
        </p>
        <div className="notesBody">
          {lines.map((line, index) => (
            readOnly
              ? (
                <div key={index} className={`notesLine ${line.kind}${line.done ? ' done' : ''}`}>
                  {line.kind === 'todo' && <span className="notesCheck static">{line.done ? '✓' : ''}</span>}
                  {line.kind === 'bullet' && <span className="notesDot" aria-hidden="true">•</span>}
                  <span className="notesStatic">{line.text || ' '}</span>
                </div>
              )
              : (
                <Line
                  key={index}
                  line={line}
                  index={index}
                  autoFocus={focus && focus.index === index ? { pos: focus.pos } : null}
                  onText={setText}
                  onDone={toggleDone}
                  onKey={onKey}
                  onFocusLine={setActive}
                  onPaste={paste}
                />
              )
          ))}
        </div>
        {(strokes.length > 0 || drawing) && (
          <SketchPad strokes={strokes} editing={drawing && !readOnly} onChange={next => onChange({ sketch: next.length ? next : null })} />
        )}
      </div>
    </section>
  )
}

// ---- The notes screen -------------------------------------------------------

export default function NotesModule() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<Folder>('all')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const pending = useRef<Map<string, Partial<Note>>>(new Map())
  const timers = useRef<Map<string, number>>(new Map())

  // Load, bring back anything an earlier visit could not save, and clear out
  // notes that have been in Recently Deleted for more than 30 days.
  useEffect(() => {
    const client = supabase
    if (!client) { setLoading(false); setError('Notes need a signed-in workspace.'); return }
    let alive = true
    void (async () => {
      const { data, error: loadError } = await client.from('workspace_notes').select(COLUMNS).order('updated_at', { ascending: false }).limit(1000)
      if (!alive) return
      if (loadError) {
        setError(/workspace_notes/.test(loadError.message) ? 'Notes are not set up on the server yet. Ask Admin to run the Notes SQL.' : loadError.message)
        setLoading(false)
        return
      }
      const rows = (data || []) as Note[]
      const expired = rows.filter(trashExpired)
      if (expired.length) void client.from('workspace_notes').delete().in('id', expired.map(note => note.id))
      const live = rows.filter(note => !trashExpired(note)).map(note => {
        const draft = readDraft(note.id)
        if (draft) {
          pending.current.set(note.id, draft)
          return { ...note, ...draft } as Note
        }
        return note
      })
      setNotes(live)
      setLoading(false)
      if (pending.current.size) {
        for (const id of pending.current.keys()) schedule(id)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flush = useCallback(async (id: string) => {
    const client = supabase
    const patch = pending.current.get(id)
    if (!client || !patch) return
    setSaveState('saving')
    const { error: saveError } = await client.from('workspace_notes').update(patch).eq('id', id)
    if (saveError) {
      setSaveState('offline')
      return
    }
    // Only clear what was sent: more typing may have arrived meanwhile.
    if (pending.current.get(id) === patch) {
      pending.current.delete(id)
      writeDraft(id, null)
    }
    setSaveState(pending.current.size ? 'saving' : 'saved')
  }, [])

  const schedule = useCallback((id: string) => {
    const old = timers.current.get(id)
    if (old) window.clearTimeout(old)
    timers.current.set(id, window.setTimeout(() => { timers.current.delete(id); void flush(id) }, SAVE_DELAY_MS))
  }, [flush])

  // Save straight away when the app is left or the connection returns.
  useEffect(() => {
    const flushAll = () => { for (const id of [...pending.current.keys()]) void flush(id) }
    const onHide = () => { if (document.visibilityState === 'hidden') flushAll() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAll)
    window.addEventListener('online', flushAll)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushAll)
      window.removeEventListener('online', flushAll)
      flushAll()
      for (const timer of timers.current.values()) window.clearTimeout(timer)
    }
  }, [flush])

  const edit = useCallback((id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'sketch' | 'pinned' | 'deleted_at'>>) => {
    const now = new Date().toISOString()
    setNotes(current => current.map(note => (note.id === id ? { ...note, ...patch, updated_at: now } : note)))
    const merged = { ...(pending.current.get(id) || {}), ...patch }
    pending.current.set(id, merged)
    writeDraft(id, merged)
    setSaveState('saving')
    schedule(id)
  }, [schedule])

  const create = async () => {
    const client = supabase
    if (!client) return
    setFolder('all')
    setQuery('')
    const { data, error: createError } = await client.from('workspace_notes').insert({ title: '', body: '' }).select(COLUMNS).single()
    if (createError || !data) { setError(createError?.message || 'Could not create the note.'); return }
    setNotes(current => [data as Note, ...current])
    setSelectedId((data as Note).id)
  }

  const forget = async (id: string) => {
    const client = supabase
    if (!client) return
    const { error: deleteError } = await client.from('workspace_notes').delete().eq('id', id)
    if (deleteError) { setError(deleteError.message); return }
    pending.current.delete(id)
    writeDraft(id, null)
    setNotes(current => current.filter(note => note.id !== id))
    setSelectedId('')
  }

  const visible = useMemo(() => {
    const list = notes.filter(note => (folder === 'trash' ? isInTrash(note) : !isInTrash(note)) && matchesSearch(note, query))
    return sortNotes(list)
  }, [notes, folder, query])

  const selected = notes.find(note => note.id === selectedId) || null
  const trashCount = notes.filter(isInTrash).length
  const pinned = visible.filter(note => note.pinned)
  const others = visible.filter(note => !note.pinned)

  const row = (note: Note) => (
    <button
      key={note.id}
      type="button"
      className={`notesRow${note.id === selectedId ? ' active' : ''}`}
      onClick={() => setSelectedId(note.id)}
    >
      <strong>{noteTitle(note)}</strong>
      <span><em>{noteDate(note.updated_at)}</em> {notePreview(note)}</span>
    </button>
  )

  return (
    <div className={`notesApp${selected ? ' open' : ''}`}>
      <aside className="notesList" aria-label="Notes">
        <header className="notesListBar">
          <h2><NotebookPen size={20} /> Notes</h2>
          <button type="button" className="notesNew" onClick={() => void create()} aria-label="New note"><Plus size={18} /> New</button>
        </header>
        <label className="notesSearch">
          <Search size={16} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </label>
        <div className="notesFolders" role="tablist">
          <button type="button" role="tab" aria-selected={folder === 'all'} className={folder === 'all' ? 'on' : ''} onClick={() => { setFolder('all'); setSelectedId('') }}>All notes</button>
          <button type="button" role="tab" aria-selected={folder === 'trash'} className={folder === 'trash' ? 'on' : ''} onClick={() => { setFolder('trash'); setSelectedId('') }}>Recently deleted{trashCount ? ` (${trashCount})` : ''}</button>
        </div>
        {error && <p className="notesError" role="alert">{error}</p>}
        {loading && <p className="notesEmpty">Loading…</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="notesEmpty">
            {query ? 'No notes match your search.' : folder === 'trash' ? 'Nothing deleted.' : 'No notes yet. Tap New to jot something down.'}
          </p>
        )}
        {pinned.length > 0 && <h3 className="notesGroup">Pinned</h3>}
        {pinned.map(row)}
        {pinned.length > 0 && others.length > 0 && <h3 className="notesGroup">Notes</h3>}
        {others.map(row)}
      </aside>

      <div className="notesPane">
        {selected
          ? (
            <Editor
              key={selected.id}
              note={selected}
              readOnly={isInTrash(selected)}
              saveState={saveState}
              onChange={patch => edit(selected.id, patch)}
              onPin={() => edit(selected.id, { pinned: !selected.pinned })}
              onTrash={() => { edit(selected.id, { deleted_at: new Date().toISOString() }); setSelectedId('') }}
              onRestore={() => { edit(selected.id, { deleted_at: null }); setFolder('all') }}
              onForget={() => void forget(selected.id)}
              onBack={() => setSelectedId('')}
            />
          )
          : (
            <div className="notesBlank">
              <NotebookPen size={36} />
              <p>Select a note, or tap New to write one.</p>
            </div>
          )}
      </div>
    </div>
  )
}
