// RideArrivo invoice generator.
//
// Same idea as the letterhead: type the details, see the PDF update, download
// it. Everything is drawn in the browser with pdf-lib and nothing typed here is
// sent anywhere. The layout follows the official RideArrivo Professional
// Invoice Template (Word): wordmark and INVOICE title, amber rule, bill to,
// service table, totals, payment details and terms.
//
// Money is held in minor units (kobo, cents) as whole numbers, so totals never
// pick up floating point dust such as 0.1 + 0.2.

import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { LETTERHEAD, drawTracked, formatDate, loadAssets, sanitize, todayISO } from './letterhead'

export type InvoiceTemplateId = 'easybooking' | 'charter' | 'arrivoair' | 'arrivoboat' | 'chauffeur' | 'general'
export type CurrencyCode = 'NGN' | 'USD' | 'GBP' | 'EUR'

export const CURRENCIES: Array<{ code: CurrencyCode; symbol: string; label: string }> = [
  { code: 'NGN', symbol: '₦', label: 'Naira (NGN)' },
  { code: 'USD', symbol: '$', label: 'US dollar (USD)' },
  { code: 'GBP', symbol: '£', label: 'Pound sterling (GBP)' },
  { code: 'EUR', symbol: '€', label: 'Euro (EUR)' },
]

export type DetailField = { key: string; label: string; placeholder: string }

export type InvoiceTemplate = {
  id: InvoiceTemplateId
  label: string
  hint: string
  subtitle: string
  prefix: string
  detailsTitle: string
  fields: DetailField[]
  itemExamples: string[]
  // Uses the full letterhead header and footer instead of the invoice banner.
  onLetterhead: boolean
}

export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'easybooking',
    label: 'easyBooking',
    hint: 'Rides and transfers booked through easyBooking',
    subtitle: 'Professional Mobility Services',
    prefix: 'EB',
    detailsTitle: 'BOOKING DETAILS',
    fields: [
      { key: 'bookingRef', label: 'Booking reference', placeholder: 'e.g. EB-48213' },
      { key: 'service', label: 'Service', placeholder: 'Airport transfer, city ride, hourly hire' },
      { key: 'pickup', label: 'Pickup', placeholder: 'Murtala Muhammed Airport, Terminal 2' },
      { key: 'dropoff', label: 'Drop-off', placeholder: 'Eko Hotel, Victoria Island' },
      { key: 'when', label: 'Date and time', placeholder: '24 Oct 2026, 14:30' },
      { key: 'vehicle', label: 'Vehicle', placeholder: 'Toyota Camry, LAG 123 AB' },
    ],
    itemExamples: ['Executive airport transfer', 'Waiting time', 'Additional stop'],
    onLetterhead: false,
  },
  {
    id: 'charter',
    label: 'Charter',
    hint: 'Vehicle charter by the day, trip or contract',
    subtitle: 'Charter Services',
    prefix: 'CH',
    detailsTitle: 'CHARTER DETAILS',
    fields: [
      { key: 'charterRef', label: 'Charter reference', placeholder: 'e.g. CH-2026-014' },
      { key: 'vehicle', label: 'Vehicle', placeholder: '18-seater Toyota Hiace' },
      { key: 'start', label: 'Start', placeholder: '24 Oct 2026, 08:00' },
      { key: 'end', label: 'End', placeholder: '26 Oct 2026, 18:00' },
      { key: 'route', label: 'Route or coverage', placeholder: 'Lagos to Ibadan and return' },
      { key: 'passengers', label: 'Passengers', placeholder: '14' },
    ],
    itemExamples: ['Vehicle charter (per day)', 'Driver allowance', 'Fuel and tolls'],
    onLetterhead: false,
  },
  {
    id: 'arrivoair',
    label: 'ArrivoAir',
    hint: 'Air charter, flight and airport services',
    subtitle: 'ArrivoAir | Air Travel Services',
    prefix: 'AIR',
    detailsTitle: 'FLIGHT DETAILS',
    fields: [
      { key: 'bookingRef', label: 'Booking reference', placeholder: 'e.g. AIR-7731' },
      { key: 'route', label: 'Route', placeholder: 'Lagos (LOS) to Abuja (ABV)' },
      { key: 'flightDate', label: 'Flight date and time', placeholder: '27 Oct 2026, 09:15' },
      { key: 'flightNo', label: 'Flight number', placeholder: 'Optional' },
      { key: 'aircraft', label: 'Aircraft', placeholder: 'Optional' },
      { key: 'passengers', label: 'Passengers', placeholder: 'Names or number' },
    ],
    itemExamples: ['Air charter (per flight)', 'Airport handling', 'Ground transfer'],
    onLetterhead: false,
  },
  {
    id: 'arrivoboat',
    label: 'ArrivoBoat',
    hint: 'Boat and water transport, charters and transfers',
    subtitle: 'ArrivoBoat | Water Transport Services',
    prefix: 'BOAT',
    detailsTitle: 'VOYAGE DETAILS',
    fields: [
      { key: 'bookingRef', label: 'Booking reference', placeholder: 'e.g. BT-3092' },
      { key: 'route', label: 'Route', placeholder: 'Ikoyi Jetty to Lekki Marina' },
      { key: 'departure', label: 'Departure', placeholder: '28 Oct 2026, 10:00' },
      { key: 'vessel', label: 'Vessel', placeholder: 'Name or type of boat' },
      { key: 'duration', label: 'Duration', placeholder: '3 hours' },
      { key: 'passengers', label: 'Passengers', placeholder: '8' },
    ],
    itemExamples: ['Boat charter (per hour)', 'Captain and crew', 'Life jackets and safety kit'],
    onLetterhead: false,
  },
  {
    id: 'chauffeur',
    label: 'ArrivoChauffeur',
    hint: 'Executive chauffeur service by the hour, day or month',
    subtitle: 'ArrivoChauffeur | Executive Driver Services',
    prefix: 'CHF',
    detailsTitle: 'CHAUFFEUR SERVICE',
    fields: [
      { key: 'bookingRef', label: 'Booking reference', placeholder: 'e.g. CHF-1180' },
      { key: 'chauffeur', label: 'Chauffeur', placeholder: 'Driver name' },
      { key: 'vehicle', label: 'Vehicle', placeholder: 'Mercedes E-Class, LAG 456 CD' },
      { key: 'period', label: 'Service period', placeholder: '1 to 31 Oct 2026' },
      { key: 'pickup', label: 'Pickup location', placeholder: 'Client residence, Banana Island' },
      { key: 'hours', label: 'Hours or days', placeholder: '10 hours a day, Monday to Friday' },
    ],
    itemExamples: ['Chauffeur service (per day)', 'Overtime (per hour)', 'Fuel'],
    onLetterhead: false,
  },
  {
    id: 'general',
    label: 'Letterhead invoice',
    hint: 'Any other invoice, on the full RideArrivo letterhead',
    subtitle: 'Invoice',
    prefix: 'INV',
    detailsTitle: 'INVOICE DETAILS',
    fields: [
      { key: 'reference', label: 'Your reference or PO number', placeholder: 'Optional' },
      { key: 'subject', label: 'For', placeholder: 'What this invoice is for' },
    ],
    itemExamples: ['Service rendered', 'Materials', 'Other charges'],
    onLetterhead: true,
  },
]

export const templateById = (id: InvoiceTemplateId): InvoiceTemplate =>
  INVOICE_TEMPLATES.find(t => t.id === id) ?? INVOICE_TEMPLATES[0]

export type InvoiceItem = { id: string; description: string; qty: string; unitPrice: string }

export type InvoiceInput = {
  template: InvoiceTemplateId
  invoiceNo: string
  issueDate: string
  dueDate: string
  currency: CurrencyCode
  clientName: string
  clientAddress: string
  contactName: string
  contactEmail: string
  contactPhone: string
  details: Record<string, string>
  items: InvoiceItem[]
  discount: string
  vatRate: string
  otherCharges: string
  amountPaid: string
  bankName: string
  accountName: string
  accountNumber: string
  notes: string
}

export const DEFAULT_NOTES = [
  'Payment is due by the due date shown above.',
  'Please quote the invoice number on payment.',
  'Thank you for choosing RideArrivo. Arrive Better.',
].join('\n')

let itemCounter = 0
export const newItem = (): InvoiceItem => ({ id: `item-${Date.now()}-${itemCounter++}`, description: '', qty: '1', unitPrice: '' })

export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return date.toISOString().slice(0, 10)
}

export const emptyInvoice = (template: InvoiceTemplateId = 'easybooking'): InvoiceInput => ({
  template,
  invoiceNo: '',
  issueDate: todayISO(),
  dueDate: addDays(todayISO(), 7),
  currency: 'NGN',
  clientName: '',
  clientAddress: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  details: {},
  items: [newItem()],
  discount: '',
  vatRate: '',
  otherCharges: '',
  amountPaid: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  notes: DEFAULT_NOTES,
})

// A number a person can keep or edit: prefix, date and time. Two invoices made
// in the same minute need a different suffix, so this is a suggestion, not a
// registry. Keep your own invoice register.
export function suggestInvoiceNo(template: InvoiceTemplateId, now = new Date()): string {
  const t = templateById(template)
  const y = now.getFullYear()
  const md = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  const hm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0')
  return `RA-${t.prefix}-${y}${md}-${hm}`
}

// ---------------------------------------------------------------------------
// Money

// "1,250.50", "₦1 250.5" or "1250" become 125050, 125050 and 125000 minor units.
export function parseMoney(text: string): number {
  const cleaned = String(text ?? '').replace(/[^0-9.\-]/g, '')
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 100)
}

export function parseQty(text: string): number {
  const value = Number.parseFloat(String(text ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0
}

export function parseRate(text: string): number {
  const value = Number.parseFloat(String(text ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0
}

export function formatMoney(minor: number, currency: CurrencyCode): string {
  const symbol = CURRENCIES.find(c => c.code === currency)?.symbol ?? ''
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}${symbol}${whole}.${cents}`
}

export type Totals = {
  lines: number[]
  subtotal: number
  discount: number
  vat: number
  other: number
  total: number
  paid: number
  balance: number
}

export function computeTotals(input: InvoiceInput): Totals {
  const lines = input.items.map(item => Math.round(parseQty(item.qty) * parseMoney(item.unitPrice)))
  const subtotal = lines.reduce((a, b) => a + b, 0)
  const discount = Math.min(parseMoney(input.discount), subtotal)
  const vat = Math.round(((subtotal - discount) * parseRate(input.vatRate)) / 100)
  const other = parseMoney(input.otherCharges)
  const total = subtotal - discount + vat + other
  const paid = Math.min(parseMoney(input.amountPaid), total)
  return { lines, subtotal, discount, vat, other, total, paid, balance: total - paid }
}

export function invoiceFilename(input: InvoiceInput): string {
  const slug = (value: string) =>
    value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const parts = ['RideArrivo', 'Invoice', slug(input.invoiceNo) || input.issueDate, slug(input.clientName)].filter(Boolean)
  return `${parts.join('_')}.pdf`
}

// ---------------------------------------------------------------------------
// Layout

const PAGE_W = 595.28
const PAGE_H = 841.89
const MX = 46
const CW = PAGE_W - MX * 2
const RIGHT = PAGE_W - MX
const BOTTOM = 78
const INK: readonly [number, number, number] = LETTERHEAD.ink
const NAVY: readonly [number, number, number] = LETTERHEAD.navy
const AMBER: readonly [number, number, number] = LETTERHEAD.amber
const MUTED: readonly [number, number, number] = LETTERHEAD.muted
const HAIR: readonly [number, number, number] = [0.82, 0.84, 0.88]
const PANEL: readonly [number, number, number] = [0.957, 0.965, 0.98]
const CREAM: readonly [number, number, number] = [1, 0.965, 0.91]
const WHITE: readonly [number, number, number] = [1, 1, 1]
const col = (c: readonly [number, number, number]) => rgb(c[0], c[1], c[2])

type Fonts = { regular: PDFFont; bold: PDFFont }
type Ctx = {
  doc: PDFDocument
  fonts: Fonts
  wordmark: Awaited<ReturnType<PDFDocument['embedPng']>>
  page: PDFPage
  pages: PDFPage[]
  y: number
  input: InvoiceInput
  template: InvoiceTemplate
  supported: Set<number>
  missing: Set<string>
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = ''
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) { line = trial; continue }
      if (line) out.push(line)
      if (font.widthOfTextAtSize(word, size) <= maxWidth) { line = word; continue }
      let chunk = ''
      for (const ch of Array.from(word)) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { out.push(chunk); chunk = ch } else chunk += ch
      }
      line = chunk
    }
    out.push(line)
  }
  return out
}

function text(ctx: Ctx, value: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: readonly [number, number, number]; align?: 'left' | 'right' | 'center'; page?: PDFPage } = {}) {
  const font = opts.bold ? ctx.fonts.bold : ctx.fonts.regular
  const width = font.widthOfTextAtSize(value, size)
  const px = opts.align === 'right' ? x - width : opts.align === 'center' ? x - width / 2 : x
  ;(opts.page ?? ctx.page).drawText(value, { x: px, y, size, font, color: col(opts.color ?? INK) })
}

function rect(page: PDFPage, x: number, y: number, w: number, h: number, fill?: readonly [number, number, number], border?: readonly [number, number, number]) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill ? col(fill) : undefined, borderColor: border ? col(border) : undefined, borderWidth: border ? 0.6 : 0 })
}

function drawHeader(ctx: Ctx, first: boolean) {
  const { page, wordmark, template } = ctx
  if (template.onLetterhead) {
    const width = first ? 252 : 170
    const height = (width * wordmark.height) / wordmark.width
    page.drawImage(wordmark, { x: MX, y: PAGE_H - 40 - height, width, height })
    if (first) {
      text(ctx, LETTERHEAD.legalName, RIGHT, PAGE_H - 62, 10, { bold: true, color: NAVY, align: 'right' })
      drawTracked(page, LETTERHEAD.tagline, ctx.fonts.regular, 9.5, 0.65, MUTED, RIGHT, PAGE_H - 76, 'right')
    }
    const ruleY = first ? PAGE_H - 106 : PAGE_H - 82
    page.drawLine({ start: { x: MX, y: ruleY }, end: { x: RIGHT, y: ruleY }, thickness: 1.1, color: col(AMBER) })
    if (first) {
      text(ctx, 'INVOICE', MX, ruleY - 34, 24, { bold: true, color: NAVY })
      ctx.y = ruleY - 52
    } else ctx.y = ruleY - 22
    return
  }
  const width = first ? 190 : 130
  const height = (width * wordmark.height) / wordmark.width
  page.drawImage(wordmark, { x: MX, y: PAGE_H - 36 - height, width, height })
  if (first) {
    text(ctx, 'INVOICE', RIGHT, PAGE_H - 62, 27, { bold: true, color: NAVY, align: 'right' })
    text(ctx, ctx.template.subtitle, RIGHT, PAGE_H - 78, 8.5, { color: MUTED, align: 'right' })
  } else {
    text(ctx, `Invoice ${ctx.input.invoiceNo || ''}`.trim(), RIGHT, PAGE_H - 52, 10, { bold: true, color: NAVY, align: 'right' })
  }
  const ruleY = first ? PAGE_H - 98 : PAGE_H - 74
  page.drawLine({ start: { x: MX, y: ruleY }, end: { x: RIGHT, y: ruleY }, thickness: 1.6, color: col(AMBER) })
  ctx.y = ruleY - 22
}

function label(ctx: Ctx, title: string) {
  drawTracked(ctx.page, title, ctx.fonts.bold, 8, 0.9, AMBER, MX, ctx.y)
  ctx.y -= 10
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pages.push(ctx.page)
  drawHeader(ctx, false)
}

function ensure(ctx: Ctx, height: number) {
  if (ctx.y - height < BOTTOM) newPage(ctx)
}

function drawFooters(ctx: Ctx) {
  const total = ctx.pages.length
  ctx.pages.forEach((page, index) => {
    if (ctx.template.onLetterhead) {
      page.drawLine({ start: { x: MX, y: 68 }, end: { x: RIGHT, y: 68 }, thickness: 0.75, color: col(AMBER) })
      const cols: Array<[string, string, number, 'left' | 'right']> = [
        ['WEBSITE', LETTERHEAD.website, MX, 'left'],
        ['EMAIL', LETTERHEAD.email, 178, 'left'],
        ['TELEPHONE', LETTERHEAD.phone, 316, 'left'],
        ['LOCATION', LETTERHEAD.location, RIGHT, 'right'],
      ]
      for (const [name, value, x, align] of cols) {
        drawTracked(page, name, ctx.fonts.bold, 6.5, 0.75, MUTED, x, 56, align)
        text(ctx, value, x, 43, 9, { color: NAVY, align, page })
      }
    } else {
      const line = `${LETTERHEAD.website}   •   ${LETTERHEAD.email}   •   ${LETTERHEAD.phone}   •   ${LETTERHEAD.location}`
      text(ctx, line, PAGE_W / 2, 52, 7.5, { color: MUTED, align: 'center', page })
      drawTracked(page, 'ARRIVE BETTER.', ctx.fonts.bold, 7.5, 0.8, AMBER, PAGE_W / 2 - 34, 40)
    }
    if (total > 1) text(ctx, `Page ${index + 1} of ${total}`, PAGE_W / 2, 26, 7.5, { color: MUTED, align: 'center', page })
  })
}

export type InvoiceBuild = { bytes: Uint8Array; pageCount: number; unsupported: string[]; totals: Totals }

export async function buildInvoicePdf(raw: InvoiceInput, author = ''): Promise<InvoiceBuild> {
  const assets = await loadAssets()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts: Fonts = {
    regular: await doc.embedFont(assets.regular, { subset: false }),
    bold: await doc.embedFont(assets.bold, { subset: false }),
  }
  const supported = new Set<number>(fonts.regular.getCharacterSet())
  const missing = new Set<string>()
  const clean = (v: string) => sanitize(v ?? '', supported, missing)
  const one = (v: string) => clean(v).replace(/\n/g, ' ').trim()

  const input: InvoiceInput = {
    ...raw,
    invoiceNo: one(raw.invoiceNo),
    clientName: one(raw.clientName),
    clientAddress: clean(raw.clientAddress).trim(),
    contactName: one(raw.contactName),
    contactEmail: one(raw.contactEmail),
    contactPhone: one(raw.contactPhone),
    bankName: one(raw.bankName),
    accountName: one(raw.accountName),
    accountNumber: one(raw.accountNumber),
    notes: clean(raw.notes).trim(),
    details: Object.fromEntries(Object.entries(raw.details).map(([k, v]) => [k, one(v)])),
    items: raw.items.map(item => ({ ...item, description: clean(item.description).trim() })),
  }
  const template = templateById(input.template)
  const totals = computeTotals(input)
  const money = (n: number) => formatMoney(n, input.currency)

  const wordmark = await doc.embedPng(assets.wordmark)
  const first = doc.addPage([PAGE_W, PAGE_H])
  const ctx: Ctx = { doc, fonts, wordmark, page: first, pages: [first], y: 0, input, template, supported, missing }
  drawHeader(ctx, true)

  // --- From and invoice facts -------------------------------------------
  const factsRows: Array<[string, string]> = [
    ['Invoice No.', input.invoiceNo || '-'],
    ['Issue Date', input.issueDate ? formatDate(input.issueDate) : '-'],
    ['Due Date', input.dueDate ? formatDate(input.dueDate) : '-'],
    ['Currency', `${input.currency} (${CURRENCIES.find(c => c.code === input.currency)?.symbol ?? ''})`],
  ]
  const blockTop = ctx.y
  const blockH = 74
  text(ctx, 'RIDEARRIVO', MX + 2, blockTop - 12, 10, { bold: true, color: NAVY })
  ;[LETTERHEAD.location, LETTERHEAD.website, LETTERHEAD.email, LETTERHEAD.phone].forEach((line, i) =>
    text(ctx, line, MX + 2, blockTop - 26 - i * 11.5, 8.5, { color: MUTED }))
  const factsX = PAGE_W - MX - 210
  rect(ctx.page, factsX, blockTop - blockH, 210, blockH, PANEL)
  factsRows.forEach(([k, v], i) => {
    const yy = blockTop - 15 - i * 16
    text(ctx, k, factsX + 10, yy, 8.5, { color: MUTED })
    text(ctx, v, factsX + 80, yy, 9, { bold: true, color: NAVY })
  })
  ctx.y = blockTop - blockH - 20

  // --- Bill to -----------------------------------------------------------
  label(ctx, 'BILL TO')
  const leftLines = [input.clientName && { t: input.clientName, b: true }, ...(input.clientAddress ? wrapLines(input.clientAddress, fonts.regular, 9, CW / 2 - 24).map(t => ({ t, b: false })) : [])]
    .filter(Boolean) as Array<{ t: string; b: boolean }>
  const rightLines: Array<[string, string]> = [['Contact', input.contactName], ['Email', input.contactEmail], ['Phone', input.contactPhone]]
  const billH = Math.max(52, 16 + Math.max(leftLines.length, 3) * 12.5)
  rect(ctx.page, MX, ctx.y - billH, CW, billH, undefined, HAIR)
  ctx.page.drawLine({ start: { x: MX + CW / 2, y: ctx.y }, end: { x: MX + CW / 2, y: ctx.y - billH }, thickness: 0.6, color: col(HAIR) })
  if (!leftLines.length) leftLines.push({ t: '-', b: false })
  leftLines.forEach((l, i) => text(ctx, l.t, MX + 10, ctx.y - 16 - i * 12.5, 9.5, { bold: l.b, color: l.b ? NAVY : INK }))
  rightLines.forEach(([k, v], i) => {
    const yy = ctx.y - 16 - i * 12.5
    text(ctx, `${k}:`, MX + CW / 2 + 10, yy, 8.5, { color: MUTED })
    if (v) text(ctx, v, MX + CW / 2 + 52, yy, 9, { color: INK })
  })
  ctx.y -= billH + 18

  // --- Template details ----------------------------------------------------
  const filled = template.fields.filter(f => (input.details[f.key] ?? '').trim())
  if (filled.length) {
    label(ctx, template.detailsTitle)
    const half = CW / 2
    const rows = Math.ceil(filled.length / 2)
    const cells = filled.map(f => ({ f, lines: wrapLines(input.details[f.key].trim(), fonts.regular, 9, half - 20) }))
    const rowH = [] as number[]
    for (let r = 0; r < rows; r++) {
      const a = cells[r * 2]?.lines.length ?? 1
      const b = cells[r * 2 + 1]?.lines.length ?? 1
      rowH.push(14 + Math.max(a, b) * 11.5)
    }
    const boxH = rowH.reduce((a, b) => a + b, 0) + 4
    ensure(ctx, boxH + 20)
    rect(ctx.page, MX, ctx.y - boxH, CW, boxH, undefined, HAIR)
    let yy = ctx.y - 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        const cell = cells[r * 2 + c]
        if (!cell) continue
        const x = MX + c * half + 10
        drawTracked(ctx.page, cell.f.label.toUpperCase(), fonts.bold, 6.5, 0.5, MUTED, x, yy - 11)
        cell.lines.forEach((ln, i) => text(ctx, ln, x, yy - 22 - i * 11.5, 9, { color: INK }))
      }
      yy -= rowH[r]
    }
    ctx.y -= boxH + 18
  }

  // --- Service table --------------------------------------------------------
  const colQty = MX + 296
  const colUnit = MX + 362
  const colAmt = RIGHT - 8
  const descX = MX + 34
  const descW = colQty - descX - 20
  const drawTableHead = () => {
    rect(ctx.page, MX, ctx.y - 20, CW, 20, NAVY)
    const yy = ctx.y - 13.5
    drawTracked(ctx.page, '#', fonts.bold, 7.5, 0.6, WHITE, MX + 12, yy)
    drawTracked(ctx.page, 'DESCRIPTION', fonts.bold, 7.5, 0.6, WHITE, descX, yy)
    drawTracked(ctx.page, 'QTY', fonts.bold, 7.5, 0.6, WHITE, colQty + 22, yy, 'right')
    drawTracked(ctx.page, 'UNIT PRICE', fonts.bold, 7.5, 0.6, WHITE, colUnit + 46, yy, 'right')
    drawTracked(ctx.page, 'AMOUNT', fonts.bold, 7.5, 0.6, WHITE, colAmt, yy, 'right')
    ctx.y -= 20
  }
  ensure(ctx, 90)
  label(ctx, 'SERVICE DETAILS')
  drawTableHead()
  const rows = input.items.length ? input.items : []
  rows.forEach((item, i) => {
    const lines = wrapLines(item.description || '-', fonts.regular, 9, descW)
    const h = Math.max(24, 12 + lines.length * 11.5)
    if (ctx.y - h < BOTTOM + 30) { newPage(ctx); drawTableHead() }
    const top = ctx.y
    text(ctx, String(i + 1), MX + 12, top - 15, 9, { color: MUTED })
    lines.forEach((ln, k) => text(ctx, ln, descX, top - 15 - k * 11.5, 9, { color: INK }))
    text(ctx, item.qty.trim() || '0', colQty + 22, top - 15, 9, { align: 'right' })
    text(ctx, money(parseMoney(item.unitPrice)), colUnit + 46, top - 15, 9, { align: 'right' })
    text(ctx, money(totals.lines[i] ?? 0), colAmt, top - 15, 9, { bold: true, color: NAVY, align: 'right' })
    ctx.page.drawLine({ start: { x: MX, y: top - h }, end: { x: RIGHT, y: top - h }, thickness: 0.5, color: col(HAIR) })
    ctx.y -= h
  })
  ctx.y -= 8

  // --- Payment and notes -------------------------------------------------------
  const half = CW / 2
  const payRows: string[] = []
  if (input.bankName) payRows.push(`Bank: ${input.bankName}`)
  if (input.accountName) payRows.push(`Account Name: ${input.accountName}`)
  if (input.accountNumber) payRows.push(`Account Number: ${input.accountNumber}`)
  payRows.push('Reference: Please use invoice number')
  const noteLines = input.notes
    ? input.notes.split('\n').filter(l => l.trim()).flatMap(l => wrapLines(l.trim(), fonts.regular, 8.5, half - 34).map((t, i) => ({ t, bullet: i === 0 })))
    : []
  const boxH2 = Math.max(70, 26 + Math.max(payRows.length, noteLines.length) * 12)
  // --- Totals ----------------------------------------------------------------
  const rate = parseRate(input.vatRate)
  const totalRows: Array<[string, string]> = [
    ['Subtotal', money(totals.subtotal)],
    ['Discount', totals.discount ? money(-totals.discount) : money(0)],
    [rate ? `VAT / Tax (${rate}%)` : 'VAT / Tax', money(totals.vat)],
    ['Other Charges', money(totals.other)],
  ]
  if (totals.paid) totalRows.push(['Amount Paid', money(-totals.paid)])
  // Keep the totals, the amount due and the payment details together.
  ensure(ctx, totalRows.length * 16 + 4 + 28 + 20 + 12 + boxH2)
  const labelX = RIGHT - 130
  totalRows.forEach(([k, v]) => {
    text(ctx, k, labelX, ctx.y - 12, 9, { color: MUTED, align: 'right' })
    text(ctx, v, colAmt, ctx.y - 12, 9.5, { bold: true, color: NAVY, align: 'right' })
    ctx.y -= 16
  })
  ctx.y -= 4
  rect(ctx.page, MX, ctx.y - 28, CW, 28, AMBER)
  drawTracked(ctx.page, totals.paid ? 'BALANCE DUE' : 'TOTAL DUE', fonts.bold, 10, 1, NAVY, labelX, ctx.y - 18, 'right')
  text(ctx, money(totals.paid ? totals.balance : totals.total), colAmt, ctx.y - 19, 13, { bold: true, color: NAVY, align: 'right' })
  ctx.y -= 28 + 20

  label(ctx, 'PAYMENT & NOTES')
  ensure(ctx, boxH2 + 6)
  rect(ctx.page, MX, ctx.y - boxH2, half, boxH2, CREAM, HAIR)
  rect(ctx.page, MX + half, ctx.y - boxH2, half, boxH2, undefined, HAIR)
  text(ctx, 'Payment Details', MX + 10, ctx.y - 16, 9.5, { bold: true, color: NAVY })
  payRows.forEach((l, i) => text(ctx, l, MX + 10, ctx.y - 32 - i * 12, 8.5, { color: INK }))
  text(ctx, 'Terms / Notes', MX + half + 10, ctx.y - 16, 9.5, { bold: true, color: NAVY })
  noteLines.forEach((l, i) => {
    if (l.bullet) text(ctx, '•', MX + half + 10, ctx.y - 32 - i * 12, 8.5, { color: MUTED })
    text(ctx, l.t, MX + half + 22, ctx.y - 32 - i * 12, 8.5, { color: MUTED })
  })
  ctx.y -= boxH2

  drawFooters(ctx)
  doc.setTitle(`Invoice ${input.invoiceNo}`.trim())
  doc.setAuthor(author || LETTERHEAD.legalName)
  doc.setCreator(`${LETTERHEAD.brandName} Workspace`)
  doc.setProducer(`${LETTERHEAD.brandName} Workspace`)
  doc.setSubject(template.label)
  doc.setCreationDate(new Date())
  return { bytes: await doc.save(), pageCount: ctx.pages.length, unsupported: Array.from(missing), totals }
}
