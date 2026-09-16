import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PARASYTE_HOME,
  buildSearchUrl,
  classifyParasyteTarget,
  isPrivateNetworkHost,
  parseEmbedOrigins,
  parseStorageTrustedOrigins,
  resolveParasyteInput,
  safeWebUrl
} from '../src/lib/parasytePolicy.ts'

test('search text resolves to an HTTPS Google search URL', () => {
  assert.equal(
    resolveParasyteInput('ridearrivo airport transfer'),
    'https://www.google.com/search?q=ridearrivo%20airport%20transfer'
  )
})

test('bare host is promoted to HTTPS', () => {
  assert.equal(resolveParasyteInput('example.com'), 'https://example.com/')
})

test('credentials in URLs are rejected', () => {
  assert.equal(safeWebUrl('https://user:secret@example.com/'), null)
})

test('private and local network hosts are detected', () => {
  for (const host of [
    'localhost',
    'service.local',
    '127.0.0.1',
    '10.1.2.3',
    '100.64.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.5',
    '169.254.10.1',
    '::1',
    'fd00::1'
  ]) {
    assert.equal(isPrivateNetworkHost(host), true, host)
  }
  assert.equal(isPrivateNetworkHost('example.com'), false)
  assert.equal(isPrivateNetworkHost('fc-example.com'), false)
  assert.equal(isPrivateNetworkHost('8.8.8.8'), false)
})

test('home remains internal', () => {
  const policy = classifyParasyteTarget(PARASYTE_HOME, {
    embedOrigins: new Set()
  })
  assert.equal(policy.kind, 'home')
})

test('unknown HTTPS sites default to external launch', () => {
  const policy = classifyParasyteTarget('https://example.com/path', {
    embedOrigins: new Set(['https://intranet.ridearrivo.com'])
  })
  assert.equal(policy.kind, 'external')
  assert.equal(policy.secure, true)
})

test('only exact configured origins are embedded', () => {
  const origins = parseEmbedOrigins(
    'https://admin.ridearrivo.com, https://preview.ridearrivo.com',
    'https://intranet.ridearrivo.com'
  )
  assert.equal(
    classifyParasyteTarget('https://admin.ridearrivo.com/users', {
      embedOrigins: origins
    }).kind,
    'embed'
  )
  assert.equal(
    classifyParasyteTarget('https://evil.admin.ridearrivo.com/', {
      embedOrigins: origins
    }).kind,
    'external'
  )
})

test('private network destinations are blocked in production policy', () => {
  const policy = classifyParasyteTarget('https://192.168.1.1/', {
    embedOrigins: new Set(),
    allowPrivateNetwork: false
  })
  assert.equal(policy.kind, 'blocked')
})

test('HTTP is never embedded unless explicitly allowed', () => {
  const policy = classifyParasyteTarget('http://example.com/', {
    embedOrigins: new Set(['http://example.com']),
    allowHttp: false
  })
  assert.equal(policy.kind, 'external')
  assert.equal(policy.secure, false)
})

test('IPv4-in-IPv6 encodings of private addresses are still blocked', () => {
  for (const host of [
    '::ffff:192.168.1.1',
    '::ffff:c0a8:101',
    '::ffff:127.0.0.1',
    '::192.168.1.1',
    '64:ff9b::10.0.0.5',
    '64:ff9b::192.168.1.1'
  ]) {
    assert.equal(isPrivateNetworkHost(host), true, host)
  }

  // A plain global-unicast IPv6 address must NOT be treated as private just
  // because its low 32 bits happen to look like a private IPv4 octet pair.
  assert.equal(isPrivateNetworkHost('2001:db8::c0a8:101'), false)
})

test('bracketed IPv4-mapped IPv6 addresses are blocked end-to-end via the URL parser', () => {
  for (const url of [
    'http://[::ffff:192.168.1.1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::192.168.1.1]/',
    'http://[64:ff9b::10.0.0.5]/'
  ]) {
    const policy = classifyParasyteTarget(url, { embedOrigins: new Set() })
    assert.equal(policy.kind, 'blocked', url)
  }
})

test('obfuscated decimal/hex/octal IPv4 hosts are blocked (browser URL parser normalizes them)', () => {
  for (const url of [
    'http://3232235521/', // 192.168.0.1
    'http://0xC0A80001/', // 192.168.0.1
    'http://017700000001/' // 127.0.0.1
  ]) {
    const policy = classifyParasyteTarget(url, { embedOrigins: new Set() })
    assert.equal(policy.kind, 'blocked', url)
  }
})

test('search template is configurable but always falls back safely', () => {
  assert.equal(
    buildSearchUrl('ridearrivo airport transfer'),
    'https://www.google.com/search?q=ridearrivo%20airport%20transfer'
  )
  assert.equal(
    buildSearchUrl('parasyte', 'https://duckduckgo.com/?q=%s'),
    'https://duckduckgo.com/?q=parasyte'
  )
  // Missing placeholder, non-HTTP scheme, and garbage all fall back to Google
  // rather than producing a broken or unsafe navigation.
  assert.equal(
    buildSearchUrl('x', 'not a template'),
    'https://www.google.com/search?q=x'
  )
  assert.equal(
    buildSearchUrl('x', 'javascript:alert(%s)'),
    'https://www.google.com/search?q=x'
  )
})

test('allowSameOrigin is only ever granted for embed origins explicitly marked storage-trusted', () => {
  const embedOrigins = parseEmbedOrigins('https://admin.ridearrivo.com')
  const storageTrustedOrigins = parseStorageTrustedOrigins('https://admin.ridearrivo.com')

  const trusted = classifyParasyteTarget('https://admin.ridearrivo.com/users', {
    embedOrigins,
    storageTrustedOrigins
  })
  assert.equal(trusted.kind, 'embed')
  assert.equal(trusted.allowSameOrigin, true)

  const untrustedEmbed = classifyParasyteTarget('https://admin.ridearrivo.com/users', {
    embedOrigins
  })
  assert.equal(untrustedEmbed.allowSameOrigin, false)

  // Listing an origin as storage-trusted without also embedding it must be a no-op.
  const notEmbedded = classifyParasyteTarget('https://preview.ridearrivo.com/', {
    embedOrigins: new Set(),
    storageTrustedOrigins: parseStorageTrustedOrigins('https://preview.ridearrivo.com')
  })
  assert.equal(notEmbedded.kind, 'external')
  assert.equal(notEmbedded.allowSameOrigin, false)
})
