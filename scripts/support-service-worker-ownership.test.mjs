import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const helperPath = 'src/pwa/registerWorkspaceServiceWorker.ts'
const helper = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, 'utf8') : ''
const app = fs.readFileSync('src/App.tsx', 'utf8')
const support = fs.readFileSync('src/support/pwa.ts', 'utf8')
const headers = fs.readFileSync('public/_headers', 'utf8')

test('root service worker selection is centralized and host aware', () => {
  assert.match(helper, /workspaceServiceWorkerUrl/)
  assert.match(helper, /support\.ridearrivo\.com/)
  assert.match(helper, /'\/support-sw\.js'/)
  assert.match(helper, /'\/sw\.js'/)
  assert.match(helper, /registerWorkspaceServiceWorker/)
  assert.match(app, /registerWorkspaceServiceWorker/)
  assert.doesNotMatch(app, /serviceWorker\.register\('\/sw\.js'/)
})

test('support push reuses central registration and never registers a competing root worker', () => {
  assert.match(support, /registerWorkspaceServiceWorker/)
  assert.doesNotMatch(support, /navigator\.serviceWorker\.register/)
  assert.match(helper, /unregister\(\)/)
  assert.match(helper, /\/sw\.js/)
})

test('support root worker and manifest always revalidate', () => {
  const sw = headers.split('\n/support-sw.js\n')[1]?.split('\n')[0] || ''
  const manifest = headers.split('\n/support.webmanifest\n')[1]?.split('\n')[0] || ''
  assert.match(sw, /Cache-Control:\s*no-cache/)
  assert.match(manifest, /Cache-Control:\s*no-cache/)
})
