import { useCallback, useEffect, useMemo, useState } from 'react'
import { Headphones, RefreshCw, Save, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { control, type TelephonySettings } from '../lib/supportCommandCentre'
import SupportTelephonyAdmin from './SupportTelephonyAdmin'
import SupportInvites from './SupportInvites'
import SupportAlertsAdmin from './SupportAlertsAdmin'
import '../support-command-centre.css'

type Employee = { id: string; full_name: string; email: string; role: string; job_title: string; department: string; active: boolean }
type Agent = {
  employee_id: string; enabled: boolean; is_supervisor: boolean; role_kind?: 'watcher' | 'agent' | 'supervisor'; voice_enabled: boolean; messaging_enabled: boolean
  email_enabled: boolean; sms_enabled: boolean; whatsapp_enabled: boolean; web_chat_enabled: boolean
  voice_capacity: number; messaging_capacity: number; skills: string[]; languages: string[]; provider_worker_id: string | null; can_invite?: boolean
  team_id?: string | null; supervisor_scope?: 'all' | 'team'
}
type Shift = { id: string; name: string; timezone: string; starts_at: string; ends_at: string; active: boolean }
type Assignment = { shift_id: string; employee_id: string; weekday: number }
type VoiceSettings = {
  caller_id: string | null; ivr_enabled: boolean; callback_enabled: boolean; recording_enabled: boolean; recording_consent_mode: string
  greeting_text: string; hold_message_text: string; callback_offer_after_seconds: number; max_queue_wait_seconds: number
  outbound_limit_per_10min: number
}
type DialRule = { prefix: string; action: 'allow' | 'deny'; note: string | null }
type Team = { id: string; name: string; description: string | null; active: boolean }
type Snapshot = { employees: Employee[]; agents: Agent[]; shifts: Shift[]; assignments: Assignment[]; voiceSettings: VoiceSettings | null; teams?: Team[] }

const DAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]] as const
const SKILLS = ['general_support', 'booking', 'payments', 'active_ride', 'safety', 'driver_support']
type Section = 'officers' | 'teams' | 'invites' | 'alerts' | 'voice' | 'dial' | 'hours' | 'numbers' | 'dnc' | 'safety'

export default function SupportOfficerAdminPanel() {
  const [section, setSection] = useState<Section>('officers')
  const [snap, setSnap] = useState<Snapshot>({ employees: [], agents: [], shifts: [], assignments: [], voiceSettings: null })
  const [rules, setRules] = useState<DialRule[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')

  // officer form
  const [enabled, setEnabled] = useState(true)
  const [roleKind, setRoleKind] = useState<'watcher' | 'agent' | 'supervisor'>('agent')
  const [teamId, setTeamId] = useState('')
  const [scope, setScope] = useState<'all' | 'team'>('all')
  const [newTeam, setNewTeam] = useState({ name: '', description: '' })
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [messagingEnabled, setMessagingEnabled] = useState(true)
  const [voiceCapacity, setVoiceCapacity] = useState(1)
  const [messagingCapacity, setMessagingCapacity] = useState(3)
  const [skills, setSkills] = useState<string[]>(['general_support'])
  const [languages, setLanguages] = useState('English')
  const [shiftId, setShiftId] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])

  // voice form
  const [vs, setVs] = useState<VoiceSettings | null>(null)
  const [newRule, setNewRule] = useState<DialRule>({ prefix: '', action: 'allow', note: '' })

  const load = useCallback(async () => {
    setLoading(true); setNotice('')
    try {
      const data = await control<Snapshot>({ action: 'admin_list' })
      setSnap(data); setVs(data.voiceSettings)
      const r = await control<{ rules: DialRule[] }>({ action: 'list_dial_rules' })
      setRules(r.rules)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load Support administration.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const agentMap = useMemo(() => new Map(snap.agents.map((a) => [a.employee_id, a])), [snap.agents])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return snap.employees.filter((e) => !q || `${e.full_name} ${e.email} ${e.job_title} ${e.department}`.toLowerCase().includes(q)).slice(0, 80)
  }, [snap.employees, search])
  const selected = snap.employees.find((e) => e.id === selectedId) || null

  useEffect(() => {
    if (!selected) return
    const a = agentMap.get(selected.id)
    setEnabled(a?.enabled ?? true); setRoleKind(a?.role_kind ?? (a?.is_supervisor ? 'supervisor' : 'agent'))
    setTeamId(a?.team_id || ''); setScope(a?.supervisor_scope === 'team' ? 'team' : 'all')
    setVoiceEnabled(a?.voice_enabled ?? true); setMessagingEnabled(a?.messaging_enabled ?? true)
    setVoiceCapacity(a?.voice_capacity ?? 1); setMessagingCapacity(a?.messaging_capacity ?? 3)
    setSkills(a?.skills?.length ? a.skills : ['general_support']); setLanguages((a?.languages || ['English']).join(', '))
    const mine = snap.assignments.filter((x) => x.employee_id === selected.id)
    setShiftId(mine[0]?.shift_id || snap.shifts[0]?.id || '')
    setWeekdays(mine.length ? mine.filter((x) => x.shift_id === mine[0].shift_id).map((x) => x.weekday) : [1, 2, 3, 4, 5])
  }, [selected, agentMap, snap.assignments, snap.shifts])

  const run = async (work: () => Promise<string>) => {
    setSaving(true); setNotice('')
    try { setNotice(await work()); await load() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'That did not save.') }
    finally { setSaving(false) }
  }

  const saveOfficer = () => selected && run(async () => {
    const res = await control<{ routingWarning?: string | null }>({
      action: 'provision_agent', employeeId: selected.id, enabled, roleKind, isSupervisor: roleKind === 'supervisor', teamId: teamId || null, supervisorScope: roleKind === 'supervisor' ? scope : 'all', voiceEnabled, messagingEnabled,
      voiceCapacity, messagingCapacity, skills, languages: languages.split(',').map((s) => s.trim()).filter(Boolean),
      assignments: shiftId && weekdays.length ? [{ shiftId, weekdays }] : [],
    })
    return res.routingWarning
      ? `Saved ${selected.full_name}, but call routing is not ready: ${res.routingWarning}. Messaging works; voice will not ring this officer until the Twilio sync succeeds.`
      : `Saved ${selected.full_name}.`
  })

  const saveVoice = () => vs && run(async () => {
    await control({
      action: 'update_voice_settings',
      settings: {
        callerId: vs.caller_id || '', ivrEnabled: vs.ivr_enabled, callbackEnabled: vs.callback_enabled, recordingEnabled: vs.recording_enabled,
        recordingConsentMode: vs.recording_consent_mode, greetingText: vs.greeting_text, holdMessageText: vs.hold_message_text,
        callbackOfferAfterSeconds: vs.callback_offer_after_seconds, maxQueueWaitSeconds: vs.max_queue_wait_seconds,
        outboundLimitPer10Min: vs.outbound_limit_per_10min,
      },
    })
    return 'Voice settings saved. They apply to the next call.'
  })

  const patchVs = (p: Partial<VoiceSettings>) => setVs((cur) => (cur ? { ...cur, ...p } : cur))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return <section className="supportAdminShell">
    <header className="supportAdminHeader sccPanel">
      <div><span className="sccEyebrow">Administration</span><h3>Support Routing</h3><p>Who takes calls and tickets, when, and the rules the phone line follows. Changes apply to the next call or ticket.</p></div>
      <button type="button" className="sccIconBtn" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />{loading ? 'Loading' : 'Refresh'}</button>
    </header>
    <nav className="sccTabs">{([['officers', 'Officers'], ['teams', 'Teams'], ['invites', 'Invite staff'], ['alerts', 'Alerts'], ['voice', 'Voice and IVR'], ['dial', 'Dial rules'], ['hours', 'Hours and voicemail'], ['numbers', 'Numbers'], ['dnc', 'Do not contact'], ['safety', 'Limits and retention']] as Array<[Section, string]>).map(([id, text]) => <button key={id} type="button" className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{text}</button>)}</nav>
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

    {section === 'officers' ? <div className="supportAdminGrid">
      <aside className="supportAdminPeople sccPanel">
        <label className="supportAdminSearch"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees" /></label>
        {filtered.map((e) => <button key={e.id} type="button" className={e.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(e.id)}>
          <span><b>{e.full_name}</b><small>{e.job_title || e.role}</small></span>
          {agentMap.get(e.id)?.enabled ? <ShieldCheck size={15} /> : null}
        </button>)}
      </aside>
      <div className="supportAdminEditor sccPanel">
        {selected ? <>
          <div className="supportAdminIdentity"><div><strong>{selected.full_name}</strong><small>{selected.email}</small></div><span><Headphones size={14} />{agentMap.get(selected.id)?.provider_worker_id ? 'Linked to call routing' : 'Not linked to call routing'}</span></div>
          <div className="supportAdminForm">
            <label><span>Support officer</span><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></label>
            <label className="wide"><span>Role</span>
              <select value={roleKind} onChange={(e) => setRoleKind(e.target.value as typeof roleKind)}>
                <option value="agent">Agent: takes calls and tickets, works emergencies</option>
                <option value="supervisor">Supervisor: also sees Control tower, Insights, approvals and the audit log</option>
                <option value="watcher">Watcher: sees queues and activity only; no work, no private details, no locations</option>
              </select></label>
            <label><span>Team</span>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">No team</option>{(snap.teams || []).filter((t) => t.active || t.id === teamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            {roleKind === 'supervisor' ? <label><span>Supervisor reach</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'team')}><option value="all">Everyone</option><option value="team" disabled={!teamId}>Own team only{teamId ? '' : ' (pick a team first)'}</option></select></label> : null}
            <label><span>Takes calls</span><input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} /></label>
            <label><span>Takes chat, WhatsApp, SMS, email, forms</span><input type="checkbox" checked={messagingEnabled} onChange={(e) => setMessagingEnabled(e.target.checked)} /></label>
            <label><span>Calls at once</span><input type="number" min={0} max={5} value={voiceCapacity} onChange={(e) => setVoiceCapacity(Number(e.target.value))} /></label>
            <label><span>Tickets at once</span><input type="number" min={0} max={20} value={messagingCapacity} onChange={(e) => setMessagingCapacity(Number(e.target.value))} /></label>
            <label className="wide"><span>Skills (routes safety, active ride and payment work to specialists first)</span>
              <div className="supportAdminDays">{SKILLS.map((s) => <button type="button" key={s} className={skills.includes(s) ? 'active' : ''} onClick={() => setSkills((cur) => toggle(cur, s))}>{s.replace(/_/g, ' ')}</button>)}</div></label>
            <label className="wide"><span>Languages</span><input value={languages} onChange={(e) => setLanguages(e.target.value)} /></label>
            <label className="wide"><span>Shift</span>
              <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">No shift (cannot go Available)</option>{snap.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.starts_at.slice(0, 5)} to {s.ends_at.slice(0, 5)} {s.timezone})</option>)}</select></label>
          </div>
          <div className="supportAdminDays" aria-label="Days">{DAYS.map(([name, n]) => <button type="button" key={n} className={weekdays.includes(n) ? 'active' : ''} onClick={() => setWeekdays((cur) => toggle(cur, n))}>{name}</button>)}</div>
          <button type="button" className="sccVoicePrimary" onClick={() => void saveOfficer()} disabled={saving}><Save size={15} />{saving ? 'Saving' : 'Save officer'}</button>
        </> : <div className="sccEmpty">Pick an employee to provision or edit.</div>}
      </div>
    </div> : null}

    {section === 'teams' ? <div className="supportAdminEditor sccPanel">
      <h4>Teams</h4>
      <p className="sccHealthNote">A supervisor limited to a team can assign work to, approve locations for and read the audit trail of that team only. Emergencies, the shared queues and the floor board stay visible to every supervisor on purpose. Administrators and the Head of Support are never limited.</p>
      {(snap.teams || []).length === 0 ? <div className="sccEmpty">No teams yet.</div> : (snap.teams || []).map((t) => <div key={t.id} className="sccAuditRow">
        <span><b>{t.name}</b><small>{t.description || 'No description'}</small></span>
        <span><small>{snap.agents.filter((a) => a.team_id === t.id && a.enabled).length} people</small></span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="sccIconBtn" disabled={saving} onClick={() => void run(async () => { await control({ action: 'team_save', id: t.id, name: t.name, description: t.description || '', active: !t.active }); return t.active ? 'Team hidden from new assignments.' : 'Team restored.' })}>{t.active ? 'Hide' : 'Restore'}</button>
          <button type="button" className="sccIconBtn" disabled={saving} onClick={() => { if (window.confirm(`Delete the team ${t.name}? People in it become unassigned and any supervisor limited to it can then act on no one but themselves.`)) void run(async () => { await control({ action: 'team_delete', id: t.id }); return 'Team deleted.' }) }}><Trash2 size={14} />Delete</button>
        </span>
      </div>)}
      <div className="supportAdminForm">
        <label><span>Team name</span><input value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} /></label>
        <label><span>Description</span><input value={newTeam.description} onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })} /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={saving || newTeam.name.trim().length < 2} onClick={() => void run(async () => { await control({ action: 'team_save', name: newTeam.name, description: newTeam.description }); setNewTeam({ name: '', description: '' }); return 'Team created.' })}><Save size={15} />Add team</button>
    </div> : null}

    {section === 'invites' ? <SupportInvites employees={snap.employees} agents={snap.agents} teams={snap.teams || []} onChanged={() => void load()} /> : null}

    {section === 'alerts' ? <SupportAlertsAdmin employees={snap.employees} /> : null}

    {section === 'voice' && vs ? <div className="supportAdminEditor sccPanel">
      <div className="supportAdminForm">
        <label><span>Caller ID shown to customers (E.164)</span><input value={vs.caller_id || ''} onChange={(e) => patchVs({ caller_id: e.target.value })} placeholder="+2348012345678" /></label>
        <label><span>Press-a-number menu (IVR)</span><input type="checkbox" checked={vs.ivr_enabled} onChange={(e) => patchVs({ ivr_enabled: e.target.checked })} /></label>
        <label><span>Offer a callback to waiting callers</span><input type="checkbox" checked={vs.callback_enabled} onChange={(e) => patchVs({ callback_enabled: e.target.checked })} /></label>
        <label><span>Offer callback after (seconds)</span><input type="number" min={0} max={3600} value={vs.callback_offer_after_seconds} onChange={(e) => patchVs({ callback_offer_after_seconds: Number(e.target.value) })} /></label>
        <label><span>Longest wait before we call back (seconds)</span><input type="number" min={30} max={7200} value={vs.max_queue_wait_seconds} onChange={(e) => patchVs({ max_queue_wait_seconds: Number(e.target.value) })} /></label>
        <label><span>Outbound calls per officer per 10 minutes</span><input type="number" min={1} max={500} value={vs.outbound_limit_per_10min} onChange={(e) => patchVs({ outbound_limit_per_10min: Number(e.target.value) })} /></label>
        <label><span>Call recording</span><input type="checkbox" checked={vs.recording_enabled} onChange={(e) => patchVs({ recording_enabled: e.target.checked })} /></label>
        <label className="wide"><span>Greeting</span><input value={vs.greeting_text} onChange={(e) => patchVs({ greeting_text: e.target.value })} maxLength={400} /></label>
        <label className="wide"><span>Hold message</span><input value={vs.hold_message_text} onChange={(e) => patchVs({ hold_message_text: e.target.value })} maxLength={400} /></label>
      </div>
      {vs.recording_enabled ? <p className="sccMuted">Recording must be disclosed to callers. Put the disclosure in the greeting above, and confirm your obligations under the NDPA before turning this on.</p> : null}
      <button type="button" className="sccVoicePrimary" onClick={() => void saveVoice()} disabled={saving}><Save size={15} />{saving ? 'Saving' : 'Save voice settings'}</button>
    </div> : null}

    {section === 'hours' || section === 'numbers' || section === 'dnc' || section === 'safety'
      ? <SupportTelephonyAdmin section={section} settings={snap.voiceSettings as unknown as TelephonySettings | null} onSettingsChanged={() => void load()} />
      : null}

    {section === 'dial' ? <div className="supportAdminEditor sccPanel">
      <p className="sccMuted">Outbound calls and callbacks are allowed only to a prefix marked Allow. The longest matching prefix wins, so a Deny on +44870 beats an Allow on +44. This is what stops a compromised account from dialling premium-rate numbers.</p>
      {rules.map((r) => <article className="sccAgent" key={r.prefix}>
        <div className={`sccPresence ${r.action === 'allow' ? 'available' : 'busy'}`} />
        <span><b>{r.prefix}</b><small>{r.action}{r.note ? ` · ${r.note}` : ''}</small></span>
        <button type="button" className="sccIconBtn" aria-label={`Delete ${r.prefix}`} disabled={saving} onClick={() => void run(async () => { await control({ action: 'delete_dial_rule', prefix: r.prefix }); return `Removed ${r.prefix}.` })}><Trash2 size={14} /></button>
      </article>)}
      <div className="supportAdminForm">
        <label><span>Prefix</span><input value={newRule.prefix} onChange={(e) => setNewRule({ ...newRule, prefix: e.target.value })} placeholder="+234" /></label>
        <label><span>Rule</span><select value={newRule.action} onChange={(e) => setNewRule({ ...newRule, action: e.target.value as 'allow' | 'deny' })}><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
        <label className="wide"><span>Note</span><input value={newRule.note || ''} onChange={(e) => setNewRule({ ...newRule, note: e.target.value })} /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={saving || !newRule.prefix} onClick={() => void run(async () => { await control({ action: 'upsert_dial_rule', prefix: newRule.prefix.replace(/\s/g, ''), rule: newRule.action, note: newRule.note }); setNewRule({ prefix: '', action: 'allow', note: '' }); return 'Rule saved.' })}><Save size={15} />Save rule</button>
    </div> : null}
  </section>
}
