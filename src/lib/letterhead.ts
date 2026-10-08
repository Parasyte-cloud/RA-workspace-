// RideArrivo letterhead generator.
//
// Takes typed or pasted content and lays it out on the official RideArrivo
// letterhead as an A4 PDF, entirely in the browser (pdf-lib). Nothing typed
// here is sent anywhere. The only network requests are for the three font
// files and the wordmark, which are static files served with the workspace.
//
// Everything about the letterhead itself (names, numbers, address, colours)
// lives in LETTERHEAD below. Change it there and every document follows.

import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

export const LETTERHEAD = {
  // Taken from the official RideArrivo Letterhead and Letter Template (Word).
  brandName: 'RideArrivo',
  legalName: 'RideArrivo Limited',
  tagline: 'Arrive Better.',
  website: 'www.ridearrivo.com',
  email: 'info@ridearrivo.com',
  phone: '0816 270 6078',
  location: 'Lagos, Nigeria',
  ink: [0.094, 0.165, 0.251] as const,   // #182A40, body text
  navy: [0, 0.106, 0.243] as const,      // #001B3E, names, labels, subject
  amber: [1, 0.541, 0] as const,         // #FF8A00, header and footer rules
  muted: [0.396, 0.443, 0.518] as const, // #657184, tagline and small labels
  rule: [0.84, 0.85, 0.89] as const,     // light hairlines inside documents
}

export type DocKind = 'letter' | 'email' | 'memo' | 'notice'
export type ClosingKind = 'faithfully' | 'sincerely' | 'regards' | 'none'

export type LetterheadInput = {
  kind: DocKind
  reference: string
  dateISO: string            // yyyy-mm-dd
  confidential: boolean
  subject: string
  body: string
  // letter
  recipient: string          // multi line: name, title, organisation, address
  salutation: string
  closing: ClosingKind
  signatoryName: string
  signatoryTitle: string
  cc: string
  enclosures: string
  // email and memo
  from: string
  to: string
  sentAt: string             // free text for emails, e.g. "Mon, 6 Oct 2026, 09:14"
}

export const emptyInput = (): LetterheadInput => ({
  kind: 'letter',
  reference: '',
  dateISO: todayISO(),
  confidential: false,
  subject: '',
  body: '',
  recipient: '',
  salutation: 'Dear Sir/Madam,',
  closing: 'faithfully',
  signatoryName: '',
  signatoryTitle: '',
  cc: '',
  enclosures: '',
  from: '',
  to: '',
  sentAt: '',
})

export function todayISO(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

const DEPARTMENT_CODES: Record<string, string> = {
  admin: 'ADM',
  legal: 'LGL',
  operations: 'OPS',
  finance: 'FIN',
}

// A reference the sender can edit. Date and time keep two documents made in the
// same minute distinguishable only if the sender adds a suffix, so it is a
// suggestion, not a registry. The issue log (letterhead_issues) is the record.
export function suggestReference(role: string, now = new Date()): string {
  const code = DEPARTMENT_CODES[role] ?? 'RA'
  const mmdd = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  const hhmm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0')
  return `RA/${code}/${now.getFullYear()}/${mmdd}-${hhmm}`
}

export function documentFilename(input: LetterheadInput): string {
  const label = { letter: 'Letter', email: 'Email', memo: 'Memo', notice: 'Notice' }[input.kind]
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
  const parts = ['RideArrivo', label, slug(input.reference) || input.dateISO, slug(input.subject)].filter(Boolean)
  return `${parts.join('_')}.pdf`
}

// ---------------------------------------------------------------------------
// Assets (fetched once per session)

type Assets = { regular: Uint8Array; bold: Uint8Array; italic: Uint8Array; wordmark: Uint8Array }
let assetsPromise: Promise<Assets> | null = null

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

function loadAssets(): Promise<Assets> {
  if (!assetsPromise) {
    const base = import.meta.env.BASE_URL || '/'
    assetsPromise = Promise.all([
      fetchBytes(`${base}fonts/Carlito-Regular.ttf`),
      fetchBytes(`${base}fonts/Carlito-Bold.ttf`),
      fetchBytes(`${base}fonts/Carlito-Italic.ttf`),
      fetchBytes(`${base}ridearrivo-letterhead-logo.png`),
    ]).then(([regular, bold, italic, wordmark]) => ({ regular, bold, italic, wordmark }))
    assetsPromise.catch(() => { assetsPromise = null })
  }
  return assetsPromise
}

// ---------------------------------------------------------------------------
// Text handling

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont }
type Run = { text: string; bold?: boolean; italic?: boolean }
type Segment = { text: string; font: PDFFont }

function codePoints(text: string): string[] {
  return Array.from(text)
}

// Replace anything the font cannot draw so the PDF never shows a blank box.
export function sanitize(text: string, supported: Set<number>, missing?: Set<string>): string {
  const out: string[] = []
  for (const ch of codePoints(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    '))) {
    const cp = ch.codePointAt(0) as number
    if (ch === '\n') { out.push(ch); continue }
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || cp === 0x2028 || cp === 0x2029) continue
    if (cp === 0xa0 || cp === 0x2007 || cp === 0x202f) { out.push(' '); continue }
    if (supported.has(cp)) { out.push(ch); continue }
    missing?.add(ch)
    out.push('?')
  }
  return out.join('')
}

// **bold**, *italic* and _italic_. Unmatched markers are left as typed.
export function parseInline(text: string): Run[] {
  const runs: Run[] = []
  let buffer = ''
  let bold = false
  let italic = false
  const flush = () => { if (buffer) { runs.push({ text: buffer, bold, italic }); buffer = '' } }
  const hasClose = (marker: string, from: number) => text.indexOf(marker, from) !== -1
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('**', i) && (bold || hasClose('**', i + 2))) { flush(); bold = !bold; i += 1; continue }
    const ch = text[i]
    if ((ch === '*' || ch === '_') && !text.startsWith('**', i)) {
      const prev = text[i - 1]
      const next = text[i + 1]
      const opening = !italic && next !== undefined && next !== ' ' && (prev === undefined || /[\s(\["']/.test(prev)) && hasClose(ch, i + 1)
      const closing = italic && prev !== undefined && prev !== ' '
      if (opening || closing) { flush(); italic = !italic; continue }
    }
    buffer += ch
  }
  flush()
  return runs
}

export function plainText(runs: Run[]): string {
  return runs.map(run => run.text).join('')
}

function fontFor(run: Run, fonts: Fonts): PDFFont {
  if (run.bold) return fonts.bold
  if (run.italic) return fonts.italic
  return fonts.regular
}

// Greedy word wrap across styled runs. Words longer than a line are broken.
function wrap(runs: Run[], fonts: Fonts, size: number, maxWidth: number): Segment[][] {
  type Word = { text: string; font: PDFFont }
  const words: Word[] = []
  for (const run of runs) {
    const font = fontFor(run, fonts)
    for (const piece of run.text.split(/( +)/)) {
      if (piece === '') continue
      words.push({ text: piece, font })
    }
  }
  const lines: Segment[][] = []
  let line: Segment[] = []
  let width = 0
  const push = (text: string, font: PDFFont) => {
    const last = line[line.length - 1]
    if (last && last.font === font) last.text += text
    else line.push({ text, font })
  }
  const newLine = () => { lines.push(line); line = []; width = 0 }
  for (const word of words) {
    const isSpace = /^ +$/.test(word.text)
    let w = word.font.widthOfTextAtSize(word.text, size)
    if (isSpace) {
      if (line.length === 0) continue
      push(word.text, word.font)
      width += w
      continue
    }
    if (width + w > maxWidth && line.length > 0) {
      const last = line[line.length - 1]
      last.text = last.text.replace(/ +$/, '')
      if (!last.text) line.pop()
      newLine()
    }
    if (w > maxWidth) {
      let chunk = ''
      for (const ch of codePoints(word.text)) {
        const cw = word.font.widthOfTextAtSize(chunk + ch, size)
        if (cw > maxWidth && chunk) { push(chunk, word.font); newLine(); chunk = ch } else chunk += ch
      }
      word.text = chunk
      w = word.font.widthOfTextAtSize(chunk, size)
    }
    push(word.text, word.font)
    width += w
  }
  if (line.length) {
    const last = line[line.length - 1]
    last.text = last.text.replace(/ +$/, '')
    lines.push(line)
  }
  return lines.length ? lines : [[]]
}

// ---------------------------------------------------------------------------
// Layout

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 62.35
const CONTENT_W = PAGE_W - MARGIN_X * 2
const BOTTOM = 90.7
const BODY_SIZE = 11
const LEADING = 15.2

type RGB = readonly [number, number, number]
const color = (c: RGB) => rgb(c[0], c[1], c[2])

type Ctx = {
  doc: PDFDocument
  fonts: Fonts
  wordmark: Awaited<ReturnType<PDFDocument['embedPng']>>
  page: PDFPage
  y: number
  pages: PDFPage[]
  input: LetterheadInput
  supported: Set<number>
  missing: Set<string>
}

function drawSegments(ctx: Ctx, segments: Segment[], x: number, y: number, size: number, tint: RGB = LETTERHEAD.ink) {
  let cursor = x
  for (const segment of segments) {
    if (!segment.text) continue
    ctx.page.drawText(segment.text, { x: cursor, y, size, font: segment.font, color: color(tint) })
    cursor += segment.font.widthOfTextAtSize(segment.text, size)
  }
}

function segmentsWidth(segments: Segment[], size: number): number {
  return segments.reduce((sum, s) => sum + s.font.widthOfTextAtSize(s.text, size), 0)
}

const TOP_CONTENT = 161.5

function drawTracked(page: PDFPage, text: string, font: PDFFont, size: number, spacing: number, tint: RGB, x: number, y: number, align: 'left' | 'right' = 'left') {
  const chars = [...text]
  const widths = chars.map(c => font.widthOfTextAtSize(c, size))
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(chars.length - 1, 0)
  let cursor = align === 'right' ? x - total : x
  chars.forEach((c, i) => {
    page.drawText(c, { x: cursor, y, size, font, color: color(tint) })
    cursor += widths[i] + spacing
  })
}

// The same header on every page, as in the Word letterhead. Continuation pages
// add a small reference line under the rule.
function drawHeader(ctx: Ctx, pageNo: number) {
  const { page, wordmark } = ctx
  const width = 252
  const height = (width * wordmark.height) / wordmark.width
  page.drawImage(wordmark, { x: MARGIN_X, y: PAGE_H - 45 - height, width, height })
  const right = PAGE_W - MARGIN_X
  const name = LETTERHEAD.legalName
  const nameW = ctx.fonts.bold.widthOfTextAtSize(name, 10)
  page.drawText(name, { x: right - nameW, y: PAGE_H - 62, size: 10, font: ctx.fonts.bold, color: color(LETTERHEAD.navy) })
  drawTracked(page, LETTERHEAD.tagline, ctx.fonts.regular, 9.5, 0.65, LETTERHEAD.muted, right, PAGE_H - 76, 'right')
  const ruleY = PAGE_H - 116
  page.drawLine({ start: { x: MARGIN_X, y: ruleY }, end: { x: right, y: ruleY }, thickness: 1.1, color: color(LETTERHEAD.amber) })
  if (pageNo > 1) {
    const label = [ctx.input.reference && `Ref: ${ctx.input.reference}`, formatDate(ctx.input.dateISO)].filter(Boolean).join('   |   ')
    const text = sanitize(label, ctx.supported)
    const w = ctx.fonts.regular.widthOfTextAtSize(text, 8.5)
    page.drawText(text, { x: right - w, y: ruleY - 16, size: 8.5, font: ctx.fonts.regular, color: color(LETTERHEAD.muted) })
  }
  ctx.y = PAGE_H - TOP_CONTENT
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pages.push(ctx.page)
  drawHeader(ctx, ctx.pages.length)
}

function ensure(ctx: Ctx, height: number) {
  if (ctx.y - height < BOTTOM) newPage(ctx)
}

function drawFooters(ctx: Ctx) {
  const total = ctx.pages.length
  const right = PAGE_W - MARGIN_X
  const columns: Array<[string, string, number, 'left' | 'right']> = [
    ['WEBSITE', LETTERHEAD.website, MARGIN_X, 'left'],
    ['EMAIL', LETTERHEAD.email, 186, 'left'],
    ['TELEPHONE', LETTERHEAD.phone, 323, 'left'],
    ['LOCATION', LETTERHEAD.location, right, 'right'],
  ]
  ctx.pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN_X, y: 68 }, end: { x: right, y: 68 }, thickness: 0.75, color: color(LETTERHEAD.amber) })
    for (const [label, value, x, align] of columns) {
      drawTracked(page, label, ctx.fonts.bold, 6.5, 0.75, LETTERHEAD.muted, x, 56, align)
      const w = ctx.fonts.regular.widthOfTextAtSize(value, 9)
      page.drawText(value, { x: align === 'right' ? x - w : x, y: 43, size: 9, font: ctx.fonts.regular, color: color(LETTERHEAD.navy) })
    }
    if (total > 1) {
      const label = `Page ${index + 1} of ${total}`
      const w = ctx.fonts.regular.widthOfTextAtSize(label, 7.5)
      page.drawText(label, { x: (PAGE_W - w) / 2, y: 26, size: 7.5, font: ctx.fonts.regular, color: color(LETTERHEAD.muted) })
    }
  })
}

// One wrapped block of text at the cursor. Splits across pages line by line.
function block(ctx: Ctx, runs: Run[], opts: { size?: number; indent?: number; leading?: number; bullet?: string; tint?: RGB; bar?: boolean } = {}) {
  const size = opts.size ?? BODY_SIZE
  const leading = opts.leading ?? (size === BODY_SIZE ? LEADING : size * 1.45)
  const indent = opts.indent ?? 0
  const lines = wrap(runs, ctx.fonts, size, CONTENT_W - indent)
  lines.forEach((segments, index) => {
    ensure(ctx, leading)
    const baseline = ctx.y - size
    if (index === 0 && opts.bullet) {
      ctx.page.drawText(opts.bullet, { x: MARGIN_X + indent - ctx.fonts.regular.widthOfTextAtSize(opts.bullet, size) - 5, y: baseline, size, font: ctx.fonts.regular, color: color(opts.tint ?? LETTERHEAD.ink) })
    }
    if (opts.bar) {
      ctx.page.drawRectangle({ x: MARGIN_X + indent - 8, y: ctx.y - leading + 2.5, width: 1.6, height: leading, color: color(LETTERHEAD.rule) })
    }
    drawSegments(ctx, segments, MARGIN_X + indent, baseline, size, opts.tint ?? LETTERHEAD.ink)
    ctx.y -= leading
  })
}

const text = (value: string, extra: Partial<Run> = {}): Run[] => [{ text: value, ...extra }]

function gap(ctx: Ctx, amount: number) {
  ctx.y -= amount
}

// The body: a small, forgiving subset of plain text. A blank line starts a new
// paragraph, "# " is a heading, "- " or "* " a bullet, "1. " a numbered item,
// "> " a quotation (pasted email threads), "---" a divider, **bold** and *italic*.
function renderBody(ctx: Ctx, body: string) {
  const lines = body.replace(/\s+$/, '').split('\n')
  let lastBlank = false
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      if (!lastBlank) gap(ctx, LEADING * 0.55)
      lastBlank = true
      continue
    }
    lastBlank = false
    let m: RegExpExecArray | null
    if ((m = /^#{1,3}\s+(.*)$/.exec(line))) {
      gap(ctx, 3)
      block(ctx, text(m[1], { bold: true }), { size: 11, leading: 16 })
    } else if (/^-{3,}$/.test(line.trim())) {
      ensure(ctx, 10)
      ctx.page.drawLine({ start: { x: MARGIN_X, y: ctx.y - 4 }, end: { x: PAGE_W - MARGIN_X, y: ctx.y - 4 }, thickness: 0.5, color: color(LETTERHEAD.rule) })
      gap(ctx, 10)
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      block(ctx, parseInline(m[1]), { indent: 16, bullet: '•' })
    } else if ((m = /^\s*(\d{1,3}[.)])\s+(.*)$/.exec(line))) {
      block(ctx, parseInline(m[2]), { indent: 20, bullet: m[1] })
    } else if ((m = /^\s*>+\s?(.*)$/.exec(line))) {
      block(ctx, parseInline(m[1]).map(run => ({ ...run, italic: run.italic })), { indent: 14, tint: LETTERHEAD.muted, bar: true })
    } else {
      block(ctx, parseInline(line))
    }
  }
}

function labelRows(ctx: Ctx, rows: Array<[string, string, boolean?]>) {
  const labelWidth = 54
  for (const [label, value, strong] of rows) {
    if (!value.trim()) continue
    const lines = wrap(text(value, { bold: !!strong }), ctx.fonts, BODY_SIZE, CONTENT_W - labelWidth)
    lines.forEach((segments, i) => {
      ensure(ctx, LEADING)
      if (i === 0) {
        ctx.page.drawText(label.toUpperCase(), { x: MARGIN_X, y: ctx.y - 8.6, size: 7.4, font: ctx.fonts.bold, color: color(LETTERHEAD.muted) })
      }
      drawSegments(ctx, segments, MARGIN_X + labelWidth, ctx.y - BODY_SIZE, BODY_SIZE)
      ctx.y -= LEADING
    })
    gap(ctx, 1.5)
  }
}

function hairline(ctx: Ctx, heavy = false) {
  ensure(ctx, 12)
  ctx.page.drawLine({ start: { x: MARGIN_X, y: ctx.y - 3 }, end: { x: PAGE_W - MARGIN_X, y: ctx.y - 3 }, thickness: heavy ? 1.1 : 0.5, color: color(heavy ? LETTERHEAD.ink : LETTERHEAD.rule) })
  gap(ctx, 13)
}

function dateRefLine(ctx: Ctx) {
  const { input } = ctx
  const right = PAGE_W - MARGIN_X
  const rows: Array<[string, string]> = [['Date: ', formatDate(input.dateISO)]]
  if (input.reference.trim()) rows.push(['Our ref: ', input.reference.trim()])
  for (const [label, value] of rows) {
    ensure(ctx, LEADING)
    const vw = ctx.fonts.regular.widthOfTextAtSize(value, BODY_SIZE)
    const lw = ctx.fonts.bold.widthOfTextAtSize(label, BODY_SIZE)
    ctx.page.drawText(value, { x: right - vw, y: ctx.y - BODY_SIZE, size: BODY_SIZE, font: ctx.fonts.regular, color: color(LETTERHEAD.ink) })
    ctx.page.drawText(label, { x: right - vw - lw, y: ctx.y - BODY_SIZE, size: BODY_SIZE, font: ctx.fonts.bold, color: color(LETTERHEAD.navy) })
    ctx.y -= LEADING
  }
  ctx.y -= 12
}

function confidentialLine(ctx: Ctx) {
  if (!ctx.input.confidential) return
  block(ctx, text('PRIVATE AND CONFIDENTIAL', { bold: true }), { size: 9, leading: 13 })
  gap(ctx, 6)
}

function signatureBlock(ctx: Ctx, closingLine: string | null) {
  const { input } = ctx
  const name = input.signatoryName.trim()
  const title = input.signatoryTitle.trim()
  if (!closingLine && !name) return
  const needed = (closingLine ? LEADING + 6 : 0) + (name ? 46 + LEADING * 2 : 0)
  ensure(ctx, needed)
  if (closingLine) { block(ctx, text(closingLine)); gap(ctx, 6) }
  if (name) {
    gap(ctx, 40)
    block(ctx, text(name, { bold: true }), { tint: LETTERHEAD.navy })
    if (title) block(ctx, text(title))
    if (ctx.input.kind === 'letter') block(ctx, text(`For: ${LETTERHEAD.legalName}`))
  }
}

function footnotes(ctx: Ctx) {
  const { input } = ctx
  const items: string[] = []
  if (input.enclosures.trim()) items.push(`Enclosures: ${input.enclosures.trim()}`)
  if (input.cc.trim()) items.push(`cc: ${input.cc.trim()}`)
  if (!items.length) return
  gap(ctx, 12)
  for (const item of items) block(ctx, text(item), { size: 9, leading: 13, tint: LETTERHEAD.muted })
}

function renderLetter(ctx: Ctx) {
  const { input } = ctx
  dateRefLine(ctx)
  confidentialLine(ctx)
  const recipient = input.recipient.split('\n').map(l => l.trim()).filter(Boolean)
  recipient.forEach(line => block(ctx, text(line)))
  if (recipient.length) gap(ctx, 12)
  if (input.salutation.trim()) { block(ctx, text(input.salutation.trim())); gap(ctx, 8) }
  if (input.subject.trim()) { block(ctx, text(`Subject: ${input.subject.trim()}`, { bold: true }), { tint: LETTERHEAD.navy }); gap(ctx, 8) }
  renderBody(ctx, input.body)
  gap(ctx, 14)
  const closing = { faithfully: 'Yours faithfully,', sincerely: 'Yours sincerely,', regards: 'Kind regards,', none: null }[input.closing]
  signatureBlock(ctx, closing)
  footnotes(ctx)
}

function renderEmail(ctx: Ctx) {
  const { input } = ctx
  confidentialLine(ctx)
  labelRows(ctx, [
    ['From', input.from],
    ['To', input.to],
    ['Cc', input.cc],
    ['Sent', input.sentAt || formatDate(input.dateISO)],
    ['Ref', input.reference],
    ['Subject', input.subject, true],
  ])
  hairline(ctx)
  renderBody(ctx, input.body)
}

function renderMemo(ctx: Ctx) {
  const { input } = ctx
  block(ctx, text('MEMORANDUM', { bold: true }), { size: 16, leading: 22 })
  gap(ctx, 8)
  confidentialLine(ctx)
  labelRows(ctx, [
    ['To', input.to],
    ['From', input.from],
    ['Cc', input.cc],
    ['Date', formatDate(input.dateISO)],
    ['Ref', input.reference],
    ['Subject', input.subject, true],
  ])
  hairline(ctx, true)
  renderBody(ctx, input.body)
  if (input.signatoryName.trim()) { gap(ctx, 14); signatureBlock(ctx, null) }
}

function renderNotice(ctx: Ctx) {
  const { input } = ctx
  confidentialLine(ctx)
  if (input.subject.trim()) { block(ctx, text(input.subject.trim(), { bold: true }), { size: 15, leading: 21 }); gap(ctx, 4) }
  const meta = [formatDate(input.dateISO), input.reference.trim() && `Ref: ${input.reference.trim()}`].filter(Boolean).join('   |   ')
  block(ctx, text(meta), { size: 9, leading: 13, tint: LETTERHEAD.muted })
  gap(ctx, 6)
  hairline(ctx)
  renderBody(ctx, input.body)
  if (input.signatoryName.trim()) { gap(ctx, 14); signatureBlock(ctx, null) }
  footnotes(ctx)
}

export type BuildResult = { bytes: Uint8Array; pageCount: number; unsupported: string[] }

export async function buildLetterheadPdf(raw: LetterheadInput, author = ''): Promise<BuildResult> {
  const assets = await loadAssets()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts: Fonts = {
    regular: await doc.embedFont(assets.regular, { subset: false }),
    bold: await doc.embedFont(assets.bold, { subset: false }),
    italic: await doc.embedFont(assets.italic, { subset: false }),
  }
  const supported = new Set<number>(fonts.regular.getCharacterSet())
  const missing = new Set<string>()
  const clean = (value: string) => sanitize(value, supported, missing)
  const input: LetterheadInput = {
    ...raw,
    reference: clean(raw.reference).replace(/\n/g, ' '),
    subject: clean(raw.subject).replace(/\n/g, ' '),
    body: clean(raw.body),
    recipient: clean(raw.recipient),
    salutation: clean(raw.salutation).replace(/\n/g, ' '),
    signatoryName: clean(raw.signatoryName).replace(/\n/g, ' '),
    signatoryTitle: clean(raw.signatoryTitle).replace(/\n/g, ' '),
    cc: clean(raw.cc).replace(/\n/g, ' '),
    enclosures: clean(raw.enclosures).replace(/\n/g, ' '),
    from: clean(raw.from),
    to: clean(raw.to),
    sentAt: clean(raw.sentAt).replace(/\n/g, ' '),
  }

  const wordmark = await doc.embedPng(assets.wordmark)
  const first = doc.addPage([PAGE_W, PAGE_H])
  const ctx: Ctx = { doc, fonts, wordmark, page: first, y: 0, pages: [first], input, supported, missing }
  drawHeader(ctx, 1)

  if (input.kind === 'letter') renderLetter(ctx)
  else if (input.kind === 'email') renderEmail(ctx)
  else if (input.kind === 'memo') renderMemo(ctx)
  else renderNotice(ctx)
  drawFooters(ctx)

  doc.setTitle(input.subject || `${LETTERHEAD.brandName} document`)
  doc.setAuthor(author || LETTERHEAD.legalName)
  doc.setCreator(`${LETTERHEAD.brandName} Workspace`)
  doc.setProducer(`${LETTERHEAD.brandName} Workspace`)
  doc.setSubject(input.reference)
  doc.setCreationDate(new Date())

  const bytes = await doc.save()
  return { bytes, pageCount: ctx.pages.length, unsupported: [...missing] }
}
