import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

// The engine is TypeScript. Bundle it once with esbuild (already installed with
// Vite) and import the result, so these tests run the real code, not a copy.
const out = join(mkdtempSync(join(tmpdir(), 'fsheets-')), 'engine.mjs')
buildSync({
  stdin: {
    contents: `export * from './src/lib/sheetModel.ts'; export * from './src/lib/sheetFormula.ts'; export * from './src/lib/sheetOps.ts'`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
})
const M = await import(pathToFileURL(out).href)

/** Builds a one-sheet workbook from { A1: '5', B1: '=A1*2' } and returns a helper to read results. */
function sheet(cells, extra = []) {
  const wb = {
    sheets: [
      { name: 'Sheet1', cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v: String(v) }])) },
      ...extra,
    ],
  }
  const calc = new M.Calc(wb)
  return {
    wb,
    calc,
    get: ref => {
      const { row, col } = M.parseRef(ref)
      return calc.value(0, row, col)
    },
    show: ref => {
      const { row, col } = M.parseRef(ref)
      return calc.display(0, row, col)
    },
  }
}

const close = (actual, expected, eps = 1e-4) => assert.ok(Math.abs(actual - expected) < eps, `${actual} is not close to ${expected}`)
const code = v => (v instanceof M.SheetError ? v.code : v)

test('column letters and references round-trip', () => {
  assert.equal(M.colName(1), 'A')
  assert.equal(M.colName(26), 'Z')
  assert.equal(M.colName(27), 'AA')
  assert.equal(M.colName(52), 'AZ')
  assert.equal(M.colIndex('AA'), 27)
  assert.deepEqual(M.parseRef('$B$12'), { row: 12, col: 2 })
  assert.equal(M.parseRef('nope'), null)
  assert.equal(M.refKey(3, 28), 'AB3')
})

test('typed values: numbers, thousands, percent, naira, brackets, dates, text', () => {
  const s = sheet({ A1: '1,250.50', A2: '12%', A3: '₦5,000', A4: '(300)', A5: '11/10/2026', A6: 'hello', A7: "'0123", A8: 'TRUE' })
  assert.equal(s.get('A1'), 1250.5)
  close(s.get('A2'), 0.12)
  assert.equal(s.get('A3'), 5000)
  assert.equal(s.get('A4'), -300)
  assert.equal(M.serialToIso(s.get('A5')), '2026-10-11')
  assert.equal(s.get('A6'), 'hello')
  assert.equal(s.get('A7'), '0123')
  assert.equal(s.get('A8'), true)
  assert.equal(M.inferFormat('2026-10-11'), 'date')
  assert.equal(M.inferFormat('12%'), 'pct')
  assert.equal(M.inferFormat('₦5'), 'ngn')
  assert.equal(M.inferFormat('abc'), undefined)
})

test('arithmetic follows Excel precedence', () => {
  const s = sheet({ A1: '=2+3*4', A2: '=(2+3)*4', A3: '=-2^2', A4: '=2^3^2', A5: '=10/4', A6: '=50%*200', A7: '="a"&"b"&1', A8: '=1/0', A9: '=2^-1' })
  assert.equal(s.get('A1'), 14)
  assert.equal(s.get('A2'), 20)
  assert.equal(s.get('A3'), 4)
  assert.equal(s.get('A4'), 64)
  assert.equal(s.get('A5'), 2.5)
  assert.equal(s.get('A6'), 100)
  assert.equal(s.get('A7'), 'ab1')
  assert.equal(code(s.get('A8')), '#DIV/0!')
  assert.equal(s.get('A9'), 0.5)
})

test('cell references, ranges, and dependency chains', () => {
  const s = sheet({ A1: 10, A2: 20, A3: 30, B1: '=A1*2', B2: '=B1+A2', B3: '=SUM(A1:A3)', B4: '=SUM(B1:B2)' })
  assert.equal(s.get('B1'), 20)
  assert.equal(s.get('B2'), 40)
  assert.equal(s.get('B3'), 60)
  assert.equal(s.get('B4'), 60)
})

test('circular references give #CIRC! instead of hanging', () => {
  const s = sheet({ A1: '=B1', B1: '=A1', C1: '=C1+1' })
  assert.equal(code(s.get('A1')), '#CIRC!')
  assert.equal(code(s.get('C1')), '#CIRC!')
})

test('a long running-balance chain does not overflow the stack', () => {
  const cells = { A1: '1' }
  for (let r = 2; r <= 1500; r += 1) cells[`A${r}`] = `=A${r - 1}+1`
  const s = sheet(cells)
  assert.equal(s.show('A1500'), '1500')
})

test('statistics and aggregates', () => {
  const s = sheet({
    A1: 4, A2: 8, A3: 15, A4: 'x', A5: '', A6: 16,
    B1: '=SUM(A1:A6)', B2: '=AVERAGE(A1:A6)', B3: '=MIN(A1:A6)', B4: '=MAX(A1:A6)',
    B5: '=COUNT(A1:A6)', B6: '=COUNTA(A1:A6)', B7: '=MEDIAN(A1:A6)', B8: '=LARGE(A1:A6,2)', B9: '=SMALL(A1:A6,1)',
    B10: '=PRODUCT(A1:A3)', B11: '=SUMPRODUCT(A1:A3,A1:A3)', B12: '=RANK(8,A1:A6)', B13: '=COUNTBLANK(A1:A6)',
  })
  assert.equal(s.get('B1'), 43)
  assert.equal(s.get('B2'), 43 / 4)
  assert.equal(s.get('B3'), 4)
  assert.equal(s.get('B4'), 16)
  assert.equal(s.get('B5'), 4)
  assert.equal(s.get('B6'), 5)
  assert.equal(s.get('B7'), 11.5)
  assert.equal(s.get('B8'), 15)
  assert.equal(s.get('B9'), 4)
  assert.equal(s.get('B10'), 480)
  assert.equal(s.get('B11'), 16 + 64 + 225)
  assert.equal(s.get('B12'), 3)
  assert.equal(s.get('B13'), 1)
})

test('conditional aggregates: SUMIF, SUMIFS, COUNTIF, COUNTIFS, AVERAGEIF, MAXIFS', () => {
  const s = sheet({
    A1: 'Fuel', A2: 'Salaries', A3: 'Fuel', A4: 'Rent', A5: 'fuel cost',
    B1: 100, B2: 500, B3: 250, B4: 900, B5: 50,
    C1: 'Q1', C2: 'Q1', C3: 'Q2', C4: 'Q1', C5: 'Q2',
    D1: '=SUMIF(A1:A5,"Fuel",B1:B5)', D2: '=SUMIF(B1:B5,">200")', D3: '=COUNTIF(A1:A5,"fuel*")',
    D4: '=SUMIFS(B1:B5,A1:A5,"Fuel",C1:C5,"Q2")', D5: '=COUNTIFS(C1:C5,"Q1",B1:B5,">=500")',
    D6: '=AVERAGEIF(A1:A5,"Fuel",B1:B5)', D7: '=MAXIFS(B1:B5,C1:C5,"Q1")', D8: '=COUNTIF(B1:B5,"<>100")', D9: '=SUMIF(A1:A5,"<>Fuel",B1:B5)',
  })
  assert.equal(s.get('D1'), 350)
  assert.equal(s.get('D2'), 1650)
  assert.equal(s.get('D3'), 3)
  assert.equal(s.get('D4'), 250)
  assert.equal(s.get('D5'), 2)
  assert.equal(s.get('D6'), 175)
  assert.equal(s.get('D7'), 900)
  assert.equal(s.get('D8'), 4)
  assert.equal(s.get('D9'), 1450, 'Salaries + Rent + "fuel cost" (a different label from "Fuel")')
})

test('logic: IF is lazy, IFS, IFERROR, IFNA, AND, OR, SWITCH', () => {
  const s = sheet({
    A1: 0, A2: 5,
    B1: '=IF(A1=0,0,10/A1)', B2: '=IF(A2>3,"big","small")', B3: '=IFS(A2<3,"low",A2<10,"mid",TRUE,"high")',
    B4: '=IFERROR(1/A1,"n/a")', B5: '=IFERROR(A2*2,"n/a")', B6: '=AND(A2>1,A2<9)', B7: '=OR(A1>1,A2>9)', B8: '=NOT(A1)',
    B9: '=SWITCH(A2,1,"one",5,"five","other")', B10: '=IFNA(VLOOKUP(99,A1:A2,1,FALSE),"missing")', B11: '=IF(A2>3,1)', B12: '=IF(A2>30,1)',
  })
  assert.equal(s.get('B1'), 0)
  assert.equal(s.get('B2'), 'big')
  assert.equal(s.get('B3'), 'mid')
  assert.equal(s.get('B4'), 'n/a')
  assert.equal(s.get('B5'), 10)
  assert.equal(s.get('B6'), true)
  assert.equal(s.get('B7'), false)
  assert.equal(s.get('B8'), true)
  assert.equal(s.get('B9'), 'five')
  assert.equal(s.get('B10'), 'missing')
  assert.equal(s.get('B11'), 1)
  assert.equal(s.get('B12'), false)
})

test('rounding matches Excel (half away from zero, no float surprises)', () => {
  const s = sheet({ A1: '=ROUND(2.5,0)', A2: '=ROUND(-2.5,0)', A3: '=ROUND(1.005,2)', A4: '=ROUND(1234.5678,-2)', A5: '=ROUNDUP(1.21,1)', A6: '=ROUNDDOWN(-1.99,1)', A7: '=INT(-1.5)', A8: '=MOD(-7,3)', A9: '=CEILING(7,5)', A10: '=FLOOR(7,5)', A11: '=TRUNC(8.987,2)' })
  assert.equal(s.get('A1'), 3)
  assert.equal(s.get('A2'), -3)
  assert.equal(s.get('A3'), 1.01)
  assert.equal(s.get('A4'), 1200)
  assert.equal(s.get('A5'), 1.3)
  assert.equal(s.get('A6'), -1.9)
  assert.equal(s.get('A7'), -2)
  assert.equal(s.get('A8'), 2)
  assert.equal(s.get('A9'), 10)
  assert.equal(s.get('A10'), 5)
  assert.equal(s.get('A11'), 8.98)
})

test('text functions', () => {
  const s = sheet({
    A1: 'Lagos Airport', B1: '=LEN(A1)', B2: '=LEFT(A1,5)', B3: '=RIGHT(A1,7)', B4: '=MID(A1,7,3)', B5: '=UPPER(A1)', B6: '=LOWER(A1)',
    B7: '=SUBSTITUTE(A1,"Airport","Terminal")', B8: '=TRIM("  a   b ")', B9: '=A1&" - "&B1', B10: '=TEXTJOIN(", ",TRUE,"a","","b")',
    B11: '=FIND("Air",A1)', B12: '=PROPER("ride arrivo")', B13: '=VALUE("1,200")', B14: '=REPT("ab",3)', B15: '=EXACT("a","A")', B16: '=CONCAT("a","b")',
  })
  assert.equal(s.get('B1'), 13)
  assert.equal(s.get('B2'), 'Lagos')
  assert.equal(s.get('B3'), 'Airport')
  assert.equal(s.get('B4'), 'Air')
  assert.equal(s.get('B5'), 'LAGOS AIRPORT')
  assert.equal(s.get('B6'), 'lagos airport')
  assert.equal(s.get('B7'), 'Lagos Terminal')
  assert.equal(s.get('B8'), 'a b')
  assert.equal(s.get('B9'), 'Lagos Airport - 13')
  assert.equal(s.get('B10'), 'a, b')
  assert.equal(s.get('B11'), 7)
  assert.equal(s.get('B12'), 'Ride Arrivo')
  assert.equal(s.get('B13'), 1200)
  assert.equal(s.get('B14'), 'ababab')
  assert.equal(s.get('B15'), false)
  assert.equal(s.get('B16'), 'ab')
})

test('TEXT formats numbers and dates', () => {
  const s = sheet({
    A1: '=TEXT(1234.5,"#,##0.00")', A2: '=TEXT(0.256,"0.0%")', A3: '=TEXT(DATE(2026,10,11),"yyyy-mm-dd")', A4: '=TEXT(DATE(2026,10,11),"dd/mm/yyyy")',
    A5: '=TEXT(DATE(2026,10,11),"mmm yyyy")', A6: '=TEXT(7,"000")', A7: '=TEXT(1234567,"₦#,##0")', A8: '=TEXT(-5,"0.00")',
  })
  assert.equal(s.get('A1'), '1,234.50')
  assert.equal(s.get('A2'), '25.6%')
  assert.equal(s.get('A3'), '2026-10-11')
  assert.equal(s.get('A4'), '11/10/2026')
  assert.equal(s.get('A5'), 'Oct 2026')
  assert.equal(s.get('A6'), '007')
  assert.equal(s.get('A7'), '₦1,234,567')
  assert.equal(s.get('A8'), '-5.00')
})

test('lookups: VLOOKUP, HLOOKUP, XLOOKUP, MATCH, INDEX, CHOOSE', () => {
  const s = sheet({
    A1: 'Fuel', B1: 100, A2: 'Rent', B2: 900, A3: 'Tax', B3: 40,
    D1: '=VLOOKUP("Rent",A1:B3,2,FALSE)', D2: '=XLOOKUP("Tax",A1:A3,B1:B3)', D3: '=XLOOKUP("Nope",A1:A3,B1:B3,"none")',
    D4: '=MATCH("Rent",A1:A3,0)', D5: '=INDEX(B1:B3,2)', D6: '=INDEX(A1:B3,3,2)', D7: '=CHOOSE(2,"a","b","c")', D8: '=VLOOKUP("Zzz",A1:B3,2,FALSE)',
    E1: 10, F1: 20, G1: 30, E2: 'a', F2: 'b', G2: 'c', D9: '=HLOOKUP(20,E1:G2,2,FALSE)',
    H1: 10, H2: 20, H3: 30, I1: 'low', I2: 'mid', I3: 'high', D10: '=VLOOKUP(25,H1:I3,2,TRUE)', D11: '=XLOOKUP(25,H1:H3,I1:I3,"x",-1)',
  })
  assert.equal(s.get('D1'), 900)
  assert.equal(s.get('D2'), 40)
  assert.equal(s.get('D3'), 'none')
  assert.equal(s.get('D4'), 2)
  assert.equal(s.get('D5'), 900)
  assert.equal(s.get('D6'), 40)
  assert.equal(s.get('D7'), 'b')
  assert.equal(code(s.get('D8')), '#N/A')
  assert.equal(s.get('D9'), 'b')
  assert.equal(s.get('D10'), 'mid')
  assert.equal(s.get('D11'), 'mid')
})

test('dates: serials, DATE, EDATE, EOMONTH, DATEDIF, WEEKDAY, NETWORKDAYS', () => {
  const s = sheet({
    A1: '=DATE(2026,10,11)', A2: '=A1+30', A3: '=YEAR(A1)', A4: '=MONTH(A1)', A5: '=DAY(A1)', A6: '=EDATE(A1,3)', A7: '=EOMONTH(A1,0)',
    A8: '=DATEDIF(DATE(2026,1,15),A1,"M")', A9: '=WEEKDAY(A1)', A10: '=NETWORKDAYS(DATE(2026,10,5),DATE(2026,10,11))', A11: '=A2-A1', A12: '=EDATE(DATE(2026,1,31),1)', A13: '=DAYS(DATE(2026,12,25),A1)',
    A14: '=DATE(2026,14,1)', A15: '=DATEDIF(DATE(2020,3,1),A1,"Y")',
  })
  assert.equal(M.serialToIso(s.get('A1')), '2026-10-11')
  assert.equal(M.serialToIso(s.get('A2')), '2026-11-10')
  assert.equal(s.get('A3'), 2026)
  assert.equal(s.get('A4'), 10)
  assert.equal(s.get('A5'), 11)
  assert.equal(M.serialToIso(s.get('A6')), '2027-01-11')
  assert.equal(M.serialToIso(s.get('A7')), '2026-10-31')
  assert.equal(s.get('A8'), 8)
  assert.equal(s.get('A9'), 1, '2026-10-11 is a Sunday')
  assert.equal(s.get('A10'), 5)
  assert.equal(s.get('A11'), 30)
  assert.equal(M.serialToIso(s.get('A12')), '2026-02-28')
  assert.equal(s.get('A13'), 75)
  assert.equal(M.serialToIso(s.get('A14')), '2027-02-01')
  assert.equal(s.get('A15'), 6)
})

test('financial functions match Excel', () => {
  const s = sheet({
    A1: 100, A2: 200, A3: 300, B1: -1000, B2: 300, B3: 400, B4: 500,
    C1: '=PMT(0.01,12,1000)', C2: '=FV(0.01,12,-100)', C3: '=PV(0.01,12,-100)', C4: '=NPV(0.1,A1:A3)', C5: '=IRR(B1:B4)',
    C6: '=NPER(0.01,-100,1000)', C7: '=RATE(12,-88.8488,1000)', C8: '=SLN(1000,100,5)', C9: '=PMT(0,10,1000)', C10: '=PMT(0.02,10,5000,0,1)',
  })
  close(s.get('C1'), -88.8488, 1e-3)
  close(s.get('C2'), 1268.2503, 1e-3)
  close(s.get('C3'), 1125.5077, 1e-3)
  close(s.get('C4'), 100 / 1.1 + 200 / 1.21 + 300 / 1.331, 1e-6)
  close(s.get('C5'), 0.08896, 1e-4)
  close(s.get('C6'), 10.5886, 1e-3)
  close(s.get('C7'), 0.01, 1e-4)
  assert.equal(s.get('C8'), 180)
  assert.equal(s.get('C9'), -100)
  close(s.get('C10'), -545.718, 1e-2)
})

test('cross-sheet references, including names with spaces', () => {
  const s = sheet(
    { A1: "='Q3 Budget'!B2+Data!A1", A2: '=SUM(Data!A1:A3)', A3: '=Missing!A1', A4: "=SUMIF('Q3 Budget'!A1:A2,\"x\",'Q3 Budget'!B1:B2)" },
    [
      { name: 'Q3 Budget', cells: { B2: { v: '40' }, A1: { v: 'x' }, B1: { v: '5' } } },
      { name: 'Data', cells: { A1: { v: '2' }, A2: { v: '3' }, A3: { v: '4' } } },
    ],
  )
  assert.equal(s.get('A1'), 42)
  assert.equal(s.get('A2'), 9)
  assert.equal(code(s.get('A3')), '#REF!')
  assert.equal(s.get('A4'), 5)
})

test('whole-column ranges only cover used rows', () => {
  const s = sheet({ A1: 5, A2: 6, A3: 7, B1: '=SUM(A:A)', B2: '=COUNT(A:A)', B3: '=SUM(1:1)' })
  assert.equal(s.get('B1'), 18 + 0 * 1)
  assert.equal(s.get('B2'), 3)
})

test('bad input gives errors, never exceptions', () => {
  const s = sheet({ A1: '=1+', A2: '=NOPE(1)', A3: '=SUM(', A4: '=A1', A5: '="x"+1', A6: '=SQRT(-1)', A7: '=ABC', A8: '=1+#REF!', A9: '=(1', A10: '=)' })
  for (const ref of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10']) {
    assert.ok(s.get(ref) instanceof M.SheetError, `${ref} should be an error, got ${s.get(ref)}`)
  }
  assert.equal(code(s.get('A2')), '#NAME?')
  assert.equal(code(s.get('A5')), '#VALUE!')
  assert.equal(code(s.get('A6')), '#NUM!')
})

test('display formats: naira, percent, number, date, plain', () => {
  const wb = { sheets: [{ name: 'S', cells: { A1: { v: '1234.5', nf: 'ngn' }, A2: { v: '0.256', nf: 'pct' }, A3: { v: '1234567.891', nf: 'num' }, A4: { v: '2026-10-11', nf: 'date' }, A5: { v: '=1/3' }, A6: { v: '-2500', nf: 'ngn' }, A7: { v: '=A1>1' } } }] }
  const c = new M.Calc(wb)
  assert.equal(c.display(0, 1, 1), '₦1,234.50')
  assert.equal(c.display(0, 2, 1), '25.60%')
  assert.equal(c.display(0, 3, 1), '1,234,567.89')
  assert.equal(c.display(0, 4, 1), '2026-10-11')
  assert.equal(c.display(0, 5, 1), '0.333333333333')
  assert.equal(c.display(0, 6, 1), '-₦2,500.00')
  assert.equal(c.display(0, 7, 1), 'TRUE')
})

test('copy and fill: relative references move, absolute ones stay', () => {
  assert.equal(M.shiftFormula('A1+B$2+$C3+$D$4', 1, 1), 'B2+C$2+$C4+$D$4')
  assert.equal(M.shiftFormula('SUM(A1:A3)', 2, 0), 'SUM(A3:A5)')
  assert.equal(M.shiftFormula('"A1"&A1', 1, 0), '"A1"&A2')
  assert.equal(M.shiftFormula("'Q3 Budget'!B2+Data!A1", 1, 0), "'Q3 Budget'!B3+Data!A2")
  assert.equal(M.shiftFormula('LOG10(A1)', 1, 0), 'LOG10(A2)')
  assert.equal(M.shiftFormula('A1', -1, 0), '#REF!')
  assert.equal(M.shiftFormula('A1', 0, 0), 'A1')
})

test('clipboard text: tabs, quotes, multi-line cells, trailing newline', () => {
  assert.deepEqual(M.parseTsv('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(M.parseTsv('"x\ty"\t"he said ""hi"""\r\n"line1\nline2"\tz'), [['x\ty', 'he said "hi"'], ['line1\nline2', 'z']])
  assert.equal(M.toTsv([['a', 'b\tc'], ['1', '"q"']]), 'a\t"b\tc"\n1\t"""q"""')
  assert.deepEqual(M.parseTsv(M.toTsv([['a', 'b\tc'], ['1', '"q"']])), [['a', 'b\tc'], ['1', '"q"']])
  assert.deepEqual(M.parseCsv('a,"b,c"\n1,2\n\n'), [['a', 'b,c'], ['1', '2']])
})

test('stored data from the database is sanitised before the editor sees it', () => {
  assert.equal(M.sanitizeWorkbook(null).sheets.length, 1)
  assert.equal(M.sanitizeWorkbook({ sheets: [] }).sheets.length, 1)
  const wb = M.sanitizeWorkbook({
    sheets: [{ name: 'X', cells: { A1: { v: '1', b: 1, nf: 'ngn', al: 'r' }, ZZZ9: { v: 'bad' }, B2: { v: 5 }, C3: { v: 'ok', nf: 'weird', al: 'q' } }, widths: { 1: 9999, 2: 10, 99: 100 } }],
  })
  assert.deepEqual(Object.keys(wb.sheets[0].cells).sort(), ['A1', 'C3'])
  assert.deepEqual(wb.sheets[0].cells.C3, { v: 'ok' })
  assert.equal(wb.sheets[0].widths['1'], 480)
  assert.equal(wb.sheets[0].widths['2'], 44)
  assert.equal(wb.sheets[0].widths['99'], undefined)
})

test('every function advertised in the editor is implemented', () => {
  for (const name of ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'IFERROR', 'VLOOKUP', 'XLOOKUP', 'SUMIFS', 'COUNTIFS', 'PMT', 'NPV', 'IRR', 'EOMONTH', 'TEXT', 'ROUND']) {
    assert.ok(M.SUPPORTED_FUNCTIONS.includes(name), `${name} missing`)
  }
  assert.ok(M.SUPPORTED_FUNCTIONS.length >= 100)
})

test('Finance Sheets are locked to Finance and Admin, and are archived rather than deleted', () => {
  const sql = readFileSync('supabase/migrations/20261011200000_finance_sheets.sql', 'utf8')
  assert.match(sql, /alter table public\.finance_sheets enable row level security/)
  assert.doesNotMatch(sql, /'manager'/, 'managers must not see finance sheets')
  assert.doesNotMatch(sql, /for delete|for all/i, 'no delete policy')
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to authenticated/i)
  assert.match(sql, /has_workspace_role\(array\['finance','admin'\]\)/)
  assert.match(sql, /revoke all on public\.finance_sheets from anon/)
  assert.match(sql, /security definer\s+set search_path = public/i)
  assert.doesNotMatch(sql, /\u2014/, 'no em dashes')
})

const wbOf = (sheets) => ({ sheets: sheets.map(([name, cells]) => ({ name, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v: String(v) }])) })) })
const val = (wb, si, ref) => { const { row, col } = M.parseRef(ref); return new M.Calc(wb).value(si, row, col) }

test('inserting a row inside a range grows the total; below it leaves it alone', () => {
  const wb = wbOf([['S', { A1: 1, A2: 2, A3: 3, A4: '=SUM(A1:A3)', A5: '=A4*2' }]])
  const inside = M.insertLines(wb, 0, 'row', 2)
  assert.equal(inside.sheets[0].cells.A5.v, '=SUM(A1:A4)')
  assert.equal(inside.sheets[0].cells.A6.v, '=A5*2')
  assert.equal(val(inside, 0, 'A5'), 6)
  const below = M.insertLines(wb, 0, 'row', 4)
  assert.equal(below.sheets[0].cells.A5.v, '=SUM(A1:A3)')
})

test('deleting rows: totals shrink, references to deleted cells become #REF!', () => {
  const wb = wbOf([['S', { A1: 1, A2: 2, A3: 3, A4: '=SUM(A1:A3)', B1: '=A2', B4: '=A3' }]])
  const gone = M.deleteLines(wb, 0, 'row', 2)
  assert.equal(gone.sheets[0].cells.A3.v, '=SUM(A1:A2)')
  assert.equal(val(gone, 0, 'A3'), 4)
  assert.equal(gone.sheets[0].cells.B1.v, '=#REF!')
  assert.equal(code(val(gone, 0, 'B1')), '#REF!')
  assert.equal(gone.sheets[0].cells.B3.v, '=A2')
  assert.equal(gone.sheets[0].cells.A4, undefined)
})

test('column insert and delete move cells, widths and whole-column references', () => {
  const wb = wbOf([['S', { A1: 5, B1: 6, C1: '=A1+B1', D1: '=SUM(A:B)' }]])
  wb.sheets[0].widths = { 2: 200 }
  const ins = M.insertLines(wb, 0, 'col', 2)
  assert.equal(ins.sheets[0].cells.D1.v, '=A1+C1')
  assert.equal(ins.sheets[0].cells.E1.v, '=SUM(A:C)')
  assert.equal(ins.sheets[0].widths['3'], 200)
  const del = M.deleteLines(wb, 0, 'col', 1)
  assert.equal(del.sheets[0].cells.B1.v, '=#REF!+A1')
})

test('formulas on other sheets follow structural edits, and unrelated sheets are untouched', () => {
  const wb = wbOf([['Data', { A1: 1, A2: 2, A3: 3 }], ['Report', { A1: '=SUM(Data!A1:A3)', A2: '=SUM(A1:A3)', A3: "=Data!A3+'Data'!A2" }]])
  const next = M.insertLines(wb, 0, 'row', 1)
  assert.equal(next.sheets[1].cells.A1.v, '=SUM(Data!A2:A4)')
  assert.equal(next.sheets[1].cells.A2.v, '=SUM(A1:A3)', 'own-sheet references on Report do not move when Data changes')
  assert.equal(next.sheets[1].cells.A3.v, "=Data!A4+'Data'!A3")
  assert.equal(val(next, 1, 'A1'), 6)
})

test('renaming a sheet rewrites the formulas that point to it', () => {
  const wb = wbOf([['Data', { A1: 7 }], ['Report', { A1: '=Data!A1*2', A2: "='Data'!A1+1" }]])
  const next = M.renameSheet(wb, 0, 'Q3 Budget')
  assert.equal(next.sheets[1].cells.A1.v, "='Q3 Budget'!A1*2")
  assert.equal(next.sheets[1].cells.A2.v, "='Q3 Budget'!A1+1")
  assert.equal(val(next, 1, 'A1'), 14)
})

test('Sheets export is a direct download for finance and admin (no approval gate)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/modules/SheetEditor.tsx', import.meta.url), 'utf8')
  assert.ok(!src.includes('ControlledDownloadButton'))
  assert.ok(src.includes('aria-label="Export Excel"'))
})
