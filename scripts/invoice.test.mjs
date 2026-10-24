import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build as esbuild } from 'esbuild'

// PArAsYtE: tests for the invoice generator (src/lib/invoice.ts).

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

async function load() {
  const out = (await esbuild({
    entryPoints: [new URL('../src/lib/invoice.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  })).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}#${Math.random()}`)
}

const item = (qty, unitPrice) => ({ id: String(Math.random()), description: 'x', qty, unitPrice })

test('money is parsed and added in whole minor units, so no floating point dust', async () => {
  const m = await load()
  assert.equal(m.parseMoney('₦1,250.50'), 125050)
  assert.equal(m.parseMoney('1 250'), 125000)
  assert.equal(m.parseMoney(''), 0)
  assert.equal(m.parseMoney('-5'), 0) // a negative price is refused, never subtracted
  const totals = m.computeTotals({ ...m.emptyInvoice(), items: [item('3', '0.1'), item('1', '0.2')] })
  assert.equal(totals.subtotal, 50)
  assert.equal(m.formatMoney(123456789, 'NGN'), '₦1,234,567.89')
  assert.equal(m.formatMoney(-500000, 'USD'), '-$5,000.00')
})

test('totals: discount cannot exceed the subtotal, VAT applies after discount, paid cannot exceed the total', async () => {
  const m = await load()
  const base = { ...m.emptyInvoice(), items: [item('2', '50000')] }
  const t = m.computeTotals({ ...base, discount: '10000', vatRate: '7.5', otherCharges: '2500', amountPaid: '30000' })
  assert.equal(t.subtotal, 10000000)
  assert.equal(t.discount, 1000000)
  assert.equal(t.vat, 675000)                  // 7.5% of 90,000.00
  assert.equal(t.total, 9000000 + 675000 + 250000)
  assert.equal(t.paid, 3000000)
  assert.equal(t.balance, t.total - 3000000)
  assert.equal(m.computeTotals({ ...base, discount: '999999999' }).discount, 10000000)
  assert.equal(m.computeTotals({ ...base, amountPaid: '999999999' }).balance, 0)
  assert.equal(m.computeTotals({ ...base, vatRate: '500' }).vat, 10000000) // rate is capped at 100
  assert.equal(m.computeTotals({ ...base, items: [item('abc', '10')] }).subtotal, 0)
})

test('six templates cover the services asked for, each with its own details', async () => {
  const m = await load()
  assert.deepEqual(m.INVOICE_TEMPLATES.map(t => t.id), ['easybooking', 'charter', 'arrivoair', 'arrivoboat', 'chauffeur', 'general'])
  assert.equal(m.INVOICE_TEMPLATES.filter(t => t.onLetterhead).length, 1)
  assert.equal(m.templateById('general').onLetterhead, true)
  for (const t of m.INVOICE_TEMPLATES) {
    assert.ok(t.fields.length >= 2, t.id)
    assert.equal(new Set(t.fields.map(f => f.key)).size, t.fields.length, `${t.id} keys are unique`)
    assert.match(m.suggestInvoiceNo(t.id, new Date(2026, 9, 24, 13, 5)), new RegExp(`^RA-${t.prefix}-20261024-1305$`))
  }
})

test('filename is safe and the due date defaults to seven days out', async () => {
  const m = await load()
  assert.equal(m.invoiceFilename({ ...m.emptyInvoice(), invoiceNo: 'RA-EB/0001', clientName: 'Ade & Sons Ltd.' }), 'RideArrivo_Invoice_RA-EB-0001_Ade-Sons-Ltd.pdf')
  assert.equal(m.addDays('2026-10-28', 7), '2026-11-04')
  assert.equal(m.addDays('2026-12-30', 3), '2027-01-02')
})

test('a PDF is produced for every template, and a long invoice runs onto more pages', async () => {
  const { readFileSync: rf } = await import('node:fs')
  globalThis.fetch = async url => {
    const b = rf(new URL(`../public${url}`, import.meta.url))
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
  }
  const m = await load()
  for (const t of m.INVOICE_TEMPLATES) {
    const input = { ...m.emptyInvoice(t.id), clientName: 'Test Client', items: [{ ...item('1', '10000'), description: 'Service' }] }
    const result = await m.buildInvoicePdf(input)
    assert.equal(Buffer.from(result.bytes.slice(0, 5)).toString(), '%PDF-', t.id)
    assert.equal(result.pageCount, 1, t.id)
    assert.deepEqual(result.unsupported, [], t.id)
  }
  const many = { ...m.emptyInvoice(), items: Array.from({ length: 40 }, () => ({ ...item('1', '1500'), description: 'Line' })) }
  assert.ok((await m.buildInvoicePdf(many)).pageCount >= 2)
})

test('wiring: Invoice is in the navigation, limited to admin, finance and operations, and uses the shared engine', () => {
  const app = read('src/App.tsx')
  assert.match(app, /invoice:\[\.\.\.INVOICE_ROLES\]/)
  assert.match(app, /\['invoice','Invoice',ReceiptText\]/)
  assert.match(app, /section==='invoice'&&<InvoiceStudio/)
  assert.match(read('src/lib/invoiceAccess.ts'), /\['admin', 'finance', 'operations'\]/)
  assert.match(read('src/lib/workspaceNav.ts'), /'invoice',/)
  assert.match(read('src/lazy-routes.tsx'), /InvoiceStudio = lazy/)
  const studio = read('src/modules/InvoiceStudio.tsx')
  assert.match(studio, /canUseInvoice\(role\)/)
  assert.doesNotMatch(read('src/lib/invoice.ts') + studio + read('src/invoice.css'), /—/)
})
