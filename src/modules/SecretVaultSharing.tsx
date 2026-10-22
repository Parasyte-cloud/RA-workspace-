import { useCallback, useEffect, useMemo, useState } from 'react'
import { Send, Share2, UserCheck, X } from 'lucide-react'
import type { VaultItem } from '../lib/secretVault'
import {
  closeRequest,
  currentUserId,
  grantAccess,
  listItemShares,
  listMyShares,
  listPeople,
  listRequests,
  requestAccess,
  revokeAccess,
  shareMinutes,
  type MyShare,
  type ShareUnit,
  type VaultPerson,
  type VaultRequest,
  type VaultShare,
} from '../lib/secretVaultSharing'

const when = (v: string | null) =>
  v ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : 'no end'

function TimePicker({ amount, unit, setAmount, setUnit }: { amount: number; unit: ShareUnit; setAmount: (n: number) => void; setUnit: (u: ShareUnit) => void }) {
  return (
    <span className="vaultShareTime">
      <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="How long" />
      <select value={unit} onChange={(e) => setUnit(e.target.value as ShareUnit)} aria-label="Unit">
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </span>
  )
}

// Share items you own, ask for things you need, answer requests, and take
// shares back. Every rule of the vault still applies to a share (purpose on
// each reveal, capped viewing window, one use per token, audit log); this only
// decides WHO may start a reveal and UNTIL WHEN. Admins see everything.
export default function SecretVaultSharing({ items, onChanged }: { items: VaultItem[]; onChanged: () => void }) {
  const [me, setMe] = useState('')
  const [people, setPeople] = useState<VaultPerson[]>([])
  const [requests, setRequests] = useState<VaultRequest[]>([])
  const [mine, setMine] = useState<MyShare[]>([])
  const [shares, setShares] = useState<Record<string, VaultShare[]>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [askOwner, setAskOwner] = useState('')
  const [askNote, setAskNote] = useState('')

  const [shareItem, setShareItem] = useState('')
  const [sharePerson, setSharePerson] = useState('')
  const [amount, setAmount] = useState(1)
  const [unit, setUnit] = useState<ShareUnit>('hours')

  const [approveItem, setApproveItem] = useState<Record<string, string>>({})

  const owned = useMemo(() => items.filter((i) => i.owner_id === me), [items, me])
  const nameOf = useCallback((id: string) => people.find((p) => p.id === id)?.full_name || people.find((p) => p.id === id)?.email || 'Someone', [people])
  const labelOf = useCallback((id: string | null) => items.find((i) => i.id === id)?.label || 'a protected item', [items])

  const refresh = useCallback(async () => {
    try {
      const [uid, ppl, reqs, my] = await Promise.all([currentUserId(), listPeople(), listRequests(), listMyShares()])
      setMe(uid)
      setPeople(ppl)
      setRequests(reqs)
      setMine(my)
      const own = items.filter((i) => i.owner_id === uid)
      const entries = await Promise.all(own.map(async (i) => [i.id, await listItemShares(i.id)] as const))
      setShares(Object.fromEntries(entries))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not load sharing')
    }
  }, [items])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNotice('')
    try {
      await fn()
      setNotice(done)
      await refresh()
      onChanged()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  const minutesOrNotice = () => {
    const m = shareMinutes(amount, unit)
    if (!m) setNotice('Choose between 5 minutes and 7 days.')
    return m
  }

  const incoming = requests.filter((r) => r.owner_id === me && r.status === 'pending')
  const outgoing = requests.filter((r) => r.requester_id === me && r.status === 'pending')
  const others = people.filter((p) => p.id !== me)

  return (
    <section className="vaultSharing" aria-label="Vault sharing and requests">
      <div className="vaultSharingHead">
        <Share2 size={18} />
        <div>
          <strong>Share and request</strong>
          <span>Give someone timed access to an item you own, or ask for something you need. Every reveal is still audited. Admins can see all.</span>
        </div>
      </div>
      {notice && <p className="vaultSharingNotice" role="status">{notice}</p>}

      <div className="vaultSharingGrid">
        <div className="vaultSharingBox">
          <h4>Share an item you own</h4>
          <select value={shareItem} onChange={(e) => setShareItem(e.target.value)} aria-label="Item to share">
            <option value="">Choose item</option>
            {owned.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
          <select value={sharePerson} onChange={(e) => setSharePerson(e.target.value)} aria-label="Share with">
            <option value="">Share with</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </select>
          <label>Access ends after <TimePicker amount={amount} unit={unit} setAmount={setAmount} setUnit={setUnit} /></label>
          <button type="button" disabled={busy || !shareItem || !sharePerson} onClick={() => { const m = minutesOrNotice(); if (m) void run(() => grantAccess(shareItem, sharePerson, m), 'Shared. You can take it back any time.') }}>
            <UserCheck size={15} /> Share
          </button>
        </div>

        <div className="vaultSharingBox">
          <h4>Ask someone for access</h4>
          <select value={askOwner} onChange={(e) => setAskOwner(e.target.value)} aria-label="Ask who">
            <option value="">Ask who</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </select>
          <textarea value={askNote} maxLength={240} onChange={(e) => setAskNote(e.target.value)} placeholder="What you need and why" aria-label="What you need" />
          <button type="button" disabled={busy || !askOwner || askNote.trim().length < 3} onClick={() => void run(async () => { await requestAccess(askOwner, askNote.trim()); setAskNote('') }, 'Request sent.')}>
            <Send size={15} /> Send request
          </button>
        </div>
      </div>

      {incoming.length > 0 && (
        <div className="vaultSharingList">
          <h4>Requests for you</h4>
          {incoming.map((r) => (
            <div className="vaultSharingRow" key={r.id}>
              <div><strong>{nameOf(r.requester_id)}</strong><span>{r.note}</span><small>{when(r.created_at)}</small></div>
              <select value={approveItem[r.id] || ''} onChange={(e) => setApproveItem({ ...approveItem, [r.id]: e.target.value })} aria-label="Item to give">
                <option value="">Item to give</option>
                {owned.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
              <TimePicker amount={amount} unit={unit} setAmount={setAmount} setUnit={setUnit} />
              <button type="button" disabled={busy || !approveItem[r.id]} onClick={() => { const m = minutesOrNotice(); if (m) void run(() => grantAccess(approveItem[r.id], r.requester_id, m, r.id), 'Approved.') }}>Approve</button>
              <button type="button" disabled={busy} onClick={() => void run(() => closeRequest(r.id, 'declined'), 'Declined.')}>Decline</button>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="vaultSharingList">
          <h4>Your open requests</h4>
          {outgoing.map((r) => (
            <div className="vaultSharingRow" key={r.id}>
              <div><strong>{nameOf(r.owner_id)}</strong><span>{r.note}</span><small>{when(r.created_at)}</small></div>
              <button type="button" disabled={busy} onClick={() => void run(() => closeRequest(r.id, 'cancelled'), 'Request withdrawn.')}><X size={14} /> Withdraw</button>
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div className="vaultSharingList">
          <h4>Shared with you</h4>
          {mine.map((s) => (
            <div className="vaultSharingRow" key={s.id}><div><strong>{labelOf(s.item_id)}</strong><small>Access ends {when(s.expires_at)}</small></div></div>
          ))}
        </div>
      )}

      {owned.some((i) => (shares[i.id] || []).length > 0) && (
        <div className="vaultSharingList">
          <h4>You are sharing</h4>
          {owned.flatMap((i) => (shares[i.id] || []).map((s) => (
            <div className="vaultSharingRow" key={s.acl_id}>
              <div><strong>{i.label}</strong><span>with {s.full_name || 'someone'}</span><small>ends {when(s.expires_at)}</small></div>
              <button type="button" disabled={busy} onClick={() => void run(() => revokeAccess(s.acl_id), 'Access taken back.')}>Take back</button>
            </div>
          )))}
        </div>
      )}
    </section>
  )
}
