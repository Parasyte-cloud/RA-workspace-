import { useCallback, useEffect, useMemo, useState } from 'react'
import { Phone, RefreshCw, Search, UserMinus, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../letterhead.css'

type Person = {
  id: string
  full_name: string | null
  email: string
  role: string
  department: string | null
  job_title: string | null
}

const label = (person: Person) => person.full_name || person.email

// Administration > Calling. Administrators can always call. Anyone else needs
// to be added here. Access is enforced in the database (has_calling_access),
// this screen only edits the list. Anyone can answer a call they receive.
export default function AdminCallingAccess() {
  const [people, setPeople] = useState<Person[]>([])
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true)
    const [peopleResult, grantResult] = await Promise.all([
      client.from('employee_profiles').select('id,full_name,email,role,department,job_title').eq('active', true).order('full_name'),
      client.from('workspace_calling_access').select('employee_id'),
    ])
    if (peopleResult.error) { setNotice(peopleResult.error.message); setLoading(false); return }
    if (grantResult.error) {
      setNotice('The calling access table is not installed yet. Apply migration 20261012120000_chat_calling.sql first.')
    } else {
      setNotice('')
      setGranted(new Set((grantResult.data || []).map((row: { employee_id: string }) => row.employee_id)))
    }
    setPeople((peopleResult.data || []) as Person[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const admins = useMemo(() => people.filter(p => p.role.toLowerCase() === 'admin'), [people])
  const individuals = useMemo(
    () => people.filter(p => granted.has(p.id) && !admins.includes(p)),
    [people, granted, admins],
  )
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter(p => !granted.has(p.id) && !admins.includes(p))
      .filter(p => [p.full_name, p.email, p.department, p.job_title, p.role].some(v => (v || '').toLowerCase().includes(q)))
      .slice(0, 8)
  }, [people, granted, admins, query])

  const grant = async (person: Person) => {
    const client = supabase
    if (!client) return
    setBusy(person.id)
    const { data: session } = await client.auth.getSession()
    const { error } = await client
      .from('workspace_calling_access')
      .insert({ employee_id: person.id, granted_by: session.session?.user?.id || null })
    setBusy('')
    if (error) { setNotice(error.message); return }
    setNotice(`${label(person)} can now start calls.`)
    setQuery('')
    await load()
  }

  const revoke = async (person: Person) => {
    const client = supabase
    if (!client) return
    setBusy(person.id)
    const { error } = await client.from('workspace_calling_access').delete().eq('employee_id', person.id)
    setBusy('')
    if (error) { setNotice(error.message); return }
    setNotice(`${label(person)} can no longer start calls.`)
    await load()
  }

  return (
    <section className="lhAdmin glassCard">
      <div className="lhAdminHeader">
        <div>
          <span className="eyebrow">CALLING</span>
          <h3>Who can start voice and video calls from Chat</h3>
          <p>Administrators can always call. Add anyone else below. Everyone can answer a call they receive.</p>
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
                  <UserPlus size={15} />Allow calling
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="lhAdminNone">No matching colleague without calling access.</li>}
          </ul>
        )}
      </div>

      {loading ? <div className="lhAdminNone">Loading...</div> : (
        <>
          <h4><Phone size={15} /> Allowed to call ({individuals.length})</h4>
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
            {individuals.length === 0 && <li className="lhAdminNone">Nobody has been added yet.</li>}
          </ul>

          <h4>Always allowed ({admins.length})</h4>
          <ul className="lhAdminList lhAdminRole">
            {admins.map(person => (
              <li key={person.id}>
                <div>
                  <strong>{label(person)}</strong>
                  <small>{[person.job_title, person.email].filter(Boolean).join(' · ')}</small>
                </div>
                <span className="lhRoleBadge">Administrator</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
