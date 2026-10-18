import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const read = p => readFileSync(p, 'utf8')
const load = async (p, replace = {}) => {
  let src = read(p)
  for (const [a, b] of Object.entries(replace)) src = src.replace(a, b)
  const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const N = await load('src/lib/notes.ts')
const nav = await load('src/lib/workspaceNav.ts')
const I = await load('src/lib/islandPrefs.ts', { "import { sanitizeIds } from './workspaceNav'": 'const sanitizeIds=(raw,valid,max)=>{if(!Array.isArray(raw))return[];const o=[];for(const v of raw){if(typeof v==="string"&&valid.has(v)&&!o.includes(v))o.push(v);if(o.length>=max)break}return o}' })
const F = await load('src/lib/fontStyle.ts')

test('notes are private: owner-only row level security', () => {
  const sql = read('supabase/migrations/20261018160000_workspace_notes.sql')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /owner_id = auth\.uid\(\)/)
  assert.match(sql, /revoke all on public\.workspace_notes from anon/i)
})
test('body round trips through lines', () => {
  const body = '- [ ] milk\n- [x] eggs\n- bread\nplain'
  const lines = N.parseBody(body)
  assert.equal(lines.length, 4)
  assert.equal(lines[0].kind, 'todo')
  assert.equal(lines[1].done, true)
  assert.equal(N.serializeBody(lines), body)
})
test('notes show up in nav, router and the phone dock', () => {
  assert.ok(nav.PINNED_IDS.includes('notes'))
  const app = read('src/App.tsx')
  assert.match(app, /notes:allWorkspaceRoles/)
  assert.match(app, /section==='notes'&&<NotesModule\/>/)
  assert.match(read('src/modules/PhoneNav.tsx'), /TAB_IDS = \[[^\]]*'notes'/)
  assert.match(read('src/phone-shell.css'), /repeat\(6, minmax\(0, 1fr\)\)/)
})
test('notes autosave and keep an offline draft', () => {
  const m = read('src/modules/NotesModule.tsx')
  assert.match(m, /pagehide/)
  assert.match(m, /ra-note-draft-/)
  assert.match(m, /Recently deleted/)
})
test('island: choose, limit, reorder', () => {
  const valid = new Set(['overview', 'tasks', 'chat', 'mail', 'calendar', 'notes', 'files', 'crm'])
  assert.deepEqual(I.cleanIsland(null, valid), [...I.ISLAND_DEFAULT])
  assert.deepEqual(I.cleanIsland(['chat', 'nope', 'chat', 'crm'], valid), ['chat', 'crm'])
  assert.deepEqual(I.cleanIsland(['chat'], valid), [...I.ISLAND_DEFAULT])
  let cur = ['chat', 'mail']
  cur = I.toggleIsland(cur, 'files', valid)
  assert.deepEqual(cur, ['chat', 'mail', 'files'])
  assert.deepEqual(I.toggleIsland(['chat', 'mail'], 'chat', valid), ['chat', 'mail'], 'keeps the minimum')
  assert.deepEqual(I.toggleIsland(['chat', 'mail'], 'admin', valid), ['chat', 'mail'], 'unknown ids ignored')
  const full = ['overview', 'tasks', 'chat', 'mail', 'calendar', 'notes', 'files']
  assert.equal(I.toggleIsland(full, 'crm', valid).length, I.ISLAND_MAX)
  assert.deepEqual(I.moveIsland(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b'])
  assert.deepEqual(I.moveIsland(['a', 'b'], 'a', -1), ['a', 'b'])
})
test('fonts: choices validate and stay on this device', () => {
  assert.equal(F.FONT_STYLES[0].id, 'default')
  assert.equal(F.isFontStyleId('serif'), true)
  assert.equal(F.isFontStyleId('<x>'), false)
  assert.match(read('src/App.tsx'), /applyStoredFontStyle\(\)/)
  assert.match(read('src/modules/AppearanceSettings.tsx'), /FontStyleCard/)
})
test('island only offers sections already allowed', () => {
  const app = read('src/App.tsx')
  assert.match(app, /<IslandNav nav=\{nav\}/)
})

test('island: double tap to move, position stays on screen and is saved', () => {
  assert.equal(I.isDoubleTap(1000, 1200), true)
  assert.equal(I.isDoubleTap(1000, 1500), false)
  assert.equal(I.isDoubleTap(0, 100), false)
  const p = I.clampPos(-500, 9999, 400, 56, 1024, 768)
  assert.deepEqual(p, { fx: 0, fy: 1 })
  const px = I.posToPixels({ fx: 1, fy: 1 }, 400, 56, 1024, 768)
  assert.equal(px.left + 400 <= 1024 && px.top + 56 <= 768, true)
  assert.equal(I.cleanPos({ fx: 3, fy: -1 }).fx, 1)
  assert.equal(I.cleanPos({ fx: 'a' }), null)
  const src = read('src/modules/IslandNav.tsx')
  assert.match(src, /isDoubleTap\(lastTap\.current/)
  assert.match(src, /savePos\(pos\)/)
})

test('sharing: owner-only control, editors cannot pin or trash, names are limited', () => {
  const sql = read('supabase/migrations/20261018170000_workspace_notes_sharing.sql')
  assert.match(sql, /create table if not exists public\.note_shares/)
  assert.match(sql, /owner_id = auth\.uid\(\) or public\.note_can_read\(id\)/)
  assert.match(sql, /owner_id = auth\.uid\(\) or public\.note_can_edit\(id\)/)
  assert.match(sql, /new\.pinned := old\.pinned/)
  assert.match(sql, /new\.deleted_at := old\.deleted_at/)
  assert.match(sql, /public\.note_owner\(note_id\) = auth\.uid\(\) and user_id <> auth\.uid\(\)/)
  assert.match(sql, /revoke all on public\.note_shares from anon/i)
  assert.match(sql, /'note_shared'/)
  assert.ok(!/for delete[^;]*workspace_notes[^;]*note_can/i.test(sql), 'delete stays owner only')
  assert.match(read('src/components/NotificationCenter.tsx'), /workspace_note/)
})
test('sharing: access rules for the buttons', async () => {
  const shares = [{ note_id: 'n', user_id: 'b', can_edit: true }, { note_id: 'n', user_id: 'c', can_edit: false }]
  const note = { id: 'n', owner_id: 'a' }
  assert.equal(N.accessFor(note, 'a', shares), 'owner')
  assert.equal(N.accessFor(note, 'b', shares), 'edit')
  assert.equal(N.accessFor(note, 'c', shares), 'view')
  assert.equal(N.accessFor(note, 'z', shares), 'view')
  assert.equal(N.isSharedByMe(note, 'a', shares), true)
  assert.equal(N.isSharedByMe(note, 'b', shares), false)
  assert.equal(N.personName({ id: 'x', full_name: '', email: 'x@ridearrivo.com' }), 'x@ridearrivo.com')
})
