import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const card = readFileSync(new URL('../src/components/WorkstationGuideCard.tsx', import.meta.url), 'utf8')
const lib = readFileSync(new URL('../src/lib/workstationGuide.ts', import.meta.url), 'utf8')
const mig = readFileSync(new URL('../supabase/migrations/20261017150000_workstation_guides_read_only.sql', import.meta.url), 'utf8')
const dept = readFileSync(new URL('../src/modules/DepartmentTeamWorkspace.tsx', import.meta.url), 'utf8')

// No way to replace a guide from the app.
assert.ok(!/Replace guide/i.test(card), 'Replace button must be gone')
assert.ok(!/\.upload\(/.test(card) && !/\.upload\(/.test(lib), 'no storage upload from the browser')
assert.ok(!/UploadCloud|type="file"/.test(card))

// The guide opens in an iframe inside the workspace, not a new tab.
assert.ok(!/window\.open/.test(card), 'must not open a new window')
assert.match(card, /<iframe/)
assert.match(card, /createPortal/)
assert.match(lib, /\.download\(workstationGuidePath\(slug\)\)/)
assert.match(lib, /type: 'application\/pdf'/)
assert.match(card, /revokeObjectURL/)

// The database refuses writes too.
for (const op of ['insert', 'update', 'delete']) {
  assert.match(mig, new RegExp(`drop policy if exists "workstation guide legal admin ${op}"`))
}
assert.ok(!/create policy/i.test(mig), 'migration must only drop write policies')

// Every workstation slug has a README to publish.
const slugs = new Set([...dept.matchAll(/workstationSlug="([a-z-]+)"/g)].map((m) => m[1]))
for (const extra of ['canonical', 'administration', 'marketing', 'linux']) slugs.add(extra)
for (const slug of slugs) assert.ok(existsSync(new URL(`../supabase/guides/${slug}/readme.pdf`, import.meta.url)), `missing README for ${slug}`)

const builder = readFileSync(new URL('./guides/build-workstation-guides.py', import.meta.url), 'utf8')
assert.ok(!builder.includes('—') && !card.includes('—'), 'no em dash')
console.log('workstation guides ok')
