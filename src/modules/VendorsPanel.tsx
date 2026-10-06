import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  MessageSquarePlus,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'

import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  ITEM_KIND_LABELS,
  ITEM_STATUS_LABELS,
  VENDOR_STATUS_LABELS,
  addContact,
  addItem,
  formatDateTime,
  formatDay,
  formatMoney,
  isFollowUpDue,
  isItemOpen,
  isItemOverdue,
  loadAttentionItems,
  loadOpenItemCounts,
  loadStaff,
  loadVendorDetail,
  loadVendors,
  logCommunication,
  removeContact,
  saveVendor,
  setFollowUpDone,
  updateItemStatus,
  vendorErrorMessage,
} from '../lib/vendors'
import type {
  CommChannel,
  CommDirection,
  ItemKind,
  ItemStatus,
  StaffMember,
  Vendor,
  VendorCategory,
  VendorCommunication,
  VendorContact,
  VendorInput,
  VendorItem,
  VendorStatus,
} from '../lib/vendors'

import '../vendors.css'

type Detail = {
  contacts: VendorContact[]
  communications: VendorCommunication[]
  items: VendorItem[]
}

type Tab = 'items' | 'communications' | 'contacts' | 'details'

const emptyVendor = (): VendorInput => ({
  name: '',
  category: 'other',
  status: 'active',
  email: '',
  phone: '',
  website: '',
  address: '',
  payment_terms: '',
  contract_start: '',
  contract_end: '',
  document_notes: '',
  notes: '',
  owner_id: '',
})

const toInput = (vendor: Vendor): VendorInput => ({
  name: vendor.name,
  category: vendor.category,
  status: vendor.status,
  email: vendor.email ?? '',
  phone: vendor.phone ?? '',
  website: vendor.website ?? '',
  address: vendor.address ?? '',
  payment_terms: vendor.payment_terms ?? '',
  contract_start: vendor.contract_start ?? '',
  contract_end: vendor.contract_end ?? '',
  document_notes: vendor.document_notes ?? '',
  notes: vendor.notes ?? '',
  owner_id: vendor.owner_id ?? '',
})

const categoryKeys = Object.keys(CATEGORY_LABELS) as VendorCategory[]
const vendorStatusKeys = Object.keys(VENDOR_STATUS_LABELS) as VendorStatus[]
const itemKindKeys = Object.keys(ITEM_KIND_LABELS) as ItemKind[]
const itemStatusKeys = Object.keys(ITEM_STATUS_LABELS) as ItemStatus[]
const channelKeys = Object.keys(CHANNEL_LABELS) as CommChannel[]

export default function VendorsPanel() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({})
  const [attention, setAttention] = useState<{
    items: VendorItem[]
    followUps: VendorCommunication[]
  }>({ items: [], followUps: [] })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [tab, setTab] = useState<Tab>('items')
  const [creating, setCreating] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | VendorStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | VendorCategory>('all')

  const staffName = useMemo(() => {
    const map = new Map<string, string>()
    staff.forEach((person) => map.set(person.id, person.full_name))
    return (id: string | null) => (id ? map.get(id) || 'Former employee' : 'Unassigned')
  }, [staff])

  const vendorName = useMemo(() => {
    const map = new Map<string, string>()
    vendors.forEach((vendor) => map.set(vendor.id, vendor.name))
    return (id: string) => map.get(id) || 'Unknown vendor'
  }, [vendors])

  const selected = vendors.find((vendor) => vendor.id === selectedId) || null

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [vendorRows, counts, attentionRows] = await Promise.all([
        loadVendors(),
        loadOpenItemCounts(),
        loadAttentionItems(),
      ])
      setVendors(vendorRows)
      setOpenCounts(counts)
      setAttention(attentionRows)
    } catch (caught) {
      setError(vendorErrorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshDetail = useCallback(async (id: string) => {
    try {
      setDetail(await loadVendorDetail(id))
    } catch (caught) {
      setError(vendorErrorMessage(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    loadStaff()
      .then(setStaff)
      .catch(() => setStaff([]))
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setDetail(null)
    void refreshDetail(selectedId)
  }, [selectedId, refreshDetail])

  async function afterChange() {
    await refresh()
    if (selectedId) await refreshDetail(selectedId)
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return vendors.filter((vendor) => {
      if (statusFilter !== 'all' && vendor.status !== statusFilter) return false
      if (categoryFilter !== 'all' && vendor.category !== categoryFilter) return false
      if (!needle) return true
      return [vendor.name, vendor.email, vendor.phone, CATEGORY_LABELS[vendor.category]]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [vendors, search, statusFilter, categoryFilter])

  const totalOpen = Object.values(openCounts).reduce((sum, n) => sum + n, 0)
  const activeCount = vendors.filter((vendor) => vendor.status === 'active').length
  const attentionCount = attention.items.length + attention.followUps.length

  return (
    <div className="vendorsPanel">
      <section className="glassCard vendorsHero">
        <div>
          <span className="eyebrow">VENDORS</span>
          <h3>Vendor Management</h3>
          <p>
            Every vendor in one place: who they are, what we have said to each
            other, and what we are waiting on. Visible to Operations, Finance
            and Admin.
          </p>
        </div>
        <div className="vendorsHeroActions">
          <button
            type="button"
            className="glassButton"
            onClick={() => {
              setLoading(true)
              void afterChange()
            }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
            }}
          >
            <Plus size={15} /> Add vendor
          </button>
        </div>
      </section>

      <div className="vendorsStats">
        <Stat icon={<Building2 size={18} />} label="Active vendors" value={activeCount} />
        <Stat icon={<PackageCheck size={18} />} label="Open items" value={totalOpen} />
        <Stat
          icon={<AlertTriangle size={18} />}
          label="Need attention"
          value={attentionCount}
          warn={attentionCount > 0}
        />
      </div>

      {error && (
        <div className="vendorsNotice vendorsError" role="alert">
          {error}
        </div>
      )}

      {attentionCount > 0 && (
        <section className="glassCard vendorsAttention">
          <h4>Needs attention</h4>
          <ul>
            {attention.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setSelectedId(item.vendor_id)
                    setTab('items')
                  }}
                >
                  <strong>{vendorName(item.vendor_id)}</strong>
                  <span>
                    {item.title} was due {formatDay(item.due_date)}
                  </span>
                </button>
              </li>
            ))}
            {attention.followUps.map((comm) => (
              <li key={comm.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setSelectedId(comm.vendor_id)
                    setTab('communications')
                  }}
                >
                  <strong>{vendorName(comm.vendor_id)}</strong>
                  <span>
                    Follow up on "{comm.subject}" was due {formatDay(comm.follow_up_date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="vendorsLayout">
        <aside className="glassCard vendorsList">
          <label className="vendorsSearch">
            <Search size={14} />
            <input
              type="search"
              placeholder="Search vendors"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search vendors"
            />
          </label>

          <div className="vendorsFilters">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | VendorStatus)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {vendorStatusKeys.map((key) => (
                <option key={key} value={key}>
                  {VENDOR_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as 'all' | VendorCategory)}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {categoryKeys.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="vendorsMuted">Loading vendors...</p>}

          {!loading && visible.length === 0 && (
            <p className="vendorsMuted">
              {vendors.length === 0
                ? 'No vendors yet. Use Add vendor to create the first one.'
                : 'No vendors match these filters.'}
            </p>
          )}

          <ul className="vendorsRows">
            {visible.map((vendor) => (
              <li key={vendor.id}>
                <button
                  type="button"
                  className={vendor.id === selectedId ? 'vendorRow active' : 'vendorRow'}
                  onClick={() => {
                    setCreating(false)
                    setSelectedId(vendor.id)
                    setTab('items')
                  }}
                >
                  <span className="vendorRowMain">
                    <strong>{vendor.name}</strong>
                    <small>{CATEGORY_LABELS[vendor.category]}</small>
                  </span>
                  <span className="vendorRowMeta">
                    <span className={`vendorPill ${vendor.status}`}>
                      {VENDOR_STATUS_LABELS[vendor.status]}
                    </span>
                    {openCounts[vendor.id] ? (
                      <small>{openCounts[vendor.id]} open</small>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="vendorsDetail">
          {creating && (
            <div className="glassCard vendorsCard">
              <h4>New vendor</h4>
              <VendorForm
                initial={emptyVendor()}
                staff={staff}
                submitLabel="Create vendor"
                onCancel={() => setCreating(false)}
                onSubmit={async (values) => {
                  const created = await saveVendor(values)
                  setCreating(false)
                  await refresh()
                  setSelectedId(created.id)
                  setTab('items')
                }}
              />
            </div>
          )}

          {!creating && !selected && (
            <div className="glassCard vendorsCard vendorsEmpty">
              <Building2 size={28} />
              <p>Select a vendor to see its items, conversations and contacts.</p>
            </div>
          )}

          {!creating && selected && (
            <div className="glassCard vendorsCard">
              <header className="vendorHeader">
                <div>
                  <h4>{selected.name}</h4>
                  <p className="vendorsMuted">
                    {CATEGORY_LABELS[selected.category]} · Owner: {staffName(selected.owner_id)}
                  </p>
                </div>
                <span className={`vendorPill ${selected.status}`}>
                  {VENDOR_STATUS_LABELS[selected.status]}
                </span>
              </header>

              <ContractNote vendor={selected} />

              <nav className="vendorTabs" aria-label="Vendor sections">
                {(
                  [
                    ['items', 'Items'],
                    ['communications', 'Conversations'],
                    ['contacts', 'Contacts'],
                    ['details', 'Details'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={tab === id ? 'active' : ''}
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              {!detail && <p className="vendorsMuted">Loading...</p>}

              {detail && tab === 'items' && (
                <ItemsTab
                  vendorId={selected.id}
                  items={detail.items}
                  staff={staff}
                  staffName={staffName}
                  onChanged={afterChange}
                />
              )}

              {detail && tab === 'communications' && (
                <CommunicationsTab
                  vendorId={selected.id}
                  communications={detail.communications}
                  staffName={staffName}
                  onChanged={afterChange}
                />
              )}

              {detail && tab === 'contacts' && (
                <ContactsTab
                  vendorId={selected.id}
                  contacts={detail.contacts}
                  onChanged={afterChange}
                />
              )}

              {detail && tab === 'details' && (
                <VendorForm
                  key={`${selected.id}-${selected.updated_at}`}
                  initial={toInput(selected)}
                  staff={staff}
                  submitLabel="Save changes"
                  onSubmit={async (values) => {
                    await saveVendor(values, selected.id)
                    await afterChange()
                  }}
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  warn,
}: {
  icon: ReactNode
  label: string
  value: number
  warn?: boolean
}) {
  return (
    <div className={warn ? 'glassCard vendorsStat warn' : 'glassCard vendorsStat'}>
      <span className="vendorsStatIcon">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function ContractNote({ vendor }: { vendor: Vendor }) {
  if (!vendor.contract_end) return null
  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  if (vendor.contract_end < today) {
    return (
      <div className="vendorsNotice vendorsError">
        Contract ended on {formatDay(vendor.contract_end)}.
      </div>
    )
  }
  if (vendor.contract_end <= soon) {
    return (
      <div className="vendorsNotice vendorsWarn">
        Contract ends on {formatDay(vendor.contract_end)}. Plan the renewal.
      </div>
    )
  }
  return null
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (caught) {
      setMessage(vendorErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return { busy, message, run, clear: () => setMessage('') }
}

function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={wide ? 'vendorField wide' : 'vendorField'}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function VendorForm({
  initial,
  staff,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: VendorInput
  staff: StaffMember[]
  submitLabel: string
  onSubmit: (values: VendorInput) => Promise<void>
  onCancel?: () => void
}) {
  const [values, setValues] = useState<VendorInput>(initial)
  const action = useAction()
  const set = <K extends keyof VendorInput>(key: K, value: VendorInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(() => onSubmit(values))
  }

  return (
    <form className="vendorForm" onSubmit={submit}>
      <Field label="Vendor name" wide>
        <input
          required
          minLength={2}
          maxLength={160}
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
        />
      </Field>
      <Field label="Category">
        <select
          value={values.category}
          onChange={(event) => set('category', event.target.value as VendorCategory)}
        >
          {categoryKeys.map((key) => (
            <option key={key} value={key}>
              {CATEGORY_LABELS[key]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select
          value={values.status}
          onChange={(event) => set('status', event.target.value as VendorStatus)}
        >
          {vendorStatusKeys.map((key) => (
            <option key={key} value={key}>
              {VENDOR_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Relationship owner">
        <select value={values.owner_id} onChange={(event) => set('owner_id', event.target.value)}>
          <option value="">Unassigned</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Email">
        <input
          type="email"
          maxLength={254}
          value={values.email}
          onChange={(event) => set('email', event.target.value)}
        />
      </Field>
      <Field label="Phone">
        <input
          maxLength={40}
          value={values.phone}
          onChange={(event) => set('phone', event.target.value)}
        />
      </Field>
      <Field label="Website">
        <input
          maxLength={300}
          value={values.website}
          onChange={(event) => set('website', event.target.value)}
        />
      </Field>
      <Field label="Address" wide>
        <input
          maxLength={400}
          value={values.address}
          onChange={(event) => set('address', event.target.value)}
        />
      </Field>
      <Field label="Payment terms">
        <input
          maxLength={200}
          placeholder="For example: 30 days from invoice"
          value={values.payment_terms}
          onChange={(event) => set('payment_terms', event.target.value)}
        />
      </Field>
      <Field label="Contract start">
        <input
          type="date"
          value={values.contract_start}
          onChange={(event) => set('contract_start', event.target.value)}
        />
      </Field>
      <Field label="Contract end">
        <input
          type="date"
          value={values.contract_end}
          onChange={(event) => set('contract_end', event.target.value)}
        />
      </Field>
      <Field label="Where the contract and documents are kept" wide>
        <input
          maxLength={2000}
          placeholder="For example: Company Files, Legal folder, Lagos Tyres"
          value={values.document_notes}
          onChange={(event) => set('document_notes', event.target.value)}
        />
      </Field>
      <Field label="Notes" wide>
        <textarea
          rows={3}
          maxLength={4000}
          value={values.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Field>

      {action.message && (
        <div className="vendorsNotice vendorsError wide" role="alert">
          {action.message}
        </div>
      )}

      <div className="vendorFormActions wide">
        <button type="submit" className="primaryButton" disabled={action.busy}>
          {action.busy ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="glassButton" onClick={onCancel} disabled={action.busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function ItemsTab({
  vendorId,
  items,
  staff,
  staffName,
  onChanged,
}: {
  vendorId: string
  items: VendorItem[]
  staff: StaffMember[]
  staffName: (id: string | null) => string
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const action = useAction()
  const [draft, setDraft] = useState({
    kind: 'order' as ItemKind,
    title: '',
    description: '',
    reference: '',
    amount: '',
    currency: 'NGN',
    status: 'requested' as ItemStatus,
    owner_id: '',
    due_date: '',
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(async () => {
      await addItem(vendorId, draft)
      setDraft({ ...draft, title: '', description: '', reference: '', amount: '', due_date: '' })
      setOpen(false)
      await onChanged()
    })
  }

  return (
    <div className="vendorTab">
      <div className="vendorTabBar">
        <h5>Items we are tracking</h5>
        <button type="button" className="glassButton" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> Add item
        </button>
      </div>

      {open && (
        <form className="vendorForm vendorInline" onSubmit={submit}>
          <Field label="Type">
            <select
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value as ItemKind })}
            >
              {itemKindKeys.map((key) => (
                <option key={key} value={key}>
                  {ITEM_KIND_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" wide>
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>
          <Field label="Reference">
            <input
              maxLength={80}
              placeholder="PO or invoice number"
              value={draft.reference}
              onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
            />
          </Field>
          <Field label="Amount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </Field>
          <Field label="Currency">
            <input
              maxLength={3}
              minLength={3}
              value={draft.currency}
              onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
            />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as ItemStatus })}
            >
              {itemStatusKeys.map((key) => (
                <option key={key} value={key}>
                  {ITEM_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={draft.due_date}
              onChange={(event) => setDraft({ ...draft, due_date: event.target.value })}
            />
          </Field>
          <Field label="Owner">
            <select
              value={draft.owner_id}
              onChange={(event) => setDraft({ ...draft, owner_id: event.target.value })}
            >
              <option value="">Unassigned</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Details" wide>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
          {action.message && (
            <div className="vendorsNotice vendorsError wide" role="alert">
              {action.message}
            </div>
          )}
          <div className="vendorFormActions wide">
            <button type="submit" className="primaryButton" disabled={action.busy}>
              {action.busy ? 'Saving...' : 'Save item'}
            </button>
          </div>
        </form>
      )}

      {items.length === 0 && <p className="vendorsMuted">No items yet for this vendor.</p>}

      <ul className="vendorItems">
        {items.map((item) => {
          const overdue = isItemOverdue(item)
          return (
            <li key={item.id} className={overdue ? 'vendorItem overdue' : 'vendorItem'}>
              <div className="vendorItemMain">
                <strong>{item.title}</strong>
                <small>
                  {ITEM_KIND_LABELS[item.kind]}
                  {item.reference ? ` · ${item.reference}` : ''}
                  {item.amount !== null ? ` · ${formatMoney(item.amount, item.currency)}` : ''}
                </small>
                {item.description && <p>{item.description}</p>}
                <small>
                  Owner: {staffName(item.owner_id)}
                  {item.due_date
                    ? ` · Due ${formatDay(item.due_date)}${overdue ? ' (overdue)' : ''}`
                    : ''}
                  {item.completed_at ? ` · Completed ${formatDay(item.completed_at)}` : ''}
                </small>
              </div>
              <select
                aria-label={`Status of ${item.title}`}
                value={item.status}
                onChange={(event) =>
                  void action.run(async () => {
                    await updateItemStatus(item.id, event.target.value as ItemStatus)
                    await onChanged()
                  })
                }
              >
                {itemStatusKeys.map((key) => (
                  <option key={key} value={key}>
                    {ITEM_STATUS_LABELS[key]}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
      {!open && action.message && (
        <div className="vendorsNotice vendorsError" role="alert">
          {action.message}
        </div>
      )}
      <p className="vendorsMuted vendorsHint">
        {items.filter((item) => isItemOpen(item.status)).length} open of {items.length}. Items
        stop counting as open once delivered, paid or cancelled.
      </p>
    </div>
  )
}

function CommunicationsTab({
  vendorId,
  communications,
  staffName,
  onChanged,
}: {
  vendorId: string
  communications: VendorCommunication[]
  staffName: (id: string | null) => string
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const action = useAction()
  const [draft, setDraft] = useState({
    channel: 'email' as CommChannel,
    direction: 'outbound' as CommDirection,
    subject: '',
    summary: '',
    follow_up_date: '',
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(async () => {
      await logCommunication(vendorId, draft)
      setDraft({ ...draft, subject: '', summary: '', follow_up_date: '' })
      setOpen(false)
      await onChanged()
    })
  }

  return (
    <div className="vendorTab">
      <div className="vendorTabBar">
        <h5>Conversation log</h5>
        <button type="button" className="glassButton" onClick={() => setOpen((v) => !v)}>
          <MessageSquarePlus size={14} /> Log conversation
        </button>
      </div>
      <p className="vendorsMuted vendorsHint">
        Send the message by email or WhatsApp as usual, then log it here so the whole team can see
        what was said.
      </p>

      {open && (
        <form className="vendorForm vendorInline" onSubmit={submit}>
          <Field label="How">
            <select
              value={draft.channel}
              onChange={(event) => setDraft({ ...draft, channel: event.target.value as CommChannel })}
            >
              {channelKeys.map((key) => (
                <option key={key} value={key}>
                  {CHANNEL_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Direction">
            <select
              value={draft.direction}
              onChange={(event) =>
                setDraft({ ...draft, direction: event.target.value as CommDirection })
              }
            >
              <option value="outbound">We contacted them</option>
              <option value="inbound">They contacted us</option>
            </select>
          </Field>
          <Field label="Subject" wide>
            <input
              required
              maxLength={200}
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
          </Field>
          <Field label="What was said or agreed" wide>
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.summary}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            />
          </Field>
          <Field label="Follow up by (optional)">
            <input
              type="date"
              value={draft.follow_up_date}
              onChange={(event) => setDraft({ ...draft, follow_up_date: event.target.value })}
            />
          </Field>
          {action.message && (
            <div className="vendorsNotice vendorsError wide" role="alert">
              {action.message}
            </div>
          )}
          <div className="vendorFormActions wide">
            <button type="submit" className="primaryButton" disabled={action.busy}>
              {action.busy ? 'Saving...' : 'Save to log'}
            </button>
          </div>
        </form>
      )}

      {communications.length === 0 && (
        <p className="vendorsMuted">Nothing logged yet for this vendor.</p>
      )}

      <ul className="vendorLog">
        {communications.map((comm) => {
          const due = isFollowUpDue(comm)
          return (
            <li key={comm.id} className={due ? 'vendorLogItem overdue' : 'vendorLogItem'}>
              <div className="vendorLogHead">
                <strong>{comm.subject}</strong>
                <small>
                  {CHANNEL_LABELS[comm.channel]} ·{' '}
                  {comm.direction === 'inbound' ? 'They contacted us' : 'We contacted them'}
                </small>
              </div>
              {comm.summary && <p>{comm.summary}</p>}
              <small>
                {formatDateTime(comm.occurred_at)} · Logged by {staffName(comm.logged_by)}
              </small>
              {comm.follow_up_date && (
                <div className="vendorFollowUp">
                  <CalendarClock size={13} />
                  <span>
                    Follow up by {formatDay(comm.follow_up_date)}
                    {comm.follow_up_done ? ' (done)' : due ? ' (due)' : ''}
                  </span>
                  <button
                    type="button"
                    className="glassButton"
                    onClick={() =>
                      void action.run(async () => {
                        await setFollowUpDone(comm.id, !comm.follow_up_done)
                        await onChanged()
                      })
                    }
                  >
                    {comm.follow_up_done ? 'Reopen' : 'Mark done'}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {!open && action.message && (
        <div className="vendorsNotice vendorsError" role="alert">
          {action.message}
        </div>
      )}
    </div>
  )
}

function ContactsTab({
  vendorId,
  contacts,
  onChanged,
}: {
  vendorId: string
  contacts: VendorContact[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const action = useAction()
  const [draft, setDraft] = useState({
    name: '',
    job_title: '',
    email: '',
    phone: '',
    is_primary: false,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    void action.run(async () => {
      await addContact(vendorId, draft)
      setDraft({ name: '', job_title: '', email: '', phone: '', is_primary: false })
      setOpen(false)
      await onChanged()
    })
  }

  return (
    <div className="vendorTab">
      <div className="vendorTabBar">
        <h5>People at this vendor</h5>
        <button type="button" className="glassButton" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> Add contact
        </button>
      </div>

      {open && (
        <form className="vendorForm vendorInline" onSubmit={submit}>
          <Field label="Name">
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Role">
            <input
              maxLength={120}
              value={draft.job_title}
              onChange={(event) => setDraft({ ...draft, job_title: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              maxLength={254}
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              maxLength={40}
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>
          <label className="vendorCheck wide">
            <input
              type="checkbox"
              checked={draft.is_primary}
              onChange={(event) => setDraft({ ...draft, is_primary: event.target.checked })}
            />
            Primary contact
          </label>
          {action.message && (
            <div className="vendorsNotice vendorsError wide" role="alert">
              {action.message}
            </div>
          )}
          <div className="vendorFormActions wide">
            <button type="submit" className="primaryButton" disabled={action.busy}>
              {action.busy ? 'Saving...' : 'Save contact'}
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 && <p className="vendorsMuted">No contacts yet.</p>}

      <ul className="vendorContacts">
        {contacts.map((contact) => (
          <li key={contact.id}>
            <div>
              <strong>
                {contact.name}
                {contact.is_primary ? ' (primary)' : ''}
              </strong>
              <small>{contact.job_title || 'No role set'}</small>
              <small>
                {[contact.email, contact.phone].filter(Boolean).join(' · ') || 'No contact details'}
              </small>
            </div>
            <button
              type="button"
              className="glassButton"
              aria-label={`Remove ${contact.name}`}
              onClick={() =>
                void action.run(async () => {
                  await removeContact(contact.id)
                  await onChanged()
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {!open && action.message && (
        <div className="vendorsNotice vendorsError" role="alert">
          {action.message}
        </div>
      )}
    </div>
  )
}
