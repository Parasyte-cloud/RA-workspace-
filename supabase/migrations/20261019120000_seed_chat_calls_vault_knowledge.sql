-- Seed: knowledge base articles for Chat, calls, phone alerts and confidential messages.
--
-- Source of every fact: the workspace code, the call and chat audit notes in docs/,
-- docs/confidential-messages.md and docs/push-notifications.md. Nothing here is invented.
-- Re-running is safe: an article that already exists (same slug) is left exactly as it
-- is, so edits made in the workspace are never overwritten.
-- Source copy lives in supabase/seed/knowledge-articles.json.

begin;

insert into public.workspace_knowledge_articles
  (title, slug, summary, content, category, tags, status, source, last_reviewed_at)
values
  ($kb$Chat: messages, files, voice notes and groups$kb$, $kb$chat-messages-and-groups$kb$, $kb$How to message one person or a group, send files and voice notes, and what happens when you delete a message.$kb$,
   $kb$## What Chat is
Chat is the messaging part of the workspace. You can message one person (a direct chat) or a group. It works on a phone and a computer, and it keeps working while you move between other sections of the workspace.

## What you can send
- Text.
- Photos and files.
- Voice notes.
- Confidential messages and documents, using the lock beside the attach button. See "Sending a confidential message or document".

## What the other person sees
- A new message shows in the chat list with an unread count until the chat is opened.
- A notification shows what was sent in plain words: the message text, or "Sent a photo", "Sent a voice note", "Sent a file" followed by the file name.
- Mentioning a person notifies them.
- If the phone alerts are on, the notification also arrives when the app is closed. See "Phone alerts and call sounds".

## Deleting a message
When you delete a message it stays in the chat as "This message was deleted", for you and for the other people, and it changes live on their screen. The text is gone. A deleted message is not counted as unread, and a notification that quoted the text is changed to "This message was deleted" too.

## If sending fails
A message, file or voice note that fails on a bad connection shows a Retry button. Pressing Retry never sends it twice: if the first try actually got through, Chat finds that copy and uses it.

## Calls
Every call is a line in the chat, with a Call back button. See "Calls in Chat".

## Not in Chat
ROOM 7 meetings and their chat are separate. Confidential messages are not available inside ROOM 7 yet.$kb$,
   $kb$Workspace$kb$, array['chat','messages','groups','voice notes','files']::text[], 'published', 'seed', now()),
  ($kb$Calls in Chat$kb$, $kb$calls-in-chat$kb$, $kb$How to call a colleague from Chat, what the call screen does, and the rules that keep calls private.$kb$,
   $kb$## Starting and answering
Open a chat and press the call button. The other person's phone or computer rings, and you hear the ringback tone. If the other person does not answer within 45 seconds, the call is closed as missed and both of you see "Missed voice call" in the chat. Press Call back to try again.

## The call screen
The call opens as a full screen in the style of FaceTime: the other person fills the screen and your own camera is a small picture you can drag. You can:
- mute and unmute your microphone
- turn your camera on or off, and flip between front and back cameras
- choose where the sound plays where the phone allows it
- shrink the call to a small window and go back to the chat, then press Return to call

The call clock starts when the other person is on the call, not while it is ringing.

## Hanging up
Hanging up on either side ends the call for both people. A call that is declined or not answered closes the caller's screen by itself.

## If the other person answers but never arrives
After the callee answers, the caller waits 30 seconds. If nobody is on the call by then, the call ends and the caller sees "They could not connect. Try calling again." While waiting, the screen says "Connecting..." instead of "Calling...".

## One call at a time
You cannot start a second call while you are on one: you see "You are already on a call". If someone calls you while you are on a call, they see "On another call". If you open the same call from a second device, the first device closes its screen and the call carries on.

## Who can be on a call
A call between two people is private to those two people. Anyone else who tries to join it is refused with "This call is private". An administrator can join any call. When one does, both people on the call get the notice "An administrator joined your call", and the header shows how many other people are on the call. If an administrator is one of the two people on the call, nobody gets that notice.

## History
- Every call is a line in the chat: "Voice call, 4:32", "Missed voice call", "Declined", or "No answer".
- The Calls tab in the chat list shows the history, newest first, with a call back button on each line.
- A missed call shows in red in the chat list and adds to the unread badge until you open the chat.

## What it cannot do
- Ringing needs the workspace open, or phone alerts turned on. A closed browser cannot ring by itself. See "Phone alerts and call sounds".
- A call does not take over a locked iPhone screen the way a normal phone call does. That needs a native app.
- Group calls from a chat are not available yet.
- If a call fails to start, see "Call could not start (ERR0002) and other call problems".$kb$,
   $kb$Workspace$kb$, array['calls','chat','voice','video','facetime']::text[], 'published', 'seed', now()),
  ($kb$Call could not start (ERR0002) and other call problems$kb$, $kb$call-could-not-start$kb$, $kb$What to try when a call says it could not start, and what to tell engineering if it keeps happening.$kb$,
   $kb$## What you may see
"The call could not start. [ERR0002]: Failed to join room. Check the network and try again." with the buttons Try again and Back to chat.

## What it means
The call screen could not open its live connection to the call service. The workspace now retries this by itself, up to two more times with a fresh pass each time, before it shows the message. If you still see it, the phone's network is blocking or dropping that connection.

## Try these, in order
1. Press Try again once and wait. Do not press it repeatedly.
2. Switch between Wi-Fi and mobile data, then try again.
3. On iPhone, turn off iCloud Private Relay for the network you are on (Settings, your name, iCloud, Private Relay).
4. Turn off any VPN, and turn off Low Data Mode (Settings, Mobile Service or Wi-Fi, the network's info button).
5. Try a different network, for example a phone hotspot. Some office and hotel Wi-Fi networks filter this traffic.
6. Close the workspace app fully, open it again, and call back.

## Other messages
- "This call is private." You are not one of the two people on this call.
- "You are already on a call." Finish or leave the other call first.
- "They could not connect. Try calling again." The other person answered but did not arrive within 30 seconds. Their network or phone is the cause. Ask them to reopen the app, then call again.
- No ring on the other side: they need the workspace open, or phone alerts turned on. See "Phone alerts and call sounds".

## What to send to engineering
If it still fails on a normal network, send: the time, who you were calling, the phone and iOS or Android version, whether Private Relay or a VPN was on, and the exact code in square brackets, for example ERR0002. The code tells engineering which stage failed.$kb$,
   $kb$Workspace$kb$, array['calls','troubleshooting','ERR0002','iphone','network']::text[], 'published', 'seed', now()),
  ($kb$Phone alerts and call sounds$kb$, $kb$phone-alerts-and-call-sounds$kb$, $kb$How to get message and call alerts when the app is closed, and why a phone may stay silent.$kb$,
   $kb$## Two different things
- **Sound inside the app:** while the workspace is open, messages play a sound and calls ring. A browser blocks sound until you have clicked or tapped the page once, so a call card may say "Click anywhere to hear the ring". After installing the workspace as an app, a card on first sign-in offers to turn sound on.
- **Phone alerts:** notifications that arrive when the app is closed. Turn them on in the bell menu with Phone alerts, then Turn on, and allow notifications when the phone asks. Turn it on once for each phone or browser you use.

## What gets sent
Calls, mentions, tasks and messages. A call notification stays on the screen until you tap it, and a missed call replaces the ring. If the workspace is open and visible, nothing extra is shown because the app already rings.

## iPhone
iPhone only allows alerts for an app that has been added to the Home Screen, and needs iOS 16.4 or later. Open the workspace in Safari, choose Share, then Add to Home Screen, open it from the Home Screen icon, and then turn Phone alerts on.

## If it stays silent
- The phone is on silent, or a Focus or Do Not Disturb mode is on. That is the phone's choice.
- Notifications are blocked for the app in the phone's settings.
- Android may delay alerts to save battery. Calls are sent as high priority, which helps.
- The Phone alerts row is hidden in the bell menu if engineering has not finished setting it up.

## Limits
A phone alert is a notification, not a phone call screen. It cannot take over a locked screen like a normal call does.$kb$,
   $kb$Workspace$kb$, array['notifications','push','sound','iphone','android']::text[], 'published', 'seed', now()),
  ($kb$Sending a confidential message or document$kb$, $kb$confidential-messages-staff-guide$kb$, $kb$How to lock a message or document in Chat, how the one-time key works, and what the other person sees.$kb$,
   $kb$## What it is
A confidential message is locked. The chat only shows a blurred card. The other person needs a one-time key from you to open it, it opens once, it shows for the time you chose, and then it locks again. Only an administrator can open it again.

## Sending one
1. Open a direct chat or a group.
2. Press the lock beside the attach button. The send button changes colour and a bar shows the view time.
3. Choose how long it can be viewed: 15 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes, 30 minutes or 1 hour. The administrator sets the longest time allowed, so the longer choices may be missing.
4. Write the message, or attach one PDF or image, and send.
5. A window shows the key, for example K7QM-2XPD-9TCW. **It is shown once.** Copy it or write it down now, then tell the person the key by a phone call, in person, or any way that is not this chat.

If you close the window before sharing the key, the message cannot be opened until an administrator issues a new key.

## What you can send
- Text up to 10,000 characters.
- A PDF or an image (photo), up to 15 MB. Word, Excel and other files are refused.
- Voice notes cannot be sent as confidential.

## Opening one you received
1. Tap Request key. The sender and the administrators are told. Asking again within a few minutes does not send more alerts.
2. When you have the key, tap Enter key and type it. Capital letters, spaces and dashes do not matter.
3. The content opens with a countdown, and your name and the time are written across it. When the time ends, or when you close it, it locks again.

## Rules to know
- **The key works once.** In a group, the first person to use it opens it. Everyone else needs an administrator.
- **Five wrong keys lock it** (an administrator can change this to anything from 3 to 10). A half-typed key does not count as a try.
- If the page reloads or the connection drops while you are inside your view time, you can continue until the time ends. You cannot get extra time.
- Switching to another tab or app hides the content. You cannot copy, print, save or drag it, and a confidential message cannot be edited or forwarded.
- The sender can delete a confidential message for everyone.
- After it has been viewed, the card says "Need to view again? Contact an administrator."

## Be honest about the limits
The workspace cannot stop a screenshot or a photo of the screen. The watermark with your name and the time is there so a leak can be traced, and so people think twice. Do not send something confidential to someone you do not trust with it.

## If you need help
Lost the key, locked out, or need to view something again: ask an administrator. See "Confidential messages for administrators".$kb$,
   $kb$Workspace$kb$, array['confidential','security','chat','key','lock']::text[], 'published', 'seed', now()),
  ($kb$Confidential messages for administrators$kb$, $kb$confidential-messages-admin-guide$kb$, $kb$What administrators can and cannot do with confidential messages: settings, unblocking, deleting and the audit trail.$kb$,
   $kb$## Where it is
Administration, then the **Confidential** tab. Only people with the Admin role see it. HR does not.

## What you cannot do
You cannot read the content of a confidential message or document. This tab never shows it, and the stored text is encrypted with a secret that is not in the database. This is on purpose, so that one administrator account in the wrong hands does not expose what staff locked. People with engineering access to the project's secrets are a separate matter, so keep that access small.

## What you can do
- **See the list.** Each line shows the chat, who sent it, whether it is a message or a document, the view time, who opened it and when, wrong keys, how many times it was unblocked, and how many people are waiting for access. The list starts on the ones needing attention (locked, viewed, or with a request waiting).
- **Unblock or issue a new key.** The button shows a new one-time key, once. It resets the wrong key count and closes any open view window. Give the key to the right person by phone or in person, never in the chat. This is the only way a viewed or locked message opens again.
- **Delete.** Deletes the message for everyone for good, including the stored content.
- **History.** Shows what happened to one message: sent, key requested, wrong key, locked, opened, unblocked, deleted, settings changed.
- **Settings.** The longest view time anyone can choose (15 seconds to 1 hour) and how many wrong keys lock a message (3 to 10, 5 by default).

## You are told when
Someone requests the key for a message that is still locked (you and the sender are told), someone asks for a viewed or locked message (administrators only), and a message locks after wrong keys (administrators and the sender). The alert never contains any content.

## Good practice
1. Before unblocking, confirm who is asking and why. The unblock is recorded with your name.
2. Pass the new key by a separate channel.
3. If the sender lost the key before sharing it, a new key fixes that. The sender cannot see the old key again.
4. In a group, only one person can use a key. If a second person also needs it, unblock again.

## Limits to tell staff
- Screenshots and phone photos cannot be prevented on the web. Only the native app could change that.
- Only PDF and image files, up to 15 MB.
- Any member of a chat can use up the wrong key attempts and lock a message. An administrator unblocks it.

## Setup and recovery
Engineering sets this up once. If the master secret is lost, locked texts cannot be read again, and if the second secret is changed, keys that were not used yet stop working and must be reissued with Unblock. See "Chat, calls and confidential messages: engineering notes".$kb$,
   $kb$Workspace$kb$, array['confidential','administration','security','unblock','audit']::text[], 'published', 'seed', now()),
  ($kb$Chat, calls and confidential messages: engineering notes$kb$, $kb$chat-calls-vault-engineering-notes$kb$, $kb$Which database migrations, edge functions and secrets Chat, calls, phone alerts and confidential messages need, and where the detailed docs are.$kb$,
   $kb$## Pieces and where they live
- **Chat and calls:** tables `social_messages` and `chat_calls`, the chat screen in `src/chat/ChatShell.tsx`, the call screens in `src/modules/CallModule.tsx`, `RoomMeeting.tsx` and `FaceTimeStage.tsx`. Calls use a Cloudflare RealtimeKit meeting created by the `room-session` edge function.
- **Phone alerts:** the `push-dispatch` edge function, `push_subscriptions` table and `public/sw.js`.
- **Confidential messages:** the `confidential-vault` edge function, the `confidential_*` tables and the screens in `src/chat/vault/` and `src/modules/AdminConfidential.tsx`.

## Order of work for a release
1. Run any new SQL migration first. Every migration here is safe to run twice.
2. Deploy the edge function that goes with it. A chat or call change that needs `room-session` does nothing until that function is deployed.
3. Merge and let Cloudflare Pages build the app.

The app is written so that shipping before the SQL is run breaks nothing: the lock button stays hidden until the vault tables exist.

## Edge functions
- `room-session`: `supabase functions deploy room-session`. Joins are locked to the two people on a chat call; administrators can join and both people are notified.
- `push-dispatch`: deployed with `--no-verify-jwt`, called by a database trigger with a shared secret.
- `confidential-vault`: `supabase functions deploy confidential-vault`. Keep the default JWT check on.

## Secrets (names only, never paste values into chat or tickets)
- Phone alerts: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`, and `VITE_VAPID_PUBLIC_KEY` in Cloudflare Pages.
- Confidential messages: `VAULT_MASTER_KEY` (base64 of 32 random bytes) and `VAULT_PEPPER` (at least 32 characters). Back both up. Losing the master key makes locked texts unreadable. Changing the pepper invalidates keys that were not used yet. Without these two secrets the vault answers "not set up" and does nothing.

## How the vault keeps content away from browsers
The chat row holds only a placeholder and a link. The content is stored in tables that have no policies for the browser. Only the edge function, using the service role, reads them, and only after a database function has checked the one-time key and the member. See `docs/confidential-messages.md`.

## Checks
- `npm run typecheck` and `npm test` run in CI on every pull request.
- The vault and call suites include source checks that fail if a security rule is weakened.
- Device checks are listed at the end of `docs/confidential-messages.md`, `docs/chat-call-audit-round3-2026-10-18.md` and `docs/call-join-failure-2026-10-18.md`. Nothing about calls on a real phone is proven until those are done.

## Known gaps
Ringing a locked or closed phone needs a native wrapper (CallKit and PushKit). Screenshots cannot be blocked on the web. ROOM 7 chat has no confidential option yet.$kb$,
   $kb$Engineering$kb$, array['engineering','supabase','edge functions','deploy','calls','confidential']::text[], 'published', 'seed', now())
on conflict (slug) do nothing;

commit;
