import assert from 'node:assert/strict'
import { parseAppearance, resolveAppearance, nextAppearance, APPEARANCE_KEY } from '../src/room7-public/room7Theme.ts'
import { readFileSync } from 'node:fs'

assert.equal(parseAppearance('light'), 'light')
assert.equal(parseAppearance('dark'), 'dark')
assert.equal(parseAppearance('banana'), 'system')
assert.equal(parseAppearance(null), 'system')
assert.equal(resolveAppearance('system', true), 'dark')
assert.equal(resolveAppearance('system', false), 'light')
assert.equal(resolveAppearance('light', true), 'light')
assert.equal(resolveAppearance('dark', false), 'dark')
assert.deepEqual(['system', 'light', 'dark'].map(nextAppearance), ['light', 'dark', 'system'])

// The meeting screen must keep reading the same key.
const meeting = readFileSync('src/room7-public/ExternalRoom7Meeting.tsx', 'utf8')
assert.ok(meeting.includes(APPEARANCE_KEY), 'meeting shares the appearance key')
console.log('room7-theme ok')
