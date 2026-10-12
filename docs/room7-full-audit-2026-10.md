# ROOM 7 full audit, October 2026

Covers the staff side (room list, create, join, leave, end, reconnect, calls from Chat), the guest side
(see `room7-audit-2026-10.md` for the guest-access detail), the edge functions and the database.

**How far this went.** Read in full: `RoomModule`, `RoomMeeting`, `roomApi`, `room-session`, and the call
tables and functions. Spot-checked for authorisation, origin checks and signatures: `room-event-control`,
`room-event-documents`, `room-event-engagement`, `room-ai-webhook`. Those four (about 9,000 lines) were not
read line by line, so treat their section as "no red flags seen", not "clean".

## What was found and fixed in this change

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | Calls from Chat left their rooms ACTIVE for ever; people clicked Join on dead rooms and got "[ERR0001] Failed to initialize". | High | Database closes call rooms when the call ends; one-off cleanup; stale rooms hidden. |
| 2 | One failed media start gave a dead black screen with only "Return". | High | Up to 3 automatic attempts, a plain-language message and a Try again button. |
| 3 | The person who did not start a call had no way to end it. | High | "End call" for everyone, also in the small window. |
| 4 | No End button in the meeting list. | Medium | End button for the host (administrators can end any meeting). |
| 5 | The list loaded 20 rooms before hiding call rooms, so it could look empty. | Medium | Loads 60. |
| 6 | Creating a meeting needed a title of 2+ letters. | Low | Title optional; a blank one becomes "Meeting, 12 Oct 21:56". |
| 7 | If starting a ring failed, an empty room was left behind. | Medium | Closed straight away. |

## Reliability findings (not yet fixed)

1. **Non-call rooms with no end.** A normal meeting nobody ends stays ACTIVE until the host ends it. Suggest:
   end a room automatically after 12 hours with nobody in it, unless it has a scheduled event.
2. **Media provider and database can disagree.** Ending marks the room ended in two steps (provider, then
   database). If the second fails the person sees an error but the meeting is already closed at the provider.
   The code reports this honestly; a retry button would be kinder.
3. **Reconnect has a fixed 25 second wait** before showing "Connection lost". Fine on good networks, long on
   a bad one. Consider showing the manual Try again after 10 seconds.
4. **Join always refreshes the person's media session** (kicks older connections). Correct for avoiding
   ghosts, but a person who opens the same room on a phone and a laptop will drop the first one. Say so in the UI.

## Security and privacy findings

1. **Administrators join any room as moderators.** That is useful for support but means an administrator who
   learns a call room code can sit in a private one-to-one call. Chat call codes are only readable by the two
   people, so exposure is small, but consider an audit entry shown to the room when an administrator joins.
2. **Codes are 8 characters from 32 symbols (about 1.1 trillion).** Strong enough for staff rooms. Guest
   endpoints already have rate limits; `room-session` join has none. Add the same limiter for repeated wrong codes.
3. **Origin checks and webhook signature checks are present** on the functions that were spot-checked. Good.
4. **Four guest-access check copies** (noted before). A bug fixed in one can survive in another. Move to one
   shared module.

## Product findings (highest value first)

1. **Lobby for staff.** Guests have a waiting room; staff joining an event do not. Optional host admit for staff too.
2. **Raise hand, reactions and a plain "Q and A" are in the engagement manager, but live only on the event
   path.** Ordinary meetings do not offer them.
3. **Recording consent text** needs counsel's sign-off (open item from earlier).
4. **No meeting summary email** after a meeting ends. Minutes exist (R7 AI Notes) but are not pushed to people.
5. **Calendar link.** Creating a meeting does not create a calendar event with the join link. Scheduling an
   event should add it to attendees' calendars.
6. **Phone.** Join from the phone works (PWA and phone layouts); screen share from a phone is not available in
   mobile browsers, which is a browser limit.
7. **Maintainability.** Three files are 2,900 to 3,200 lines each (`Room7EventControlCenter`,
   `room-event-documents`, `room-event-control`). They should be split by feature before more is added.
8. **Tests.** Room 7 has tests for guest link, admission and PWA. The staff flow (create, join, end, reconnect)
   has none and is where the worst bug of this session lived.

## Suggested next order

1. Auto-end empty rooms after 12 hours (small, stops the pile-up for good).
2. Rate limit on staff join, and an admin-joined notice.
3. Meeting summary email and calendar link.
4. Staff lobby.
5. Split the three very large files; add staff-flow tests.
