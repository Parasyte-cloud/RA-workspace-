import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : ''
const dashboard = read('src/modules/PersonalDashboard.tsx')
const shelf = read('src/components/MyAwardsShelf.tsx')
const dialog = read('src/components/MyAwardsHistoryDialog.tsx')
const css = read('src/my-awards.css')
const recognition = read('src/components/Recognition.tsx')

test('PersonalDashboard mounts My Awards after KPI summary and before detailed workspace content', () => {
  assert.match(dashboard, /import MyAwardsShelf from ['"]\.\.\/components\/MyAwardsShelf['"]/)
  const kpi = dashboard.indexOf('todayRow')
  const awards = dashboard.indexOf('<MyAwardsShelf')
  const guide = dashboard.indexOf('title="Workstation guide"')
  assert.ok(kpi >= 0 && awards > kpi && guide > awards, 'My Awards must sit after KPI summary and before guide/details')
})

test('My Awards uses the caller-scoped RPC and exposes loading empty retry and history states', () => {
  assert.match(shelf, /rpc\(['"]list_my_awards['"]/)
  assert.doesNotMatch(shelf + dialog + dashboard, /from\(['"]employee_recognition_awards['"]\)/)
  assert.match(shelf, /My Awards/)
  assert.match(shelf, /No awards yet/)
  assert.match(shelf, /Retry/)
  assert.match(shelf, /View all awards/)
  assert.match(shelf, /aria-label=['"]My Awards shelf['"]/)
})

test('award history is private paginated keyboard operable and focus managed', () => {
  assert.match(dialog, /rpc\(['"]list_my_awards['"]/)
  assert.match(dialog, /p_before/)
  assert.match(dialog, /Load more/)
  assert.match(dialog, /role=['"]dialog['"]/)
  assert.match(dialog, /aria-modal=['"]true['"]/)
  assert.match(dialog, /event\.key === ['"]Escape['"]/)
  assert.match(dialog, /focus\(\)/)
  assert.match(dialog, /previousFocus/)
  assert.match(dialog, /event\.key === ['"]Tab['"]/, 'modal must trap keyboard focus')
})

test('award labels are humanized and private details do not become company cards', () => {
  assert.match(shelf + dialog, /monthly_kpi_excellence/)
  assert.match(shelf + dialog, /identity_compliance_milestone/)
  assert.doesNotMatch(recognition, /from\(['"]employee_recognition_awards['"]\)/)
})

test('My Awards shelf is responsive and horizontally scrollable without hiding controls', () => {
  assert.match(css, /\.myAwardsRail\s*\{[^}]*overflow-x:\s*auto/s)
  assert.match(css, /scroll-snap-type:\s*x proximity/)
  assert.match(css, /@media\s*\(max-width:\s*650px\)/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /min-height:\s*44px/)
})

test('award label formatting stays compatible with the ES2020 application target', () => {
  assert.doesNotMatch(dialog, /\.replaceAll\s*\(/, 'ES2020 target must not rely on String.prototype.replaceAll')
  assert.doesNotMatch(dialog, /\.at\s*\(/, 'ES2020 target must not rely on Array.prototype.at')
  assert.match(dialog, /\.replace\(\/_\/g,\s*['"] ['"]\)/)
})
