import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8',
  ),
)

const runner = readFileSync(
  new URL('./run-tests.mjs', import.meta.url),
  'utf8',
)

test('normal npm test excludes every local Supabase integration suite', () => {
  const command = pkg.scripts?.['test:supabase'] || ''

  const supabaseSuites = [
    ...command.matchAll(/scripts\/([^\s]+\.test\.mjs)/g),
  ].map(match => match[1])

  assert.ok(
    supabaseSuites.length > 0,
    'test:supabase must name its integration suites',
  )

  for (const suite of supabaseSuites) {
    assert.ok(
      runner.includes(`'${suite}'`),
      `${suite} must be excluded from the normal Node-only test runner`,
    )
  }
})

test('local Supabase integration suites run serially', () => {
  const command = pkg.scripts?.['test:supabase'] || ''

  assert.match(
    command,
    /--test-concurrency=1/,
    'test:supabase must serialize suites that share one local Supabase stack',
  )
})


test('Chat admin management integration suite is routed through test:supabase', () => {
  const command = pkg.scripts?.['test:supabase'] || ''
  const runner = readFileSync(
    new URL('./run-tests.mjs', import.meta.url),
    'utf8',
  )

  assert.match(
    command,
    /chat-admin-management\.test\.mjs/,
    'test:supabase must include Chat admin management integration tests',
  )

  assert.match(
    runner,
    /chat-admin-management\.test\.mjs/,
    'normal npm test must exclude the local Chat admin management integration suite',
  )
})
