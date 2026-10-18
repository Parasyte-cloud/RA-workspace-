import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = walk('src').filter(f => /\.(ts|tsx)$/.test(f))

test('no code signs out with the default (global) scope', () => {
  const bad = files.filter(f => !f.endsWith('authSignOut.ts') && /auth\.signOut\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(bad, [], 'use signOutThisDevice or signOutEverywhere from lib/authSignOut')
})

test('this-device sign-out is local scope, everywhere is explicit', () => {
  const src = readFileSync('src/lib/authSignOut.ts', 'utf8')
  assert.match(src, /signOut\(\{ scope: 'local' \}\)/)
  assert.match(src, /signOut\(\{ scope: 'global' \}\)/)
})

test('the idle timeout only ends this device', () => {
  const src = readFileSync('src/lib/useIdleSignOut.ts', 'utf8')
  assert.match(src, /signOutThisDevice\(client, 'idle'\)/)
})

test('an unrequested sign-out tells the person why', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  assert.match(app, /Your session ended/)
  assert.match(app, /protectSavedSignIn/)
})
