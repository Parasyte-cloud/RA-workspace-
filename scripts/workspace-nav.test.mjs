import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/workspaceNav.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const N = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

const app = readFileSync('src/App.tsx', 'utf8')

// The real navigation list, read from the source so this test fails if a new
// section is added and then cannot be reached.
const navBlock = app.slice(app.indexOf('const items = ['), app.indexOf('] as const', app.indexOf('const items = [')))
const REAL = [...navBlock.matchAll(/\['([a-z]+)','([^']+)',[A-Za-z0-9]+\]/g)].map(m => [m[1], m[2]])
const ids = list => list.map(item => item[0])

function zones(side) {
  return [
    ...side.pinned,
    ...side.mine,
    ...side.groups.flatMap(group => group.items),
    ...side.system,
    ...side.menu,
  ]
}

test('the real navigation list was read from App.tsx', () => {
  assert.equal(REAL.length, 38)
  assert.ok(ids(REAL).includes('overview') && ids(REAL).includes('admin'))
})

test('an admin sees every section exactly once, nothing lost, nothing doubled', () => {
  const side = N.buildSidebar(REAL, { primarySection: 'admin' })
  const all = ids(zones(side))
  assert.equal(all.length, REAL.length)
  assert.deepEqual([...all].sort(), ids(REAL).sort())
  assert.equal(new Set(all).size, all.length)
})

test('first glance is short: pinned, own workstation, collapsed group headings, one system item', () => {
  const side = N.buildSidebar(REAL, { primarySection: 'support' })
  const firstGlance = side.pinned.length + side.mine.length + side.groups.length + side.system.length
  assert.ok(firstGlance <= 12, `first glance is ${firstGlance} lines`)
  assert.deepEqual(ids(side.pinned), ['overview', 'tasks', 'chat', 'mail', 'calendar', 'notes', 'profile'])
})

test('an ordinary employee has no workstation block and keeps all shared sections', () => {
  const employee = REAL.filter(([id]) => N.PINNED_IDS.includes(id) || N.COMPANY_IDS.includes(id) || N.MENU_IDS.includes(id))
  const side = N.buildSidebar(employee, {})
  assert.deepEqual(side.mine, [])
  assert.ok(side.groups.every(group => group.id !== 'workstations'))
  assert.equal(ids(zones(side)).length, employee.length)
})

test('the primary workstation moves up front and is not repeated in More workstations', () => {
  const side = N.buildSidebar(REAL, { primarySection: 'finance' })
  assert.deepEqual(ids(side.mine), ['finance'])
  const more = side.groups.find(group => group.id === 'workstations')
  assert.equal(more.label, 'More workstations')
  assert.ok(!ids(more.items).includes('finance'))
})

test('without a primary workstation the group is simply Workstations', () => {
  const side = N.buildSidebar(REAL, {})
  assert.equal(side.groups.find(group => group.id === 'workstations').label, 'Workstations')
})

test('a section nobody planned for still lands in Company, so it cannot become unreachable', () => {
  const side = N.buildSidebar([...REAL, ['brand-new', 'Brand new', null]], {})
  const company = side.groups.find(group => group.id === 'company')
  assert.ok(ids(company.items).includes('brand-new'))
})

test('My Profile stands alone in the sidebar; Settings and Headshots live in the avatar menu', () => {
  const side = N.buildSidebar(REAL, {})
  assert.ok(ids(side.pinned).includes('profile'))
  assert.deepEqual(ids(side.menu).sort(), ['gallery', 'settings'])
  assert.ok(!ids(side.system).includes('settings'))
  assert.deepEqual(ids(side.system), ['admin'])
})

test('favourites default to Projects, ignore unknown ids and keep the item in its home too', () => {
  const side = N.buildSidebar(REAL, { favourites: [...N.DEFAULT_FAVOURITES, 'nope'] })
  assert.deepEqual(ids(side.favourites), ['projects'])
  assert.ok(ids(side.groups.find(group => group.id === 'company').items).includes('projects'))
})

test('toggling favourites adds, removes, ignores unknown ids and caps the list', () => {
  const valid = new Set(ids(REAL))
  assert.deepEqual(N.toggleFavourite([], 'tasks', valid), ['tasks'])
  assert.deepEqual(N.toggleFavourite(['tasks', 'mail'], 'tasks', valid), ['mail'])
  assert.deepEqual(N.toggleFavourite(['tasks'], 'ghost', valid), ['tasks'])
  let list = []
  for (const id of ids(REAL).slice(0, 12)) list = N.toggleFavourite(list, id, valid)
  assert.equal(list.length, N.MAX_FAVOURITES)
})

test('stored lists are cleaned: wrong types, unknown ids, duplicates', () => {
  const valid = new Set(['tasks', 'mail'])
  assert.deepEqual(N.sanitizeIds(['tasks', 5, 'zzz', 'tasks', 'mail'], valid, 8), ['tasks', 'mail'])
  assert.deepEqual(N.sanitizeIds('not a list', valid, 8), [])
})

test('recent pages: newest first, no repeats, capped at five', () => {
  let recent = []
  for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) recent = N.pushRecent(recent, id)
  assert.deepEqual(recent, ['f', 'e', 'd', 'a', 'c'])
})

test('Go to finds sections by label, id and the old names people still use', () => {
  const sections = REAL.map(([id, label]) => ({ id, label }))
  const top = query => N.matchSections(query, sections).map(s => s.id)
  assert.equal(top('pulse')[0], 'social')
  assert.equal(top('headshots')[0], 'gallery')
  assert.equal(top('hr')[0], 'people')
  assert.equal(top('leave')[0], 'people')
  assert.equal(top('backup')[0], 'admin')
  assert.equal(top('fin')[0], 'finance')
  assert.deepEqual(top(''), [])
  assert.deepEqual(top('zzzzzz'), [])
})

test('an exact name beats a prefix, and one letter only matches the start of a name', () => {
  const sections = [{ id: 'mail', label: 'Mail' }, { id: 'marketing', label: 'Marketing' }]
  assert.equal(N.matchSections('mail', sections)[0].id, 'mail')
  assert.deepEqual(N.matchSections('a', sections), [])
  assert.deepEqual(N.matchSections('m', sections).map(s => s.id).sort(), ['mail', 'marketing'])
})

/* ---- wiring: guards for the things that are easy to break by accident ---- */

const dash = readFileSync('src/modules/PersonalDashboard.tsx', 'utf8')
const navCss = readFileSync('src/workspace-nav.css', 'utf8')
const search = readFileSync('src/components/GlobalSearch.tsx', 'utf8')

test('hiding a sidebar item is layout only: the access filter still runs before the layout', () => {
  assert.match(app, /items\.filter\(\(\[id\]\)=>canAccess\(profile\.role,id,workstationAssignments\)\)/)
  assert.match(app, /buildSidebar\(nav,/)
  assert.ok(app.indexOf('canAccess(profile.role,id,workstationAssignments)') < app.indexOf('buildSidebar(nav,'))
})

test('Settings, My Profile and Headshots are reachable from the avatar menu', () => {
  assert.match(app, /groupedNav\.menu\.map/)
})

test('the repeated tagline and the duplicate launcher grid are gone', () => {
  assert.ok(!app.includes('One secure workplace for RideArrivo teams.'))
  assert.ok(!app.includes('const launchers='))
  assert.ok(!app.includes('Your authorised command centres'))
})

test('search gets the pages and recents, and old names still find a page', () => {
  assert.match(app, /<GlobalSearch sections=\{nav\.map/)
  assert.match(app, /recent=\{recentSections\}/)
  assert.match(search, /matchSections\(typed, sections\)/)
})

test('nothing on the dashboard was deleted, only moved behind a click', () => {
  for (const text of [
    'How your KPI is measured',
    'MyWorkspaceSessionsPanel',
    'Company equipment',
    'Workstation guide',
    'Open overdue',
    'On-time completion',
    'Completion rate',
  ]) assert.ok(dash.includes(text), `missing: ${text}`)
  assert.match(dash, /function Disclosure/)
})

test('the favourites star can never cover the page link (this broke once in a real browser)', () => {
  assert.match(navCss, /width: 20px !important/)
  assert.match(navCss, /height: 20px !important/)
  assert.match(navCss, /position: absolute !important/)
})
