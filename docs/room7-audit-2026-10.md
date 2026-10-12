# ROOM 7 guest access audit, October 2026

Scope: how an outside guest goes from an invitation to a live meeting, and how a host makes that possible. Files read end to end: the guest page, the guest meeting, `room-guest-session`, the access checks in `room-event-documents` and `room-event-engagement`, `room-event-control` (configure and state changes), and `room-session` (create and end).

## What a guest needed before this change

1. The host opened Event Control and set four things by hand: passcode access, a passcode, public page on, and the state moved forward one step at a time to Live.
2. The guest typed name, email, a passcode, and ticked a consent box.
3. A guest who arrived early saw a dead "lobby" and had to refresh by hand.
4. Returning guests retyped everything.

## Findings and what was done

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Guest link was handed out before the event was configured, so it was dead | High | Fixed. One click on **Guest link and code** configures and opens the event |
| 2 | Joining needed a separate passcode on top of the code | High | Fixed. The event code is the key. Guests type name and email only. A separate passcode is still supported and is asked for only when the host set one |
| 3 | Early guests were stuck in a lobby that never updated | High | Fixed. The lobby checks every 5 seconds and shows the join form the moment the host opens the room |
| 4 | Passcode field hid what was typed and was case sensitive, so phones caused false "incorrect" errors | Medium | Fixed earlier. Visible, no auto capitalisation, retried in capitals |
| 5 | Documents panel in the lobby could not unlock because the passcode was empty | Medium | Fixed. It now uses the event code |
| 6 | Returning guests retyped name and email | Low | Fixed. Remembered on that device |
| 7 | A host who already set their own passcode could not simplify it | Medium | Fixed. **Use the event code only** button in the guest window |
| 8 | `room7.ridearrivo.com` was redirected to the intranet at Cloudflare, so guests never reached the guest page | High | Fixed outside the code (Cloudflare redirect removed). Confirmed working |

## Second pass: server changes

Run `supabase/migrations/20261012240000_room7_admission_and_limits.sql`, then deploy `room-guest-session`, `room-event-control` and `room-session`.

| # | Item | Status |
|---|---|---|
| A | No rate limit on `resolve` and `join` | Fixed. Limits per address (and per address and room for wrong passcodes: 15 per 10 minutes). Generous enough for an office behind one address. If the counter is unreachable, guests are allowed in, so a limiter fault never blocks a live event |
| B | No host approval queue | Fixed. **Approve each guest before they enter** in the Guest link window. Guests wait on a screen; the host sees them above the call and presses Admit, Deny or Admit all. An approval belongs to the guest's browser and lasts 12 hours. Invited guests skip the queue because the host already chose them |
| C | Room did not open if the host forgot the button | Fixed. When the host (or a Manager or Administrator) joins a meeting whose guest page is already on, the doors open. It never turns the page on by itself, never reopens an ended event, and can be switched off per event with `auto_open` |
| D | Access checks copied into four functions | Open. Not changed in this pass to avoid touching four live functions at once. Suggested next step: one shared module |
| E | Consent tick box wording | Open, owner: you. Confirm with counsel before making consent implicit |
| F | Email required for every guest | Kept on purpose (attendance record) |
| G | Host gets no signal when a guest joins | Partly addressed: with approval on, the host sees each arrival. With approval off, still no signal |
