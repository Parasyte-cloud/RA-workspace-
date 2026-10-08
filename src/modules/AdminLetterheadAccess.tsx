import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSignature, RefreshCw, Search, UserMinus, UserPlus } from 'lucide-react'

import { supabase } from '../lib/supabase'
import { LETTERHEAD_ROLES } from '../lib/letterheadAccess'
import '../letterhead.css'

type Person = {
  id: string
  full_name: string | null
  email: string
  role: string
  department: string | null
  job_title: string | null
}

type Issue = {
  id: string
  issued_at: string
  issued_by: string
  doc_type: string
  reference: string | null
  subject: string | null
  recipient: string | null
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  legal: 'Legal',
  operations: 'Operations',
  finance: 'Finance',
}

const label = (person: Person) => person.full_name || person.email

// Administration > Letterhead. Four roles have access by default; an
// administrator adds anyone else here. Access is enforced in the database
// (can_issue_letterhead), this screen only edits the list.
export default function AdminLetterheadAccess() {
  const [people, setPeople] = useState<Person[]>([])
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [issues, setIssues] = useState<Issue[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true)
    const [peopleResult, grantResult, issueResult] = await Promise.all([
      client.from('employee_profiles').select('id,full_name,email,role,department,job_title').eq('active', true).order('full_name'),
      client.from('workspace_letterhead_access').select('employee_id'),
      client.from('letterhead_issues').select('id,issued_at,issued_by,doc_type,reference,subject,recipient').order('issued_at', { ascending: false }).limit(15),
    ])
    if (peopleResult.error) { setNotice(peopleResult.error.message); setLoading(false); return }
    if (grantResult.error) {
      setNotice('The letterhead access table is not installed yet. Apply migration 20261008120000_letterhead_issue_log.sql first.')
    } else {
      setNotice('')
      setGranted(new Set((grantResult.data || []).map((row: { employee_id: string }) => row.employee_id)))
    }
    setPeople((peopleResult.data || []) as Person[])
    setIssues(issueResult.error ? [] : ((issueResult.data || []) as Issue[]))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const roleMembers = useMemo(
    () => people.filter(p => (LETTERHEAD_ROLES as readonly string[]).includes(p.role.toLowerCase())),
    [people],
  )
  const individuals = useMemo(
    () => people.filter(p => granted.has(p.id) && !roleMembers.includes(p)),
    [people, granted, roleMembers],
  )
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter(p => !granted.has(p.id) && !roleMembers.includes(p))
      .filter(p => [p.full_name, p.email, p.department, p.job_title, p.role].some(v => (v || '').toLowerCase().includes(q)))
      .slice(0, 8)
  }, [people, granted, roleMembers, query])

  const grant = async (person: Person) => {
    const client = supabase
    if (!client) return
    setBusy(person.id)
    const { error } = await client.from('workspace_letterhead_access').insert({ employee_id: person.id })
    setBusy('')
    if (error) { setNotice(error.message); return }
    setNotice(`${label(person)} can now use the letterhead.`)
    setQuery('')
    await load()
  }

  const revoke = async (person: Person) => {
    const client = supabase
    if (!client) return
    setBusy(person.id)
    const { error } = await client.from('workspace_letterhead_access').delete().eq('employee_id', person.id)
    setBusy('')
    if (error) { setNotice(error.message); return }
    setNotice(`${label(person)} no longer has letterhead access.`)
    await load()
  }

  return (
    <section className="lhAdmin glassCard">
      <div className="lhAdminHeader">
        <div>
          <span className="eyebrow">LETTERHEAD</span>
          <h3>Who can issue documents on the letterhead</h3>
          <p>Administrator, Legal, Operations and Finance have access automatically. Add anyone else below.</p>
        </div>
        <button type="button" className="glassButton" onClick={() => void load()}><RefreshCw size={15} />Refresh</button>
      </div>

      {notice && <div className="moduleNotice">{notice}</div>}

      <div className="lhAdminAdd">
        <label>
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search a colleague by name, email, department or title"
            onChange={event => setQuery(event.target.value)}
            aria-label="Search people to add"
          />
        </label>
        {query.trim() && (
          <ul className="lhAdminResults">
            {matches.map(person => (
              <li key={person.id}>
                <div>
                  <strong>{label(person)}</strong>
                  <small>{[person.job_title, person.department, person.email].filter(Boolean).join(' · ')}</small>
                </div>
                <button type="button" className="primaryButton" disabled={busy === person.id} onClick={() => void grant(person)}>
                  <UserPlus size={15} />Give access
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="lhAdminNone">No matching colleague without access.</li>}
          </ul>
        )}
      </div>

      {loading ? <div className="lhAdminNone">Loading…</div> : (
        <>
          <h4>Added individually ({individuals.length})</h4>
          <ul className="lhAdminList">
            {individuals.map(person => (
              <li key={person.id}>
                <div>
                  <strong>{label(person)}</strong>
                  <small>{[person.job_title, person.department, person.email].filter(Boolean).join(' · ')}</small>
                </div>
                <button type="button" className="glassButton danger" disabled={busy === person.id} onClick={() => void revoke(person)}>
                  <UserMinus size={15} />Remove
                </button>
              </li>
            ))}
            {individuals.length === 0 && <li className="lhAdminNone">Nobody has been added individually yet.</li>}
          </ul>

          <h4>Included by role ({roleMembers.length})</h4>
          <ul className="lhAdminList lhAdminRole">
            {roleMembers.map(person => (
              <li key={person.id}>
                <div>
                  <strong>{label(person)}</strong>
                  <small>{[person.job_title, person.email].filter(Boolean).join(' · ')}</small>
                </div>
                <span className="lhRoleBadge">{ROLE_LABEL[person.role.toLowerCase()] || person.role}</span>
              </li>
            ))}
          </ul>
          <p className="lhAdminFoot">To remove someone from this group, change their role under Access.</p>

          <h4><FileSignature size={15} /> Recently issued</h4>
          <ul className="lhAdminList">
            {issues.map(issue => (
              <li key={issue.id}>
                <div>
                  <strong>{issue.subject || '(no subject)'}</strong>
                  <small>
                    {[issue.doc_type, issue.reference, issue.recipient && `to ${issue.recipient}`].filter(Boolean).join(' · ')}
                    {' · '}{label(byId.get(issue.issued_by) || { id: '', full_name: null, email: 'unknown', role: '', department: null, job_title: null })}
                  </small>
                </div>
                <span className="lhRoleBadge">{new Date(issue.issued_at).toLocaleString()}</span>
              </li>
            ))}
            {issues.length === 0 && <li className="lhAdminNone">Nothing issued yet.</li>}
          </ul>
        </>
      )}
    </section>
  )
}
