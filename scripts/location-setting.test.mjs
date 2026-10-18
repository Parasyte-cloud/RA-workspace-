import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('stop sharing lives in Settings, not the sidebar', () => {
  const presence = read('../src/components/DevicePresence.tsx')
  const settings = read('../src/modules/NotificationSettings.tsx')
  assert.ok(!/Stop sharing<|> Stop sharing/.test(presence), 'sidebar must not render a Stop sharing button')
  assert.match(presence, /Share work location/)
  assert.match(presence, /LOCATION_REQUEST_EVENT/)
  assert.match(settings, /Work location sharing/)
  assert.match(settings, /LOCATION_REQUEST_EVENT/)
})
