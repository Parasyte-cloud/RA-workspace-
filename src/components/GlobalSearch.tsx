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
} from 'lucide-react'

import { supabase } from '../lib/supabase'
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
 * Clicking a result navigates to that result's section (onNavigate) via
 * the same setSection the sidebar uses; it does not deep-link to the
 * specific record inside that section, since that would need thread-ing
 * a selected-id prop through every target module. Landing in the right
 * section and letting people find the exact record there felt like the
 * right size for a first version of this — deep-linking is a reasonable
 * follow-up if it turns out to matter.
 */

type PersonRow = { id: string; full_name: string; email: string; department: string; job_title: string }
type CaseRow = { id: string; reference: string; subject: string; status: string; priority: string }
type IncidentRow = { id: string; reference: string; summary: string; severity: string; status: string }
type HrRow = { id: string; subject: string; category: string; status: string }
type LeaveRow = { id: string; leave_type: string; status: string; start_date: string; end_date: string }
type IntakeRow = { id: string; form_title_snapshot: string; category_title_snapshot: string; status: string; source_reference: string | null }
type ChatRow = { id: string; conversation_id: string; body: string; sender_name: string }
type MailRow = { messageId: string; mailboxEmail: string; subject: string; sender: string; summary: string }

type SearchResults = {
  people: PersonRow[]
  cases: CaseRow[]
  incidents: IncidentRow[]
  hr: HrRow[]
  leave: LeaveRow[]
  intake: IntakeRow[]
  chat: ChatRow[]
}

const emptyResults: SearchResults = {
  people: [], cases: [], incidents: [], hr: [], leave: [], intake: [], chat: [],
}

function resultCount(results: SearchResults | null, mail: MailRow[] | null) {
  if (!results) return 0
  return (
    results.people.length + results.cases.length + results.incidents.length +
    results.hr.length + results.leave.length + results.intake.length +
    results.chat.length + (mail?.length || 0)
  )
}

export function GlobalSearch({ onNavigate }: { onNavigate: (section: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [mail, setMail] = useState<MailRow[] | null>(null)
  const [error, setError] = useState('')

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
  }, [open])

  useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      setMail(null)
      setLoading(false)
      setError('')
      return
    }

    const sequence = ++requestSequence.current
    setLoading(true)
    setError('')

    const timer = setTimeout(async () => {
      const client = supabase
      if (!client) {
        if (sequence === requestSequence.current) {
          setError('Search is unavailable — Supabase is not configured.')
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

      // A later keystroke already started a newer request — drop this
      // stale one rather than let it clobber more recent results.
      if (sequence !== requestSequence.current) return

      if (searchResult.error) {
        setError('Search failed. Please try again.')
        setResults(emptyResults)
      } else {
        setResults({ ...emptyResults, ...(searchResult.data?.results || {}) })
      }

      // Mail failing (no mailbox connected, Zoho token issue, etc.) isn't
      // a reason to show an error for the whole search — just show no
      // mail results.
      setMail(mailResult.error ? [] : (mailResult.data?.messages || []))
      setLoading(false)
    }, 250)

    return () => clearTimeout(timer)
  }, [query, open])

  function go(section: string) {
    setOpen(false)
    onNavigate(section)
  }

  if (!open) {
    return (
      <button type="button" className="iconButton" title="Search (⌘K)" onClick={() => setOpen(true)}>
        <Search size={17}/>
      </button>
    )
  }

  const trimmed = query.trim()
  const total = resultCount(results, mail)

  return (
    <div className="socialModal searchModal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
      <div className="searchModalPanel" onClick={event => event.stopPropagation()}>
        <div className="searchModalHeader">
          <Search size={18}/>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
            placeholder="Search people, cases, chat, mail…"
            aria-label="Search the workspace"
          />
          <button type="button" className="modalClose" onClick={() => setOpen(false)} aria-label="Close search">
            <X size={16}/>
          </button>
        </div>

        <div className="searchModalBody">
          {trimmed.length > 0 && trimmed.length < 2 && (
            <p className="searchHint">Keep typing — search needs at least 2 characters.</p>
          )}

          {loading && (
            <p className="searchHint"><Loader2 size={14} className="spinIcon"/> Searching…</p>
          )}

          {!loading && error && <p className="searchHint searchError">{error}</p>}

          {!loading && !error && results && (
            <>
              {results.people.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">People</div>
                  {results.people.map(person => (
                    <button type="button" key={person.id} className="searchResultRow" onClick={() => go('people')}>
                      <span className="searchResultIcon"><User size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{person.full_name || person.email}</strong>
                        <small>{[person.job_title, person.department].filter(Boolean).join(' · ') || person.email}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {results.cases.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">Support cases</div>
                  {results.cases.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('support')}>
                      <span className="searchResultIcon"><Headphones size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.subject}</strong>
                        <small>{item.reference}</small>
                      </span>
                      <span className="searchResultMeta">{item.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.incidents.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">Incidents</div>
                  {results.incidents.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('operations')}>
                      <span className="searchResultIcon"><ShieldAlert size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.summary}</strong>
                        <small>{item.reference}</small>
                      </span>
                      <span className="searchResultMeta">{item.severity}</span>
                    </button>
                  ))}
                </div>
              )}

              {(results.hr.length > 0 || results.leave.length > 0) && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">People & HR</div>
                  {results.hr.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('people')}>
                      <span className="searchResultIcon"><Users size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.subject}</strong>
                        <small>{item.category}</small>
                      </span>
                      <span className="searchResultMeta">{item.status}</span>
                    </button>
                  ))}
                  {results.leave.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('people')}>
                      <span className="searchResultIcon"><CalendarDays size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.leave_type}</strong>
                        <small>{item.start_date} → {item.end_date}</small>
                      </span>
                      <span className="searchResultMeta">{item.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.intake.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">Intake submissions</div>
                  {results.intake.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('support')}>
                      <span className="searchResultIcon"><Inbox size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.form_title_snapshot}</strong>
                        <small>{item.category_title_snapshot}</small>
                      </span>
                      <span className="searchResultMeta">{item.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.chat.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">Chat</div>
                  {results.chat.map(item => (
                    <button type="button" key={item.id} className="searchResultRow" onClick={() => go('chat')}>
                      <span className="searchResultIcon"><MessagesSquare size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.sender_name}</strong>
                        <small>{item.body}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {mail && mail.length > 0 && (
                <div className="searchGroup">
                  <div className="searchGroupLabel">Mail</div>
                  {mail.map(item => (
                    <button type="button" key={item.messageId} className="searchResultRow" onClick={() => go('mail')}>
                      <span className="searchResultIcon"><Mail size={16}/></span>
                      <span className="searchResultBody">
                        <strong>{item.subject || '(no subject)'}</strong>
                        <small>{item.sender} · {item.mailboxEmail}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {trimmed.length >= 2 && total === 0 && (
                <p className="searchEmpty">No results for "{trimmed}".</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
