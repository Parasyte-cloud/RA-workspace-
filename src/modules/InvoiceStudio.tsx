import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Download, ExternalLink, Plus, ReceiptText, RotateCcw, Trash2, Wand2 } from 'lucide-react'

import {
  CURRENCIES,
  INVOICE_TEMPLATES,
  buildInvoicePdf,
  computeTotals,
  emptyInvoice,
  formatMoney,
  invoiceFilename,
  newItem,
  suggestInvoiceNo,
  templateById,
} from '../lib/invoice'
import type { CurrencyCode, InvoiceInput, InvoiceTemplateId } from '../lib/invoice'
import { canUseInvoice } from '../lib/invoiceAccess'
import { useCelebrationBlocker } from '../celebrations/CelebrationBlockerContext'

import '../letterhead.css'
import '../invoice.css'

type Props = {
  role: string
  fullName: string
}

type TextKey =
  | 'invoiceNo' | 'issueDate' | 'dueDate' | 'clientName' | 'clientAddress' | 'contactName' | 'contactEmail'
  | 'contactPhone' | 'discount' | 'vatRate' | 'otherCharges' | 'amountPaid' | 'bankName' | 'accountName'
  | 'accountNumber' | 'notes'

export default function InvoiceStudio({ role, fullName }: Props) {
  const allowed = canUseInvoice(role)

  const [input, setInput] = useState<InvoiceInput>(() => emptyInvoice('easybooking'))
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [unsupported, setUnsupported] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const generation = useRef(0)
  const urlRef = useRef<string | null>(null)

  const template = templateById(input.template)
  const totals = useMemo(() => computeTotals(input), [input])
  const money = (minor: number) => formatMoney(minor, input.currency)

  const setText = useCallback((key: TextKey, value: string) => {
    setInput(current => ({ ...current, [key]: value }))
  }, [])

  const bind = (key: TextKey) => ({
    value: input[key],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(key, event.target.value),
  })

  const setDetail = (key: string, value: string) =>
    setInput(current => ({ ...current, details: { ...current.details, [key]: value } }))

  const setItem = (id: string, patch: Partial<InvoiceInput['items'][number]>) =>
    setInput(current => ({ ...current, items: current.items.map(item => (item.id === id ? { ...item, ...patch } : item)) }))

  const addItem = () => setInput(current => ({ ...current, items: [...current.items, newItem()] }))
  const removeItem = (id: string) =>
    setInput(current => ({ ...current, items: current.items.length > 1 ? current.items.filter(item => item.id !== id) : current.items }))

  const switchTemplate = (id: InvoiceTemplateId) =>
    setInput(current => ({
      ...current,
      template: id,
      // Trip fields differ per type, so they start fresh. Client, items and
      // payment details are kept.
      details: {},
      invoiceNo: current.invoiceNo && !current.invoiceNo.startsWith('RA-') ? current.invoiceNo : '',
    }))

  const hasContent = input.items.some(item => item.description.trim() && totals.lines[input.items.indexOf(item)] > 0)
  const dirty = Boolean(input.clientName.trim() || hasContent)
  useCelebrationBlocker('critical_unsaved_form', dirty)

  useEffect(() => {
    if (!allowed) return
    const ticket = ++generation.current
    setBusy(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await buildInvoicePdf(input, fullName)
        if (ticket !== generation.current) return
        const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setPreviewUrl(url)
        setPageCount(result.pageCount)
        setUnsupported(result.unsupported)
        setError('')
      } catch (problem) {
        if (ticket !== generation.current) return
        setError(problem instanceof Error ? problem.message : 'Could not build the preview.')
      } finally {
        if (ticket === generation.current) setBusy(false)
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [input, allowed, fullName])

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  // Nothing is stored, so warn before a refresh throws typed work away.
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  const download = useCallback(async () => {
    if (!hasContent || busy) return
    setError('')
    try {
      const result = await buildInvoicePdf(input, fullName)
      const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = invoiceFilename(input)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not build the PDF.')
    }
  }, [busy, fullName, hasContent, input])

  const clearAll = () => {
    if (!confirmClear) { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 4000); return }
    setConfirmClear(false)
    setInput(emptyInvoice(input.template))
  }

  if (!allowed) {
    return (
      <div className="letterheadStudio invoiceStudio">
        <div className="lhRestricted">
          <ReceiptText size={28} />
          <h2>Invoices are restricted</h2>
          <p>Only the Administrator, Finance and Operations can issue invoices.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="letterheadStudio invoiceStudio">
      <header className="lhHero">
        <div>
          <span className="lhEyebrow">Official invoice</span>
          <h2>Invoice</h2>
          <p>Choose the service, fill in the details, check the preview, download the PDF. Nothing you type is stored or sent anywhere.</p>
        </div>
        <div className="lhHeroActions">
          <button type="button" className="lhPrimary" onClick={download} disabled={!hasContent || busy}>
            <Download size={16} /> Download PDF
          </button>
          {previewUrl && hasContent && (
            <a className="lhGhost" href={previewUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} /> Open to print
            </a>
          )}
        </div>
      </header>

      {error && <p className="lhNote lhBad" role="alert">{error}</p>}

      <div className="lhGrid">
        <section className="lhForm" aria-label="Invoice details">
          <div className="invKinds" role="tablist" aria-label="Invoice type">
            {INVOICE_TEMPLATES.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={input.template === item.id}
                className={input.template === item.id ? 'active' : ''}
                onClick={() => switchTemplate(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="lhHint">{template.hint}</p>

          <h3 className="invGroup">Invoice</h3>
          <div className="lhRow">
            <label className="lhField">
              <span>Invoice number</span>
              <div className="lhInline">
                <input type="text" placeholder="e.g. RA-EB-20261024-1336" {...bind('invoiceNo')} />
                <button type="button" className="lhIcon" title="Suggest a number" aria-label="Suggest an invoice number" onClick={() => setText('invoiceNo', suggestInvoiceNo(input.template))}>
                  <Wand2 size={15} />
                </button>
              </div>
            </label>
            <label className="lhField">
              <span>Currency</span>
              <select value={input.currency} onChange={event => setInput(current => ({ ...current, currency: event.target.value as CurrencyCode }))}>
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <div className="lhRow">
            <label className="lhField"><span>Issue date</span><input type="date" {...bind('issueDate')} /></label>
            <label className="lhField"><span>Due date</span><input type="date" {...bind('dueDate')} /></label>
          </div>

          <h3 className="invGroup">Bill to</h3>
          <label className="lhField"><span>Client or company name</span><input type="text" {...bind('clientName')} /></label>
          <label className="lhField"><span>Address</span><textarea rows={3} placeholder={'12 Obafemi Awolowo Way\nIkeja, Lagos, Nigeria'} {...bind('clientAddress')} /></label>
          <div className="lhRow">
            <label className="lhField"><span>Contact name</span><input type="text" {...bind('contactName')} /></label>
            <label className="lhField"><span>Phone</span><input type="text" inputMode="tel" {...bind('contactPhone')} /></label>
          </div>
          <label className="lhField"><span>Email</span><input type="text" inputMode="email" {...bind('contactEmail')} /></label>

          <h3 className="invGroup">{template.detailsTitle.charAt(0) + template.detailsTitle.slice(1).toLowerCase()}</h3>
          <div className="lhRow">
            {template.fields.map(field => (
              <label className="lhField" key={`${template.id}-${field.key}`}>
                <span>{field.label}</span>
                <input
                  type="text"
                  placeholder={field.placeholder}
                  value={input.details[field.key] ?? ''}
                  onChange={event => setDetail(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <h3 className="invGroup">Services</h3>
          <div className="invItems">
            <div className="invItemsHead" aria-hidden="true">
              <span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span><span />
            </div>
            {input.items.map((item, index) => (
              <div className="invItem" key={item.id}>
                <label className="lhField invDesc">
                  <span className="invOnly">Description</span>
                  <input
                    type="text"
                    placeholder={template.itemExamples[index % template.itemExamples.length]}
                    value={item.description}
                    onChange={event => setItem(item.id, { description: event.target.value })}
                  />
                </label>
                <label className="lhField">
                  <span className="invOnly">Qty</span>
                  <input type="text" inputMode="decimal" value={item.qty} onChange={event => setItem(item.id, { qty: event.target.value })} />
                </label>
                <label className="lhField">
                  <span className="invOnly">Unit price</span>
                  <input type="text" inputMode="decimal" placeholder="0.00" value={item.unitPrice} onChange={event => setItem(item.id, { unitPrice: event.target.value })} />
                </label>
                <output className="invAmount" aria-label={`Line ${index + 1} amount`}>{money(totals.lines[index] ?? 0)}</output>
                <button type="button" className="lhIcon" aria-label={`Remove line ${index + 1}`} title="Remove line" onClick={() => removeItem(item.id)} disabled={input.items.length === 1}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="lhGhost invAdd" onClick={addItem}><Plus size={15} /> Add a line</button>

          <h3 className="invGroup">Charges</h3>
          <div className="lhRow">
            <label className="lhField"><span>Discount (amount)</span><input type="text" inputMode="decimal" placeholder="0.00" {...bind('discount')} /></label>
            <label className="lhField"><span>VAT / tax rate (%)</span><input type="text" inputMode="decimal" placeholder="0, or 7.5 for Nigerian VAT" {...bind('vatRate')} /></label>
          </div>
          <div className="lhRow">
            <label className="lhField"><span>Other charges</span><input type="text" inputMode="decimal" placeholder="0.00" {...bind('otherCharges')} /></label>
            <label className="lhField"><span>Amount already paid</span><input type="text" inputMode="decimal" placeholder="0.00" {...bind('amountPaid')} /></label>
          </div>

          <div className="invSummary" aria-live="polite">
            <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
            {totals.discount > 0 && <div><span>Discount</span><strong>{money(-totals.discount)}</strong></div>}
            {totals.vat > 0 && <div><span>VAT / tax</span><strong>{money(totals.vat)}</strong></div>}
            {totals.other > 0 && <div><span>Other charges</span><strong>{money(totals.other)}</strong></div>}
            {totals.paid > 0 && <div><span>Paid</span><strong>{money(-totals.paid)}</strong></div>}
            <div className="invDue"><span>{totals.paid > 0 ? 'Balance due' : 'Total due'}</span><strong>{money(totals.paid > 0 ? totals.balance : totals.total)}</strong></div>
          </div>

          <h3 className="invGroup">Payment details</h3>
          <div className="lhRow">
            <label className="lhField"><span>Bank</span><input type="text" {...bind('bankName')} /></label>
            <label className="lhField"><span>Account name</span><input type="text" {...bind('accountName')} /></label>
          </div>
          <label className="lhField"><span>Account number</span><input type="text" inputMode="numeric" {...bind('accountNumber')} /></label>
          <label className="lhField">
            <span>Terms and notes (one point per line)</span>
            <textarea rows={4} {...bind('notes')} />
          </label>

          <button type="button" className="lhGhost lhClear" onClick={clearAll}>
            <RotateCcw size={15} /> {confirmClear ? 'Click again to clear everything' : 'Clear and start again'}
          </button>
        </section>

        <section className="lhPreview" aria-label="Preview">
          <div className="lhPreviewBar">
            <strong>Preview</strong>
            <span>{busy ? 'Updating…' : `${pageCount} page${pageCount === 1 ? '' : 's'}, A4`}</span>
          </div>
          {unsupported.length > 0 && (
            <p className="lhNote lhWarn">These characters cannot be printed and appear as "?": {unsupported.slice(0, 12).join(' ')}</p>
          )}
          {previewUrl ? (
            <iframe title="Invoice preview" src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`} />
          ) : (
            <div className="lhEmpty">Preparing the preview…</div>
          )}
        </section>
      </div>
    </div>
  )
}
