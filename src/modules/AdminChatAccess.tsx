import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Archive, CheckCircle2, ChevronRight, MessageSquareLock, Plus, RefreshCw, RotateCcw, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { addRoomMember, archiveRoom, createRoom, removeRoomMember, setRoomMemberRole } from '../chat/api/roomApi'
import type { GovernedRoomKind } from '../chat/api/roomApi'
import ChatAdminManager from './ChatAdminManager'
import AdminCallingAccess from './AdminCallingAccess'
import { filterRooms, roleLabel, roomNeedsAttention, roomSummary, typeLabel } from './adminChatAccessModel'
import type { AdminRoom, AdminRoomMember } from './adminChatAccessModel'

type Person = { id: string; full_name: string; email: string; role: string; department: string; active: boolean }

/*
 * Administration > Chat. Everything about who can use chat, in one place:
 * rooms and their members, why somebody cannot post, Chat administrators and
 * who may start calls. The database decides access; this screen edits it.
 */
export default function AdminChatAccess() {
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [openId, setOpenId] = useState('')
  const [members, setMembers] = useState<AdminRoomMember[]>([])
  const [query, setQuery] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [pick, setPick] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<{ title: string; type: GovernedRoomKind; description: string }>({ title: '', type: 'committee', description: '' })

  const loadRooms = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true)
    const [roomResult, peopleResult] = await Promise.all([
      client.rpc('admin_chat_rooms'),
      client.from('employee_profiles').select('id,full_name,email,role,department,active').order('full_name'),
    ])
    if (roomResult.error) {
      setNotice(/does not exist|schema cache/i.test(roomResult.error.message)
        ? 'Run migration 20261016210000_admin_chat_access.sql first.'
        : roomResult.error.message)
    } else {
      setNotice('')
      setRooms((roomResult.data || []) as AdminRoom[])
    }
    setPeople((peopleResult.data || []) as Person[])
    setLoading(false)
  }, [])

  const loadMembers = useCallback(async (id: string) => {
    const client = supabase
    if (!client || !id) { setMembers([]); return }
    const { data, error } = await client.rpc('admin_chat_room_members', { p_conversation_id: id })
    if (error) { setNotice(error.message); return }
    setMembers((data || []) as AdminRoomMember[])
  }, [])

  useEffect(() => { void loadRooms() }, [loadRooms])
  useEffect(() => { void loadMembers(openId) }, [openId, loadMembers])

  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key)
    try {
      const done = await work()
      setNotice(done || 'Saved.')
      await loadRooms()
      await loadMembers(openId)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : (cause as { message?: string })?.message || 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  const summary = useMemo(() => roomSummary(rooms), [rooms])
  const shown = useMemo(() => filterRooms(rooms, query, onlyProblems), [rooms, query, onlyProblems])
  const room = rooms.find(row => row.conversation_id === openId) || null
  const memberIds = useMemo(() => new Set(members.filter(m => !m.removed_at).map(m => m.user_id)), [members])
  const addable = useMemo(() => people.filter(p => p.active && !memberIds.has(p.id)), [people, memberIds])
  const name = (m: AdminRoomMember) => m.full_name || m.email || 'Employee'

  const submitRoom = () => void run('create', async () => {
    const title = draft.title.trim()
    if (title.length < 2) throw new Error('Give the room a name.')
    const id = await createRoom({ title, roomType: draft.type, description: draft.description.trim() || null })
    setDraft({ title: '', type: 'committee', description: '' })
    setCreating(false)
    setOpenId(id)
    return `Room "${title}" created. Add its members below.`
  })

  return (
    <div className="acaRoot responsiveModule">
      <section className="acaCard glassCard">
        <div className="acaHead">
          <div>
            <span className="eyebrow">CHAT</span>
            <h3>Chat access, in one place</h3>
            <p>Who is in each room, who can post, and why someone cannot. Chat administrators, room admins and call access are all managed here.</p>
          </div>
          <div className="acaHeadActions">
            <button type="button" className="glassButton" onClick={() => setCreating(open => !open)}><Plus size={15} />New room</button>
            <button type="button" className="glassButton" onClick={() => void loadRooms()}><RefreshCw size={15} />Refresh</button>
          </div>
        </div>

        <details className="acaHow">
          <summary>How chat permissions work</summary>
          <ul>
            <li><b>Posting</b> needs three things: an active employee profile, an active membership in the room, and a room that is not archived.</li>
            <li><b>Room admins</b> add and remove members of their own room. <b>Chat administrators</b> (Admin, HR, or anyone delegated below) manage every room.</li>
            <li><b>Calls</b> are separate: anyone can answer, only listed people can start one.</li>
            <li>The red message "Conversation write access required" means one of the three posting conditions failed. Open the room below and the reason is written next to each person.</li>
          </ul>
        </details>

        {notice && <div className="moduleNotice" role="status">{notice}</div>}

        <div className="acaStats">
          <div><strong>{summary.total}</strong><span>rooms</span></div>
          <div className={summary.broken ? 'warn' : ''}><strong>{summary.broken}</strong><span>cannot be posted in</span></div>
          <div><strong>{summary.archived}</strong><span>archived</span></div>
          <div className={summary.withBlocked ? 'warn' : ''}><strong>{summary.withBlocked}</strong><span>with blocked members</span></div>
        </div>

        {creating && (
          <form className="acaCreate" onSubmit={event => { event.preventDefault(); submitRoom() }}>
            <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Room name" maxLength={80} aria-label="Room name" />
            <select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as GovernedRoomKind })} aria-label="Room type">
              <option value="committee">Committee</option>
              <option value="project">Project</option>
              <option value="restricted">Restricted</option>
            </select>
            <input value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="What is it for? (optional)" maxLength={300} aria-label="Description" />
            <button type="submit" className="glassButton" disabled={busy === 'create'}>Create room</button>
          </form>
        )}

        <div className="acaTools">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search rooms" aria-label="Search rooms" />
          <label><input type="checkbox" checked={onlyProblems} onChange={event => setOnlyProblems(event.target.checked)} /> Only rooms that need attention</label>
        </div>

        {loading && <p className="acaMuted">Loading rooms...</p>}
        {!loading && shown.length === 0 && <p className="acaMuted">No rooms match.</p>}

        <ul className="acaRooms">
          {shown.map(row => {
            const open = row.conversation_id === openId
            return (
              <li key={row.conversation_id} className={open ? 'open' : ''}>
                <button type="button" className="acaRoomRow" aria-expanded={open} onClick={() => setOpenId(open ? '' : row.conversation_id)}>
                  <ChevronRight size={16} className="acaChevron" />
                  <span className="acaRoomName"><b>{row.title}</b><small>{typeLabel(row.room_type)}{row.department ? ` · ${row.department}` : ''}</small></span>
                  <span className="acaCount">{row.active_members} in</span>
                  {roomNeedsAttention(row)
                    ? <span className="acaPill bad"><AlertTriangle size={12} />{row.problem ? (row.status === 'archived' ? 'Archived' : 'No record') : `${row.blocked_members} blocked`}</span>
                    : <span className="acaPill ok"><CheckCircle2 size={12} />Working</span>}
                </button>

                {open && room && (
                  <div className="acaDetail">
                    {room.problem && (
                      <div className="acaProblem" role="alert">
                        <MessageSquareLock size={18} />
                        <div><b>{room.problem}</b><span>Members see "Conversation write access required" until this is fixed.</span></div>
                        <button type="button" className="glassButton" disabled={busy === 'restore'}
                          onClick={() => void run('restore', async () => {
                            const { data, error } = await supabase!.rpc('admin_restore_chat_room', { p_conversation_id: room.conversation_id })
                            if (error) throw error
                            return String(data)
                          })}>
                          <RotateCcw size={14} />Restore room
                        </button>
                      </div>
                    )}

                    <table className="acaMembers">
                      <thead><tr><th>Person</th><th>Room role</th><th>Can post?</th><th aria-label="Actions" /></tr></thead>
                      <tbody>
                        {members.map(member => (
                          <tr key={member.user_id} className={member.removed_at ? 'gone' : ''}>
                            <td><b>{name(member)}</b><small>{[member.employee_role, member.department].filter(Boolean).join(' · ')}</small></td>
                            <td>
                              {member.room_role === 'owner' || member.removed_at
                                ? roleLabel(member.room_role)
                                : (
                                  <select value={member.room_role} disabled={!!busy} aria-label={`Room role for ${name(member)}`}
                                    onChange={event => void run(`role-${member.user_id}`, async () => {
                                      await setRoomMemberRole({ conversationId: room.conversation_id, employeeId: member.user_id, roomRole: event.target.value as 'member' | 'admin' })
                                      return `${name(member)} is now ${roleLabel(event.target.value).toLowerCase()}.`
                                    })}>
                                    <option value="member">Member</option>
                                    <option value="admin">Room admin</option>
                                  </select>
                                )}
                            </td>
                            <td>{member.can_post
                              ? <span className="acaPill ok"><CheckCircle2 size={12} />Yes</span>
                              : <span className="acaPill bad" title={member.block_reason || ''}><AlertTriangle size={12} />{member.block_reason || 'No'}</span>}</td>
                            <td className="acaRowActions">
                              {member.removed_at
                                ? <button type="button" className="glassButton" disabled={!!busy || room.status !== 'active'}
                                    onClick={() => void run(`add-${member.user_id}`, async () => { await addRoomMember({ conversationId: room.conversation_id, employeeId: member.user_id }); return `${name(member)} was added back.` })}>
                                    <UserPlus size={13} />Add back</button>
                                : member.room_role !== 'owner' && (
                                  <button type="button" className="glassButton danger" disabled={!!busy} aria-label={`Remove ${name(member)}`}
                                    onClick={() => void run(`rm-${member.user_id}`, async () => { await removeRoomMember({ conversationId: room.conversation_id, employeeId: member.user_id }); return `${name(member)} was removed.` })}>
                                    <UserMinus size={13} />Remove</button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {room.status === 'active' && (
                      <div className="acaAdd">
                        <select value={pick} onChange={event => setPick(event.target.value)} aria-label="Add a person">
                          <option value="">Add a person...</option>
                          {addable.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email} ({p.role})</option>)}
                        </select>
                        <button type="button" className="glassButton" disabled={!pick || !!busy}
                          onClick={() => void run('add', async () => {
                            await addRoomMember({ conversationId: room.conversation_id, employeeId: pick })
                            setPick('')
                            return 'Added to the room.'
                          })}><UserPlus size={14} />Add to room</button>
                        <button type="button" className="glassButton danger" disabled={!!busy}
                          onClick={() => { if (window.confirm(`Archive "${room.title}"? Nobody will be able to post until you restore it.`)) void run('archive', async () => { await archiveRoom(room.conversation_id); return 'Room archived.' }) }}>
                          <Archive size={14} />Archive room
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="acaCard glassCard">
        <div className="acaHead"><div><span className="eyebrow">CHAT ADMINISTRATORS</span><h3><ShieldCheck size={16} /> Who can manage every room</h3></div></div>
        <ChatAdminManager employees={people} />
      </section>

      <AdminCallingAccess />
    </div>
  )
}
