import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const workflowsDir = path.join(repoRoot, '.github', 'workflows')
const ciPath = path.join(workflowsDir, 'ci.yml')

const read = (file) => fs.readFileSync(file, 'utf8')
const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .map((name) => path.join(workflowsDir, name))

const shaActionPattern = /^\s*-?\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#\s+.+)?\s*$/i

test('all external workflow actions are pinned to immutable 40-character SHAs', () => {
  const violations = []

  for (const file of workflowFiles) {
    const lines = read(file).split('\n')
    lines.forEach((line, index) => {
      if (!/^\s*-?\s*uses:\s*/.test(line)) return
      if (/^\s*-?\s*uses:\s*\.\//.test(line)) return
      if (!shaActionPattern.test(line)) {
        violations.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`)
      }
    })
  }

  assert.deepEqual(violations, [])
})

test('CI pins the validated Node runtime exactly for every setup-node step', () => {
  const ci = read(ciPath)
  const setupNodeBlocks = [...ci.matchAll(/uses:\s*actions\/setup-node@[0-9a-f]{40}[^\n]*\n(?:\s+[^\n]*\n)*?\s+node-version:\s*([^\s#]+)/g)]
  assert.equal(setupNodeBlocks.length, 3)
  assert.deepEqual(setupNodeBlocks.map((match) => match[1]), ['22.23.2', '22.23.2', '22.23.2'])
})

test('CI pins Supabase setup action and CLI version without latest', () => {
  const ci = read(ciPath)
  assert.match(
    ci,
    /uses:\s*supabase\/setup-cli@[0-9a-f]{40}\s+#\s+v2\.1\.1/,
  )
  assert.match(ci, /version:\s*2\.116\.0/)
  assert.doesNotMatch(ci, /version:\s*latest/)
})

test('CI keeps deterministic install and required quality gates', () => {
  const ci = read(ciPath)
  assert.match(ci, /- run:\s*npm ci/)
  assert.match(ci, /- run:\s*npm run typecheck/)
  assert.match(ci, /- run:\s*npm test/)
  assert.match(ci, /- run:\s*npm run build/)
  assert.match(ci, /npm audit --omit=dev --audit-level=high/)
  assert.match(ci, /npm run test:supabase/)
})
