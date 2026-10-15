import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('phone menu has Settings, theme switch and Sign out; settings page has ringtones', () => {
  const nav = read('src/modules/PhoneNav.tsx')
  assert.match(nav, /groups\.menu/)
  assert.match(nav, /Sign out/)
  assert.match(nav, /Light mode/)
  assert.match(read('src/App.tsx'), /onSignOut=\{\(\)=>\{setPhoneMenuOpen\(false\);void signOut\(\)\}\}/)
  assert.match(read('src/App.tsx'), /<NotificationSettings/)
  const s = read('src/modules/NotificationSettings.tsx')
  assert.match(s, /RINGTONES\.map/)
  assert.match(s, /PhoneAlertsToggle/)
})

test('ring light is drawn along the screen edge on phones', () => {
  const css = read('src/app-feel.css')
  assert.match(css, /max-width: 599px/)
  assert.match(css, /data-ra-glow='high'\] body::after/)
  assert.match(css, /pointer-events: none/)
  assert.match(read('src/InternalApp.tsx'), /app-feel\.css/)
})

test('manifest is installable with maskable icon, shortcuts and iOS tags', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'))
  assert.equal(m.display, 'standalone')
  assert.ok(m.icons.some(i => i.purpose === 'maskable'))
  assert.ok(m.shortcuts.length >= 3)
  assert.ok(fs.existsSync(new URL('../public/icons/icon-maskable-512.png', import.meta.url)))
  assert.match(read('index.html'), /apple-mobile-web-app-capable/)
})

test('closed apps keep ringing: repeats while the call is unanswered, badge on push', () => {
  const fn = read('supabase/functions/push-dispatch/index.ts')
  assert.match(fn, /RING_REPEATS/)
  assert.match(fn, /eq\("status", "ringing"\)/)
  assert.match(fn, /waitUntil/)
  const sw = read('public/sw.js')
  assert.match(sw, /setAppBadge/)
  assert.match(sw, /renotify: Boolean\(data\.tag\)/)
  assert.match(read('src/context/NotificationsContext.tsx'), /setAppBadge/)
})
