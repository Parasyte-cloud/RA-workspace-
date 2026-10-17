import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const app = read('../src/App.tsx')
const sql = read('../supabase/migrations/20261017170000_workstation_guides_own_department.sql')

// guide slug -> the workspace section whose page shows that guide
const SECTION_FOR_GUIDE = {
  support: 'support', operations: 'operations', 'driver-guide': 'operations', people: 'people',
  engineering: 'engineering', linux: 'linux', finance: 'finance', marketing: 'marketing',
  partnerships: 'partnerships', legal: 'legal', executive: 'executive', administration: 'admin',
}

function sectionRoles(section) {
  const block = app.slice(app.indexOf('const sectionAccess'), app.indexOf('const workstationForSection'))
  const m = block.match(new RegExp(`\\n  ${section}:\\[(.*?)\\]`, 's'))
  assert.ok(m, `sectionAccess has no ${section}`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

function sqlRows() {
  const rows = new Map()
  for (const m of sql.matchAll(/\('([a-z-]+)',\s*array\[([^\]]*)\],\s*'([a-z]+)'\)/g)) {
    rows.set(m[1], { roles: [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), workstation: m[3] })
  }
  return rows
}

test('database guide access matches who can open the workstation page in the app', () => {
  const rows = sqlRows()
  assert.deepEqual([...rows.keys()].sort(), Object.keys(SECTION_FOR_GUIDE).sort())
  for (const [slug, section] of Object.entries(SECTION_FOR_GUIDE)) {
    assert.deepEqual(rows.get(slug).roles, sectionRoles(section), `roles for ${slug} differ from sectionAccess.${section}`)
  }
})

test('assignment workstation names match the app', () => {
  const rows = sqlRows()
  const map = app.slice(app.indexOf('const workstationForSection'), app.indexOf('const canAccess'))
  for (const [slug, section] of Object.entries(SECTION_FOR_GUIDE)) {
    const ws = map.match(new RegExp(`\\n  ${section}:'([a-z]+)'`))?.[1]
    assert.equal(rows.get(slug).workstation, ws, `workstation for ${slug}`)
  }
})

test('the broad read policy is replaced and nothing else is opened up', () => {
  assert.match(sql, /drop policy if exists "workstation guide active employee read"/)
  assert.match(sql, /can_read_workstation_guide\(name\)/)
  assert.match(sql, /security definer/)
  assert.match(sql, /set search_path = public, pg_temp/)
  assert.match(sql, /revoke all on function public\.can_read_workstation_guide\(text\) from public, anon/)
  assert.ok(!/for (insert|update|delete)/.test(sql), 'read access only')
  assert.ok(!sql.includes('—'))
})

test('the dashboard shows the signed-in person\'s own README', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guide-'))
  const stub = join(dir, 'stub.mjs')
  writeFileSync(stub, 'export const supabase = null')
  const out = join(dir, 'lib.mjs')
  await build({
    entryPoints: [new URL('../src/lib/workstationGuide.ts', import.meta.url).pathname], bundle: true, format: 'esm',
    platform: 'node', outfile: out, logLevel: 'silent',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: stub })) } }],
  })
  const { guideForUser } = await import(out)
  assert.equal(guideForUser('support', []).slug, 'support')
  assert.equal(guideForUser('hr', []).slug, 'people')
  assert.equal(guideForUser('engineer', []).slug, 'engineering')
  assert.equal(guideForUser('manager', []).slug, 'executive')
  assert.equal(guideForUser('admin', []).slug, 'administration')
  assert.equal(guideForUser('employee', []).slug, 'canonical')
  // an active primary assignment wins over the role
  assert.equal(guideForUser('employee', [{ workstation: 'finance', is_primary: true, active: true }]).slug, 'finance')
  assert.equal(guideForUser('support', [{ workstation: 'legal', is_primary: true, active: true }]).slug, 'legal')
  // inactive or non-primary assignments are ignored
  assert.equal(guideForUser('support', [{ workstation: 'legal', is_primary: true, active: false }]).slug, 'support')
  assert.equal(guideForUser('support', [{ workstation: 'legal', is_primary: false, active: true }]).slug, 'support')
  // an unknown workstation name falls back to the role
  assert.equal(guideForUser('marketing', [{ workstation: 'blog', is_primary: true, active: true }]).slug, 'marketing')
  // every slug it can return has a README file to publish
  const fs = await import('node:fs')
  for (const role of ['support', 'operations', 'hr', 'engineer', 'cto', 'finance', 'marketing', 'partnerships', 'legal', 'manager', 'admin', 'employee']) {
    const { slug } = guideForUser(role, [])
    assert.ok(fs.existsSync(new URL(`../supabase/guides/${slug}/readme.pdf`, import.meta.url)), slug)
  }
  assert.match(read('../src/modules/PersonalDashboard.tsx'), /slug=\{ownGuide\.slug\}/)
})
