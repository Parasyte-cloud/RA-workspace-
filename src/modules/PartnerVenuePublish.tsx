import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { publishPartnerVenue } from '../lib/ridearrivoPartnerVenues'

// Renders as one cell in the Partnerships "Partners" DataWorkbench table
// (see BusinessModules.tsx's PartnershipsModule). Lets whoever owns a
// partner relationship set or fix the exact "<name> x RideArrivo" display
// name once that partner has a signed agreement -- publishing calls the
// ridearrivo-partner-venues Edge Function, which re-checks the agreement
// itself and then writes straight into the same Arrivo admin API the
// Arrivo dashboard's own Partner Venues tab uses.
//
// The agreement check done here, client-side, is only ever a UI hint (so
// the button can be disabled with a clear reason before anyone fills out
// a form) -- the Edge Function is what actually enforces it.

const CATEGORY_OPTIONS = [
  { value: 'club', label: 'Club' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'other', label: 'Other' },
]

type AgreementCheck = 'checking' | 'agreed' | 'not_agreed' | 'unknown'

export function PartnerVenuePublishCell({
  partner,
}: {
  partner: Record<string, unknown>
}) {
  const partnerId = String(partner.id || '')
  const partnerName = String(partner.name || '')

  const [agreementState, setAgreementState] = useState<AgreementCheck>('checking')
  const [open, setOpen] = useState(false)
  const [publishedId, setPublishedId] = useState<number | null>(
    typeof partner.arrivo_venue_id === 'number' ? partner.arrivo_venue_id : null
  )
  const [syncedAt, setSyncedAt] = useState<string | null>(
    typeof partner.arrivo_venue_synced_at === 'string' ? partner.arrivo_venue_synced_at : null
  )
  const [form, setForm] = useState({
    name: partnerName,
    category: 'club',
    address: String(partner.city || ''),
    lat: '',
    lng: '',
    perkDescription: '',
  })
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkAgreement = useCallback(async () => {
    if (!supabase || !partnerName) {
      setAgreementState('unknown')
      return
    }

    setAgreementState('checking')

    const { data, error: lookupError } = await supabase
      .from('partner_agreements')
      .select('id')
      .ilike('partner_name', partnerName)
      .in('status', ['signed', 'active'])
      .limit(1)

    if (lookupError) {
      setAgreementState('unknown')
      return
    }

    setAgreementState(data && data.length > 0 ? 'agreed' : 'not_agreed')
  }, [partnerName])

  useEffect(() => {
    void checkAgreement()
  }, [checkAgreement])

  const publish = async () => {
    setPublishing(true)
    setError(null)

    try {
      const venue = await publishPartnerVenue({
        partnerId,
        partnerName,
        arrivoVenueId: publishedId,
        venue: {
          name: form.name.trim(),
          category: form.category,
          address: form.address.trim(),
          lat: form.lat,
          lng: form.lng,
          perkDescription: form.perkDescription.trim() || undefined,
        },
      })

      setPublishedId(venue.id)
      setSyncedAt(new Date().toISOString())
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish this venue.')
    } finally {
      setPublishing(false)
    }
  }

  if (agreementState === 'checking') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted, #8a8f98)', fontSize: 12 }}>
        <Loader2 size={12} /> Checking…
      </span>
    )
  }

  if (agreementState === 'not_agreed') {
    return (
      <span title="Publishing opens up once Legal/Partnerships marks an agreement as signed or active." style={{ color: 'var(--text-muted, #8a8f98)', fontSize: 12 }}>
        Needs a signed agreement
      </span>
    )
  }

  return (
    <div>
      {publishedId ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3ec28f', marginBottom: 4 }}>
          <CheckCircle2 size={13} />
          Live as "{form.name || partnerName} x RideArrivo"
          {syncedAt ? <span style={{ color: 'var(--text-muted, #8a8f98)' }}>· synced {new Date(syncedAt).toLocaleDateString()}</span> : null}
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          className="glassButton"
          onClick={() => setOpen(true)}
        >
          {publishedId ? 'Update RideArrivo listing' : 'Publish to RideArrivo'}
        </button>
      ) : (
        <div className="quickForm" style={{ minWidth: 220 }}>
          <div className="quickFormGrid">
            <label>
              Shows in the apps as
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Venue name"
              />
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #8a8f98)', marginTop: -4 }}>
              "{form.name || partnerName} x RideArrivo"
            </div>
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label>
              Address
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Pickup address"
              />
            </label>
            <label>
              Latitude
              <input
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                placeholder="6.4550"
              />
            </label>
            <label>
              Longitude
              <input
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                placeholder="3.3941"
              />
            </label>
            <label>
              Perk for riders
              <input
                value={form.perkDescription}
                onChange={(e) => setForm((f) => ({ ...f, perkDescription: e.target.value }))}
                placeholder="e.g. Skip the queue"
              />
            </label>
          </div>

          {error ? <div className="moduleError">{error}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="primaryButton"
              disabled={publishing || !form.name.trim() || !form.address.trim()}
              onClick={() => void publish()}
            >
              {publishing ? 'Publishing…' : 'Confirm & publish'}
            </button>
            <button
              type="button"
              className="glassButton"
              disabled={publishing}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

