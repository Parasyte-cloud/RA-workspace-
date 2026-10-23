import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build as esbuild } from 'esbuild'

// PArAsYtE: regression tests for the Secret Vault share and request audit.
//
// Symptom that started it: "Share with", "Ask who" and "Choose item" were all
// empty. The sharing panel loaded people, requests, shares and items in one
// all-or-nothing call, so one refused read (the requests table had no SELECT
// grant) emptied every picker.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Bundle a source file with the Supabase client replaced by a controllable
// stand in, then import it.
async function load(path, client) {
  const out = (await esbuild({
    entryPoints: [new URL(`../${path}`, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    plugins: [
      {
        name: 'mock-supabase',
        setup(build) {
          build.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: 'mock-supabase', namespace: 'mock' }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents: 'export const supabase = globalThis.__client',
            loader: 'js',
          }))
        },
      },
    ],
  })).outputFiles[0].text
  globalThis.__client = client
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}#${Math.random()}`)
}

const people = [
  { id: 'a', full_name: 'Ana Obi', email: 'ana@x.com' },
  { id: 'b', full_name: 'Bayo Ade', email: 'bayo@x.com' },
]

const query = result => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

test('people list: direct read first, vault_people() when the directory refuses', async () => {
  const direct = await load('src/lib/secretVaultSharing.ts', {
    from: () => query({ data: people, error: null }),
    rpc: async () => assert.fail('rpc must not be needed when the directory works'),
  })
  assert.deepEqual(await direct.listPeople(), people)

  const fallback = await load('src/lib/secretVaultSharing.ts', {
    from: () => query({ data: null, error: { message: 'permission denied for table employee_profiles' } }),
    rpc: async name => (name === 'vault_people' ? { data: people, error: null } : { data: null, error: { message: 'x' } }),
  })
  assert.deepEqual(await fallback.listPeople(), people)

  const both = await load('src/lib/secretVaultSharing.ts', {
    from: () => query({ data: null, error: { message: 'permission denied for table employee_profiles' } }),
    rpc: async () => ({ data: null, error: { message: 'Could not find the function public.vault_people' } }),
  })
  await assert.rejects(both.listPeople(), /permission denied/)
})

test('friendly messages turn grants and missing updates into an instruction', async () => {
  const lib = await load('src/lib/secretVaultSharing.ts', {})
  assert.match(lib.friendlySharingError('permission denied for table secret_vault_access_requests', 'Requests'), /Requests could not load.*database update/)
  assert.match(lib.friendlySharingError('Could not find the function public.vault_people in the schema cache', 'The list of people'), /database update/)
  assert.match(lib.friendlySharingError('JWT expired', 'Requests'), /Sign in again/)
  assert.match(lib.friendlySharingError('boom', 'Requests'), /Requests could not load: boom/)
})

test('share time: 5 minutes to 7 days, units converted, nonsense refused', async () => {
  const lib = await load('src/lib/secretVaultSharing.ts', {})
  assert.equal(lib.shareMinutes(1, 'hours'), 60)
  assert.equal(lib.shareMinutes(2, 'days'), 2880)
  assert.equal(lib.shareMinutes(5, 'minutes'), 5)
  assert.equal(lib.shareMinutes(7, 'days'), 10080)
  for (const bad of [[4, 'minutes'], [8, 'days'], [0, 'hours'], [NaN, 'hours'], [-1, 'days']]) {
    assert.equal(lib.shareMinutes(...bad), null, String(bad))
  }
})

test('viewer: administrators are recognised, everyone else is not', async () => {
  const make = role => ({
    auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
    from: () => query({ data: { role }, error: null }),
  })
  assert.deepEqual(await (await load('src/lib/secretVaultSharing.ts', make('admin'))).currentViewer(), { id: 'me', isAdmin: true })
  assert.deepEqual(await (await load('src/lib/secretVaultSharing.ts', make('employee'))).currentViewer(), { id: 'me', isAdmin: false })
})

test('vault calls show the server reason (file too large) instead of "non-2xx"', async () => {
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    functions: {
      invoke: async () => ({
        data: null,
        error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Vault item must be between 1 byte and 15 MB' }) } },
      }),
    },
  }
  const vault = await load('src/lib/secretVault.ts', client)
  await assert.rejects(vault.listVault(), /Vault item must be between 1 byte and 15 MB/)
  assert.equal(vault.MAX_VAULT_FILE_BYTES, 15 * 1024 * 1024)

  // A body that is not JSON keeps the original error.
  client.functions.invoke = async () => ({ data: null, error: { message: 'non-2xx', context: { json: async () => { throw new Error('not json') } } } })
  await assert.rejects((await load('src/lib/secretVault.ts', client)).listVault(), error => /non-2xx/.test(error.message))
})

test('sharing panel: each part loads on its own, so one failure never empties the pickers', () => {
  const ui = read('src/modules/SecretVaultSharing.tsx')
  assert.match(ui, /Promise\.allSettled\(\[currentUserId\(\), listPeople\(\), listRequests\(\), listMyShares\(\)\]\)/)
  assert.doesNotMatch(ui, /await Promise\.all\(\[currentUserId/)
  assert.match(ui, /vaultSharingProblems/)
  assert.match(ui, /Try again/)
  assert.match(ui, /You have no items to share yet/)
  assert.match(ui, /No other people found/)
  assert.match(ui, /You have no items to give/)
  // Approvals have their own time box, and a finished share clears its pickers.
  assert.match(ui, /approveAmount/)
  assert.match(ui, /setShareItem\(''\); setSharePerson\(''\)/)
})

test('panel: Delete only where the server would allow it, file size checked before upload', () => {
  const panel = read('src/modules/SecretVaultPanel.tsx')
  assert.match(panel, /!viewer \|\| viewer\.isAdmin \|\| item\.owner_id === viewer\.id/)
  assert.match(panel, /Shared with you/)
  assert.match(panel, /file\.size > MAX_VAULT_FILE_BYTES/)
  assert.match(panel, /That file is empty/)
  const css = read('src/modules/secret-vault.css')
  assert.match(css, /\.secretVaultUpload:focus-within/)
  assert.match(css, /\.secretVaultUpload \{\s*position: relative;/)
})

test('notifications about vault requests and shares open the Vault', () => {
  const center = read('src/components/NotificationCenter.tsx')
  assert.match(center, /item\.entity_type\.startsWith\('secret_vault'\)/)
  assert.match(center, /onOpenSection\('vault'\)/)
})

test('migration: grant, people function, and notifications that leak nothing', () => {
  const sql = read('supabase/migrations/20261023240000_secret_vault_sharing_access.sql')
  assert.match(sql, /grant select on table public\.secret_vault_access_requests to authenticated/)
  assert.match(sql, /revoke insert, update, delete on table public\.secret_vault_access_requests from authenticated/)
  assert.match(sql, /create or replace function public\.vault_people\(\)/)
  assert.match(sql, /grant execute on function public\.vault_people\(\) to authenticated/)
  // Notifications: three kinds, never emailed, helpers not callable by clients.
  for (const type of ['vault_access_requested', 'vault_access_granted', 'vault_access_declined']) {
    assert.ok(sql.includes(`'${type}'`), type)
  }
  assert.match(sql, /'skipped'/)
  assert.match(sql, /revoke all on function public\.vault_notify\(uuid,text,text,text,text,uuid\) from public, anon, authenticated/)
  assert.match(sql, /exception when others then\s+null;/)
  // The text of a notification is built from names only: no label, note or value.
  const bodies = [...sql.matchAll(/perform public\.vault_notify\(([\s\S]*?)\);/g)].map(match => match[1])
  assert.equal(bodies.length, 3)
  for (const call of bodies) assert.doesNotMatch(call, /\blabel\b|request_note|\bnote\b|value/i)
  // The rules are unchanged.
  assert.match(sql, /Only the owner or an admin can share this item/)
  assert.match(sql, /duration_minutes < 5 or duration_minutes > 10080/)
  assert.match(sql, /values \(target_item,grantee,true,false,me,until_ts\)/)
  assert.match(sql, /Too many open requests/)
  assert.doesNotMatch(sql, /—/)
})
