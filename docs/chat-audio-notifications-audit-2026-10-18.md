# Chat, call audio and notifications audit, 18 October 2026

Scope: how a message and a call reach a person and how they sound. Read end to end: the in-app banner
(`NotificationCenter`, `NotificationsContext`), system alerts (`desktopAlerts`, `public/sw.js`, `pushBridge`,
`pushClient`), server push (`push-dispatch`, `_shared/pushPayload`), the sound engine (`ringtone`, `chatSound`,
`SoundOnPrompt`), call routing (`audioRoute`, `FaceTimeStage`, `callKeepAlive`, `RoomMeeting`, `CallModule`,
`CallRinger`), and the delivery headers (`public/_headers`).

Reported symptoms: speaker and phone audio not working right in calls; no banner and no sound for messages and
for calls.

What this audit could and could not do. Everything below was found by reading the code and confirmed with
tests that run in Node. Nothing here was run on a real iPhone or Android phone, because the audio session,
silent switch and push delivery only exist on a device. Those items are marked **needs device check** and the
checklist at the end says exactly what to press.

## Findings and what changed

| # | Severity | Finding | Root cause | Status |
|---|----------|---------|-----------|--------|
| 1 | High | No banner for the second and later messages in a chat | The in-app banner only fired for a notification row id it had never seen. A chat has one notification row that is updated in place for each new message (`created_at` moves on, text becomes "3 new messages"). Message 1 banners, messages 2, 3, 4 never do. | **Fixed.** The banner remembers `id` and `created_at` (`lib/toastPick.ts`), so a bumped row banners again. It stays quiet for the chat you are reading. |
| 2 | High | Sound dies after the app has been in the background (iPhone mainly) | The audio engine only resumed a context in the `suspended` state. Safari reports `interrupted` after a lock, a call or Siri, so it never came back. The tap-to-unlock listeners were also removed after the first success, so nothing could unlock it again until a reload. | **Fixed.** Any non-running state is resumed, listeners stay for the life of the page, the app also tries to resume when it returns to the front. Regression test mutates the old behaviour back in and fails. |
| 3 | High | First tap does not unlock sound on iPhone | Unlock listened to `pointerdown` and `touchstart`. iPhone Safari counts `click`, `touchend` and `pointerup` as a user activation, and wants a sound actually started inside the tap. | **Fixed.** Those events are wired, and one silent sample is played inside the tap. |
| 4 | High | Rings and message sounds silent when the phone is on silent | The browser audio engine follows the ring/silent switch on iPhone. | **Fixed, needs device check.** While a ring or message sound plays the audio session is held at `playback`, then put back to `auto`. Skipped during a call (the call owns the route). On by default, switch in Settings, Ringtone card. Needs iOS with the Audio Session API. |
| 5 | High | Speaker or phone route flips or is lost during a call | The route was set once when the call screen mounted, before the microphone started. iOS resets the session when capture restarts (mute and unmute, camera switch, an interruption), and nothing applied the route again. | **Fixed, needs device check.** The route is re-applied on session change, on every audio, video and device update, after join, when the app returns to the front, and on a 4 second beat, only when it has drifted (`audioRoute.reassertRoute`, `watchRoute`). |
| 6 | High | No system banner on Android Chrome and the installed iPhone app when the app is in the background | `showDesktopAlert` used `new Notification()`, which those platforms refuse. The error was swallowed, so nothing showed. | **Fixed.** It now shows through the service worker first (tap opens the right chat through the existing push bridge) and falls back to the constructor on desktop. |
| 7 | Medium | Turning alerts down once hid the prompt for ever | "Later" stored a permanent flag. | **Fixed.** It is a three day snooze. The old flag is not honoured, so people who tapped it once are asked again. |
| 8 | Medium | A blocked message sound was silent with no hint | Nothing told the app the sound had not played. | **Fixed.** The app raises `ra:sound-blocked`, and the sound prompt returns (at most once a day) so one tap brings sound back. |
| 9 | Medium | "Still silent" shown when sound actually worked | `resume()` is asynchronous and the preview ran in the same tick. | **Fixed.** `ensureAudioRunning()` is awaited before previewing. |
| 10 | Medium | No connection quality signal in calls (open item 5 in `calls-chat-audit-2026-10.md`) | Not built. RealtimeKit already sends `mediaScoreUpdate`. | **Fixed.** "Poor connection" appears below a score of 5 and clears at 7 or better, so it does not flicker. |
| 11 | Low | The self-check did not cover sound | It only checked permission and push registration. | **Fixed.** Settings now also reports whether sound is running and whether rings can play on silent. |
| 12 | Low | Remote call audio is rebuilt when the call is minimised and restored | `RtkParticipantsAudio` sits inside the two stage layouts. | **Not changed on purpose.** It also hosts RealtimeKit's "audio blocked" dialog, so moving it risks layout and stacking for a gap of about a tenth of a second. |

## Round 2: one call screen, a Speaker button that works (same day)

Reported with screenshots: on desktop the Speaker button showed "Your phone picks where call sound plays..."
and nothing else, and on iPhone the call opened RealtimeKit's stock "Join" set-up screen instead of the
FaceTime screen.

| # | Severity | Finding | Root cause | Status |
|---|----------|---------|-----------|--------|
| 13 | High | iPhone showed the classic set-up screen (serif font, Join button, device dropdowns) | The FaceTime screen was switched off per device by a stored "classic call screen" setting. The phone had it on. | **Fixed.** The setting, its toggle and its helper are deleted. Every chat call, on every device, uses the one FaceTime screen. ROOM 7 meetings keep their own. |
| 14 | High | Speaker button on desktop only showed phone wording | The list needed two or more outputs, and a laptop reports one (plus a "default" copy of it). Anything less fell through to the phone text. | **Fixed.** Desktop and Android list every real output by its real name with the one in use ticked, even when there is only one. The "default" entry is matched to the real device by group. If the browser lists nothing (Safari on a Mac), the button is not drawn at all, instead of a dead one. |
| 15 | Medium | iPhone Speaker needed a sheet for a two way choice | Extra tap. | **Fixed.** One tap flips Phone and Speaker like FaceTime. The button is white while the speaker is on. |
| 16 | High | Pressing End on a call that was still ringing left the other phone ringing | The hang up sent `ended`, which the database only accepts for answered calls. The caller never sent `cancelled`. | **Fixed.** The caller sends `cancelled` then `ended` (each is a no-op in the wrong state). The tab-close path does the same. The person being called never sends the cancel, which the database refuses. |
| 17 | Medium | A failed join left the phone "in a call" and the call live | Join failure cleared the call id but not the shared active call id, and never told the server. | **Fixed.** The active id is cleared and the call is closed on the server. |
| 18 | Medium | The "Calling..." card and the call screen showed the same call twice | Both listened to the same call. | **Fixed.** The card steps aside while the call screen is up. |
| 19 | Medium | Controls vanished while ringing or reconnecting | The hide timer ignored the call state. | **Fixed.** They only fade on a connected video call. Voice calls, ringing, reconnecting and the open sheet keep them on screen. |
| 20 | Low | Desktop call window was a narrow phone shaped column | Fixed inset sized for a portrait window. | **Fixed.** A centred 16:10 window on desktop, edge to edge on phones. The same controls and header sit in it either way. |

Tests: `call-screen-consistency.test.mjs` (output list, hang up statuses, active call subscription, no classic
option) plus updated `facetime-call` and `call-cleanup` tests. Still needs a device check: the one tap Speaker
toggle on a real iPhone (same Audio Session caveat as before).

## Against iMessage and FaceTime

Already at or near parity: delivered and read receipts, typing indicator, replies, forwarding, edit and
delete, voice notes, pinned and muted chats, in-chat search, reconnect without ending the call, wake lock,
picture in picture, media-session hang up, draggable self view, flip camera, mute, "Waiting for X to reconnect".

Gaps that remain, with the honest limit:

| Gap | Why it is not in this change |
|-----|------------------------------|
| A real ringing screen when the phone is locked or the app is closed (CallKit) | A web app cannot do it. Today a call is pushed every 8 seconds, 5 times, with a 45 second lifetime. Only a native wrapper (PushKit and CallKit) gives FaceTime-grade ringing. |
| Answer and Decline buttons on the notification | Declining from the service worker needs an auth token the worker does not hold. Needs a short-lived signed call token in the push payload. Worth doing next. |
| Reply from the banner (iMessage inline reply) | Text actions on web notifications are only on some Chromium builds. Not reliable enough to ship. |
| Choose earpiece, speaker or Bluetooth from a list on iPhone | Safari does not list outputs. The page can only pick `play-and-record` (ear) or `playback` (loud). A headset takes over by itself. |
| Screen goes dark at the ear (proximity sensor) | Not exposed to web pages. |
| Group calls from a chat, switching device mid-call | Product work, already listed in the earlier audit. |

## Network and delivery notes

- Media runs on Cloudflare RealtimeKit (an SFU with managed ICE and TURN). There is no STUN or TURN setting in
  this repo to tune. **Check in the RealtimeKit dashboard** that TURN over TCP and TLS 443 is enabled for the
  preset, because mobile carriers in Lagos often block or throttle UDP. If the call connects on Wi-Fi but not on
  mobile data, this is the first place to look.
- `Permissions-Policy` allows microphone and camera for the workspace origin. Correct for calls.
- `notifications` and `chat_calls` are in the `supabase_realtime` publication, and the ringer also polls every
  3 seconds as a safety net. Heartbeat is every 15 seconds.
- Ring pushes use urgency high and a 45 second TTL, chat pushes 24 hours. The service worker hides a push
  when a window is visible (except iPhone, which requires every push to show something).
- The workspace CSP is enforced for scripts only; connect, media and image rules are report-only. Nothing in
  this change needs a new origin.

## Verification

- `tsc -b` clean, production build succeeds, 138 of 138 suites pass (137 before, plus
  `audio-notifications-audit.test.mjs` with 21 tests).
- Two of the new tests were checked by putting the old behaviour back and confirming they fail: the banner
  keyed on id only, and the unlock listeners removed after the first success.
- Three existing suites loaded `ringtone.ts` on its own and now bundle it, because it imports `audioRoute`.
- No database change, no new environment variable. Rolling back is reverting the pull request.

## Device checklist (needs device check)

iPhone, installed from the Home Screen, iOS with Audio Session support:

1. Sign in, tap **Turn sound on**. A message sound plays. Put the phone on silent: it still plays.
2. Lock the phone for two minutes, open the app, have someone message you. Sound plays (this was the dead state).
3. Have someone message you twice in the same chat while you are on another screen. Two banners, not one.
4. Voice call: audio comes from the earpiece. Tap mute, unmute, switch camera on and off: still the earpiece.
   Choose Speaker in the output sheet and repeat: still the speaker, and the other person still hears you.
5. Settings, Notifications and sound: every line of the incoming call check is a tick.

Android Chrome: background the app, receive a message, the system banner appears and tapping it opens that chat.
Desktop: move the window behind another one, receive a message, the system banner appears.

If step 4 loses your microphone when you choose Speaker, tell me the iOS version. That is a known class of
Safari issue with `playback` while the microphone is live, and the fix is to fall back to `play-and-record`
for the speaker route.
