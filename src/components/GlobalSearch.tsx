import {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  Search,
  X,
  Loader2,
  User,
  Headphones,
  ShieldAlert,
  Users,
  CalendarDays,
  Inbox,
  MessagesSquare,
  Mail,
  CheckSquare,
  BookOpen,
  FileText,
  Megaphone,
  Palette,
  Building2,
  Scale,
  Video,
  FolderKanban,
  type LucideIcon,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { setSearchFocus } from '../lib/searchFocus'
import '../global-search.css'

/*
 * The header search icon in App.tsx used to do nothing at all — no
 * onClick, no modal. This is that feature, built out: Cmd/Ctrl+K (or the
 * icon) opens a command-palette-style search across people, support
 * cases, incidents, HR/leave requests, intake submissions, chat and mail.
 *
 * Two backends, called in parallel per keystroke (debounced):
 *   - workspace-search   Postgres-backed (people/cases/incidents/hr/
 *                        leave/intake/chat), one round trip
 *   - zoho-mail-search   live Zoho Mail API search, one call per mailbox
 *                        the actor can read
 * Mail is separate so a slow/failing Zoho call never blocks the rest —
 * see the comments in both edge functions for why.
 *
 * Clicking a result navigates to its section. Tasks, knowledge articles and
 * shared spaces also open the chosen record, through lib/searchFocus. Other
 * areas land in the right section. Arrow keys and Enter work without a mouse.
 */

type AnyRow = Record<string, any>
type MailRow = { messageId: string; mailboxEmail: string; subject: string; sender: string; summary: string }
type SearchResults = Record<string, AnyRow[]>

type ResultItem = {
  key: string
  icon: LucideIcon
  title: string
  sub: string
  meta?: string
  section: string
  focus?: { kind: string; id: string }
}
type ResultGroup = { label: string; items: ResultItem[] }

const text = (value: unknown) => (value == null ? '' : String(value))
const join = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(' · ')

function buildGroups(results: SearchResults | null, mail: MailRow[] | null): ResultGroup[] {
  if (!results) return []
  const r = (key: string) => results[key] || []
  const groups: ResultGroup[] = [
    { label: 'People', items: r('people').map(x => ({ key: `p${x.id}`, icon: User, title: text(x.full_name || x.email), sub: join(x.job_title, x.department) || text(x.email), section: 'people' })) },
    { label: 'Tasks', items: r('tasks').map(x => ({ key: `t${x.id}`, icon: CheckSquare, title: text(x.title), sub: join(x.department, x.priority), meta: text(x.status), section: 'tasks', focus: { kind: 'task', id: x.id } })) },
    { label: 'Knowledge', items: r('knowledge').map(x => ({ key: `k${x.id}`, icon: BookOpen, title: text(x.title), sub: join(x.category, x.summary), section: 'knowledge', focus: { kind: 'knowledge', id: x.id } })) },
    { label: 'Files', items: r('files').map(x => ({ key: `f${x.id}`, icon: FileText, title: text(x.name), sub: join(x.folder_path, x.department), meta: text(x.file_type), section: 'files' })) },
    { label: 'Announcements', items: r('announcements').map(x => ({ key: `a${x.id}`, icon: Megaphone, title: text(x.title), sub: text(x.category), meta: text(x.priority), section: 'announcements' })) },
    { label: 'Calendar', items: r('calendar').map(x => ({ key: `c${x.id}`, icon: CalendarDays, title: text(x.title), sub: join(x.event_type, x.location, text(x.starts_at).slice(0, 10)), section: 'calendar' })) },
    { label: 'Shared spaces', items: r('shared').map(x => ({ key: `s${x.id}`, icon: FolderKanban, title: text(x.name), sub: join(x.space_type, x.home_department), section: 'shared', focus: { kind: 'shared', id: x.id } })) },
    { label: 'Rooms', items: r('rooms').map(x => ({ key: `r${x.id}`, icon: Video, title: text(x.title || x.room_code), sub: text(x.room_code), meta: text(x.status), section: 'room' })) },
    { label: 'Brand', items: r('brand').map(x => ({ key: `b${x.id}`, icon: Palette, title: text(x.name), sub: join(x.category, x.description), section: 'brand' })) },
    { label: 'CRM', items: [
      ...r('crmAccounts').map(x => ({ key: `ca${x.id}`, icon: Building2, title: text(x.name), sub: join(x.account_type, x.lifecycle_stage), meta: text(x.status), section: 'crm' })),
      ...r('crmContacts').map(x => ({ key: `cc${x.id}`, icon: User, title: text(x.full_name), sub: join(x.contact_type, x.email), section: 'crm' })),
    ] },
    { label: 'Legal', items: [
      ...r('legalStatutes').map(x => ({ key: `ls${x.id}`, icon: Scale, title: text(x.title), sub: join(x.instrument_type, x.reference_number), meta: text(x.status), section: 'legal' })),
      ...r('legalOpinions').map(x => ({ key: `lo${x.id}`, icon: Scale, title: text(x.title), sub: 'Legal opinion', meta: text(x.status), section: 'legal' })),
      ...r('legalContracts').map(x => ({ key: `lc${x.id}`, icon: Scale, title: text(x.title), sub: text(x.counterparty), meta: text(x.status), section: 'legal' })),
    ] },
    { label: 'Support cases', items: r('cases').map(x => ({ key: `sc${x.id}`, icon: Headphones, title: text(x.subject), sub: text(x.reference), meta: text(x.status), section: 'support' })) },
    { label: 'Incidents', items: r('incidents').map(x => ({ key: `i${x.id}`, icon: ShieldAlert, title: text(x.summary), sub: text(x.reference), meta: text(x.severity), section: 'operations' })) },
    { label: 'People & HR', items: [
      ...r('hr').map(x => ({ key: `h${x.id}`, icon: Users, title: text(x.subject), sub: text(x.category), meta: text(x.status), section: 'people' })),
      ...r('leave').map(x => ({ key: `l${x.id}`, icon: CalendarDays, title: text(x.leave_type), sub: `${text(x.start_date)} → ${text(x.end_date)}`, meta: text(x.status), section: 'people' })),
    ] },
    { label: 'Intake submissions', items: r('intake').map(x => ({ key: `in${x.id}`, icon: Inbox, title: text(x.form_title_snapshot), sub: text(x.category_title_snapshot), meta: text(x.status), section: 'support' })) },
    { label: 'Chat', items: r('chat').map(x => ({ key: `ch${x.id}`, icon: MessagesSquare, title: text(x.sender_name), sub: text(x.body), section: 'chat' })) },
    { label: 'Mail', items: (mail || []).map(x => ({ key: `m${x.messageId}`, icon: Mail, title: text(x.subject) || '(no subject)', sub: join(x.sender, x.mailboxEmail), section: 'mail' })) },
  ]
  return groups.filter(group => group.items.length > 0)
}

export function GlobalSearch({ onNavigate }: { onNavigate: (section: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [mail, setMail] = useState<MailRow[] | null>(null)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const requestSequence = useRef(0)

  // Cmd/Ctrl+K opens search from anywhere in the workspace.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(current => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(timer)
    }
    setQuery('')
    setResults(null)
    setMail(null)
    setError('')
    setPartial(false)
    setActive(0)
  }, [open])

  useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      setMail(null)
      setLoading(false)
      setError('')
      setPartial(false)
      return
    }

    const sequence = ++requestSequence.current
    setLoading(true)
    setError('')

    const timer = setTimeout(async () => {
      const client = supabase
      if (!client) {
        if (sequence === requestSequence.current) {
          setError('Search is unavailable because Supabase is not configured.')
          setLoading(false)
        }
        return
      }

      const { data: { session } } = await client.auth.getSession()
      if (!session) {
        if (sequence === requestSequence.current) {
          setError('Your Workspace session has expired. Sign in again.')
          setLoading(false)
        }
        return
      }

      const headers = { Authorization: `Bearer ${session.access_token}` }

      const [searchResult, mailResult] = await Promise.all([
        client.functions.invoke('workspace-search', { body: { query: trimmed }, headers }),
        client.functions.invoke('zoho-mail-search', { body: { query: trimmed }, headers }),
      ])

      // A later keystroke already started a newer request, so drop this
      // stale one rather than let it clobber more recent results.
      if (sequence !== requestSequence.current) return

      if (searchResult.error) {
        setError('Search failed. Please try again.')
        setResults({})
        setPartial(false)
      } else {
        setResults((searchResult.data?.results || {}) as SearchResults)
        setPartial(Array.isArray(searchResult.data?.partial) && searchResult.data.partial.length > 0)
      }

      // Mail failing (no mailbox connected, Zoho token issue, etc.) is not
      // a reason to fail the whole search; show no mail results.
      setMail(mailResult.error ? [] : (mailResult.data?.messages || []))
      setActive(0)
      setLoading(false)
    }, 250)

    return () => clearTimeout(timer)
  }, [query, open])

  function choose(item: ResultItem) {
    setOpen(false)
    if (item.focus) setSearchFocus(item.focus.kind, item.focus.id)
    onNavigate(item.section)
  }

  const groups = buildGroups(results, mail)
  const flat = groups.flatMap(group => group.items)

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' && flat.length) {
      event.preventDefault()
      setActive(current => (current + 1) % flat.length)
    } else if (event.key === 'ArrowUp' && flat.length) {
      event.preventDefault()
      setActive(current => (current - 1 + flat.length) % flat.length)
    } else if (event.key === 'Enter' && flat[active]) {
      event.preventDefault()
      choose(flat[active])
    }
  }

  useEffect(() => {
    document.querySelector('.searchResultRow.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) {
    return (
      <button type="button" className="iconButton" title="Search (⌘K)" aria-label="Search the workspace" onClick={() => setOpen(true)}>
        <Search size={17}/>
      </button>
    )
  }

  const trimmed = query.trim()
  let index = -1

  return (
    <div className="socialModal searchModal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
      <div className="searchModalPanel" onClick={event => event.stopPropagation()}>
        <div className="searchModalHeader">
          <Search size={18}/>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks, files, knowledge, people, chat, mail…"
            aria-label="Search the workspace"
          />
          <button type="button" className="modalClose" onClick={() => setOpen(false)} aria-label="Close search">
            <X size={16}/>
          </button>
        </div>

        <div className="searchModalBody">
          {trimmed.length > 0 && trimmed.length < 2 && (
            <p className="searchHint">Keep typing. Search needs at least 2 characters.</p>
          )}

          {loading && (
            <p className="searchHint"><Loader2 size={14} className="spinIcon"/> Searching…</p>
          )}

          {!loading && error && <p className="searchHint searchError">{error}</p>}

          {!loading && !error && results && (
            <>
              {groups.map(group => (
                <div className="searchGroup" key={group.label}>
                  <div className="searchGroupLabel">{group.label}</div>
                  {group.items.map(item => {
                    index += 1
                    const position = index
                    const Icon = item.icon
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={`searchResultRow${position === active ? ' active' : ''}`}
                        onMouseEnter={() => setActive(position)}
                        onClick={() => choose(item)}
                      >
                        <span className="searchResultIcon"><Icon size={16}/></span>
                        <span className="searchResultBody">
                          <strong>{item.title}</strong>
                          <small>{item.sub}</small>
                        </span>
                        {item.meta && <span className="searchResultMeta">{item.meta}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}

              {partial && (
                <p className="searchHint">Some areas could not be searched just now. Results may be incomplete.</p>
              )}

              {trimmed.length >= 2 && flat.length === 0 && (
                <p className="searchEmpty">No results for "{trimmed}".</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
