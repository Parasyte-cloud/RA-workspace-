import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertCircle,
  Car,
  Headphones,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from 'lucide-react'
import {
  getRideArrivoSupportData,
  type SupportResource,
} from '../lib/ridearrivoSupport'

type Tab = {
  key: SupportResource
  label: string
}

type CachedSupportView = {
  records: any[]
  raw: any
  loadedAt: number
}

const tabs: Tab[] = [
  { key: 'tickets', label: 'Support Queue' },
  { key: 'rides', label: 'Bookings & Rides' },
  { key: 'onTheGo', label: 'On the Go' },
  { key: 'riders', label: 'Riders' },
  { key: 'drivers', label: 'Drivers' },
]

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value

  const candidates = [
    value?.data,
    value?.tickets,
    value?.rides,
    value?.riders,
    value?.drivers,
    value?.requests,
    value?.items,
    value?.results,
  ]

  for (const item of candidates) {
    if (Array.isArray(item)) return item
  }

  return []
}

function firstValue(row: any, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function titleFor(row: any, resource: SupportResource) {
  if (resource === 'tickets') {
    return (
      firstValue(row, ['subject', 'title']) ||
      `Support ticket #${firstValue(row, ['id']) ?? '—'}`
    )
  }

  if (resource === 'rides' || resource === 'liveRides') {
    return (
      firstValue(row, [
        'booking_reference',
        'reference',
        'ride_reference',
      ]) ||
      `Ride #${firstValue(row, ['id']) ?? '—'}`
    )
  }

  if (resource === 'riders' || resource === 'drivers') {
    return (
      firstValue(row, ['name', 'full_name', 'email']) ||
      `${resource === 'drivers' ? 'Driver' : 'Rider'} #${
        firstValue(row, ['id']) ?? '—'
      }`
    )
  }

  return (
    firstValue(row, ['reference', 'name', 'customer_name']) ||
    `Request #${firstValue(row, ['id']) ?? '—'}`
  )
}

function detailRows(row: any, resource: SupportResource) {
  if (resource === 'tickets') {
    return [
      ['Type', firstValue(row, ['type', 'category'])],
      ['Status', firstValue(row, ['status'])],
      ['Rider', firstValue(row, ['rider_name', 'user_name', 'name'])],
      ['Email', firstValue(row, ['rider_email', 'email'])],
      ['Phone', firstValue(row, ['rider_phone', 'phone'])],
      ['Booking', firstValue(row, ['booking_reference', 'ride_id'])],
    ]
  }

  if (resource === 'rides' || resource === 'liveRides') {
    return [
      ['Status', firstValue(row, ['status', 'ride_status'])],
      ['Rider', firstValue(row, ['rider_name', 'customer_name', 'name'])],
      ['Driver', firstValue(row, ['driver_name'])],
      ['Pickup', firstValue(row, ['pickup_address', 'pickup', 'origin'])],
      ['Destination', firstValue(row, ['dropoff_address', 'destination', 'dropoff'])],
      ['Payment', firstValue(row, ['payment_status', 'paid'])],
    ]
  }

  if (resource === 'riders') {
    return [
      ['Email', firstValue(row, ['email'])],
      ['Phone', firstValue(row, ['phone'])],
      ['WhatsApp', firstValue(row, ['whatsapp_number', 'whatsapp'])],
      ['Status', firstValue(row, ['status', 'verification_status'])],
    ]
  }

  if (resource === 'drivers') {
    return [
      ['Email', firstValue(row, ['email'])],
      ['Phone', firstValue(row, ['phone'])],
      ['Status', firstValue(row, ['status'])],
      ['Verified', firstValue(row, ['verified', 'is_verified'])],
      ['Vehicle', firstValue(row, ['vehicle', 'vehicle_name', 'vehicle_model'])],
    ]
  }

  return [
    ['Status', firstValue(row, ['status'])],
    ['Rider', firstValue(row, ['rider_name', 'customer_name', 'name'])],
    ['Phone', firstValue(row, ['phone'])],
    ['Pickup', firstValue(row, ['pickup', 'pickup_address'])],
    ['Destination', firstValue(row, ['destination', 'dropoff_address'])],
  ]
}

export default function SupportOperationsPanel() {
  const [active, setActive] = useState<SupportResource>('tickets')
  const [records, setRecords] = useState<any[]>([])
  const [raw, setRaw] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)

  const cacheRef = useRef(
    new Map<SupportResource, CachedSupportView>()
  )
  const requestSequenceRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestSequenceRef.current += 1
    }
  }, [])

  const load = useCallback(async (
    resource: SupportResource,
    options: { force?: boolean } = {}
  ) => {
    const requestSequence = ++requestSequenceRef.current
    const cached = cacheRef.current.get(resource)

    if (cached && !options.force) {
      setRecords(cached.records)
      setRaw(cached.raw)
      setLastUpdatedAt(cached.loadedAt)
    }

    const hasVisibleData = Boolean(cached)
    if (hasVisibleData) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setError('')

    try {
      const result = await getRideArrivoSupportData(resource)

      if (
        !mountedRef.current ||
        requestSequence !== requestSequenceRef.current
      ) {
        return
      }

      const next: CachedSupportView = {
        records: asArray(result),
        raw: result,
        loadedAt: Date.now(),
      }

      cacheRef.current.set(resource, next)
      setRaw(next.raw)
      setRecords(next.records)
      setLastUpdatedAt(next.loadedAt)
    } catch (err) {
      if (
        !mountedRef.current ||
        requestSequence !== requestSequenceRef.current
      ) {
        return
      }

      // Keep the last known-good snapshot visible. A temporary upstream
      // failure must not blank the Support Station and create a flash.
      const fallback = cacheRef.current.get(resource)
      if (fallback) {
        setRaw(fallback.raw)
        setRecords(fallback.records)
        setLastUpdatedAt(fallback.loadedAt)
      }

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load Support Operations.'
      )
    } finally {
      if (
        mountedRef.current &&
        requestSequence === requestSequenceRef.current
      ) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    const cached = cacheRef.current.get(active)
    if (cached) {
      setRecords(cached.records)
      setRaw(cached.raw)
      setLastUpdatedAt(cached.loadedAt)
    } else {
      setRecords([])
      setRaw(null)
      setLastUpdatedAt(null)
    }

    void load(active)
  }, [active, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records

    return records.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(q)
    )
  }, [records, query])

  const initialLoading = loading && records.length === 0 && !raw
  const hasData = filtered.length > 0

  return (
    <div className="supportOps" aria-busy={initialLoading || refreshing}>
      <div className="supportOpsHeader glassCard">
        <div>
          <span className="eyebrow">LIVE OPERATIONS</span>
          <h3>RideArrivo Support Operations</h3>
          <p>
            Read-only access to customer support, bookings, riders and drivers
            from the RideArrivo operational backend.
          </p>
        </div>

        <div className="supportOpsRefreshBlock">
          {lastUpdatedAt && (
            <small>
              Updated {new Date(lastUpdatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          )}
          <button
            className="glassButton"
            type="button"
            onClick={() => void load(active, { force: true })}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? 'supportRefreshSpin' : undefined}
            />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="supportMetrics">
        <div className="glassCard supportMetric">
          <Headphones size={18} />
          <span>Current view</span>
          <strong>{records.length}</strong>
        </div>

        <div className="glassCard supportMetric">
          <Car size={18} />
          <span>Access</span>
          <strong>Read only</strong>
        </div>

        <div className="glassCard supportMetric">
          <Users size={18} />
          <span>Source</span>
          <strong>{error ? 'Last known good' : 'Live backend'}</strong>
        </div>
      </div>

      <div className="supportOpsToolbar glassCard">
        <div className="supportTabs" role="tablist" aria-label="Support views">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              className={active === tab.key ? 'supportTab active' : 'supportTab'}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="supportSearch">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reference, rider, phone, driver..."
          />
        </label>
      </div>

      {error && (
        <div className="glassCard supportOpsError" role="status">
          <AlertCircle size={18} />
          <div>
            <strong>
              {records.length
                ? 'Live refresh failed — showing the last successful snapshot'
                : 'Unable to load live Support data'}
            </strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {initialLoading && (
        <div className="glassCard supportOpsState" role="status">
          Loading RideArrivo operations…
        </div>
      )}

      {!initialLoading && !hasData && (
        <div className="glassCard supportOpsState">
          <UserRound size={22} />
          <strong>No records found</strong>
          <span>
            {records.length === 0
              ? error
                ? 'No cached records are available for this view yet.'
                : 'The backend returned no records for this view.'
              : 'Try another search.'}
          </span>

          {records.length === 0 && raw && !error && (
            <small>Connection succeeded.</small>
          )}
        </div>
      )}

      {!initialLoading && hasData && (
        <div className="supportOpsList">
          {filtered.map((row, index) => (
            <article
              className="glassCard supportRecord"
              key={`${active}:${String(
                row?.id ?? row?.reference ?? row?.booking_reference ?? index
              )}`}
            >
              <div className="supportRecordHeader">
                <div>
                  <span className="eyebrow">
                    {active === 'tickets'
                      ? 'SUPPORT'
                      : active === 'rides'
                        ? 'BOOKING'
                        : active.toUpperCase()}
                  </span>
                  <h4>{titleFor(row, active)}</h4>
                </div>

                {firstValue(row, ['status']) && (
                  <span className="supportStatus">
                    {String(firstValue(row, ['status']))}
                  </span>
                )}
              </div>

              <div className="supportRecordGrid">
                {detailRows(row, active)
                  .filter(([, value]) => value !== null)
                  .map(([label, value]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <strong>
                        {typeof value === 'boolean'
                          ? value
                            ? 'Yes'
                            : 'No'
                          : String(value)}
                      </strong>
                    </div>
                  ))}
              </div>

              {active === 'tickets' &&
                firstValue(row, ['description', 'message']) && (
                  <p className="supportRecordMessage">
                    {String(firstValue(row, ['description', 'message']))}
                  </p>
                )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
