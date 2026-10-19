import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Lock, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import '../chat/vault/vault.css'
import KeySheet from '../chat/vault/KeySheet'
import type { SheetKey } from '../chat/vault/KeySheet'
import { callVault, listAdminItems, listAudit, loadVaultSettings, saveVaultSettings } from '../chat/vault/vaultApi'
import type { AdminItem, AuditRow, VaultSettings } from '../chat/vault/vaultApi'
import { VIEW_CHOICES, viewLabel } from '../chat/vault/vaultFormat'

const EVENT_WORDS: Record<string, string> = {
  created: 'Sent as confidential',
  requested: 'Key or access requested',
  key_failed: 'Wrong key tried',
  locked_out: 'Locked after too many wrong keys',
  opened: 'Opened with the key',
  admin_unblocked: 'Unblocked by an administrator',
  destroyed: 'Deleted',
  settings_changed: 'Settings changed'
}

const STATUS_WORDS: Record<string, string> = {
  sealed: 'Locked, waiting for the key',
  spent: 'Viewed, locked again',
  locked: 'Locked after wrong keys',
  destroyed: 'Deleted'
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

/*
 * Administration > Confidential. Administrators never see the content here.
 * They see which messages are locked, who asked for access, and they can issue
 * a new one-time key (the only way a viewed or locked message opens again),
 * delete a message for good, and read the full trail of what happened.
 */
export default function AdminConfidential() {
  const [items, setItems] = useState<AdminItem[]>([])
  const [settings, setSettings] = useState<VaultSettings>({ max_view_seconds: 900, max_attempts: 5 })
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [onlyAttention, setOnlyAttention] = useState(true)
  const [openAudit, setOpenAudit] = useState('')
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [keySheet, setKeySheet] = useState<{ title: string; keys: SheetKey[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [list, found] = await Promise.all([listAdminItems(), loadVaultSettings()])
    setItems(list.rows)
    setNotice(list.error)
    if (found) setSettings(found)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const showAudit = async (itemId: string) => {
    if (openAudit === itemId) { setOpenAudit(''); return }
    setOpenAudit(itemId)
    setAudit(await listAudit(itemId))
  }

  const unblock = async (item: AdminItem) => {
    setBusy(item.item_id)
    const result = await callVault<{ key: string }>('unblock', { item_id: item.item_id })
    setBusy('')
    if (!result.ok) { setNotice(result.error); return }
    setNotice('')
    setKeySheet({ title: 'New one-time key', keys: [{ label: item.conversation_title, key: result.key }] })
    void load()
  }

  const destroy = async (item: AdminItem) => {
    if (!window.confirm('Delete this confidential message for everyone? This cannot be undone.')) return
    setBusy(item.item_id)
    const result = await callVault('destroy', { item_id: item.item_id })
    setBusy('')
    if (!result.ok) { setNotice(result.error); return }
    void load()
  }

  const save = async () => {
    setBusy('settings')
    const failure = await saveVaultSettings(settings)
    setBusy('')
    setNotice(failure || 'Saved.')
  }

  const shown = useMemo(
    () => items.filter(item => !onlyAttention || item.status === 'locked' || item.status === 'spent' || item.open_requests > 0),
    [items, onlyAttention]
  )

  return (
    <section className="acPanel" aria-label="Confidential messages">
      <div className="acCard">
        <h3><ShieldCheck size={16} /> Confidential messages</h3>
        <p>
          Locked messages and documents people send in Chat. You never see what is inside. A message that was viewed or locked
          opens again only when you issue a new one-time key.
        </p>
        <div className="acForm">
          <label>
            Longest view time anyone can choose
            <select value={settings.max_view_seconds} onChange={event => setSettings({ ...settings, max_view_seconds: Number(event.target.value) })}>
              {VIEW_CHOICES.map(seconds => <option key={seconds} value={seconds}>{viewLabel(seconds)}</option>)}
            </select>
          </label>
          <label>
            Wrong keys before it locks
            <select value={settings.max_attempts} onChange={event => setSettings({ ...settings, max_attempts: Number(event.target.value) })}>
              {[3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={busy === 'settings'} onClick={() => void save()}>Save</button>
        </div>
      </div>

      {notice && <div className="acNotice" role="status">{notice}</div>}

      <div className="acCard">
        <div className="acForm" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}><Lock size={16} /> Messages</h3>
          <span className="acActions">
            <button type="button" onClick={() => setOnlyAttention(value => !value)}>{onlyAttention ? 'Show all' : 'Needs attention only'}</button>
            <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          </span>
        </div>
        {loading && <p>Loading...</p>}
        {!loading && !shown.length && <p>{onlyAttention ? 'Nothing needs attention.' : 'No confidential messages yet.'}</p>}
        {shown.map(item => (
          <div key={item.item_id}>
            <div className="acRow">
              <div>
                <strong>{item.conversation_title}</strong>{' '}
                <span className={`acStatus ${item.status}`}>{STATUS_WORDS[item.status] || item.status}</span>
                <div className="acMeta">
                  <span>{item.kind === 'file' ? 'Document' : 'Message'} from {item.sender_name || 'unknown'}</span>
                  <span>Sent {when(item.created_at)}</span>
                  <span>View time {viewLabel(item.view_seconds)}</span>
                  {item.participants && <span>In chat: {item.participants}</span>}
                  {item.opened_by_name && <span>Opened by {item.opened_by_name} {when(item.opened_at)}</span>}
                  {item.failed_attempts > 0 && <span>{item.failed_attempts} wrong keys</span>}
                  {item.unblock_count > 0 && <span>Unblocked {item.unblock_count}x</span>}
                  {item.open_requests > 0 && <strong>{item.open_requests} waiting for access</strong>}
                </div>
              </div>
              <div className="acActions">
                {item.status !== 'destroyed' && (
                  <button type="button" className="primary" disabled={busy === item.item_id} onClick={() => void unblock(item)}>
                    <KeyRound size={14} /> {item.status === 'sealed' ? 'New key' : 'Unblock'}
                  </button>
                )}
                <button type="button" onClick={() => void showAudit(item.item_id)}>{openAudit === item.item_id ? 'Hide history' : 'History'}</button>
                {item.status !== 'destroyed' && (
                  <button type="button" disabled={busy === item.item_id} onClick={() => void destroy(item)}><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>
            {openAudit === item.item_id && (
              <div className="acAudit">
                {audit.length === 0 && <span>No history yet.</span>}
                {audit.map(row => (
                  <div key={row.id}>
                    {when(row.created_at)} {EVENT_WORDS[row.event] || row.event}{row.actor_name ? `, ${row.actor_name}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {keySheet && <KeySheet title={keySheet.title} keys={keySheet.keys} onDone={() => setKeySheet(null)} />}
    </section>
  )
}
