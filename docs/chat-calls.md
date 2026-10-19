# Calls in Chat

Updated 19 October 2026. This is the current behaviour. The reasoning and the bugs found along the way are in `chat-call-audit-round3-2026-10-18.md`, `call-join-failure-2026-10-18.md` and `calls-chat-audit-2026-10.md`.

## What people see

- **Ringing:** an incoming call plays a phone ring and vibrates on phones, and the caller hears the ringback tone. If the browser is still blocking sound (it needs one click on the page first), the call card says "Click anywhere to hear the ring". When the tab is in the background, a system alert stays on screen until the call is answered or rings out. With phone alerts on, it also rings when the app is closed (see `push-notifications.md`).
- **Call screen:** one FaceTime style screen on phone and desktop. The other person fills the screen, your own camera is a small picture you can drag. Mute, camera on and off, flip camera, sound output where the phone allows it, minimise to a small window over the chat and **Return to call**. The clock starts when the other person is on the call, not while it rings.
- **In the chat:** every call is a line in the conversation: "Missed voice call", "Voice call, 4:32", "Declined", "No answer", each with a **Call back** button. A missed call also shows in the chat list ("Missed voice call" in red) and adds to the unread badge until the chat is opened.
- **Calls tab:** the Chats list has a **Calls** tab with the history, newest first, and a call-back button on every line.
- **Share screen:** the call screen has a Share screen button on browsers that can capture a screen (desktop, and some iPads). Anyone sharing is shown to everyone else full size and uncropped, with a badge saying who. iPhone and Android phone browsers cannot capture a screen, so the button there explains that; they can still watch a share. Sharing from a phone needs the native wrapper.
- **Stays in Chat:** answering or starting a call opens the call screen over the chat instead of jumping to the ROOM 7 page. Hanging up on either side ends the call for both, and a declined or unanswered call closes the caller's screen by itself.

## Rules

- **Unanswered:** a call that rings for 45 seconds is closed as missed by the database (`expire_chat_calls`), so a caller who closes their browser still produces a missed call for the other person.
- **No-show after answering:** once the callee answers, the caller waits 30 seconds. If nobody else is on the call by then, it ends with "They could not connect. Try calling again." The header reads "Connecting..." instead of "Calling..." while waiting. It never fires once anyone is on the call.
- **One call at a time:** refused in the database (the caller must not be on a live call), on the chat Call buttons, and on Accept (it declines the new one). The caller sees "You are already on a call"; someone calling a busy person sees "On another call".
- **Private rooms:** a room that belongs to a chat call can only be joined by the caller, the callee or an administrator. Anyone else gets "This call is private." and it counts as a wrong guess for the rate limit. This is enforced in the `room-session` edge function, so that function must be deployed for it to apply.
- **Administrator joins:** when an administrator joins, the caller and the callee both get "An administrator joined your call", and the header shows "N other people on this call". An administrator who is one of the two people on the call tells nobody.
- **Second device:** joining the same call from another device closes the first device's screen and the call carries on. A device that was kicked this way only closes itself, it does not end the call for the other person.
- **Dead phones:** a call a phone left behind (no heartbeat) is ended at its last heartbeat, so the history shows the real length. A call answered in the last two minutes with no heartbeat yet is left alone.

## When the call screen cannot connect

The screen asks the server for a fresh pass and joins again, up to twice, before it shows "The call could not start" with the SDK code (for example ERR0002) in small type. Try again fetches a new pass. If the phone's network blocks the media service for good (VPN, iCloud Private Relay, Low Data Mode, a filtering network), the retries fail the same way and the message names those settings. Detail: `call-join-failure-2026-10-18.md`.

## How it works

- Calls are rows in `chat_calls`. The call screen and the chat call are tied together by the call id, so ending one ends the other.
- The call media runs on a Cloudflare RealtimeKit meeting created by the `room-session` edge function, which also does the membership and private-call checks before it hands out a pass.
- The call screen sends a heartbeat. The database uses it to end abandoned calls.

## Not covered

- Ringing a locked or closed iPhone like a real phone call needs a native wrapper (CallKit and PushKit). Phone alerts are a notification, not a call screen.
- Answer and Decline from the notification needs a short-lived signed token in the push.
- Choosing earpiece, speaker or Bluetooth from a list on iPhone is not possible from a web page.
- Group calls from a chat and moving a call between devices are product work.
- None of the above is proven on a real phone by the tests. Use the device checklists at the end of the round 3 and join failure notes.
