# Calls in Chat

## What people see

- **Ringing:** an incoming call plays a phone ring and vibrates on phones, and the caller hears the ringback tone. If the browser is still blocking sound (it needs one click on the page first), the call card says "Click anywhere to hear the ring". When the tab is in the background, a system alert stays on screen until the call is answered or rings out.
- **In the chat:** every call is a line in the conversation: "Missed voice call", "Voice call, 4:32", "Declined", "No answer", each with a **Call back** button. A missed call also shows in the chat list ("Missed voice call" in red) and adds to the unread badge until the chat is opened.
- **Calls tab:** the Chats list has a **Calls** tab with the history, newest first, and a call-back button on every line.
- **Stays in Chat:** answering or starting a call opens a small call window over the chat instead of jumping to the ROOM 7 page. **Return to call** expands it to full size. Hanging up on either side ends the call for both, and a declined or unanswered call closes the caller's window by itself.

## How it works

- Calls are rows in `chat_calls`. The database closes any call that rings for more than 45 seconds as missed (`expire_chat_calls`), so a caller who closes their browser still produces a missed call for the other person.
- The call window and the chat call are tied together by the call id, so ending one ends the other.

## Not covered

Ringing needs the workspace open in a browser tab (any section). A closed browser cannot ring: that needs push notifications from a phone app or a service worker with a push server.
