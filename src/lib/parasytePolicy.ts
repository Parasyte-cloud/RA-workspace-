export const PARASYTE_HOME = 'parasyte://home'

export type ParasyteTargetKind =
  | 'home'
  | 'embed'
  | 'external'
  | 'blocked'

export type ParasyteTargetPolicy = {
  kind: ParasyteTargetKind
  value: string
  hostname: string
  origin: string
  secure: boolean
  reason: string
  /** Only ever true for kind === 'embed', and only when the origin is on storageTrustedOrigins. */
  allowSameOrigin: boolean
}

export type ParasytePolicyOptions = {
  embedOrigins: ReadonlySet<string>
  /**
   * Origins that are both embeddable AND explicitly trusted to keep their own
   * client-side session/storage state while framed (grants `allow-same-origin`
   * in addition to the default sandbox flags). Leave empty by default. Only
   * add an origin here if it is already in `embedOrigins`, is a first-party
   * RideArrivo application, and is known to break without localStorage/
   * sessionStorage/cook<->script access when sandboxed. An origin listed here
   * must not itself embed untrusted third-party content, since allow-scripts
   * plus allow-same-origin together let framed script escape sandbox
   * isolation for that one origin.
   */
  storageTrustedOrigins?: ReadonlySet<string>
  allowPrivateNetwork?: boolean
  allowHttp?: boolean
}

export function safeWebUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    if (url.username || url.password) {
      return null
    }
    return url
  } catch {
    return null
  }
}

const DEFAULT_SEARCH_TEMPLATE = 'https://www.google.com/search?q=%s'

/**
 * Builds a search URL from a free-text query. `template` must contain the
 * literal `%s` placeholder for the encoded query; anything else (missing,
 * malformed, or a non-HTTP(S) template) silently falls back to the default
 * so a bad `VITE_PARASYTE_SEARCH_URL` value can never brick the search box.
 */
export function buildSearchUrl(query: string, template?: string): string {
  const candidate = template && template.includes('%s') ? template : DEFAULT_SEARCH_TEMPLATE
  const filled = candidate.replace('%s', encodeURIComponent(query))
  const parsed = safeWebUrl(filled)
  if (parsed) {
    return parsed.toString()
  }
  return DEFAULT_SEARCH_TEMPLATE.replace('%s', encodeURIComponent(query))
}

export function resolveParasyteInput(raw: string, searchTemplate?: string): string {
  const value = raw.trim()
  if (!value) {
    return PARASYTE_HOME
  }

  if (/^https?:\/\//i.test(value)) {
    const parsed = safeWebUrl(value)
    return parsed ? parsed.toString() : value
  }

  if (!value.includes(' ') && value.includes('.')) {
    const parsed = safeWebUrl(`https://${value}`)
    return parsed ? parsed.toString() : value
  }

  return buildSearchUrl(value, searchTemplate)
}

/**
 * Extracts the last 32 bits of an IPv4-in-IPv6 address as a dotted-decimal
 * string, if `host` is one of the three standard embedding forms browsers
 * normalize numeric/octal/hex IPv4 hosts into an IPv6 literal:
 *
 *  - IPv4-mapped:      ::ffff:c0a8:101   (== ::ffff:192.168.1.1)
 *  - IPv4-compatible:  ::c0a8:101        (== ::192.168.1.1, legacy form)
 *  - NAT64 well-known: 64:ff9b::c0a8:101 (== 64:ff9b::192.168.1.1)
 *
 * `new URL()` already canonicalizes decimal/hex/octal IPv4 hosts (e.g.
 * `http://3232235521/`) into plain dotted-decimal, so those never reach
 * this function as IPv6 literals. But it does NOT unwrap an IPv4 address
 * embedded inside an IPv6 literal, so without this a bracketed address
 * like `[::ffff:192.168.1.1]` sails past the private-network check even
 * though it resolves to the same private host - a real bypass for the
 * "no probing internal services from the trusted browser surface" control.
 */
const IPV4_DOTTED = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function embeddedIPv4FromIPv6(host: string): string | null {
  // `new URL()` always normalizes a numeric IPv6 literal to the compressed
  // hex:hex form before it reaches this function via classifyParasyteTarget,
  // but this function is exported and pure, so it also accepts the
  // un-normalized dotted-decimal suffix form directly (e.g. `::ffff:192.168.1.1`)
  // for any caller that hasn't already round-tripped the value through URL.
  const dotted =
    host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/) ||
    host.match(/^64:ff9b::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/) ||
    host.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted && IPV4_DOTTED.test(dotted[1])) {
    return dotted[1]
  }

  const match =
    host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ||
    host.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ||
    host.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)

  if (!match) {
    return null
  }

  const hi = Number.parseInt(match[1], 16)
  const lo = Number.parseInt(match[2], 16)
  if (Number.isNaN(hi) || Number.isNaN(lo)) {
    return null
  }

  const a = (hi >> 8) & 0xff
  const b = hi & 0xff
  const c = (lo >> 8) & 0xff
  const d = lo & 0xff
  return `${a}.${b}.${c}.${d}`
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    (host.includes(':') && (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:')
    ))
  ) {
    return true
  }

  if (host.includes(':')) {
    const embedded = embeddedIPv4FromIPv6(host)
    if (embedded) {
      return isPrivateNetworkHost(embedded)
    }
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) {
    return false
  }

  const octets = ipv4.slice(1).map(Number)
  if (octets.some(octet => octet < 0 || octet > 255)) {
    return false
  }

  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

export function classifyParasyteTarget(
  rawValue: string,
  options: ParasytePolicyOptions
): ParasyteTargetPolicy {
  if (rawValue === PARASYTE_HOME) {
    return {
      kind: 'home',
      value: PARASYTE_HOME,
      hostname: '',
      origin: '',
      secure: true,
      reason: 'PArAsYtE home',
      allowSameOrigin: false
    }
  }

  const url = safeWebUrl(rawValue)
  if (!url) {
    return {
      kind: 'blocked',
      value: rawValue,
      hostname: '',
      origin: '',
      secure: false,
      reason: 'The address is not a valid HTTP or HTTPS URL, or it contains embedded credentials.',
      allowSameOrigin: false
    }
  }

  const secure = url.protocol === 'https:'
  const privateNetwork = isPrivateNetworkHost(url.hostname)

  if (privateNetwork && !options.allowPrivateNetwork) {
    return {
      kind: 'blocked',
      value: url.toString(),
      hostname: url.hostname,
      origin: url.origin,
      secure,
      reason: 'Private-network and localhost destinations are blocked from the production intranet browser.',
      allowSameOrigin: false
    }
  }

  if (!secure && !options.allowHttp) {
    return {
      kind: 'external',
      value: url.toString(),
      hostname: url.hostname,
      origin: url.origin,
      secure: false,
      reason: 'Insecure HTTP pages are not embedded inside the RideArrivo intranet.',
      allowSameOrigin: false
    }
  }

  if (options.embedOrigins.has(url.origin)) {
    return {
      kind: 'embed',
      value: url.toString(),
      hostname: url.hostname,
      origin: url.origin,
      secure,
      reason: 'This origin is explicitly approved for embedded use.',
      allowSameOrigin: Boolean(options.storageTrustedOrigins?.has(url.origin))
    }
  }

  return {
    kind: 'external',
    value: url.toString(),
    hostname: url.hostname,
    origin: url.origin,
    secure,
    reason: 'This site is not on the explicit embedded-origin allowlist.',
    allowSameOrigin: false
  }
}

function parseOriginList(value: string | undefined): Set<string> {
  const origins = new Set<string>()

  for (const candidate of (value || '').split(',')) {
    const trimmed = candidate.trim()
    if (!trimmed) {
      continue
    }
    const parsed = safeWebUrl(trimmed)
    if (parsed) {
      origins.add(parsed.origin)
    }
  }

  return origins
}

export function parseEmbedOrigins(
  value: string | undefined,
  currentOrigin?: string
): ReadonlySet<string> {
  const origins = parseOriginList(value)

  if (currentOrigin) {
    const current = safeWebUrl(currentOrigin)
    if (current) {
      origins.add(current.origin)
    }
  }

  return origins
}

/**
 * Parses VITE_PARASYTE_STORAGE_TRUSTED_ORIGINS. This is intersected against
 * embedOrigins at classify-time (see ParasytePolicyOptions.storageTrustedOrigins),
 * so listing an origin here that is missing from VITE_PARASYTE_EMBED_ORIGINS
 * has no effect - it can only ever loosen an origin that is already embeddable.
 */
export function parseStorageTrustedOrigins(value: string | undefined): ReadonlySet<string> {
  return parseOriginList(value)
}
