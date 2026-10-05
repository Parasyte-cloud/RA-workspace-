import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

test('analytics is only reachable from the public forms surface', () => {
  const root = new URL('../src', import.meta.url).pathname
  const importers = walk(root)
    .filter(file => /\.(ts|tsx)$/.test(file))
    .filter(file => /from ['"][./]*(lib\/)?analytics['"]/.test(readFileSync(file, 'utf8')))
    .map(file => file.slice(root.length + 1))
    .sort()

  for (const file of importers) {
    assert.ok(
      file.startsWith('forms-public/') || file === 'lib/intake.ts',
      `${file} must not import analytics`,
    )
  }
  assert.ok(importers.includes('forms-public/FormsApp.tsx'))
})

test('internal workspace entry never calls analytics', () => {
  for (const file of ['src/InternalApp.tsx', 'src/App.tsx', 'src/main.tsx']) {
    assert.doesNotMatch(read(file), /initAnalytics|lib\/analytics/, file)
  }
})

test('consent defaults to denied and vendor script waits for consent', () => {
  const source = read('src/lib/analytics.ts')
  assert.match(source, /analytics_storage: 'denied'/)
  assert.match(source, /ad_user_data: 'denied'/)
  const emit = source.slice(source.indexOf('function emit'))
  assert.match(emit, /getConsent\(\) !== 'granted'\) return/)
  // initAnalytics must only load the vendor inside the granted branch.
  const init = source.slice(source.indexOf('export function initAnalytics'), source.indexOf('function clean'))
  assert.match(init, /getConsent\(\) === 'granted'/)
})

test('event parameters are whitelisted and PII is filtered', () => {
  const source = read('src/lib/analytics.ts')
  assert.match(source, /ALLOWED_PARAMS/)
  assert.match(source, /PII_LIKE/)
  for (const forbidden of ['email', 'phone', 'name:', 'address']) {
    const list = source.slice(source.indexOf('ALLOWED_PARAMS = new Set'), source.indexOf(']', source.indexOf('ALLOWED_PARAMS = new Set')))
    assert.ok(!list.includes(`'${forbidden}`), `${forbidden} must not be whitelisted`)
  }
})

test('no em dash in generated analytics files', () => {
  for (const file of [
    'src/lib/analytics.ts',
    'src/forms-public/AnalyticsConsent.tsx',
    'src/forms-public/FormsErrorBoundary.tsx',
    'public/_headers',
  ]) {
    assert.ok(!read(file).includes('—'), `${file} contains an em dash`)
  }
})

test('security headers file ships the baseline set', () => {
  const headers = read('public/_headers')
  for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) {
    assert.match(headers, new RegExp(header))
  }
})
