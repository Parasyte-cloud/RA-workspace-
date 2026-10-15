// Finance Sheets: the formula engine.
//
// A small Excel-compatible evaluator, written in-house on purpose. The off-the-shelf
// parsers we tried lacked basics a finance team needs (MIN, MAX, COUNTA, PMT, NPV,
// SUMIFS, XLOOKUP), so this covers the functions people actually type, and every
// one of them is covered by a test in scripts/finance-sheets.test.mjs.
//
// How it works, in one paragraph: a formula string is turned into a tree once
// (and remembered), then evaluated against a `Calc`, which looks up other cells on
// demand and remembers each answer. Because evaluation is lazy, a sheet with a
// thousand formulas only computes the ones that are on screen or that something on
// screen depends on. A cell that depends on itself gets #CIRC! instead of
// looping forever.

import {
  MAX_COLS,
  MAX_ROWS,
  colIndex,
  dateToSerial,
  formatNumber,
  formatWithPattern,
  parseInput,
  plainNumber,
  refKey,
  serialToParts,
  todaySerial,
  usedExtent,
} from './sheetModel'
import type { Cell, WorkbookData } from './sheetModel'

// ------------------------------------------------------------------- values

export class SheetError {
  constructor(readonly code: string) {}
  toString() { return this.code }
}

export type Scalar = number | string | boolean | null | SheetError
export type Value = Scalar | RangeVal

export const E = {
  div0: new SheetError('#DIV/0!'),
  value: new SheetError('#VALUE!'),
  ref: new SheetError('#REF!'),
  name: new SheetError('#NAME?'),
  na: new SheetError('#N/A'),
  num: new SheetError('#NUM!'),
  circ: new SheetError('#CIRC!'),
  parse: new SheetError('#ERROR!'),
}

export const isErr = (v: unknown): v is SheetError => v instanceof SheetError

export class RangeVal {
  constructor(
    readonly calc: Calc,
    readonly si: number,
    readonly r1: number,
    readonly c1: number,
    readonly r2: number,
    readonly c2: number,
  ) {}
  get rows() { return this.r2 - this.r1 + 1 }
  get cols() { return this.c2 - this.c1 + 1 }
  at(i: number, j: number): Scalar { return this.calc.value(this.si, this.r1 + i, this.c1 + j) }
  values(): Scalar[] {
    const out: Scalar[] = []
    for (let i = 0; i < this.rows; i += 1) for (let j = 0; j < this.cols; j += 1) out.push(this.at(i, j))
    return out
  }
}

// ------------------------------------------------------------------- parser

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: SheetError }
  | { k: 'ref'; sheet?: string; r1: number; c1: number; r2: number; c2: number; range: boolean; open?: 'col' | 'row' }
  | { k: 'un'; op: '-' | '+'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'empty' }

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; node: Extract<Node, { k: 'ref' }> }
  | { t: 'name'; v: string }
  | { t: 'err'; v: SheetError }
  | { t: 'op'; v: string }

const ERR_CODES: Record<string, SheetError> = {
  '#DIV/0!': E.div0, '#VALUE!': E.value, '#REF!': E.ref, '#NAME?': E.name, '#N/A': E.na, '#NUM!': E.num, '#CIRC!': E.circ,
}

const SHEET_PREFIX = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!`
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`
const RE_REF = new RegExp(String.raw`^(?:${SHEET_PREFIX})?(${CELL})(?::(${CELL}))?(?![A-Za-z0-9_(.])`)
const RE_COLS = new RegExp(String.raw`^(?:${SHEET_PREFIX})?(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})(?![A-Za-z0-9_(.])`)
const RE_ROWS = new RegExp(String.raw`^(?:${SHEET_PREFIX})?(\$?\d{1,7}):(\$?\d{1,7})(?![\d.A-Za-z(])`)

function cellParts(text: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text)!
  return { col: colIndex(m[1]), row: Number(m[2]) }
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i += 1; continue }
    const rest = src.slice(i)

    if (ch === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) throw E.parse
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue }
          break
        }
        s += src[j]; j += 1
      }
      toks.push({ t: 'str', v: s })
      i = j + 1
      continue
    }

    if (ch === '#') {
      const m = /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|CIRC!)/i.exec(rest)
      if (!m) throw E.parse
      toks.push({ t: 'err', v: ERR_CODES[m[0].toUpperCase()] })
      i += m[0].length
      continue
    }

    let m = RE_COLS.exec(rest)
    if (m) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
      const a = colIndex(m[3].replace('$', ''))
      const b = colIndex(m[4].replace('$', ''))
      toks.push({ t: 'ref', node: { k: 'ref', sheet, r1: 1, c1: Math.min(a, b), r2: MAX_ROWS, c2: Math.max(a, b), range: true, open: 'col' } })
      i += m[0].length
      continue
    }
    m = RE_ROWS.exec(rest)
    if (m) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
      const a = Number(m[3].replace('$', ''))
      const b = Number(m[4].replace('$', ''))
      toks.push({ t: 'ref', node: { k: 'ref', sheet, r1: Math.min(a, b), c1: 1, r2: Math.max(a, b), c2: MAX_COLS, range: true, open: 'row' } })
      i += m[0].length
      continue
    }
    m = RE_REF.exec(rest)
    if (m) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
      const a = cellParts(m[3])
      const b = m[4] ? cellParts(m[4]) : a
      toks.push({
        t: 'ref',
        node: {
          k: 'ref', sheet,
          r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col),
          range: Boolean(m[4]),
        },
      })
      i += m[0].length
      continue
    }

    m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest)
    if (m) {
      toks.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }

    m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)
    if (m) {
      toks.push({ t: 'name', v: m[0] })
      i += m[0].length
      continue
    }

    const two = rest.slice(0, 2)
    if (two === '<=' || two === '>=' || two === '<>') { toks.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/^&=<>(),%;'.includes(ch)) { toks.push({ t: 'op', v: ch === ';' ? ',' : ch }); i += 1; continue }
    throw E.parse
  }
  return toks
}

class Parser {
  private p = 0
  constructor(private toks: Tok[]) {}

  parse(): Node {
    const n = this.comparison()
    if (this.p < this.toks.length) throw E.parse
    return n
  }

  private peekOp(...ops: string[]) {
    const t = this.toks[this.p]
    return t && t.t === 'op' && ops.includes(t.v) ? t.v : null
  }

  private comparison(): Node {
    let a = this.concat()
    for (let op = this.peekOp('=', '<>', '<', '>', '<=', '>='); op; op = this.peekOp('=', '<>', '<', '>', '<=', '>=')) {
      this.p += 1
      a = { k: 'bin', op, a, b: this.concat() }
    }
    return a
  }

  private concat(): Node {
    let a = this.additive()
    while (this.peekOp('&')) {
      this.p += 1
      a = { k: 'bin', op: '&', a, b: this.additive() }
    }
    return a
  }

  private additive(): Node {
    let a = this.term()
    for (let op = this.peekOp('+', '-'); op; op = this.peekOp('+', '-')) {
      this.p += 1
      a = { k: 'bin', op, a, b: this.term() }
    }
    return a
  }

  private term(): Node {
    let a = this.power()
    for (let op = this.peekOp('*', '/'); op; op = this.peekOp('*', '/')) {
      this.p += 1
      a = { k: 'bin', op, a, b: this.power() }
    }
    return a
  }

  // Excel evaluates ^ left to right, and unary minus binds tighter than ^ (so -2^2 is 4).
  private power(): Node {
    let a = this.unary()
    while (this.peekOp('^')) {
      this.p += 1
      a = { k: 'bin', op: '^', a, b: this.unary() }
    }
    return a
  }

  private unary(): Node {
    const op = this.peekOp('-', '+')
    if (op) {
      this.p += 1
      return { k: 'un', op: op as '-' | '+', a: this.unary() }
    }
    return this.postfix()
  }

  private postfix(): Node {
    let a = this.primary()
    while (this.peekOp('%')) {
      this.p += 1
      a = { k: 'pct', a }
    }
    return a
  }

  private primary(): Node {
    const t = this.toks[this.p]
    if (!t) throw E.parse
    this.p += 1
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v }
      case 'str': return { k: 'str', v: t.v }
      case 'err': return { k: 'err', v: t.v }
      case 'ref': return t.node
      case 'name': {
        if (this.peekOp('(')) {
          this.p += 1
          const args: Node[] = []
          if (this.peekOp(')')) { this.p += 1; return { k: 'call', name: t.v.toUpperCase(), args } }
          for (;;) {
            // An empty argument, as in IF(A1,,2), is allowed.
            if (this.peekOp(',', ')')) args.push({ k: 'empty' })
            else args.push(this.comparison())
            if (this.peekOp(',')) { this.p += 1; continue }
            if (this.peekOp(')')) { this.p += 1; break }
            throw E.parse
          }
          return { k: 'call', name: t.v.toUpperCase(), args }
        }
        const up = t.v.toUpperCase()
        if (up === 'TRUE') return { k: 'bool', v: true }
        if (up === 'FALSE') return { k: 'bool', v: false }
        return { k: 'err', v: E.name }
      }
      case 'op':
        if (t.v === '(') {
          const n = this.comparison()
          if (!this.peekOp(')')) throw E.parse
          this.p += 1
          return n
        }
        throw E.parse
    }
  }
}

const astCache = new Map<string, Node | SheetError>()

function parseFormula(formula: string): Node | SheetError {
  const hit = astCache.get(formula)
  if (hit) return hit
  let out: Node | SheetError
  try {
    out = new Parser(tokenize(formula)).parse()
  } catch (e) {
    if (e instanceof SheetError) out = e
    else throw e
  }
  if (astCache.size > 5000) astCache.clear()
  astCache.set(formula, out)
  return out
}

// ---------------------------------------------------------------- coercions

const fail = (e: SheetError): never => { throw e }

function toNum(v: Value): number {
  if (v instanceof RangeVal) return toNum(intersect(v))
  if (isErr(v)) return fail(v)
  if (typeof v === 'number') return v
  if (v === null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  const p = parseInput(v)
  if (p.kind === 'number') return p.n
  if (p.kind === 'empty') return 0
  return fail(E.value)
}

function toStr(v: Value): string {
  if (v instanceof RangeVal) return toStr(intersect(v))
  if (isErr(v)) return fail(v)
  if (v === null) return ''
  if (typeof v === 'number') return plainNumber(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return v
}

function toBool(v: Value): boolean {
  if (v instanceof RangeVal) return toBool(intersect(v))
  if (isErr(v)) return fail(v)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null) return false
  const up = v.trim().toUpperCase()
  if (up === 'TRUE') return true
  if (up === 'FALSE') return false
  return fail(E.value)
}

/** A range used where one value is expected: a single cell works, anything bigger is #VALUE!. */
function intersect(r: RangeVal): Scalar {
  if (r.rows === 1 && r.cols === 1) return r.at(0, 0)
  return fail(E.value)
}

const scalar = (v: Value): Scalar => {
  const s = v instanceof RangeVal ? intersect(v) : v
  if (isErr(s)) return fail(s)
  return s
}

function flat(v: Value): Scalar[] {
  return v instanceof RangeVal ? v.values() : [v]
}

/** Numbers for SUM, AVERAGE and friends. In a range, text/blank/booleans are skipped; typed directly they count. */
function collectNums(args: Value[]): number[] {
  const out: number[] = []
  for (const a of args) {
    if (a instanceof RangeVal) {
      for (const v of a.values()) {
        if (isErr(v)) fail(v)
        if (typeof v === 'number') out.push(v)
      }
    } else if (a !== null) {
      if (isErr(a)) fail(a)
      out.push(toNum(a))
    }
  }
  return out
}

function checkNum(n: number): number {
  if (!Number.isFinite(n)) return fail(E.num)
  return n
}

// ------------------------------------------------------------- comparisons

const typeRank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1)

function compare(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0
  const x: Scalar = a === null ? (typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0) : a
  const y: Scalar = b === null ? (typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0) : b
  const rx = typeRank(x)
  const ry = typeRank(y)
  if (rx !== ry) return rx - ry
  if (typeof x === 'string') {
    const l = x.toLowerCase()
    const r = (y as string).toLowerCase()
    return l < r ? -1 : l > r ? 1 : 0
  }
  return Number(x) - Number(y as number | boolean)
}

const looseEqual = (a: Scalar, b: Scalar) => compare(a, b) === 0

function wildcardRegex(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '~' && i + 1 < pattern.length) { out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1 }
    else if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
}

/** COUNTIF-style criteria: 5, ">5", "<>x", "=abc", "ab*". */
function criteriaMatcher(c: Scalar): (v: Scalar) => boolean {
  if (isErr(c)) return fail(c)
  if (typeof c === 'number' || typeof c === 'boolean') return v => (typeof c === 'boolean' ? v === c : typeof v === 'number' ? v === c : typeof v === 'string' && parseInput(v).kind === 'number' && toNum(v) === c)
  const text = c === null ? '' : c
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(text)!
  const op = m[1] || '='
  const operand = m[2]
  const parsed = parseInput(operand)
  const numeric = parsed.kind === 'number' ? parsed.n : null
  return v => {
    if (numeric !== null) {
      let n: number | null = null
      if (typeof v === 'number') n = v
      else if (typeof v === 'string' && parseInput(v).kind === 'number') n = toNum(v)
      if (n === null) return op === '<>'
      switch (op) {
        case '=': return n === numeric
        case '<>': return n !== numeric
        case '<': return n < numeric
        case '>': return n > numeric
        case '<=': return n <= numeric
        default: return n >= numeric
      }
    }
    if (operand === '' && (op === '=' || op === '<>')) {
      const blank = v === null || v === ''
      return op === '=' ? blank : !blank
    }
    if (isErr(v)) return false
    const s = v === null ? '' : typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : plainNumber(v)
    if (op === '=') return wildcardRegex(operand).test(s)
    if (op === '<>') return !wildcardRegex(operand).test(s)
    if (typeof v !== 'string') return false
    const cmp = compare(s, operand)
    return op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0
  }
}

// ---------------------------------------------------------------- functions

type Fn = (a: Value[], x: Calc) => Value
type Ctx = { si: number; row: number; col: number }
type LazyFn = (n: Node[], run: (node: Node) => Value, ctx: Ctx) => Value

const need = (a: Value[], min: number, max = min) => {
  if (a.length < min || a.length > max) fail(E.value)
}

const optNum = (a: Value[], i: number, dflt: number) => (a[i] === undefined || a[i] === null ? dflt : toNum(a[i]))

function asRange(v: Value): RangeVal {
  if (v instanceof RangeVal) return v
  return fail(E.value)
}

function roundHalfAwayFromZero(n: number, digits: number): number {
  const f = 10 ** digits
  const shifted = Math.abs(n) * f
  // toPrecision guards against 1.005 * 100 = 100.49999999999999
  const r = Math.round(Number(shifted.toPrecision(15)))
  return (Math.sign(n) * r) / f
}

function roundDir(n: number, digits: number, dir: 'up' | 'down'): number {
  const f = 10 ** digits
  const shifted = Number((Math.abs(n) * f).toPrecision(15))
  const r = dir === 'up' ? Math.ceil(shifted) : Math.floor(shifted)
  return (Math.sign(n) * r) / f
}

function numberArray(v: Value): number[] {
  const out: number[] = []
  for (const s of flat(v)) {
    if (isErr(s)) fail(s)
    if (typeof s === 'number') out.push(s)
  }
  return out
}

function percentile(values: number[], k: number): number {
  if (!values.length || k < 0 || k > 1) return fail(E.num)
  const s = [...values].sort((x, y) => x - y)
  const pos = (s.length - 1) * k
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

function variance(values: number[], sample: boolean): number {
  const n = values.length
  if (n < (sample ? 2 : 1)) return fail(E.div0)
  const mean = values.reduce((s, v) => s + v, 0) / n
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / (sample ? n - 1 : n)
}

// Financial helpers. Cash you pay out is negative, as in Excel.
function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (nper === 0) return fail(E.num)
  if (rate === 0) return -(pv + fv) / nper
  const g = (1 + rate) ** nper
  return -(rate * (pv * g + fv)) / ((1 + rate * type) * (g - 1))
}

function fv(rate: number, nper: number, pmtv: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmtv * nper)
  const g = (1 + rate) ** nper
  return -(pv * g + (pmtv * (1 + rate * type) * (g - 1)) / rate)
}

function pv(rate: number, nper: number, pmtv: number, fvv: number, type: number): number {
  if (rate === 0) return -(fvv + pmtv * nper)
  const g = (1 + rate) ** nper
  return -(fvv + (pmtv * (1 + rate * type) * (g - 1)) / rate) / g
}

function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, c, i) => s + c / (1 + rate) ** (i + 1), 0)
}

function irr(flows: number[], guess: number): number {
  if (!flows.some(f => f > 0) || !flows.some(f => f < 0)) return fail(E.num)
  const f = (r: number) => flows.reduce((s, c, i) => s + c / (1 + r) ** i, 0)
  const d = (r: number) => flows.reduce((s, c, i) => s - (i * c) / (1 + r) ** (i + 1), 0)
  let r = guess
  for (let i = 0; i < 100; i += 1) {
    const y = f(r)
    const dy = d(r)
    if (Math.abs(y) < 1e-9) return r
    if (dy === 0) break
    const next = r - y / dy
    if (!Number.isFinite(next) || next <= -1) break
    if (Math.abs(next - r) < 1e-12) return next
    r = next
  }
  // Newton can wander; fall back to bisection on a bracket.
  let lo = -0.9999
  let hi = 10
  let flo = f(lo)
  if (flo * f(hi) > 0) return fail(E.num)
  for (let i = 0; i < 300; i += 1) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.abs(fm) < 1e-9) return mid
    if (flo * fm < 0) hi = mid
    else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

function rate(nper: number, pmtv: number, pvv: number, fvv: number, type: number, guess: number): number {
  let r = guess
  const f = (x: number) => (x === 0 ? pvv + pmtv * nper + fvv : pvv * (1 + x) ** nper + (pmtv * (1 + x * type) * ((1 + x) ** nper - 1)) / x + fvv)
  for (let i = 0; i < 200; i += 1) {
    const y = f(r)
    if (Math.abs(y) < 1e-9) return r
    const h = 1e-7
    const dy = (f(r + h) - y) / h
    if (dy === 0 || !Number.isFinite(dy)) break
    const next = r - y / dy
    if (!Number.isFinite(next) || next <= -1) break
    r = next
  }
  return fail(E.num)
}

function addMonths(serial: number, months: number): number {
  const { y, m, d } = serialToParts(serial)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  const last = serialToParts(dateToSerial(ny, nm + 1, 0)).d
  return dateToSerial(ny, nm, Math.min(d, last))
}

const weekday = (serial: number) => ((Math.floor(serial) - 1) % 7 + 7) % 7 + 1 // Sunday = 1

function lookupIndex(key: Scalar, vals: Scalar[], exact: boolean): number {
  if (exact) {
    const re = typeof key === 'string' && /[*?~]/.test(key) ? wildcardRegex(key) : null
    return vals.findIndex(v => (re && typeof v === 'string' ? re.test(v) : !isErr(v) && v !== null && typeof v === typeof key && looseEqual(v, key)))
  }
  let best = -1
  for (let i = 0; i < vals.length; i += 1) {
    const v = vals[i]
    if (v === null || isErr(v) || typeRank(v) !== typeRank(key)) continue
    if (compare(v, key) <= 0) best = i
    else break
  }
  return best
}

function conditionalCells(a: Value[], start: number): number[] {
  // Returns the indices of cells that satisfy every (range, criteria) pair.
  const pairs: { vals: Scalar[]; ok: (v: Scalar) => boolean }[] = []
  for (let i = start; i + 1 < a.length + 1; i += 2) {
    if (a[i] === undefined) break
    if (a[i + 1] === undefined) fail(E.value)
    const r = asRange(a[i])
    pairs.push({ vals: r.values(), ok: criteriaMatcher(scalar(a[i + 1])) })
  }
  if (!pairs.length) return fail(E.value)
  const len = pairs[0].vals.length
  const out: number[] = []
  for (let i = 0; i < len; i += 1) {
    if (pairs.every(p => p.vals.length === len && p.ok(p.vals[i]))) out.push(i)
  }
  return out
}

const FUNCS: Record<string, Fn> = {
  // ---- math and statistics
  SUM: a => collectNums(a).reduce((s, v) => s + v, 0),
  PRODUCT: a => checkNum(collectNums(a).reduce((s, v) => s * v, 1)),
  AVERAGE: a => { const n = collectNums(a); return n.length ? n.reduce((s, v) => s + v, 0) / n.length : fail(E.div0) },
  MIN: a => { const n = collectNums(a); return n.length ? Math.min(...n) : 0 },
  MAX: a => { const n = collectNums(a); return n.length ? Math.max(...n) : 0 },
  COUNT: a => {
    let c = 0
    for (const x of a) {
      if (x instanceof RangeVal) c += x.values().filter(v => typeof v === 'number').length
      else if (x !== null && !isErr(x)) { try { toNum(x); c += 1 } catch { /* not a number */ } }
    }
    return c
  },
  COUNTA: a => a.reduce<number>((c, x) => c + (x instanceof RangeVal ? x.values().filter(v => v !== null && v !== '').length : x === null ? 0 : 1), 0),
  COUNTBLANK: a => { need(a, 1); return asRange(a[0]).values().filter(v => v === null || v === '').length },
  MEDIAN: a => { const n = collectNums(a); return n.length ? percentile(n, 0.5) : fail(E.num) },
  LARGE: a => { need(a, 2); const n = numberArray(a[0]).sort((x, y) => y - x); const k = toNum(a[1]); return k >= 1 && k <= n.length ? n[Math.floor(k) - 1] : fail(E.num) },
  SMALL: a => { need(a, 2); const n = numberArray(a[0]).sort((x, y) => x - y); const k = toNum(a[1]); return k >= 1 && k <= n.length ? n[Math.floor(k) - 1] : fail(E.num) },
  RANK: a => {
    need(a, 2, 3)
    const x = toNum(a[0])
    const n = numberArray(a[1])
    if (!n.includes(x)) return fail(E.na)
    const asc = optNum(a, 2, 0) !== 0
    return 1 + n.filter(v => (asc ? v < x : v > x)).length
  },
  PERCENTILE: a => { need(a, 2); return percentile(numberArray(a[0]), toNum(a[1])) },
  STDEV: a => Math.sqrt(variance(collectNums(a), true)),
  'STDEV.S': a => Math.sqrt(variance(collectNums(a), true)),
  STDEVP: a => Math.sqrt(variance(collectNums(a), false)),
  VAR: a => variance(collectNums(a), true),
  'VAR.S': a => variance(collectNums(a), true),
  VARP: a => variance(collectNums(a), false),
  SUMSQ: a => collectNums(a).reduce((s, v) => s + v * v, 0),
  SUMPRODUCT: a => {
    need(a, 1, 30)
    const arrays = a.map(x => flat(x).map(v => (typeof v === 'number' ? v : isErr(v) ? fail(v) : 0)))
    const len = arrays[0].length
    if (arrays.some(x => x.length !== len)) return fail(E.value)
    let total = 0
    for (let i = 0; i < len; i += 1) total += arrays.reduce((p, arr) => p * arr[i], 1)
    return total
  },
  ABS: a => { need(a, 1); return Math.abs(toNum(a[0])) },
  SIGN: a => { need(a, 1); return Math.sign(toNum(a[0])) },
  SQRT: a => { need(a, 1); const n = toNum(a[0]); return n < 0 ? fail(E.num) : Math.sqrt(n) },
  EXP: a => { need(a, 1); return checkNum(Math.exp(toNum(a[0]))) },
  LN: a => { need(a, 1); const n = toNum(a[0]); return n <= 0 ? fail(E.num) : Math.log(n) },
  LOG: a => { need(a, 1, 2); const n = toNum(a[0]); const b = optNum(a, 1, 10); return n <= 0 || b <= 0 || b === 1 ? fail(E.num) : Math.log(n) / Math.log(b) },
  LOG10: a => { need(a, 1); const n = toNum(a[0]); return n <= 0 ? fail(E.num) : Math.log10(n) },
  POWER: a => { need(a, 2); const r = toNum(a[0]) ** toNum(a[1]); return Number.isNaN(r) ? fail(E.num) : checkNum(r) },
  MOD: a => { need(a, 2); const d = toNum(a[1]); if (d === 0) return fail(E.div0); const n = toNum(a[0]); return n - d * Math.floor(n / d) },
  INT: a => { need(a, 1); return Math.floor(toNum(a[0])) },
  TRUNC: a => { need(a, 1, 2); const d = optNum(a, 1, 0); return roundDir(toNum(a[0]), d, 'down') },
  ROUND: a => { need(a, 2); return roundHalfAwayFromZero(toNum(a[0]), toNum(a[1])) },
  ROUNDUP: a => { need(a, 2); return roundDir(toNum(a[0]), toNum(a[1]), 'up') },
  ROUNDDOWN: a => { need(a, 2); return roundDir(toNum(a[0]), toNum(a[1]), 'down') },
  CEILING: a => { need(a, 2); const s = toNum(a[1]); return s === 0 ? 0 : Math.ceil(toNum(a[0]) / s) * s },
  FLOOR: a => { need(a, 2); const s = toNum(a[1]); return s === 0 ? fail(E.div0) : Math.floor(toNum(a[0]) / s) * s },
  PI: () => Math.PI,

  // ---- conditional aggregates
  COUNTIF: a => { need(a, 2); return asRange(a[0]).values().filter(criteriaMatcher(scalar(a[1]))).length },
  COUNTIFS: a => conditionalCells(a, 0).length,
  SUMIF: a => {
    need(a, 2, 3)
    const test = asRange(a[0]).values()
    const ok = criteriaMatcher(scalar(a[1]))
    const sumVals = a[2] === undefined ? test : asRange(a[2]).values()
    return test.reduce<number>((s, v, i) => (ok(v) && typeof sumVals[i] === 'number' ? s + (sumVals[i] as number) : s), 0)
  },
  SUMIFS: a => {
    need(a, 3, 31)
    const sumVals = asRange(a[0]).values()
    return conditionalCells(a, 1).reduce((s, i) => (typeof sumVals[i] === 'number' ? s + (sumVals[i] as number) : s), 0)
  },
  AVERAGEIF: a => {
    need(a, 2, 3)
    const test = asRange(a[0]).values()
    const ok = criteriaMatcher(scalar(a[1]))
    const avgVals = a[2] === undefined ? test : asRange(a[2]).values()
    const picked = test.map((v, i) => (ok(v) ? avgVals[i] : null)).filter((v): v is number => typeof v === 'number')
    return picked.length ? picked.reduce((s, v) => s + v, 0) / picked.length : fail(E.div0)
  },
  AVERAGEIFS: a => {
    need(a, 3, 31)
    const vals = asRange(a[0]).values()
    const picked = conditionalCells(a, 1).map(i => vals[i]).filter((v): v is number => typeof v === 'number')
    return picked.length ? picked.reduce((s, v) => s + v, 0) / picked.length : fail(E.div0)
  },
  MAXIFS: a => { need(a, 3, 31); const vals = asRange(a[0]).values(); const p = conditionalCells(a, 1).map(i => vals[i]).filter((v): v is number => typeof v === 'number'); return p.length ? Math.max(...p) : 0 },
  MINIFS: a => { need(a, 3, 31); const vals = asRange(a[0]).values(); const p = conditionalCells(a, 1).map(i => vals[i]).filter((v): v is number => typeof v === 'number'); return p.length ? Math.min(...p) : 0 },
  SUBTOTAL: a => {
    need(a, 2, 30)
    const code = toNum(a[0]) % 100
    const rest = a.slice(1)
    switch (code) {
      case 1: return FUNCS.AVERAGE(rest, undefined as never)
      case 2: return FUNCS.COUNT(rest, undefined as never)
      case 3: return FUNCS.COUNTA(rest, undefined as never)
      case 4: return FUNCS.MAX(rest, undefined as never)
      case 5: return FUNCS.MIN(rest, undefined as never)
      case 9: return FUNCS.SUM(rest, undefined as never)
      default: return fail(E.value)
    }
  },

  // ---- logic
  AND: a => { const v = a.flatMap(flat).filter(x => x !== null); if (!v.length) return fail(E.value); return v.every(x => toBool(x)) },
  OR: a => { const v = a.flatMap(flat).filter(x => x !== null); if (!v.length) return fail(E.value); return v.some(x => toBool(x)) },
  XOR: a => a.flatMap(flat).filter(x => x !== null).reduce<boolean>((s, x) => s !== toBool(x), false),
  NOT: a => { need(a, 1); return !toBool(a[0]) },
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: a => { need(a, 1); const v = a[0] instanceof RangeVal ? intersectSafe(a[0]) : a[0]; return v === null },
  ISNUMBER: a => { need(a, 1); const v = a[0] instanceof RangeVal ? intersectSafe(a[0]) : a[0]; return typeof v === 'number' },
  ISTEXT: a => { need(a, 1); const v = a[0] instanceof RangeVal ? intersectSafe(a[0]) : a[0]; return typeof v === 'string' },
  ISERROR: a => { need(a, 1); const v = a[0] instanceof RangeVal ? intersectSafe(a[0]) : a[0]; return isErr(v) },
  ISNA: a => { need(a, 1); const v = a[0] instanceof RangeVal ? intersectSafe(a[0]) : a[0]; return isErr(v) && v.code === '#N/A' },

  // ---- text
  LEN: a => { need(a, 1); return toStr(a[0]).length },
  LEFT: a => { need(a, 1, 2); const n = optNum(a, 1, 1); return n < 0 ? fail(E.value) : toStr(a[0]).slice(0, n) },
  RIGHT: a => { need(a, 1, 2); const n = optNum(a, 1, 1); const s = toStr(a[0]); return n < 0 ? fail(E.value) : n === 0 ? '' : s.slice(-n) },
  MID: a => { need(a, 3); const s = Math.floor(toNum(a[1])); const n = toNum(a[2]); return s < 1 || n < 0 ? fail(E.value) : toStr(a[0]).substr(s - 1, n) },
  UPPER: a => { need(a, 1); return toStr(a[0]).toUpperCase() },
  LOWER: a => { need(a, 1); return toStr(a[0]).toLowerCase() },
  PROPER: a => { need(a, 1); return toStr(a[0]).toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()) },
  TRIM: a => { need(a, 1); return toStr(a[0]).trim().replace(/\s+/g, ' ') },
  CONCAT: a => a.flatMap(flat).map(v => toStr(v)).join(''),
  CONCATENATE: a => a.map(v => toStr(v)).join(''),
  TEXTJOIN: a => {
    need(a, 3, 60)
    const delim = toStr(a[0])
    const skip = toBool(a[1])
    return a.slice(2).flatMap(flat).filter(v => !(skip && (v === null || v === ''))).map(v => toStr(v)).join(delim)
  },
  TEXT: a => {
    need(a, 2)
    const v = scalar(a[0])
    if (typeof v === 'string') { const p = parseInput(v); if (p.kind !== 'number') return v }
    return formatWithPattern(toNum(v), toStr(a[1]))
  },
  VALUE: a => { need(a, 1); return toNum(a[0]) },
  SUBSTITUTE: a => {
    need(a, 3, 4)
    const s = toStr(a[0]); const from = toStr(a[1]); const to = toStr(a[2])
    if (!from) return s
    if (a[3] === undefined) return s.split(from).join(to)
    const nth = toNum(a[3]); let idx = -1; let pos = 0
    for (let i = 0; i < nth; i += 1) { idx = s.indexOf(from, pos); if (idx < 0) return s; pos = idx + from.length }
    return s.slice(0, idx) + to + s.slice(idx + from.length)
  },
  REPLACE: a => { need(a, 4); const s = toStr(a[0]); const st = toNum(a[1]) - 1; return s.slice(0, st) + toStr(a[3]) + s.slice(st + toNum(a[2])) },
  FIND: a => { need(a, 2, 3); const i = toStr(a[1]).indexOf(toStr(a[0]), optNum(a, 2, 1) - 1); return i < 0 ? fail(E.value) : i + 1 },
  SEARCH: a => { need(a, 2, 3); const i = toStr(a[1]).toLowerCase().indexOf(toStr(a[0]).toLowerCase(), optNum(a, 2, 1) - 1); return i < 0 ? fail(E.value) : i + 1 },
  REPT: a => { need(a, 2); const n = toNum(a[1]); return n < 0 || n > 1000 ? fail(E.value) : toStr(a[0]).repeat(n) },
  EXACT: a => { need(a, 2); return toStr(a[0]) === toStr(a[1]) },

  // ---- lookup
  VLOOKUP: a => {
    need(a, 3, 4)
    const key = scalar(a[0]); const t = asRange(a[1]); const idx = Math.floor(toNum(a[2]))
    if (idx < 1 || idx > t.cols) return fail(E.ref)
    const exact = a[3] !== undefined && !toBool(a[3])
    const col: Scalar[] = []
    for (let i = 0; i < t.rows; i += 1) col.push(t.at(i, 0))
    const at = lookupIndex(key, col, exact)
    return at < 0 ? fail(E.na) : t.at(at, idx - 1)
  },
  HLOOKUP: a => {
    need(a, 3, 4)
    const key = scalar(a[0]); const t = asRange(a[1]); const idx = Math.floor(toNum(a[2]))
    if (idx < 1 || idx > t.rows) return fail(E.ref)
    const exact = a[3] !== undefined && !toBool(a[3])
    const row: Scalar[] = []
    for (let j = 0; j < t.cols; j += 1) row.push(t.at(0, j))
    const at = lookupIndex(key, row, exact)
    return at < 0 ? fail(E.na) : t.at(idx - 1, at)
  },
  XLOOKUP: a => {
    need(a, 3, 6)
    const key = scalar(a[0]); const look = asRange(a[1]); const ret = asRange(a[2])
    const vals = look.values()
    const mode = optNum(a, 4, 0)
    const reverse = optNum(a, 5, 1) === -1
    let at = -1
    if (mode === 0 || mode === 2) {
      const list = reverse ? [...vals].reverse() : vals
      const hit = lookupIndex(key, list, true)
      at = hit < 0 ? -1 : reverse ? vals.length - 1 - hit : hit
    } else {
      const k = toNum(key)
      let bestV: number | null = null
      vals.forEach((v, i) => {
        if (typeof v !== 'number') return
        const better = mode === -1 ? v <= k && (bestV === null || v > bestV) : v >= k && (bestV === null || v < bestV)
        if (better) { bestV = v; at = i }
      })
    }
    if (at < 0) {
      if (a[3] !== undefined) return scalar(a[3])
      return fail(E.na)
    }
    if (look.cols === 1 && look.rows > 1) return ret.at(at, 0)
    return ret.at(0, at)
  },
  MATCH: a => {
    need(a, 2, 3)
    const key = scalar(a[0]); const vals = asRange(a[1]).values(); const type = optNum(a, 2, 1)
    let at: number
    if (type === 0) at = lookupIndex(key, vals, true)
    else if (type === 1) at = lookupIndex(key, vals, false)
    else { at = -1; for (let i = 0; i < vals.length; i += 1) { if (typeRank(vals[i]) === typeRank(key) && compare(vals[i], key) >= 0) at = i; else break } }
    return at < 0 ? fail(E.na) : at + 1
  },
  INDEX: a => {
    need(a, 2, 3)
    const r = asRange(a[0])
    let row = Math.floor(toNum(a[1])); let col = a[2] === undefined ? 1 : Math.floor(toNum(a[2]))
    if (r.cols === 1 && a[2] === undefined) col = 1
    else if (r.rows === 1 && a[2] === undefined) { col = row; row = 1 }
    if (row < 1 || col < 1 || row > r.rows || col > r.cols) return fail(E.ref)
    return r.at(row - 1, col - 1)
  },
  CHOOSE: a => { need(a, 2, 30); const i = Math.floor(toNum(a[0])); return i < 1 || i >= a.length ? fail(E.value) : a[i] },
  ROWS: a => { need(a, 1); return asRange(a[0]).rows },
  COLUMNS: a => { need(a, 1); return asRange(a[0]).cols },

  // ---- dates
  TODAY: () => todaySerial(),
  NOW: () => { const n = new Date(); return todaySerial() + (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400 },
  DATE: a => { need(a, 3); return dateToSerial(toNum(a[0]), toNum(a[1]), toNum(a[2])) },
  YEAR: a => { need(a, 1); return serialToParts(toNum(a[0])).y },
  MONTH: a => { need(a, 1); return serialToParts(toNum(a[0])).m },
  DAY: a => { need(a, 1); return serialToParts(toNum(a[0])).d },
  EDATE: a => { need(a, 2); return addMonths(toNum(a[0]), toNum(a[1])) },
  EOMONTH: a => { need(a, 2); const s = addMonths(toNum(a[0]), toNum(a[1])); const { y, m } = serialToParts(s); return dateToSerial(y, m + 1, 0) },
  DAYS: a => { need(a, 2); return Math.floor(toNum(a[0])) - Math.floor(toNum(a[1])) },
  WEEKDAY: a => {
    need(a, 1, 2)
    const w = weekday(toNum(a[0])); const t = optNum(a, 1, 1)
    return t === 2 ? ((w + 5) % 7) + 1 : t === 3 ? (w + 5) % 7 : w
  },
  DATEDIF: a => {
    need(a, 3)
    const s = Math.floor(toNum(a[0])); const e = Math.floor(toNum(a[1])); const u = toStr(a[2]).toUpperCase()
    if (e < s) return fail(E.num)
    if (u === 'D') return e - s
    const p = serialToParts(s); const q = serialToParts(e)
    let months = (q.y - p.y) * 12 + (q.m - p.m)
    if (q.d < p.d) months -= 1
    if (u === 'M') return months
    if (u === 'Y') return Math.floor(months / 12)
    return fail(E.num)
  },
  NETWORKDAYS: a => {
    need(a, 2, 3)
    let s = Math.floor(toNum(a[0])); let e = Math.floor(toNum(a[1]))
    const sign = e < s ? -1 : 1
    if (e < s) [s, e] = [e, s]
    const holidays = new Set(a[2] === undefined ? [] : flat(a[2]).filter((v): v is number => typeof v === 'number').map(Math.floor))
    let n = 0
    for (let d = s; d <= e; d += 1) { const w = weekday(d); if (w !== 1 && w !== 7 && !holidays.has(d)) n += 1 }
    return n * sign
  },

  // ---- financial
  PMT: a => { need(a, 3, 5); return pmt(toNum(a[0]), toNum(a[1]), toNum(a[2]), optNum(a, 3, 0), optNum(a, 4, 0)) },
  FV: a => { need(a, 3, 5); return fv(toNum(a[0]), toNum(a[1]), toNum(a[2]), optNum(a, 3, 0), optNum(a, 4, 0)) },
  PV: a => { need(a, 3, 5); return pv(toNum(a[0]), toNum(a[1]), toNum(a[2]), optNum(a, 3, 0), optNum(a, 4, 0)) },
  NPER: a => {
    need(a, 3, 5)
    const r = toNum(a[0]); const p = toNum(a[1]); const pvv = toNum(a[2]); const f = optNum(a, 3, 0); const t = optNum(a, 4, 0)
    if (r === 0) return p === 0 ? fail(E.num) : -(pvv + f) / p
    const z = (p * (1 + r * t)) / r
    const ratio = (z - f) / (pvv + z)
    return ratio <= 0 ? fail(E.num) : Math.log(ratio) / Math.log(1 + r)
  },
  RATE: a => { need(a, 3, 6); return rate(toNum(a[0]), toNum(a[1]), toNum(a[2]), optNum(a, 3, 0), optNum(a, 4, 0), optNum(a, 5, 0.1)) },
  NPV: a => { need(a, 2, 30); return npv(toNum(a[0]), collectNums(a.slice(1))) },
  IRR: a => { need(a, 1, 2); return irr(numberArray(a[0]), optNum(a, 1, 0.1)) },
  SLN: a => { need(a, 3); const life = toNum(a[2]); return life === 0 ? fail(E.div0) : (toNum(a[0]) - toNum(a[1])) / life },
}

function intersectSafe(r: RangeVal): Scalar {
  return r.rows === 1 && r.cols === 1 ? r.at(0, 0) : fail(E.value)
}

// IF and friends only evaluate the branch they need, so =IF(A1=0,0,B1/A1) never divides by zero.
const LAZY: Record<string, LazyFn> = {
  IF: (n, run) => {
    if (n.length < 2 || n.length > 3) return fail(E.value)
    const cond = run(n[0])
    if (cond instanceof RangeVal || !isErr(cond)) {
      return toBool(cond) ? (n[1].k === 'empty' ? 0 : run(n[1])) : n[2] ? (n[2].k === 'empty' ? 0 : run(n[2])) : false
    }
    return cond
  },
  IFS: (n, run) => {
    if (n.length < 2 || n.length % 2) return fail(E.value)
    for (let i = 0; i < n.length; i += 2) if (toBool(run(n[i]))) return run(n[i + 1])
    return fail(E.na)
  },
  IFERROR: (n, run) => {
    if (n.length !== 2) return fail(E.value)
    const v = run(n[0])
    return isErr(v) ? run(n[1]) : v
  },
  IFNA: (n, run) => {
    if (n.length !== 2) return fail(E.value)
    const v = run(n[0])
    return isErr(v) && v.code === '#N/A' ? run(n[1]) : v
  },
  SWITCH: (n, run) => {
    if (n.length < 3) return fail(E.value)
    const key = scalar(run(n[0]))
    let i = 1
    for (; i + 1 < n.length; i += 2) if (looseEqual(key, scalar(run(n[i])))) return run(n[i + 1])
    return i < n.length ? run(n[i]) : fail(E.na)
  },
  ROW: (n, _run, ctx) => (n.length === 0 ? ctx.row : n[0].k === 'ref' ? n[0].r1 : fail(E.value)),
  COLUMN: (n, _run, ctx) => (n.length === 0 ? ctx.col : n[0].k === 'ref' ? n[0].c1 : fail(E.value)),
}

export const SUPPORTED_FUNCTIONS = [...new Set([...Object.keys(FUNCS), ...Object.keys(LAZY)])].sort()

// --------------------------------------------------------------------- calc

export class Calc {
  private cache = new Map<string, Scalar>()
  private busy = new Set<string>()
  private extents = new Map<number, { rows: number; cols: number }>()
  private names: Map<string, number>

  constructor(readonly wb: WorkbookData) {
    this.names = new Map(wb.sheets.map((s, i) => [s.name.toLowerCase(), i]))
  }

  private extent(si: number) {
    let e = this.extents.get(si)
    if (!e) {
      e = usedExtent(this.wb.sheets[si])
      this.extents.set(si, e)
    }
    return e
  }

  cellAt(si: number, row: number, col: number): Cell | undefined {
    return this.wb.sheets[si]?.cells[refKey(row, col)]
  }

  /** The computed value of a cell. */
  value(si: number, row: number, col: number): Scalar {
    if (row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS) return E.ref
    const key = `${si}:${row}:${col}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const cell = this.cellAt(si, row, col)
    let out: Scalar
    if (!cell || cell.v === '') out = null
    else {
      const parsed = parseInput(cell.v)
      switch (parsed.kind) {
        case 'empty': out = null; break
        case 'number': out = parsed.n; break
        case 'bool': out = parsed.b; break
        case 'text': out = parsed.s; break
        case 'formula': {
          if (this.busy.has(key)) return E.circ
          this.busy.add(key)
          try { out = this.runFormula(parsed.formula, { si, row, col }) } finally { this.busy.delete(key) }
          break
        }
      }
    }
    if (out === undefined) out = null
    this.cache.set(key, out)
    return out
  }

  private runFormula(formula: string, ctx: Ctx): Scalar {
    const ast = parseFormula(formula)
    if (isErr(ast)) return ast
    const v = this.run(ast, ctx)
    if (v instanceof RangeVal) {
      try { return intersect(v) } catch (e) { if (e instanceof SheetError) return e; throw e }
    }
    return v
  }

  private run(node: Node, ctx: Ctx): Value {
    try {
      return this.eval(node, ctx)
    } catch (e) {
      if (e instanceof SheetError) return e
      throw e
    }
  }

  private sheetIndex(name: string | undefined, ctx: Ctx): number {
    if (name === undefined) return ctx.si
    const i = this.names.get(name.toLowerCase())
    return i === undefined ? -1 : i
  }

  private eval(node: Node, ctx: Ctx): Value {
    switch (node.k) {
      case 'num': return node.v
      case 'str': return node.v
      case 'bool': return node.v
      case 'err': return node.v
      case 'empty': return null
      case 'ref': {
        const si = this.sheetIndex(node.sheet, ctx)
        if (si < 0) return E.ref
        const ext = this.extent(si)
        const r2 = node.open === 'col' ? Math.max(ext.rows, 1) : node.r2
        const c2 = node.open === 'row' ? Math.max(ext.cols, 1) : node.c2
        if (!node.range) return this.value(si, node.r1, node.c1)
        return new RangeVal(this, si, node.r1, node.c1, Math.min(r2, MAX_ROWS), Math.min(c2, MAX_COLS))
      }
      case 'un': {
        const n = toNum(this.run(node.a, ctx))
        return node.op === '-' ? -n : n
      }
      case 'pct': return toNum(this.run(node.a, ctx)) / 100
      case 'bin': return this.binary(node, ctx)
      case 'call': {
        const lazy = LAZY[node.name]
        if (lazy) return lazy(node.args, n => this.run(n, ctx), ctx)
        const fn = FUNCS[node.name]
        if (!fn) return E.name
        const args = node.args.map(n => this.run(n, ctx))
        // An error passed straight in as an argument stops the formula, except where the function inspects errors.
        if (!['ISERROR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT'].includes(node.name)) {
          for (const a of args) if (isErr(a)) return a
        }
        return fn(args, this)
      }
    }
  }

  private binary(node: Extract<Node, { k: 'bin' }>, ctx: Ctx): Value {
    const a = this.run(node.a, ctx)
    const b = this.run(node.b, ctx)
    if (isErr(a)) return a
    if (isErr(b)) return b
    switch (node.op) {
      case '+': return checkNum(toNum(a) + toNum(b))
      case '-': return checkNum(toNum(a) - toNum(b))
      case '*': return checkNum(toNum(a) * toNum(b))
      case '/': { const d = toNum(b); return d === 0 ? E.div0 : checkNum(toNum(a) / d) }
      case '^': {
        const base = toNum(a); const exp = toNum(b)
        if (base === 0 && exp === 0) return E.num
        const r = base ** exp
        return Number.isNaN(r) ? E.num : checkNum(r)
      }
      case '&': return toStr(a) + toStr(b)
      default: {
        const x = scalar(a); const y = scalar(b)
        const c = compare(x, y)
        switch (node.op) {
          case '=': return c === 0
          case '<>': return c !== 0
          case '<': return c < 0
          case '>': return c > 0
          case '<=': return c <= 0
          default: return c >= 0
        }
      }
    }
  }

  /** The text shown in the grid for a cell. */
  display(si: number, row: number, col: number): string {
    let v: Scalar
    try {
      v = this.value(si, row, col)
    } catch (e) {
      if (e instanceof RangeError) {
        // A very long chain of formulas can exhaust the call stack. Filling the
        // cache from the top of the sheet down keeps every later step shallow.
        this.warm(si)
        try {
          v = this.value(si, row, col)
        } catch (again) {
          // Still too deep after warming: this one formula is nested too far
          // by itself. Show an error in that cell instead of crashing the sheet.
          if (!(again instanceof RangeError)) throw again
          v = E.parse
        }
      } else throw e
    }
    return this.format(v, this.cellAt(si, row, col))
  }

  format(v: Scalar, cell: Cell | undefined): string {
    if (v === null) return ''
    if (isErr(v)) return v.code
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'number') return formatNumber(v, cell?.nf)
    return v
  }

  private warm(si: number) {
    const sheet = this.wb.sheets[si]
    const keys = Object.keys(sheet.cells)
      .map(k => /^([A-Z]+)(\d+)$/.exec(k))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => ({ row: Number(m[2]), col: colIndex(m[1]) }))
      .sort((a, b) => a.row - b.row || a.col - b.col)
    for (const k of keys) {
      try { this.value(si, k.row, k.col) } catch (e) { if (!(e instanceof RangeError)) throw e }
    }
  }
}

export function evaluateFormulaText(wb: WorkbookData, si: number, row: number, col: number): Scalar {
  return new Calc(wb).value(si, row, col)
}

export type { Cell }
