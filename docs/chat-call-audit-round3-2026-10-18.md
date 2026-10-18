# Chat and calls deep audit, 18 October 2026 (round 3)

Scope: everything between pressing Send or Call and the other person seeing or hearing it. Read end to end: the
database (message and call functions, row level rules, triggers, receipts, notifications), the edge functions
(`room-session`, `push-dispatch`), the chat screen (`ChatShell` and its libraries), and the call code
(`CallModule`, `CallRinger`, `RoomMeeting`, `FaceTimeStage`, `callCleanup`).

How it was checked. The database changes were run against a real Postgres engine (PGlite) with a stub schema:
the attachment rule refuses a path outside the chat, previews appear for voice, photo and file, a read with
nothing new does not write, an abandoned call ends at its last heartbeat, and a second live call is refused.
Putting the old behaviour back makes those checks fail. The deleted message, alert scrub and read rule checks were added in the follow up. The app side has contract and behaviour tests in
`scripts/chat-call-audit-round3.test.mjs`. Nothing here was run on a phone: items marked **device check** need one.

## Fixed in this pull request

| # | Severity | Finding | Root cause | Fix |
|---|----------|---------|-----------|-----|
| 1 | High | A member can attach any storage path to a message | `20261013130300` replaced the insert rule and dropped the rule from `20261012210000` that a file must sit in this chat and in the sender's own folder. The old test only reads the old migration. | Rule restored in `20261018190000`. Test now checks the new policy and that the old one had no rule. |
| 2 | High | Photos, files and voice notes give a blank notification and a blank phone alert | `20261015003000` rewrote `notify_social_message` for mentions and lost the "Sent a photo / voice note / file" preview. | Preview restored inside the mention aware version. |
| 3 | High | A full chat list reload on every read receipt and every "mark read" | `mark_social_conversation_read` always rewrote the member row, every rewrite is a realtime event, and the app reloaded the whole list (6 queries, 500 messages) per event. A room message also created one receipt row per person, each one triggering a reload. The open chat re-marked itself every 45 seconds, so an idle open chat caused a reload for every member. | The database only writes when something is newer. The app coalesces realtime events into one refresh (1 s for the list, 0.5 s for receipts). |
| 4 | High | Starting or answering a second call took over the screen and stranded the first | Only the person being rung was checked as busy. The screen swapped its call id and the old call kept running with nobody on it (no heartbeat, 15 minutes to clear). | Refused in three places: the database (caller must not be on a live call), the chat Call buttons, and the Accept button (declines the new one). `CallModule` ignores a second join and closes it. |
| 5 | High | A phone that was kicked (same person joined from another device) ended the call for both people | `onLeft('kicked')` ran the normal hang up, which sends `ended`. | A kicked device only closes its own screen. |
| 6 | Medium | Another device could end a call that was just answered | `endStaleCalls` treated "no heartbeat yet" as dead, and the first heartbeat only arrives once the call screen has loaded. Opening the app on a second device in that window ended the live call. | A call answered in the last two minutes with no heartbeat is left alone. |
| 7 | Medium | Call history shows the wrong length for a call a dead phone left behind | `end_stale_calls_for` set `ended_at` to the time the sweep ran (15 minutes or 4 hours later). | It ends the call at its last heartbeat. |
| 8 | Medium | The call clock counted the ringing time | The timer started when the call screen opened. | It starts when the other person is on the call, like FaceTime. |
| 9 | Medium | A file or voice note posted twice after a bad connection | Text sends use an idempotent function, file and voice sends inserted directly with no client id, so a retry after a lost answer made a second message and a second upload. | The insert carries the client id. A retry that hits the unique key finds the first copy, uses it, and removes the duplicate upload. |
| 10 | Medium | A third person in a one to one call was heard but never shown | The call screen shows the first other person but plays everyone's audio. An administrator can join any room (by design, the host gets a notice) and the callee is told nothing. | The header shows "N other people on this call". |

Run `20261018190000_chat_call_audit_round3.sql` before the app release, and deploy the `room-session` edge function with it (items 12 and 13). The migration is safe to run twice.

## Decided and fixed in the same pull request

You answered the four open items. All four are done and included.

| # | Decision | What changed |
|---|----------|--------------|
| 11 | Show deleted messages | The read rule no longer hides them (`20261013130300` had added `deleted_at is null`). A deleted message stays as "This message was deleted" for both people, live, because realtime now passes the changed row. Deleted messages are not counted as unread, and an unread alert that quoted the text is scrubbed to "This message was deleted". Search and thread lookups already skip them. |
| 12 | Notify both people when an administrator joins a call | `room-session` now tells the caller and the callee ("An administrator joined your call"). Before, only the room creator was told. An administrator who is one of the two on the call, just answering it, tells nobody (before, that sent the caller a false "administrator joined" notice). |
| 13 | Lock call rooms to the two people on them | A room that belongs to a chat call can only be joined by the caller, the callee or an administrator. Anyone else gets "This call is private." Checked before any participant or provider work, and it counts as a wrong guess for the rate limit. |
| 14 | 30 second no-show | After the callee answers, the caller waits 30 seconds for them to arrive. If nobody is in the call by then, the call ends and the caller sees "They could not connect. Try calling again." The header reads "Connecting..." instead of "Calling..." while waiting. It never fires if anyone is on the call, and the timer is reset between calls. |

## Found, not changed

| # | Severity | Finding | Why it was left, and what I recommend |
|---|----------|---------|--------------------------------------|
| E | Medium | A call can use any active ROOM 7 room the caller owns, and ends it when the call ends | `start_chat_call` only checks "created by me and active". Ending a call ends that meeting. Recommend a marker on call rooms. (Item 13 means that meeting is then private to the two people, so the exposure is the caller's own meeting only.) |
| F | Low | The people list is loaded once per page load | A new employee is missing, and a deactivated one stays, until reload. |
| G | Low | A background refresh clears any error banner | `loadBase` ends with `setNotice('')`. |
| H | Low | The open chat is only marked read while the window has focus | Side by side windows never mark it read. |
| I | Low | The typing indicator uses a public broadcast channel named after the chat id | Anyone with the id can listen or fake typing (name is shown as text, not run). Use a private channel with an authorization rule. |
| J | Low | The chat reloads the 300 latest messages every 45 seconds and on every focus | Fine at today's size. Replace with "messages newer than the last one I have". |
| K | Low | The call screen has no keyboard focus handling | Add focus trap and `Escape` to minimise. |

## Gaps against iMessage and FaceTime (unchanged from round 1)

Ringing when the phone is locked or the app is closed needs a native wrapper (CallKit and PushKit). Answer and
Decline on the notification needs a short lived signed token in the push. Choosing earpiece, speaker or Bluetooth
from a list on iPhone is not possible from a web page. Group calls from a chat and switching a call between
devices are product work.

## Device checklist (needs device check)

1. Two phones: A rings B, A presses End while it rings. B stops ringing within a second and sees "Missed call".
2. A on a call with B. A tries to call C: refused with "You are already on a call". C rings A while A is on a
   call: C sees "On another call".
3. Join the same call from a second device: the first one closes its screen and the call carries on.
4. Send a photo, a voice note and a file to someone on another screen: the alert says "Sent a photo", "Sent a
   voice note", "Sent a file: name".
5. Turn the network off while sending a file, then back on, press Retry: one message, not two.
6. Open a busy room: the chat list does not flicker or reload while people read.
7. Delete a message while the other person has the chat open: it turns into "This message was deleted" on their screen within a second.
8. An administrator joins someone else's call: both people get "An administrator joined your call". A signed in person who is not on the call and not an administrator is refused.
9. Accept a call, then close the callee's app straight away: the caller sees "Connecting..." and after 30 seconds the call ends with "They could not connect".
