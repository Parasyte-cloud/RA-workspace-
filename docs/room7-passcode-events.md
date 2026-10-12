# ROOM 7 external events with a passcode

How to run a ROOM 7 event for people outside RideArrivo, protected by a passcode.

## How it works

1. You create a ROOM 7 room in the intranet. It gets an 8 character code, like `UFCKV8V7`.
2. You set it up as an external event in the **Room7 Event Control Center**.
3. Guests open `https://room7.ridearrivo.com/r/<CODE>`, enter their **email** and the **passcode**, and join.

Every guest gives an email, in every mode. That is how ROOM 7 knows who attended. The passcode is the extra lock on top.

## Quickest way: Guest link and code

In the intranet, open **ROOM 7** and press **Guest link and code** (or **Guest link** on a meeting card). One click does all the setup below for you: it turns on the public page, uses the event code as the key, and opens the doors. Guests open the link, type their name and email, and join. You get the link and the event code with Copy buttons, plus **Copy invitation message** and **Share on WhatsApp**.

If you want an extra lock, press **Make a new passcode**. Guests are then asked for it as well. **Use the event code only** switches back.

Requirements on the server (one time):

- The Supabase Edge Function secret `ROOM7_ACCESS_PEPPER` must be set. Without it passcodes cannot be saved and the button shows a clear error.
- `room7.ridearrivo.com` must be a custom domain of the `ra-workspace` Cloudflare Pages project.
- The Cloudflare RealtimeKit secrets must be set, or guests reach the page but cannot enter the call.

Pressing the button again changes nothing that invitations already sent depend on.

Guests who arrive before you open the room wait on the page and are let in automatically. If the guest page is already on, the room also opens by itself the moment you join the meeting.

To vet each guest, tick **Approve each guest before they enter** in the same window. Guests then wait until you press Admit on the panel that appears above your call.

The sections below describe the same setup done by hand.

## Setting it up (host)

In the Event Control Center, open the room and set:

| Setting | Value |
|---|---|
| Access mode | **Passcode** |
| Passcode | 6 to 128 characters |
| External public page | **Enabled** |

Save. Then share two things with guests: the link and the passcode. Send them separately if the event is sensitive.

## Event states

The state controls what guests can do. Move it forward as the event runs:

| State | Guests see the page | Guests can join | Use it for |
|---|---|---|---|
| Draft | yes, if public page is on | no | Still preparing |
| Pre-event | yes | no | Link shared, room not open yet |
| Doors open | yes | **yes** | Let people into the room early |
| Live | yes | **yes** | Event running |
| Intermission | yes | **yes** | Break |
| Ended | yes | no | Event over |
| Replay | yes | no | Recording available |

Order: Draft, Pre-event, Doors open, Live, Intermission or Ended, Replay.

## What the guest sees

- **Before joins open:** the event page and the lobby. They can open **Documents**, type email and passcode, and read the event material.
- **Once joins open:** a form asking for name, email, and passcode, then they enter the live room.

## Access modes compared

| Mode | Guest types | Good for |
|---|---|---|
| Open | email | Public events, webinars |
| Passcode | email + passcode | A group you share one secret with |
| Invitation | email (the invite link carries the secret) | Named guests, one link each |

## When it does not work

| Guest sees | Cause | Fix |
|---|---|---|
| "This event is not available" | External public page is off, or the room was never set up as an event | Turn on External public page and save |
| "ROOM 7 is not accepting guest joins right now" | State is Draft, Pre-event, Ended or Replay | Move the state to Doors open or Live |
| "The ROOM 7 passcode is incorrect" | Wrong passcode, or it was set outside the Control Center | Re-enter it in the Control Center and save |
| "ROOM 7 passcode access is not configured" | `ROOM7_ACCESS_PEPPER` secret is missing from Supabase Edge Functions | Add the secret, then re-save the passcode |

## Why passcodes must be set in the Control Center

ROOM 7 never stores the passcode itself. It stores a hash made with the `ROOM7_ACCESS_PEPPER` secret. If you write a passcode straight into the database, no guest can ever match it. If the pepper secret is changed, every existing passcode stops working until it is saved again.
