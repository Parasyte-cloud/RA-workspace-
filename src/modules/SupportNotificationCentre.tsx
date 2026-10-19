// Bell, notification list, and "how do alerts reach me" settings (this device, my phone, test buttons).
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, CheckCheck, Download, Smartphone } from 'lucide-react'
import { loadMyContact, saveMyContact, sendTestAlert, type AlertChannel, type MyContact, type NotificationRow } from '../lib/supportCommandCentre'
import {
  canPromptInstall, currentPushState, disablePush, enablePush, isIos, isStandalone, myPushDevices, onInstallChange, promptInstall, type PushState,
} from '../support/pwa'
import '../support-command-centre.css'

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: 'This browser cannot receive push alerts. Use Chrome, Edge or Firefox, or install the app on your phone.',
  needs_install: 'On iPhone and iPad, alerts only work from the Home Screen app. Tap Share, then Add to Home Screen, and open it from there.',
  not_configured: 'Push alerts are not switched on for this workspace yet. Ask your administrator.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser settings, then reload.',
  off: 'Alerts on this device are off.',
  on: 'This device will get alerts even when the workspace is closed.',
}

export default function SupportNotificationCentre({ items, unread, error, onRead, onOpen }: {
  items: NotificationRow[]; unread: number; error?: string
  onRead: (ids?: number[]) => void
  onOpen: (n: NotificationRow) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'alerts' | 'settings'>('alerts')
  return <div className="sccBellWrap">
    <button type="button" className={`sccBell ${unread ? 'hot' : ''}`} onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
      <Bell size={18} />{unread ? <span className="sccBellCount">{unread > 9 ? '9+' : unread}</span> : null}
    </button>
    {open ? <div className="sccBellPanel sccPanel" role="dialog" aria-label="Notifications">
      <div className="sccTabs sub">
        <button type="button" className={view === 'alerts' ? 'active' : ''} onClick={() => setView('alerts')}>Alerts</button>
        <button type="button" className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>How alerts reach me</button>
        <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: 'auto' }}>Close</button>
      </div>
      {view === 'alerts' ? <>
        {error ? <div className="sccNotice">{error}</div> : null}
        {unread ? <button type="button" className="sccIconBtn" onClick={() => onRead()}><CheckCheck size={14} />Mark all read</button> : null}
        {items.length === 0 ? <div className="sccEmpty">No alerts yet.</div> : <div className="sccBellList">
          {items.map((n) => <button key={n.id} type="button" className={`sccBellItem ${n.severity} ${n.read_at ? 'read' : ''}`}
            onClick={() => { onRead([n.id]); onOpen(n); setOpen(false) }}>
            <b>{n.title}</b>
            {n.body ? <small>{n.body}</small> : null}
            <small>{ago(n.created_at)}</small>
          </button>)}
        </div>}
      </> : <AlertSettings />}
    </div> : null}
  </div>
}

function AlertSettings() {
  const [push, setPush] = useState<PushState>('off')
  const [devices, setDevices] = useState(0)
  const [contact, setContact] = useState<MyContact>({ phone: null, allow_sms: true, allow_whatsapp: true, allow_voice: true })
  const [phone, setPhone] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [installable, setInstallable] = useState(canPromptInstall())

  const refresh = useCallback(async () => {
    setPush(await currentPushState())
    try { setDevices((await myPushDevices()).length) } catch { /* not fatal */ }
  }, [])
  useEffect(() => {
    void refresh()
    void loadMyContact().then((c) => { setContact(c); setPhone(c.phone || '') }).catch(() => undefined)
    return onInstallChange(() => setInstallable(canPromptInstall()))
  }, [refresh])

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true); setNotice('')
    try { const m = await work(); if (m) setNotice(m) } catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false); void refresh() }
  }
  const test = (channel: AlertChannel) => run(async () => { await sendTestAlert(channel); return 'Test sent. It should arrive within a few seconds.' })

  return <div className="sccPad" style={{ display: 'grid', gap: 12 }}>
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

    <section className="sccLoc">
      <b><Smartphone size={15} /> This device</b>
      <span>{PUSH_TEXT[push]}{push === 'on' && devices > 1 ? ` (${devices} devices registered)` : ''}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {push === 'off' ? <button type="button" disabled={busy} onClick={() => run(async () => { await enablePush(); return 'Alerts are on for this device.' })}><Bell size={14} />Turn on alerts here</button> : null}
        {push === 'on' ? <button type="button" disabled={busy} onClick={() => run(async () => { await disablePush(); return 'Alerts are off for this device.' })}><BellOff size={14} />Turn off here</button> : null}
        {push === 'on' ? <button type="button" disabled={busy} onClick={() => void test('push')}>Send me a test</button> : null}
        {installable ? <button type="button" disabled={busy} onClick={() => run(async () => { await promptInstall() })}><Download size={14} />Install the app</button> : null}
      </div>
      {isIos() && !isStandalone() ? <small>Tip: on iPhone, Share, then Add to Home Screen. Open the workspace from the new icon, then turn alerts on.</small> : null}
    </section>

    <section className="sccLoc">
      <b>My phone</b>
      <span>Used for text, WhatsApp and phone-call alerts when an emergency needs you and the screen is not enough. Only supervisors can see it.</span>
      <label className="sccField"><span>Mobile number (international form)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 801 234 5678" inputMode="tel" autoComplete="tel" /></label>
      {(['sms', 'whatsapp', 'voice'] as const).map((k) => {
        const field = (k === 'sms' ? 'allow_sms' : k === 'whatsapp' ? 'allow_whatsapp' : 'allow_voice') as keyof MyContact
        return <label key={k} className="sccCheck"><input type="checkbox" checked={Boolean(contact[field])} onChange={(e) => setContact({ ...contact, [field]: e.target.checked })} /><span>{k === 'sms' ? 'Text messages' : k === 'whatsapp' ? 'WhatsApp' : 'Phone calls'}</span></label>
      })}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => run(async () => { await saveMyContact({ phone, sms: contact.allow_sms, whatsapp: contact.allow_whatsapp, voice: contact.allow_voice }); return 'Saved.' })}>Save</button>
        {(['sms', 'whatsapp', 'voice'] as const).map((k) => <button key={k} type="button" disabled={busy || !contact.phone} onClick={() => void test(k)}>Test {k === 'sms' ? 'text' : k === 'whatsapp' ? 'WhatsApp' : 'call'}</button>)}
      </div>
      {!contact.phone ? <small>Save your number first, then the test buttons unlock.</small> : null}
    </section>
  </div>
}
