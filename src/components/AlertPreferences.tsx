import { useCallback, useEffect, useState } from 'react'
import { BellRing, Moon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { deviceLabel, outcomeLabel, timeAgo } from '../lib/pushDevices'

type Prefs = {
  push_chat: boolean
  push_calls: boolean
  push_mail: boolean
  push_room: boolean
  push_other: boolean
  show_previews: boolean
  quiet_enabled: boolean
  quiet_start: string
  quiet_end: string
  quiet_allow_calls: boolean
  timezone: string
}

type Device = { id: string; user_agent: string | null; last_success_at: string | null; created_at: string }
type LogRow = { id: string; outcome: string; created_at: string }

const localZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos' } catch { return 'Africa/Lagos' }
}

const DEFAULTS: Prefs = {
  push_chat: true,
  push_calls: true,
  push_mail: true,
  push_room: true,
  push_other: true,
  show_previews: true,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
  quiet_allow_calls: true,
  timezone: 'Africa/Lagos',
}

const hhmm = (value: string) => String(value || '').slice(0, 5)

// What reaches your devices, when, and whether it really did.
export default function AlertPreferences() {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULTS, timezone: localZone() })
  const [ready, setReady] = useState(false)
  const [note, setNote] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  const [testing, setTesting] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!supabase) return
    const [subs, rows] = await Promise.all([
      supabase.from('push_subscriptions').select('id,user_agent,last_success_at,created_at').order('created_at', { ascending: false }),
      supabase.from('push_delivery_log').select('id,outcome,created_at').order('created_at', { ascending: false }).limit(6),
    ])
    setDevices((subs.data as Device[]) || [])
    setLog((rows.data as LogRow[]) || [])
  }, [])

  useEffect(() => {
    let alive = true
    const run = async () => {
      if (!supabase) return
      const { data: auth } = await supabase.auth.getUser()
      const id = auth.user?.id
      if (!id) return
      const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', id).maybeSingle()
      if (!alive) return
      if (data) setPrefs({ ...DEFAULTS, ...(data as Partial<Prefs>) })
      setReady(true)
      await loadHistory()
    }
    void run().catch(() => setReady(true))
    return () => { alive = false }
  }, [loadHistory])

  const save = async (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    setNote('')
    if (!supabase) return
    const { data: auth } = await supabase.auth.getUser()
    const id = auth.user?.id
    if (!id) return
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: id, ...next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setNote(error ? 'Could not save that. Try again in a moment.' : 'Saved.')
  }

  const sendTest = async () => {
    if (!supabase) return
    setTesting(true)
    setNote('')
    const { error } = await supabase.rpc('send_test_push')
    setTesting(false)
    if (error) {
      setNote(error.message.includes('wait') ? 'Please wait a few seconds between tests.' : 'Could not send the test. The alert service may not be installed yet.')
      return
    }
    setNote('Sent. It should arrive in a few seconds. Lock the phone or close the app to see how it looks.')
    window.setTimeout(() => void loadHistory(), 6000)
  }

  const toggle = (key: keyof Prefs, label: string, hint?: string) => (
    <label className="settingsToggle" key={key}>
      <input type="checkbox" checked={Boolean(prefs[key])} disabled={!ready} onChange={event => void save({ [key]: event.target.checked } as Partial<Prefs>)} />
      <span>{label}{hint && <small className="alertHint"> {hint}</small>}</span>
    </label>
  )

  return (
    <>
      <article className="appearanceSettingCard">
        <div className="appearanceSettingCopy">
          <span className="appearanceSettingNumber"><BellRing size={16} /></span>
          <div>
            <h3>What alerts you</h3>
            <p>Choose what reaches your phone and computer when the app is closed. Anything you turn off still shows in the bell inside the workspace.</p>
          </div>
        </div>
        {toggle('push_chat', 'Chat messages and mentions')}
        {toggle('push_calls', 'Calls and missed calls')}
        {toggle('push_mail', 'New email', '(checked every two minutes)')}
        {toggle('push_room', 'ROOM 7 (a guest waiting, meeting summaries)')}
        {toggle('push_other', 'Everything else (tasks, approvals, announcements)')}
        {toggle('show_previews', 'Show who and what on the lock screen', '(off shows only "You have a new message")')}
        {note && <small className="settingsNote" role="status">{note}</small>}
      </article>

      <article className="appearanceSettingCard">
        <div className="appearanceSettingCopy">
          <span className="appearanceSettingNumber"><Moon size={16} /></span>
          <div>
            <h3>Quiet hours</h3>
            <p>Hold back alerts overnight. Times use {prefs.timezone.replace('_', ' ')}.</p>
          </div>
        </div>
        {toggle('quiet_enabled', 'Turn on quiet hours')}
        <div className="alertTimes">
          <label>
            <span>From</span>
            <input type="time" value={hhmm(prefs.quiet_start)} disabled={!prefs.quiet_enabled} onChange={event => void save({ quiet_start: event.target.value || '22:00', timezone: localZone() })} />
          </label>
          <label>
            <span>Until</span>
            <input type="time" value={hhmm(prefs.quiet_end)} disabled={!prefs.quiet_enabled} onChange={event => void save({ quiet_end: event.target.value || '07:00', timezone: localZone() })} />
          </label>
        </div>
        {toggle('quiet_allow_calls', 'Let calls ring during quiet hours')}
      </article>

      <article className="appearanceSettingCard">
        <div className="appearanceSettingCopy">
          <span className="appearanceSettingNumber"><BellRing size={16} /></span>
          <div>
            <h3>Your devices</h3>
            <p>Send a real alert through the server to check that this device receives it.</p>
          </div>
        </div>
        <button type="button" className="glassButton" disabled={testing} onClick={() => void sendTest()}>
          {testing ? 'Sending...' : 'Send a test alert'}
        </button>
        {devices.length === 0 ? (
          <small className="settingsNote">No device has alerts turned on yet. Turn on "Alerts when the app is closed" above.</small>
        ) : (
          <ul className="alertDevices">
            {devices.map(device => (
              <li key={device.id}>
                <strong>{deviceLabel(device.user_agent)}</strong>
                <small>Last delivered {timeAgo(device.last_success_at)}</small>
              </li>
            ))}
          </ul>
        )}
        {log.length > 0 && (
          <>
            <small className="settingsNote">Recent attempts</small>
            <ul className="alertDevices">
              {log.map(row => (
                <li key={row.id}>
                  <strong>{outcomeLabel(row.outcome)}</strong>
                  <small>{timeAgo(row.created_at)}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
    </>
  )
}
