import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'

/*
 * Confidential messages (the vault), 19 October 2026.
 * Behaviour tests run the real crypto and key code. Contract tests pin the
 * rules that keep content out of the browser, so a later edit cannot quietly
 * weaken them. The database rules were also run on a real Postgres engine
 * (PGlite) with attacks and mutations; see docs/confidential-messages.md.
 */

const read = p => readFileSync(p, 'utf8')
let instance = 0
const load = async path => {
  const code = buildSync({ entryPoints: [path], bundle: true, format: 'esm', write: false }).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// copy ${++instance}`).toString('base64')}`)
}

const sql = read('supabase/migrations/20261019100000_confidential_messages.sql')
const fn = read('supabase/functions/confidential-vault/index.ts')
const MASTER = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const PEPPER = 'p'.repeat(40)

// ---------- server crypto and key logic ----------

test('keys use only the safe alphabet, are 12 long, and do not repeat', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  const seen = new Set()
  for (let i = 0; i < 2000; i++) {
    const key = core.generateKey()
    assert.equal(key.length, 12)
    assert.match(key, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/)
    seen.add(key)
  }
  assert.equal(seen.size, 2000)
  // No look-alike characters.
  for (const ch of 'ILO01') assert.ok(!core.KEY_ALPHABET.includes(ch), ch)
})

test('every character of the alphabet comes up about equally often (no modulo bias)', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  const counts = new Map()
  const rounds = 20000
  for (let i = 0; i < rounds; i++) for (const ch of core.generateKey()) counts.set(ch, (counts.get(ch) || 0) + 1)
  const expected = (rounds * 12) / core.KEY_ALPHABET.length
  for (const ch of core.KEY_ALPHABET) {
    const seen = counts.get(ch) || 0
    assert.ok(Math.abs(seen - expected) / expected < 0.06, `${ch} ${seen} vs ${expected}`)
  }
})

test('a typed key is normalised: case, spaces and dashes do not matter, bad characters are dropped', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  assert.equal(core.normalizeKey('abcd-efgh jkmn'), 'ABCDEFGHJKMN')
  assert.equal(core.normalizeKey('ab0cd1'), 'ABCD')
  assert.equal(core.normalizeKey(null), '')
  assert.equal(core.formatKey('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN')
  assert.equal(core.isCompleteKey('ABCDEFGHJKMN'), true)
  assert.equal(core.isCompleteKey('ABCDEFGHJKM'), false)
})

test('the stored hash depends on the pepper, so a stolen database cannot be used to guess keys', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  const a = core.parseSecrets(MASTER, PEPPER)
  const b = core.parseSecrets(MASTER, 'q'.repeat(40))
  const h1 = await core.hashKey('ABCDEFGHJKMN', a)
  assert.equal(h1, await core.hashKey('ABCDEFGHJKMN', a))
  assert.notEqual(h1, await core.hashKey('ABCDEFGHJKMN', b))
  assert.notEqual(h1, await core.hashKey('ABCDEFGHJKMP', a))
  assert.match(h1, /^[0-9a-f]{64}$/)
})

test('sealed text opens only with the right secret and the right chat and sender', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  const secrets = core.parseSecrets(MASTER, PEPPER)
  const ctx = core.sealContext('conv-1', 'user-1')
  const sealed = await core.sealText('The salary list is attached', secrets, ctx)
  assert.match(sealed, /^v1:/)
  assert.ok(!sealed.includes('salary'))
  assert.equal(await core.openText(sealed, secrets, ctx), 'The salary list is attached')
  // Moved into another chat or sender: refused.
  await assert.rejects(core.openText(sealed, secrets, core.sealContext('conv-2', 'user-1')))
  await assert.rejects(core.openText(sealed, secrets, core.sealContext('conv-1', 'user-2')))
  // A different master key: refused.
  const other = core.parseSecrets(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'), PEPPER)
  await assert.rejects(core.openText(sealed, other, ctx))
  // Tampered: refused.
  const bytes = Buffer.from(sealed.slice(3), 'base64')
  bytes[bytes.length - 1] ^= 1
  await assert.rejects(core.openText(`v1:${bytes.toString('base64')}`, secrets, ctx))
  // Two seals of the same text differ (fresh random IV each time).
  assert.notEqual(sealed, await core.sealText('The salary list is attached', secrets, ctx))
})

test('missing or weak secrets switch the vault off instead of falling back', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  assert.equal(core.parseSecrets(undefined, PEPPER), null)
  assert.equal(core.parseSecrets(MASTER, undefined), null)
  assert.equal(core.parseSecrets(MASTER, 'short'), null)
  assert.equal(core.parseSecrets(Buffer.from('too short').toString('base64'), PEPPER), null)
  assert.equal(core.parseSecrets('%%%not base64%%%', PEPPER), null)
  assert.ok(core.parseSecrets(MASTER, PEPPER))
  assert.match(fn, /parseSecrets\([\s\S]{0,120}VAULT_MASTER_KEY[\s\S]{0,80}VAULT_PEPPER/)
  assert.match(fn, /if \(!secrets\) \{\s*return fail\(req, 503, "not_configured"/)
})

test('a file is judged by its first bytes, not by what the browser claims', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  const pdf = new TextEncoder().encode('%PDF-1.7\n')
  assert.equal(core.sniffMime(pdf), 'application/pdf')
  assert.equal(core.sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), 'image/png')
  assert.equal(core.sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(core.sniffMime(new TextEncoder().encode('GIF89a')), 'image/gif')
  assert.equal(core.sniffMime(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')), 'image/webp')
  // A web page or a program renamed to .pdf is not allowed through.
  assert.equal(core.sniffMime(new TextEncoder().encode('<html><script>')), null)
  assert.equal(core.sniffMime(new TextEncoder().encode('MZ\u0090\u0000')), null)
  assert.equal(core.isAllowedMime('application/pdf'), true)
  assert.equal(core.isAllowedMime('image/svg+xml'), false)
  assert.equal(core.isAllowedMime('text/html'), false)
  assert.equal(core.cleanFileName('../../etc/passwd'), '.._.._etc_passwd')
})

test('failure messages never reveal more than they should', async () => {
  const core = await load('supabase/functions/_shared/vaultCore.ts')
  assert.match(core.openFailureMessage('wrong_key', 2), /2 tries left/)
  assert.match(core.openFailureMessage('wrong_key', 1), /1 try left/)
  assert.match(core.openFailureMessage('spent'), /Contact an administrator/)
  assert.match(core.openFailureMessage('locked'), /Contact an administrator/)
  assert.equal(core.openFailureMessage('forbidden'), core.openFailureMessage('not_found'))
})

// ---------- client logic ----------

test('the client key rules match the server exactly', async () => {
  const server = await load('supabase/functions/_shared/vaultCore.ts')
  const client = await load('src/chat/vault/vaultFormat.ts')
  assert.equal(client.KEY_ALPHABET, server.KEY_ALPHABET)
  assert.equal(client.KEY_LENGTH, server.KEY_LENGTH)
  assert.deepEqual([...client.VIEW_CHOICES], [...server.VIEW_SECONDS_PRESETS])
  for (const sample of ['abcd efgh jkmn', 'ABCD-EFGH-JKMN-ZZZZ', 'a1b2 c3d4']) {
    assert.equal(client.normalizeKeyInput(sample), server.normalizeKey(sample).slice(0, 12), sample)
  }
  assert.equal(client.formatKey('ABCDEFGHJKMN'), server.formatKey('ABCDEFGHJKMN'))
})

test('view times read plainly and never go above the administrator ceiling', async () => {
  const f = await load('src/chat/vault/vaultFormat.ts')
  assert.deepEqual([15, 30, 60, 300, 900, 1800, 3600].map(f.viewLabel),
    ['15 seconds', '30 seconds', '1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour'])
  assert.deepEqual(f.choicesUpTo(900), [15, 30, 60, 300, 900])
  assert.deepEqual(f.choicesUpTo(10), [])
  assert.equal(f.countdownLabel(65_000), '1:05')
  assert.equal(f.countdownLabel(0), '0:00')
  assert.equal(f.countdownLabel(-5), '0:00')
})

test('the card shows the right face to the sender, the recipient and a late arrival', async () => {
  const f = await load('src/chat/vault/vaultFormat.ts')
  const base = { id: 'i', message_id: 'm', conversation_id: 'c', sender_id: 'ann', kind: 'text', mime: null,
    view_seconds: 60, opened_by: null, opened_at: null, failed_attempts: 0, unblock_count: 0 }
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(f.cardState(undefined, 'bob', now), 'loading')
  assert.equal(f.cardState({ ...base, status: 'pending' }, 'ann', now), 'pending')
  assert.equal(f.cardState({ ...base, status: 'sealed' }, 'bob', now), 'sealed')
  assert.equal(f.cardState({ ...base, status: 'sealed' }, 'ann', now), 'mine-sealed')
  assert.equal(f.cardState({ ...base, status: 'locked' }, 'bob', now), 'blocked')
  assert.equal(f.cardState({ ...base, status: 'locked' }, 'ann', now), 'mine-blocked')
  assert.equal(f.cardState({ ...base, status: 'destroyed' }, 'bob', now), 'deleted')
  const spent = { ...base, status: 'spent', opened_by: 'bob', opened_at: '2026-10-19T11:59:30Z' }
  // 30 seconds into a 60 second window, for the person who opened it.
  assert.equal(f.cardState(spent, 'bob', now), 'window')
  // Someone else, or the same person after the window: it is just "viewed".
  assert.equal(f.cardState(spent, 'cy', now), 'viewed')
  assert.equal(f.cardState(spent, 'bob', now + 40_000), 'viewed')
  assert.equal(f.cardState(spent, 'ann', now), 'mine-viewed')
})

// ---------- database contract ----------

test('secrets, grants, requests and audit are closed to the browser', () => {
  assert.match(sql, /revoke all on public\.confidential_secrets, public\.confidential_grants,\s*public\.confidential_requests, public\.confidential_audit from public, anon, authenticated;/)
  // No policy is ever created on those four tables.
  for (const table of ['confidential_secrets', 'confidential_grants', 'confidential_requests', 'confidential_audit']) {
    assert.doesNotMatch(sql, new RegExp(`create policy[^;]*on public\\.${table}`), table)
  }
  assert.match(sql, /revoke insert, update, delete on public\.confidential_items from authenticated;/)
  // The secret columns are not on the table that realtime carries.
  const items = sql.slice(sql.indexOf('create table if not exists public.confidential_items'), sql.indexOf('create table if not exists public.confidential_secrets'))
  for (const secret of ['key_hash', 'ciphertext', 'file_path']) assert.ok(!items.includes(secret), secret)
})

test('only the vault can create or relink a confidential chat row, and it cannot be edited or forwarded', () => {
  assert.match(sql, /coalesce\(current_setting\('vault\.write', true\), ''\) <> 'on'/)
  assert.match(sql, /Confidential messages are created through the vault only\./)
  assert.match(sql, /A confidential message cannot be edited\./)
  assert.match(sql, /A confidential message cannot be forwarded\./)
  assert.match(sql, /perform set_config\('vault\.write', 'on', true\)/)
  // The chat row holds a placeholder only.
  assert.match(sql, /'Confidential document' else 'Confidential message'|then 'Confidential document'\s+else 'Confidential message'/)
})

test('state changes are atomic and every key attempt is counted and capped', () => {
  for (const name of ['vault_open', 'vault_unblock', 'vault_destroy', 'vault_finish']) {
    const body = sql.slice(sql.indexOf(`function public.${name}(`))
    assert.match(body.slice(0, 1600), /for update/, name)
  }
  assert.match(sql, /failed_attempts = failed_attempts \+ 1/)
  assert.match(sql, /case when failed_attempts \+ 1 >= v_max then 'locked' else status end/)
  // The key is burned the moment it works.
  assert.match(sql, /update public\.confidential_secrets set key_hash = null where item_id = p_item;\s+insert into public\.confidential_grants/)
  assert.match(sql, /if it\.sender_id = p_user then\s+return jsonb_build_object\('ok', false, 'code', 'own'\)/)
})

test('the vault functions are for the edge function only; admin tools check the admin role', () => {
  const internal = sql.slice(sql.indexOf('revoke all on function\n  public.vault_begin'), sql.indexOf('-- 7. Called from the browser.'))
  assert.match(internal, /from public, anon, authenticated;/)
  assert.match(internal, /to service_role;/)
  assert.doesNotMatch(internal, /to authenticated/)
  assert.match(sql, /role = 'admin'/)
  assert.doesNotMatch(sql.slice(sql.indexOf('function public.is_vault_admin'), sql.indexOf('function public.is_vault_admin') + 400), /'hr'/)
  for (const name of ['vault_admin_list', 'vault_admin_audit', 'vault_admin_set_settings']) {
    const body = sql.slice(sql.indexOf(`function public.${name}(`))
    assert.match(body.slice(0, 900), /is_vault_admin\(auth\.uid\(\)\)/, name)
  }
  assert.match(sql, /vault_unblock[\s\S]{0,400}is_vault_admin\(p_admin\)/)
  // The view time cannot exceed the administrator ceiling.
  assert.match(sql, /p_view_seconds > v_max/)
})

test('the file bucket is private and has no storage policy', () => {
  assert.match(sql, /'confidential-vault', 'confidential-vault', false, 15728640/)
  assert.doesNotMatch(sql, /on storage\.objects/)
})

test('the migration is safe to run twice', () => {
  assert.doesNotMatch(sql, /create table (?!if not exists)/)
  assert.doesNotMatch(sql, /create index (?!if not exists)/)
  assert.match(sql, /drop trigger if exists guard_confidential_message_ins/)
  assert.match(sql, /duplicate_object then null/)
})

// ---------- edge function contract ----------

test('the edge function never logs content or keys and never lets a response be cached', () => {
  assert.doesNotMatch(fn, /console\.(log|info|debug)\(/)
  // Errors are logged without the text, key or hash in them.
  for (const line of fn.split('\n').filter(l => /console\.(error|warn)/.test(l))) {
    assert.doesNotMatch(line, /\b(text|key|hash|ciphertext|plain)\b(?!-)/i, line)
  }
  assert.match(fn, /"Cache-Control": "no-store, no-cache, max-age=0"/)
})

test('the edge function only ever opens content through the database check', () => {
  const reveal = fn.slice(fn.indexOf('if (action === "reveal")'), fn.indexOf('if (action === "resume")'))
  assert.ok(reveal.indexOf('vault_open') > -1 && reveal.indexOf('vault_open') < reveal.indexOf('deliver('))
  assert.match(reveal, /if \(!result\?\.ok\)/)
  // A half-typed key is not an attempt; the rate limit runs before the check.
  assert.match(reveal, /isCompleteKey\(key\)[\s\S]{0,200}rateCount[\s\S]{0,300}vault_open/)
  const resume = fn.slice(fn.indexOf('if (action === "resume")'), fn.indexOf('if (action === "destroy")'))
  assert.ok(resume.indexOf('vault_resume') < resume.indexOf('deliver('))
  // Files are handed out as a short signed address sized to the time left.
  assert.match(fn, /createSignedUrl\(secret\.file_path, Math\.max\(secondsLeft, 5\)\)/)
})

test('an upload is checked by its first bytes and discarded if it is not what it claims', () => {
  const finish = fn.slice(fn.indexOf('if (action === "finish_file")'), fn.indexOf('if (action === "reveal")'))
  assert.match(finish, /sniffMime\(bytes\) !== item\.mime/)
  assert.match(finish, /await discard\(\)/)
  assert.match(finish, /Range: "bytes=0-15"/)
})

test('the key is made on the server, shown once in the response and stored only as a hash', () => {
  assert.match(fn, /const key = generateKey\(\)\s+const hash = await hashKey\(key, secrets!\)/)
  // No vault function ever receives the raw key, only its hash. (p_key in the rate
  // limiter is a counter label such as "vaultopen:<uid>", not a secret.)
  const vaultCalls = fn.match(/rpc\("vault_[a-z_]+",\s*\{[^}]*\}/g) || []
  assert.ok(vaultCalls.length >= 4)
  for (const call of vaultCalls) assert.doesNotMatch(call, /p_key\b(?!_hash)|p_secret|p_plain/, call)
  assert.match(fn, /rpc\("vault_open", \{ p_item: itemId, p_user: uid, p_key_hash: hash \}\)/)
  assert.doesNotMatch(fn, /\.from\("confidential_secrets"\)\s*\.(insert|update|upsert)/)
  assert.match(fn, /action === "create_text"[\s\S]{0,2200}sealText\(text, secrets/)
})

// ---------- screens ----------

test('the browser code never touches the secrets table', () => {
  for (const file of ['src/chat/vault/vaultApi.ts', 'src/chat/vault/useVaultItems.ts', 'src/chat/vault/ConfidentialCard.tsx',
    'src/chat/vault/ConfidentialViewer.tsx', 'src/chat/vault/KeySheet.tsx', 'src/modules/AdminConfidential.tsx']) {
    const code = read(file)
    for (const table of ['confidential_secrets', 'confidential_grants', 'confidential_requests', 'confidential_audit']) {
      assert.ok(!code.includes(table), `${file} mentions ${table}`)
    }
    assert.doesNotMatch(code, /\.from\('confidential_items'\)\s*\.(insert|update|upsert|delete)/, file)
  }
})

test('the chat only appears to offer the lock once the server side exists', () => {
  const shell = read('src/chat/ChatShell.tsx')
  // Deploy order safety: the app must not ask the database for a column that may not exist yet.
  const columns = shell.match(/const MESSAGE_COLUMNS='([^']+)'/)[1]
  assert.ok(!columns.includes('confidential_id'))
  assert.match(shell, /\{vaultSettings&&\(\s*<LockButton/)
  // chat-composer-enter pins className="cmSend" on the send button, so the lock state is a data attribute.
  assert.match(shell, /className="cmSend" data-vault=\{vaultOn\?'on':undefined\}/)
  assert.match(read('src/chat/vault/vault.css'), /\.cmSend\[data-vault="on"\]/)
  const api = read('src/chat/vault/vaultApi.ts')
  assert.match(api, /Promise<VaultSettings \| null>/)
})

test('the lock button does not borrow the chat banner class, and the layout rules that broke it stay fixed', () => {
  // The chat already has a ".cmLock" banner ("Private. Only the two of you..."). Reusing that name made the
  // button inherit the banner's padding, margin and tint.
  assert.match(read('src/chat.css'), /\.cmLock\{/)
  const bar = read('src/chat/vault/LockComposerBar.tsx')
  assert.doesNotMatch(bar, /cmLock\b/)
  assert.match(bar, /cmVaultBtn/)
  const css = read('src/chat/vault/vault.css')
  assert.doesNotMatch(css, /\.cmLock\b/)
  // A confidential bubble has a fixed width: a percentage width inside a bubble that sizes itself to its
  // contents ballooned the bubble to its 640px cap around a 340px card.
  assert.match(css, /\.cmMsg \.cmBubble\[data-vault\] \{ width: 360px;/)
  // chat-ios-layout.test.mjs finds the bubble by the literal className="cmBubble", so the state is a data attribute.
  assert.match(read('src/chat/ChatShell.tsx'), /className="cmBubble"\s+data-vault=\{isConf&&!deleted\?'on':undefined\}/)
  // The bar floats above the floating composer, and the chat measures it so the list makes room.
  assert.match(css, /\.cmThread \.vcBar \{\s*position: absolute;/)
  const shell = read('src/chat/ChatShell.tsx')
  assert.equal((shell.match(/'\.cmTyping','\.vcBar'\]/g) || []).length, 2)
  // Own bubbles are orange: the card uses the same dark ink as ordinary messages, not the pale muted grey.
  assert.match(css, /\.cmMsg\.mine \.vcCard \{ color: #1a1200; \}/)
  assert.match(css, /\.cmMsg\.mine \.vcTime, \.cmMsg\.mine \.vcSmall, \.cmMsg\.mine \.vcEnded \{ color: inherit;/)
})

test('a confidential message cannot be copied, edited or forwarded from the chat', () => {
  const shell = read('src/chat/ChatShell.tsx')
  assert.match(shell, /&& !message\.forwarded_from_user_id && !isConf/)
  assert.match(shell, /copyableText\(message\)&&!isConf/)
  assert.match(shell, /canForward\(message\)&&!isConf/)
  assert.match(shell, /: isConf\s+\? \(\s*<ConfidentialCard/)
})

test('sending routes through the vault and keeps the key off the chat', () => {
  const shell = read('src/chat/ChatShell.tsx')
  assert.match(shell, /if\(vaultOn && vaultSettings\)\{\s*void submitConfidential\(body,staged\)/)
  assert.match(shell, /callVault<\{key:string\}>\('create_text'/)
  assert.match(shell, /sendConfidentialFile\(selectedId,item\.file,item\.mime,vaultSeconds\)/)
  assert.match(shell, /Only PDF files and images can be sent as confidential\./)
  assert.match(shell, /useEffect\(\(\)=>\{setVaultOn\(false\)\},\[selectedId\]\)/)
  assert.match(shell, /callVault\('destroy',\{item_id:vaultItemId\}\)/)
  // The key sheet says to share the key outside this chat.
  assert.match(read('src/chat/vault/KeySheet.tsx'), /not in this chat/)
})

test('the viewer takes the content away when time is up, when the person looks away and on copy, print and save', () => {
  const v = read('src/chat/vault/ConfidentialViewer.tsx')
  assert.match(v, /performance\.now\(\)/)
  assert.match(v, /if \(remaining <= 0\) finish\('expired'\)/)
  assert.match(v, /visibilitychange/)
  assert.match(v, /\['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'\]/)
  assert.match(v, /\['c', 'x', 'p', 's', 'a', 'u'\]/)
  assert.match(v, /PrintScreen/)
  assert.match(v, /URL\.revokeObjectURL\(objectUrl\)/)
  assert.match(v, /canvas\.width = 0/)
  assert.match(v, /watermarkLabel\(opened\.viewer\.name/)
  assert.match(read('src/chat/vault/vault.css'), /@media print \{ \.cvOverlay, \.ksOverlay \{ display: none !important; \} \}/)
})

test('the card says what the person asked for: need to view again, contact admin', async () => {
  const f = await load('src/chat/vault/vaultFormat.ts')
  assert.equal(f.VIEWED_NOTE, 'Need to view again? Contact an administrator.')
  const card = read('src/chat/vault/ConfidentialCard.tsx')
  assert.match(card, /\{VIEWED_NOTE\}/)
  assert.match(card, /Ask an administrator/)
})

test('the Confidential tab is in Administration and administrators never see content there', () => {
  const plane = read('src/modules/AdministrationControlPlane.tsx')
  assert.match(plane, /\['confidential','Confidential',ShieldCheck\]/)
  assert.match(plane, /\{tab==='confidential'&&<AdminConfidential\/>\}/)
  const admin = read('src/modules/AdminConfidential.tsx')
  assert.doesNotMatch(admin, /ciphertext|text:|\.url/)
  assert.match(admin, /callVault<\{ key: string \}>\('unblock'/)
})

test('nothing new uses an em dash', () => {
  const dash = new RegExp(String.fromCharCode(0x2014))
  for (const file of [
    'supabase/migrations/20261019100000_confidential_messages.sql',
    'supabase/functions/confidential-vault/index.ts',
    'supabase/functions/_shared/vaultCore.ts',
    'src/chat/vault/vaultApi.ts', 'src/chat/vault/vaultFormat.ts', 'src/chat/vault/useVaultItems.ts',
    'src/chat/vault/ConfidentialCard.tsx', 'src/chat/vault/ConfidentialViewer.tsx', 'src/chat/vault/KeySheet.tsx',
    'src/chat/vault/LockComposerBar.tsx', 'src/chat/vault/vault.css', 'src/modules/AdminConfidential.tsx',
    'scripts/confidential-messages.test.mjs'
  ]) assert.doesNotMatch(read(file), dash, file)
})
