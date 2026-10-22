import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict'
const app=fs.readFileSync('src/App.tsx','utf8')
test('Secret Vault is its own section open to every workspace role',()=>{
  assert.match(app,/\|'notes'\|'vault'/)
  assert.match(app,/vault:allWorkspaceRoles,/)
  assert.match(app,/\['vault','Secret Vault',KeyRound\]/)
  assert.match(app,/section==='vault'&&<SecretVaultPanel\/>/)
})
test('no em dash in the new lines',()=>{assert.ok(!/vault:allWorkspaceRoles[^\n]*—/.test(app))})
