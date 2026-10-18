# Call could not start: ERR0002 on iPhone (18 October 2026)

## What the person saw

"The call could not start. [ERR0002]: {Client} Failed to join room. Check the network and try again." with Try again and Back to chat.

## What the code was doing

A call has two stages after the server hands out a pass (auth token):

1. `initMeeting` builds the media client. This stage already retried three times.
2. `meeting.join()` (in `FaceTimeStage`) opens the signalling socket and then the audio route. This stage tried **once**. ERR0002 is the SDK saying the socket step failed (its source: `SelfController.joinRoom`, "socket join failed").

So one dropped socket, or one stale copy of the same person still sitting in the room, ended the call with a dead screen. Try again then reused the same pass, so a stale copy was never cleared.

The server side was checked and is not the cause: `room-session` only returns a pass after its checks pass, and the pass code path did not change in the private-call work. A refusal there shows its own message ("This call is private.").

## What changed

- `src/lib/joinFailure.ts` (new): reads the SDK error code, says which codes are worth retrying, and turns each into plain words with the code kept small at the end.
- `RoomMeeting.tsx`:
  - A failed join now asks the server for a fresh pass and joins again, up to twice, with a short back off. The server removes any stale copy of the person before it issues the pass. Only then is the error screen shown.
  - Try again does the same instead of reusing the failed pass.
  - A client built from an older pass is never shown or joined (`readyToken`), so a retry cannot join as a second copy next to the new one.
  - The SDK hook ignores a start while another is running and returns nothing. That used to leave the screen on the old pass. It now waits and starts again.
  - A server refusal (removed, ended, not found) still ends the attempt at once.

## What this cannot fix

If the phone's network blocks the media service for good (VPN, iCloud Private Relay, Low Data Mode, a filtering carrier or Wi-Fi), retries will fail the same way. The message now says so and names those settings.

## Device check

1. iPhone on mobile data, Private Relay off: call connects first time.
2. Turn Wi-Fi off and on during the "Calling" screen: the call recovers on its own, or shows the plain message.
3. iPhone with Private Relay on: the plain message appears after the retries, and turning it off then Try again connects.
4. Tap Try again several times quickly: only one copy of you ever appears on the call.
