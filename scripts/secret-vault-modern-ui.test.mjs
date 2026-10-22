import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const panel = fs.readFileSync(
  new URL('../src/modules/SecretVaultPanel.tsx', import.meta.url),
  'utf8',
)

const css = fs.readFileSync(
  new URL('../src/modules/secret-vault.css', import.meta.url),
  'utf8',
)

test('modern Secret Vault has protected item creation and filtering', () => {
  assert.match(panel, /Add protected item/)
  assert.match(panel, /Search protected items/)
  assert.match(panel, /Secret text/)
  assert.match(panel, /Number \/ ID/)
  assert.match(panel, /Document/)
})

test('Secret Vault retains timed reveal and focus-loss concealment', () => {
  assert.match(panel, /authorizeReveal/)
  assert.match(panel, /secondsLeft/)
  assert.match(panel, /visibilitychange/)
  assert.match(panel, /window\.addEventListener\('blur'/)
  assert.match(panel, /Hide now/)
})

test('Secret Vault reveal surface blocks common browser copy interactions', () => {
  assert.match(panel, /onContextMenu/)
  assert.match(panel, /onCopy/)
  assert.match(panel, /onCut/)
  assert.match(panel, /onDragStart/)
  assert.match(panel, /AUTHORIZED VIEW/)
})

test('Secret Vault replaces raw infrastructure errors with friendly UI', () => {
  assert.match(panel, /Secure storage could not be reached/)
  assert.match(panel, /Unable to complete vault request/)
  assert.doesNotMatch(panel, />Edge Function returned a non-2xx status code</)
})

test('Secret Vault layout includes responsive liquid-glass presentation', () => {
  assert.match(css, /backdrop-filter/)
  assert.match(css, /\.secretVaultWorkspace/)
  assert.match(css, /\.secretVaultModalBackdrop/)
  assert.match(css, /\.secretVaultRevealStage/)
  assert.match(css, /@media \(max-width: 720px\)/)
})
