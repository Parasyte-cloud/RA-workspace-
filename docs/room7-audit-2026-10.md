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

## Open items that need a backend change or a decision

| # | Item | Why it matters | Suggested fix |
|---|---|---|---|
| A | No rate limit on `resolve` and `join` | Someone could guess codes or passcodes. The code space is 32^8 (about 1.1 trillion), so guessing is impractical, but nothing slows an attempt | Throttle by IP and room in `room-guest-session` |
| B | No host approval queue ("admit") | With the code as the key, anyone holding the link gets in. Hosts cannot approve people one by one | Add an optional waiting room: guests join a lobby preset and the host admits them |
| C | Rooms open only after a host action | A host who forgets the button leaves guests waiting | Let the server treat an active room as open when the host is in it, or open automatically at the scheduled start |
| D | Access checks are copied into four functions | A rule changed in one can drift from the others | Move the check into one shared module |
| E | Consent tick box wording | Counsel advised on recording wording, so it was left unchanged | Confirm with counsel before making consent implicit in the Join button |
| F | Email is required for every guest | It is how attendance is recorded, so it was kept | Make it optional per event if a looser setting is wanted |
| G | Host gets no signal when a guest joins | Hosts cannot tell who has arrived without opening the call | Show a "guest joined" notice in the host view |
