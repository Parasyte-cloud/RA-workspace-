# Calls and Chat audit, October 2026

Scope: direct chat (`ChatModule.tsx`), chat calls (`useChatCalls`, `CallRinger`, `RoomMeeting`, the
`chat_calls` table and its functions), and how calls show up in the ROOM 7 page. Findings come from reading
the code and the screenshot of the ROOM 7 page showing three stale "ACTIVE" call rooms.

## Fixed in this change

| # | Problem | Fix |
|---|---------|-----|
| 1 | Hanging up ended the chat call but never the room behind it. Rooms stayed ACTIVE for ever. | A database trigger ends the room when the call reaches declined, cancelled, missed or ended. |
| 2 | Ending a room depended on the caller's browser still being open. | Same trigger: it runs in the database, whoever has a tab open. |
| 3 | Call rooms cluttered "Active ROOM 7" and "ROOM 7 history" as "Call with ...". | The ROOM 7 page hides rooms that belong to a chat call. Calls live in Chat, Calls tab. |
| 4 | No way to end a meeting from the list. | An "End" button on each active meeting you host. An administrator can end any meeting. |
| 5 | If starting the ring failed (not allowed, network), the empty room was left open. | The room is closed straight away. |
| 6 | Answered calls that nobody hung up (both tabs closed) lasted for ever. | Ended automatically after 4 hours, and the room with them. |
| 7 | Old stale rooms. | A one-off cleanup in the migration closes them. |

## Still open: calls (highest value first)

1. **No "busy" handling.** If Ada is in a call and Tunde rings her, she gets a second ring on top. Better:
   show "On another call" to the caller and queue a missed-call notice for her.
2. **One-to-one only.** No group call from a chat. The data model has `is_group`, the UI does not use it.
3. **Cannot add a third person mid-call.** Today you would have to start a Room 7 meeting.
4. **Ringing needs the app open or Phone alerts on.** Phone alerts now cover a closed app (see
   `push-notifications.md`), but it is a notification, not a full-screen call. A native app is the only way to
   get the lock-screen call UI.
5. **No call quality signal** shown to people (reconnecting banner exists, no "poor connection" hint).
6. **Callee pickup is a new window.** Switching device mid-call (phone to laptop) is not supported.
7. **Call history is per chat only.** There is no single "recent calls" list across all chats.

## Still open: chat (highest value first)

1. **You cannot edit or delete your own message.** The data has `edited_at`, but there is no edit or
   delete control. This is the most requested basic in any chat.
2. **No typing indicator.**
3. **Only the latest 300 messages load, and there is no "load older".** Long chats silently lose history on
   screen. The database keeps it.
4. **Search finds people and chat names, not message text.**
5. **No reactions, forwarding, pinned messages or mute.**
6. **No groups.** Same as calls: the schema is ready, the interface is not.
7. **Delete chat is admin only and removes both sides' history.** Consider "clear for me" for everyone else.
8. **Message limit per list is 500 rows.** Companies with many chats will lose the oldest from the list.
9. **Export of a chat does not include call lines.** (Noted earlier; still true.)

## Suggested order

1. Edit and delete own message, typing indicator, load older messages (chat basics, one release).
2. Busy handling and a "Recent calls" list.
3. Group chats, then group calls.
4. In-chat message search.

Each of these can be done without changing the call or push foundations built so far.
