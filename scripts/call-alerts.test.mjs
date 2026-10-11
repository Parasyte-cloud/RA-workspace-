import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const alerts = readFileSync('src/lib/desktopAlerts.ts', 'utf8')
const ctx = readFileSync('src/context/NotificationsContext.tsx', 'utf8')
const center = readFileSync('src/components/NotificationCenter.tsx', 'utf8')
const ringer = readFileSync('src/modules/CallRinger.tsx', 'utf8')

test('alerts only fire with permission and when the tab is in the background', () => {
  assert.match(alerts, /Notification\.permission !== 'granted' \|\| !tabIsBackground\(\)/)
  assert.match(alerts, /visibilityState === 'hidden' \|\| !document\.hasFocus\(\)/)
})

test('call alerts stay on screen until answered', () => {
  assert.match(alerts, /requireInteraction: Boolean\(options\.urgent\)/)
  assert.match(ctx, /urgent:row\.type==='call'/)
})

test('new notifications and chat message updates raise an alert', () => {
  assert.match(ctx, /payload\.eventType==='INSERT'/)
  assert.match(ctx, /row\?\.type==='chat_message' && !row\?\.read_at/)
})

test('clicking an alert focuses the tab and opens the right section', () => {
  assert.match(alerts, /window\.focus\(\)/)
  assert.match(center, /addEventListener\(OPEN_SECTION_EVENT/)
  assert.match(center, /ra\.chat\.open/)
})

test('the ringer asks for permission once and flashes the tab title', () => {
  assert.match(ringer, /requestAlertPermission/)
  assert.match(ringer, /dismissAlertsPrompt/)
  assert.match(ringer, /flashTitle\(`Incoming call:/)
})
