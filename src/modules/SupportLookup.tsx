import { useState } from 'react'
import { Search, ShieldCheck } from 'lucide-react'
import { label, lookupIdentity, type IdentityResult } from '../lib/supportCommandCentre'

// Find the right rider or driver by their RideArrivo identity code. Exact match
// only, rate limited, and every successful lookup is logged. The result is what
// your role may see; it never includes a location.
export default function SupportLookup({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<IdentityResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await lookupIdentity(code, reason)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Lookup failed.') }
    finally { setBusy(false) }
  }

  return <section className="sccPanel sccLookup" aria-label="Rider and driver lookup">
    <div className="sccPanelTitle"><Search size={17} /><strong>Rider and driver lookup</strong></div>
    <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); if (code.trim()) void run() }}>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RAR-XXXXX-XXXXX (rider) or RAD-XXXXX-XXXXX (driver)" maxLength={20} aria-label="Identity code" autoComplete="off" spellCheck={false} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why you are looking this person up (optional)" maxLength={200} aria-label="Reason" />
      <button type="submit" disabled={busy || !code.trim()}>Look up</button>
    </form>
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    {result?.status === 'not_found' ? <div className="sccEmpty">No match. Check the code with the caller. Repeated misses are limited and logged.</div> : null}
    {result?.status === 'rate_limited' ? <div className="sccNotice" role="alert">Too many lookups in a short time. Wait a few minutes. A supervisor can see this was blocked.</div> : null}
    {result?.status === 'found' ? <div className="sccLookupCard">
      <div><span className={`sccPriority ${result.subject_type === 'driver' ? 'p2' : ''}`}>{result.subject_type === 'driver' ? 'DRIVER' : 'RIDER'}</span> <b>{result.code}</b></div>
      <strong>{result.display_name || 'No name on file'}</strong>
      <span>{result.phone || 'No phone on file'}{result.email ? ` · ${result.email}` : ''}</span>
      <small className="sccMuted"><ShieldCheck size={12} /> {result.full_details ? 'Full contact details shown because you are handling an open case for them, or you are a supervisor.' : 'Contact details are partly hidden. They show in full once you are handling an open case for this person.'}</small>
      <h4>Recent tickets</h4>
      {result.tickets?.length ? result.tickets.map((t) => <button type="button" key={t.id} className="sccQueue" onClick={() => onOpenTicket(t.id)}>
        <span><b>{t.public_id} · {t.subject}</b><small>{label(t.status)}</small></span><span className="sccQueueNumbers"><b>{t.priority}</b></span>
      </button>) : <div className="sccEmpty">No tickets yet.</div>}
    </div> : null}
  </section>
}
