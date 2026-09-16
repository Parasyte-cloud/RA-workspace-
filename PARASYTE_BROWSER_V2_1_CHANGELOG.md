# PArAsYtE Browser V2.1 - what changed on top of V2, and why

Date: 16 September 2026
Scope: `src/lib/parasytePolicy.ts`, `src/modules/ParasyteBrowser.tsx`, `scripts/parasyte-policy.test.ts`
Nothing here reopens anything the V2 audit closed. This is a review of the V2 fix itself, done as if it were someone else's PR, plus a couple of features that make the hardening more usable in practice.

## 1. Fixed: private-network block had a real bypass via IPv4-in-IPv6

This is the one that matters. `isPrivateNetworkHost` matched dotted-decimal IPv4 (`192.168.1.1`) and a few IPv6 prefixes (`fc`, `fd`, `fe80:`), but it never unwrapped an IPv4 address embedded inside an IPv6 literal. Browsers (and Node's own `URL`, which is spec-compliant) will happily parse and normalize:

- `http://[::ffff:192.168.1.1]/` -> hostname `[::ffff:c0a8:101]` (IPv4-mapped)
- `http://[::192.168.1.1]/` -> hostname `[::c0a8:101]` (IPv4-compatible, legacy)
- `http://[64:ff9b::192.168.1.1]/` -> hostname `[64:ff9b::c0a8:101]` (NAT64 well-known prefix)

All three resolve to the same private host, `192.168.1.1`, but none of them matched the old regex, so all three came back `external` instead of `blocked`. I checked the other classic SSRF trick too - decimal/hex/octal IPv4 (`http://3232235521/`, `http://0xC0A80001/`, `http://017700000001/`) - and confirmed the WHATWG URL parser already normalizes those to plain dotted-decimal before `hostname` is read, so V2 already covered that path correctly. It was specifically the IPv6-embedding forms that got through.

Why this matters here specifically: the audit's own reasoning for blocking private-network destinations is that this component makes internal/private addresses reachable "under a trusted-looking intranet browser surface" - via a managed link, a bookmark, or a pasted URL. A bracketed IPv6 address is an easy thing to slip past someone at a glance, and it would have shown up as a plain external launch instead of a blocked destination, which also means it wouldn't have shown up as a blocked-navigation event if anyone's watching for those.

Fix: `embeddedIPv4FromIPv6()` recognizes the three embedding forms (both their compressed hex output and the un-normalized dotted-decimal input, since the function is exported and pure), extracts the low 32 bits, and re-runs the existing IPv4 octet check against it. A normal global-unicast IPv6 address that just happens to end in something octet-shaped is left alone - only the three specific embedding prefixes trigger the unwrap. Added 6 new test cases covering this directly plus the full URL round-trip.

## 2. Added: opt-in `allow-same-origin` for specific storage-trusted origins

V2's sandbox is `allow-forms allow-scripts allow-popups` - no `allow-same-origin`, which is the right default. But it only ever applies to origins that already passed the exact-origin allowlist, and without `allow-same-origin` the framed page runs with an opaque/unique origin: no `localStorage`, no `sessionStorage`, and its own `postMessage`/CORS origin checks stop working. If any approved RideArrivo app leans on browser storage for its session (a lot of SPAs do), it'll either show a blank screen or silently log the user out every time they open it through PArAsYtE.

Rather than either accepting that breakage or loosening the sandbox for every embedded origin, V2.1 adds a second, narrower allowlist: `VITE_PARASYTE_STORAGE_TRUSTED_ORIGINS`. It's empty by default, it only ever grants `allow-same-origin` to an origin that is *also* in the main embed allowlist (listing something here that isn't embeddable does nothing), and the code comments spell out the actual risk: an origin listed here should not itself iframe untrusted third-party content, because `allow-scripts` + `allow-same-origin` together let framed script act with the real origin's identity. Use it if and when a specific app breaks without it, not by default.

## 3. Added: configurable search engine, safe by construction

The omnibox hardcodes Google as the search fallback. That's a reasonable default, but for a product that's explicitly meant to be a *secure* browsing surface, sending every unresolved query an employee types straight to Google isn't something that should be baked in with no way to change it. `VITE_PARASYTE_SEARCH_URL` lets you point it at anything with a `%s` placeholder (DuckDuckGo, an internal search proxy, whatever). If the value is missing, has no `%s`, or doesn't resolve to a valid HTTP(S) URL once filled in, `buildSearchUrl()` silently falls back to the Google default - a bad env value can't break the search box or produce a `javascript:` navigation.

## 4. Fixed: frame status could get stuck on "taking longer than expected" forever

When a destination refuses to be framed (`X-Frame-Options: DENY`, `frame-ancestors` mismatch), most browsers fire neither `load` nor `error` on the iframe. V2's status logic goes `loading -> slow` after 7s and then just... stays there. There's no second state. Added a 20-second hard-fail timeout that escalates `slow` (or a still-`loading` frame) to `failed`, and a **Retry** button next to **Open outside** in the frame status bar so the recovery path doesn't require reaching for the toolbar's reload button. If the frame does eventually load after the hard-fail fires, `onLoad` still flips it to `ready` - the timeout only fires if nothing ever happens.

## 5. Fixed: state updates after unmount

`loadLinks`, `saveBookmark`, and `removeBookmark` all `await` a Supabase call and then call `setState`. If the component unmounts mid-request (route change, tab switch, hitting the layout selector fast), React will log an "update on unmounted component" warning and, in the worst case, waste a render on a component that's gone. Added a `mountedRef` guard before every post-await `setState` call. No behavior change while mounted.

## What I deliberately left alone

- The overall Phase 1 architecture (deny-by-default embedding, external launch for everything else) is correct and I didn't second-guess it.
- The RLS gap flagged in the original audit is still open - it's a database-side question this bundle can't answer from a component review, and it's still the hard gate before production rollout.
- I didn't add tabs, history search, or other "real browser" chrome. The honest read of "make PArAsYtE a real browser" is Phase 2 in the original audit (a proxied, isolated Chromium session) - the audit is right that trying to fake that with more iframe features would be a worse use of time than building it properly later.

## Verification

- `node --experimental-strip-types --test scripts/parasyte-policy.test.ts`: **14 passed, 0 failed** (9 original + 5 new).
- Isolated strict TypeScript check (`strict`, `noUnusedLocals`, `noUnusedParameters`, with stub types for `react`, `lucide-react`, and the local `../lib/supabase` module, since this repo isn't mounted here): **clean, no errors**.
- As with V2: `npm run build` against the real RA-workspace repo still needs to run for real, and the RLS audit and per-origin frame-policy checks in the original audit's rollout gates still apply unchanged.
