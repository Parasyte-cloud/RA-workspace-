import { useCallback, useEffect, useState } from 'react'
import {
  APPROVAL_LABEL, complaintDetail, customerDuplicates, editCustomer, label, markCompensationPaid, naira, requestApproval, requestMerge, updateComplaint,
  type ComplaintDetail, type DuplicateCustomer, type SupportParty,
} from '../lib/supportCommandCentre'
import { RaiseComplaint } from './SupportComplaints'

// Complaint, money and customer-record controls shown inside the ticket drawer.
export default function SupportComplaintPanel({ ticketId, status, isSupervisor, customer, onChanged }: {
  ticketId: string; status: string; isSupervisor: boolean
  customer: { id: string | null; name: string | null; phone: string | null; email: string | null }
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<ComplaintDetail | null>(null)
  const [dups, setDups] = useState<DuplicateCustomer[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [raising, setRaising] = useState(false)
  const [rootCause, setRootCause] = useState('')
  const [resolution, setResolution] = useState('')
  const [moneyKind, setMoneyKind] = useState<'compensation' | 'refund'>('compensation')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [edit, setEdit] = useState({ name: '', phone: '', email: '', party: '' })
  const [editReason, setEditReason] = useState('')
  const [open, setOpen] = useState<'' | 'money' | 'customer' | 'ask'>('')

  const load = useCallback(async () => {
    try {
      const d = await complaintDetail(ticketId)
      setDetail(d); setRootCause(d?.complaint?.root_cause || ''); setResolution(d?.complaint?.resolution || '')
      if (d?.customer_id) setDups(await customerDuplicates(d.customer_id).catch(() => []))
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load complaint details') }
  }, [ticketId])
  useEffect(() => { void load() }, [load, status])

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setNotice('')
    try { await work(); await load(); onChanged(); setNotice(done) } catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work.') } finally { setBusy(false) }
  }

  const c = detail?.complaint || null
  const closed = status === 'resolved' || status === 'closed'
  const amountMinor = Math.round(Number(amount.replace(/,/g, '')) * 100)
  const pending = (detail?.approvals || []).filter((a) => a.status === 'pending')

  return <section className="sccComplaintPanel" aria-label="Complaint and customer record">
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}
    {pending.length ? <div className="sccApprovalNote">Waiting for approval: {pending.map((a) => `${APPROVAL_LABEL[a.action] || label(a.action)}${a.amount_minor ? ` ${naira(a.amount_minor)}` : ''} (${a.level})`).join(', ')}</div> : null}

    {!c ? (raising
      ? <RaiseComplaint ticketId={ticketId} defaults={{ name: customer.name || '', phone: customer.phone || '', email: customer.email || '' }} onCancel={() => setRaising(false)} onDone={() => { setRaising(false); void load(); onChanged(); setNotice('Recorded as a complaint.') }} />
      : <button type="button" onClick={() => setRaising(true)}>Record as a complaint</button>)
      : <div className="sccComplaintBox">
        <strong>Complaint · {label(c.party_type)} · {label(c.complaint_type)} · <span className={`sccSev ${c.severity}`}>{label(c.severity)}</span></strong>
        <small>{[c.ride_ref && `Ride ${c.ride_ref}`, c.booking_ref && `Booking ${c.booking_ref}`, c.against_name && `About ${c.against_name}`].filter(Boolean).join(' · ') || 'No ride or booking reference'}</small>
        {c.description ? <p>{c.description}</p> : null}
        <label>Root cause<textarea rows={2} value={rootCause} onChange={(e) => setRootCause(e.target.value)} maxLength={2000} /></label>
        <label>Resolution given to the customer<textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={2000} /></label>
        <button type="button" disabled={busy} onClick={() => void act(() => updateComplaint(ticketId, { rootCause, resolution }), 'Saved.')}>Save complaint notes</button>
        {c.compensation_status !== 'none' ? <small>Money: {naira(c.compensation_minor)} · {label(c.compensation_status)}</small> : null}
      </div>}

    <div className="sccFormActions">
      {detail?.critical && status === 'resolved' && !isSupervisor ? <button type="button" onClick={() => setOpen(open === 'ask' ? '' : 'ask')}>Ask a supervisor to close</button> : null}
      {closed && !isSupervisor ? <button type="button" onClick={() => setOpen(open === 'ask' ? '' : 'ask')}>Ask to reopen</button> : null}
      {c ? <button type="button" onClick={() => setOpen(open === 'money' ? '' : 'money')}>Compensation or refund</button> : null}
      {customer.id ? <button type="button" onClick={() => setOpen(open === 'customer' ? '' : 'customer')}>Customer record</button> : null}
    </div>

    {open === 'ask' ? <form className="sccNoteForm" onSubmit={(e) => { e.preventDefault(); void act(() => requestApproval({ action: closed ? 'reopen_ticket' : 'close_critical_ticket', ticketId, reason }).then(() => setReason('')), 'Sent for approval.') }}>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (a few words)" maxLength={1000} />
      <button type="submit" disabled={busy || reason.trim().length < 5}>Send request</button>
    </form> : null}

    {open === 'money' && c ? <form className="sccNoteForm" onSubmit={(e) => { e.preventDefault(); void act(() => requestApproval({ action: moneyKind, ticketId, amountMinor, reason }).then(() => { setAmount(''); setReason('') }), 'Sent to a manager for approval.') }}>
      <div className="sccFormGrid">
        <label>Type<select value={moneyKind} onChange={(e) => setMoneyKind(e.target.value as 'compensation' | 'refund')}><option value="compensation">Compensation</option><option value="refund">Refund</option></select></label>
        <label>Amount (₦)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the customer deserve this?" maxLength={1000} />
      <button type="submit" disabled={busy || !(amountMinor > 0) || reason.trim().length < 5}>Ask a manager to approve</button>
      {c.compensation_status === 'approved' ? <button type="button" disabled={busy} onClick={() => void act(() => markCompensationPaid(ticketId), 'Marked as paid.')}>Mark as paid (managers)</button> : null}
    </form> : null}

    {open === 'customer' && customer.id ? <div className="sccNoteForm">
      <small>{isSupervisor ? 'Your changes apply straight away and are logged.' : 'Changes are sent to a supervisor for approval.'}</small>
      <div className="sccFormGrid">
        <label>Name<input value={edit.name} placeholder={customer.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label>Phone<input value={edit.phone} placeholder={customer.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
        <label>Email<input value={edit.email} placeholder={customer.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
        <label>Type<select value={edit.party} onChange={(e) => setEdit({ ...edit, party: e.target.value })}><option value="">Unchanged</option>{(['rider', 'driver', 'other'] as SupportParty[]).map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
      </div>
      <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Reason for the change" maxLength={500} />
      <button type="button" disabled={busy || editReason.trim().length < 5} onClick={() => void act(async () => {
        const r = await editCustomer(customer.id as string, { displayName: edit.name, phone: edit.phone, email: edit.email, partyType: edit.party, reason: editReason })
        setEdit({ name: '', phone: '', email: '', party: '' }); setEditReason('')
        setNotice(r && (r as { applied?: boolean }).applied === false ? 'Sent to a supervisor for approval.' : 'Customer updated.')
      }, '')}>Save customer change</button>
      {dups.length ? <div className="sccRelated"><strong>Possible duplicates</strong>{dups.map((d) => <span key={d.id} className="sccInline">{d.name || d.primary_phone || d.primary_email} · {d.tickets} ticket{d.tickets === 1 ? '' : 's'}
        <button type="button" className="sccIconBtn" disabled={busy || editReason.trim().length < 5} title="Needs a reason above" onClick={() => void act(() => requestMerge(customer.id as string, d.id, editReason), 'Merge sent for approval. This record will be folded into the other one.')}>Merge into this</button></span>)}
        <small className="sccMuted">Merging folds the record you are viewing into the one listed. A supervisor approves it first.</small></div> : null}
    </div> : null}
  </section>
}
