# Confidential messages (the vault)

19 October 2026. Chat, direct and group.

## What it does

In a chat, tap the lock next to the attach button, then send. The message (or a PDF or image) is sealed on the server and the chat shows a blurred locked card instead of the content.

1. **Sender** picks a view time (15 seconds up to 1 hour, capped by the administrator), turns the lock on and sends. The app shows a one-time key like `K7QM-2XPD-9TCW` exactly once. The sender passes it to the person on a phone call, in person, anywhere that is not this chat.
2. **Recipient** sees the locked card. They tap **Request key**, which notifies the sender and the administrators, or they type the key if they already have it.
3. **The key works once.** The content appears for the chosen time with the viewer's name and the time written across it, then the card locks again and says: *Need to view again? Contact an administrator.*
4. **Only an administrator can open it again**, from Administration > Confidential, by issuing a new one-time key. Administrators never see the content there.

Too many wrong keys (5 by default, 3 to 10 in settings) locks the card the same way. The sender and administrators are told.

## Why it is built this way

The first rule is that **the content is never in the chat row**. The chat table holds the words "Confidential message" and a link to a vault record. Realtime copies chat rows to every device in the chat, so if the content were there, "locked" would only be a blur on top of data already on the phone. Here the blur is a drawing and there is nothing behind it.

| Piece | Where it lives | Who can read it |
|---|---|---|
| Card state (locked, viewed, who, when) | `confidential_items` | Chat members |
| Text, sealed with AES-256-GCM | `confidential_secrets.ciphertext` | Nobody from the browser; the edge function only |
| File | private bucket `confidential-vault` | Nobody directly; a signed link sized to the view time |
| Key | `confidential_secrets.key_hash` | Nobody; only an HMAC of it is stored |
| History | `confidential_audit` | Administrators |

What each choice prevents:

- **Key is hashed with a server-only pepper (HMAC-SHA256).** A copy of the database alone cannot be used to guess keys offline.
- **Text is encrypted with a master key held as an edge function secret.** A copy of the database alone shows only ciphertext. The ciphertext is also bound to the chat and the sender, so moving a row into another chat makes it unreadable.
- **The key is burned the instant it works.** Two people typing it at the same moment cannot both win; the database row is locked while it decides.
- **Every wrong key is counted in the database**, not in the browser, so reloading or opening another tab does not reset the count.
- **Reload inside the window works, but only inside it.** A refresh or a dropped connection will not cost the viewer their time, and it can never extend it.
- **Only the vault can create or relink a confidential chat row.** A trigger refuses a hand-made insert. A confidential message also cannot be edited, forwarded or unlinked.
- **Delete is real.** Deleting the chat message wipes the secret and marks the record destroyed.
- **Files are judged by their first bytes**, not by the name or type the browser claims. A web page renamed `.pdf` is thrown away.

## Limits you should know

These are real and the app does not hide them.

1. **A screenshot or a photo of the screen cannot be stopped on the web.** The viewer hides itself when the tab loses focus, blocks copy, print, save and drag, and puts the viewer's name and time across the content. That discourages leaks and identifies the source if one happens. It does not prevent one. For true screenshot blocking you need the native iOS/Android app.
2. **Files are PDF and images only, up to 15 MB.** Word, Excel and zip files cannot be shown safely inside a locked viewer, so they are refused.
3. **Any member of the chat can burn the wrong-key attempts** and lock a card. That is the price of a lockout. An administrator unblocks it.
4. **If the sender loses the key before sharing it,** an administrator issues a new one. The sender has no way to see it twice.
5. **If the master key secret is lost, sealed texts cannot be read.** Back it up. **If the pepper is changed, keys that were not used yet stop working** and administrators must reissue them.
6. **Administrators can delete and re-key but cannot read.** If you want an escrow path for investigations, that is a separate decision.

## Deploy, in this order

1. Secrets (once). Keep a copy somewhere safe:
   ```
   supabase secrets set VAULT_MASTER_KEY="$(openssl rand -base64 32)" VAULT_PEPPER="$(openssl rand -base64 48)" --project-ref fkkxcivxnwshahnbatnp
   ```
2. Run these two files in the SQL editor, in this order. Both are safe to run twice.
   - `supabase/migrations/20261019100000_confidential_messages.sql`
   - `supabase/migrations/20261019130000_confidential_grants.sql` (table permissions for the app and the Edge Function; without it a project that has no default grants answers 403 and the lock button stays hidden)
3. Deploy the function: `supabase functions deploy confidential-vault --project-ref fkkxcivxnwshahnbatnp`
4. Merge the PR.

The lock button stays hidden until both files in step 2 are run, and the vault answers `not_configured` until step 1 is done. Merging first breaks nothing.

## How it was checked

- `scripts/confidential-messages.test.mjs` runs the real crypto and key code and pins the rules above. Three deliberate weakenings (secrets granted to the browser, cacheable responses, biased key generation) each fail it.
- The migration was run on a real Postgres engine (PGlite), first with permissive default table permissions and then, after a production 403, with none, so the explicit grants in `20261019130000_confidential_grants.sql` are what is being tested. Attacks: forged inserts, reading secrets, calling the vault functions as a signed-in user, editing, forwarding, unlinking, wrong keys to lockout, double open, window resume, unblock, delete. Four mutations (guard removed, key not burned, no lockout, secrets readable) each broke a check.
- Not yet checked: the screens on a real phone, and the edge function running on Supabase. Use the device checklist in the PR.

## Device checklist

- Send a text with the lock on, to one person. Key appears once, closing it hides it for good.
- Recipient: Request key. Sender and an admin get a notification.
- Enter a wrong key twice, then the right one. Content shows with the watermark and counts down.
- Switch tabs mid-view: content hides. Reload inside the window: it continues. After time is up: locked with the contact-admin line.
- Admin: Administration > Confidential > Unblock. New key, opens once more.
- Send a PDF and a photo. Send in a group. Try forward and copy: both are absent.
