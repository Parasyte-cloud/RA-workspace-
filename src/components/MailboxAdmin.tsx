import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Box = { id: string; address: string | null; display_name: string | null; type: string; active: boolean; connection_status: string | null }
type Person = { id: string; name: string; email: string }
type Grant = { mailbox_id: string; employee_id: string; can_read: boolean; can_send: boolean; is_default: boolean }
type Overview = { is_admin: boolean; max_per_person?: number; mailboxes?: Box[]; employees?: Person[]; grants?: Grant[] }

// Admins only. Who can open which company mailbox. Hidden from everyone else.
export function MailboxAdmin({ onConnect, connecting }: { onConnect?: () => void; connecting?: boolean } = {}) {
  const [data, setData] = useState<Overview | null>(null)
  const [open, setOpen] = useState(false)
  const [boxId, setBoxId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data: result, error } = await supabase.rpc('admin_zoho_mailbox_overview')
    if (error) { setData({ is_admin: false }); return }
    const overview = result as Overview
    setData(overview)
    setBoxId(current => current || overview.mailboxes?.[0]?.id || '')
  }, [])

  useEffect(() => { void load() }, [load])

  const grantFor = useMemo(() => {
    const map = new Map<string, Grant>()
    for (const grant of data?.grants || []) {
      if (grant.mailbox_id === boxId) map.set(grant.employee_id, grant)
    }
    return map
  }, [data, boxId])

  const countFor = (employeeId: string) => (data?.grants || []).filter(g => g.employee_id === employeeId).length

  if (!data?.is_admin) return null

  const save = async (person: Person, patch: Partial<Pick<Grant, 'can_read' | 'can_send' | 'is_default'>>) => {
    if (!supabase || !boxId) return
    const current = grantFor.get(person.id)
    const next = {
      can_read: current?.can_read ?? false,
      can_send: current?.can_send ?? false,
      is_default: current?.is_default ?? false,
      ...patch,
    }
    setBusy(true)
    setNote('')
    const { error } = await supabase.rpc('admin_set_zoho_mailbox_access', {
      p_mailbox_id: boxId,
      p_employee_id: person.id,
      p_can_read: next.can_read,
      p_can_send: next.can_send,
      p_is_default: next.is_default,
    })
    setBusy(false)
    setNote(error ? error.message : `Saved for ${person.name || person.email}.`)
    await load()
  }

  const boxes = data.mailboxes || []
  const limit = data.max_per_person || 10

  return (
    <div className="mailboxAdmin glassCard">
      <div className="mailboxAdminBar">
        <button type="button" className="glassButton" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? 'Hide mailbox access' : 'Manage mailbox access'}
        </button>
        {onConnect && (
          <button type="button" className="glassButton" disabled={connecting} onClick={onConnect}>
            Connect another mailbox
          </button>
        )}
      </div>
      {onConnect && open && (
        <p className="mailboxAdminHelp">
          To add info@, admin@ or any other mailbox: first sign out of Zoho in this browser (open accounts.zoho.com and
          choose Sign out). Then press "Connect another mailbox", sign in to Zoho as that mailbox and approve. It appears
          in the Mailbox menu. Then use the table below to choose who else can open it.
        </p>
      )}
      {open && (
        <div className="mailboxAdminBody">
          {boxes.length === 0 ? (
            <p>No Zoho mailbox is connected yet. Open Mail as the mailbox owner and choose "Connect Zoho Mail". Each connected mailbox then appears here.</p>
          ) : (
            <>
              <p>Choose who can open each company mailbox. One person can have up to {limit}. A person with more than one gets a mailbox switcher in Mail.</p>
              <label className="mailboxAdminPick">
                <span>Mailbox</span>
                <select value={boxId} onChange={event => setBoxId(event.target.value)}>
                  {boxes.map(box => (
                    <option key={box.id} value={box.id}>
                      {(box.address || box.display_name || box.id) + (box.connection_status && box.connection_status !== 'active' ? ' (needs reconnecting)' : '')}
                    </option>
                  ))}
                </select>
              </label>
              <table className="mailboxAdminTable">
                <thead>
                  <tr><th>Person</th><th>Read</th><th>Send</th><th>Opens first</th><th>Mailboxes</th></tr>
                </thead>
                <tbody>
                  {(data.employees || []).map(person => {
                    const grant = grantFor.get(person.id)
                    return (
                      <tr key={person.id}>
                        <td><strong>{person.name || person.email}</strong><small>{person.email}</small></td>
                        <td><input type="checkbox" disabled={busy} aria-label={`Read for ${person.name}`} checked={Boolean(grant?.can_read)} onChange={event => void save(person, { can_read: event.target.checked, ...(event.target.checked ? {} : { is_default: false }) })} /></td>
                        <td><input type="checkbox" disabled={busy} aria-label={`Send for ${person.name}`} checked={Boolean(grant?.can_send)} onChange={event => void save(person, { can_send: event.target.checked })} /></td>
                        <td><input type="radio" name={`first-${person.id}`} disabled={busy || !grant?.can_read} aria-label={`Opens first for ${person.name}`} checked={Boolean(grant?.is_default)} onChange={() => void save(person, { is_default: true })} /></td>
                        <td>{countFor(person.id)} of {limit}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          {note && <small role="status" className="mailboxAdminNote">{note}</small>}
        </div>
      )}
    </div>
  )
}
