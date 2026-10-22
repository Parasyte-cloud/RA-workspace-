import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict'
const sql=fs.readFileSync('supabase/migrations/20261022210000_secret_vault_delegate_reveal.sql','utf8')
const ui=fs.readFileSync('src/modules/AdminSecurityPermissionsPanel.tsx','utf8')
test('delegate access is reveal only, never manage',()=>{assert.match(sql,/not need_manage and public\.has_workspace_capability\('vault\.reveal'\)/);assert.doesNotMatch(sql,/has_workspace_capability\('vault\.manage'\)/)})
test('owner, admin and active-profile checks are kept',()=>{assert.match(sql,/i\.owner_id=auth\.uid\(\)/);assert.match(sql,/public\.is_active_workspace_admin\(\)/);assert.match(sql,/p\.active=true/);assert.match(sql,/secret_vault_acl a/)})
test('function stays definer with fixed search path and locked grants',()=>{assert.match(sql,/security definer\s+set search_path=public/);assert.match(sql,/revoke all on function public\.can_access_secret_vault_item\(uuid,boolean\) from public/)})
test('admin screen says what the button does and offers an end date',()=>{assert.match(ui,/Allow vault access without owner approval/);assert.match(ui,/Vault access length/);assert.match(ui,/expiresAt\)/)})
test('no em dash',()=>{assert.ok(!sql.includes('—')&&!ui.includes('—'))})
