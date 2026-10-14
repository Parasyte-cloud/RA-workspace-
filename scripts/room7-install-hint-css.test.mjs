import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Room7 install hint CSS rule is closed before phone styles', () => {
  const css = readFileSync(
    new URL('../src/room7-public/room7-public.css', import.meta.url),
    'utf8',
  )

  assert.match(
    css,
    /\.room7InstallHint\s*\{[\s\S]*?opacity:\s*0\.85;[\s\S]*?\}\s*\/\*\s*---- Phones:/,
    'room7InstallHint must close before the phone-specific styles begin',
  )
})
