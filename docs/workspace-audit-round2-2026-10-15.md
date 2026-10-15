# Workspace audit, round 2 (15 Oct 2026)

Scope: the whole workspace app (src), the edge functions, the migrations and the
light and dark themes. Round 1 is in `workspace-audit-2026-10-15.md`.

## Method

- Static checks: TypeScript, eslint (hooks and promises), searches for unsafe HTML,
  links, secrets, filter injection and listener leaks.
- Database and functions: a scan of every migration and function config, plus a set
  of read-only SQL checks to run on the live project (`live-security-checks.sql`).
- Behaviour: fuzzing of the spreadsheet formula engine and the calendar logic.
- Looks: an automatic contrast checker. It renders each screen in light and dark,
  hides the text, samples the real pixels behind every piece of text and reports
  anything under 3:1.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | Medium | Links stored in the database (calendar meeting link, legal source links, brand preview) became clickable even when they were not web addresses, for example `javascript:`. | `lib/safeUrl.ts`; used for all four. |
| 2 | Medium | Calendar export (.ics) put the event link into the file as typed. A link with a line break could add lines to the file. A lone carriage return in a title could do the same. Semicolons were not escaped. | Link must be a plain web address; every kind of line break is escaped; semicolons escaped. |
| 3 | Low | Repeating timed events exported an end date of the wrong type, which some calendar apps reject. | End date is now a UTC time for timed events. |
| 4 | Medium | A repeating event stopped showing after 2,000 occurrences counted from its first date. A daily event older than about 5.5 years vanished from the calendar. | The calendar now starts counting near the window being viewed. |
| 5 | Medium | The 30 minute idle sign-out only counted typing and clicking. Someone listening to a long ROOM 7 meeting could be signed out in the middle of it. | A call or meeting now counts as activity. |
| 6 | Medium | The admin people list only loaded the first 200 accounts. Beyond that, people silently did not appear. | Reads every page. |
| 7 | Low | A spreadsheet formula nested thousands of levels deep crashed the sheet. | Shows `#ERROR!` in that cell. |
| 8 | Low | An invalid date from the database crashed two screens (attendance times, finance dates). | Shows a dash instead. |
| 9 | Low | Em dashes in about 70 places on screen and in generated text. | Replaced. A test now blocks new ones. |
| 10 | Medium | Dark mode: the whole Chat panel stayed cream while its text turned light, so it was unreadable. | `chat-dark.css`. |
| 11 | Low | Light mode: small amber labels were about 2:1 on white. | Deeper amber in light mode. |
| 12 | Low | The phone tab bar was an opaque navy block. | Clear liquid glass, readable in both themes. |

See the section at the end for the contrast fixes found by the scan.

## Checked and found fine

- No inner HTML written from user text except the mail reader, which is sanitised.
- No secrets in the source; no sensitive values written to the console or local storage.
- Every realtime channel, interval and listener is cleaned up.
- No filter strings built from user text; the one search uses escaped wildcards.
- Webhooks verify signatures in constant time. Public edge functions rate limit or require a secret.

## Needs a look on the live database

Run `docs/live-security-checks.sql` in the Supabase SQL Editor. Each query should
return no rows (the notes in the file say where rows are expected). The migrations
alone cannot prove the live state, because some tables are protected by loops that
run at migration time.

## Light and dark mode readability

A pixel contrast scan of 74 modules at phone width in both themes found text under 3:1 contrast in about 30 places. Causes:

- Panels, inputs, tabs, calendar, mail, archive, directory and phone menu surfaces painted white with no dark version, so dark mode showed pale boxes with pale text (the Chat panel in dark mode was the worst).
- Badges and notices using dark amber, red or navy text with no dark counterpart.
- Light mode helper text in light grey (#697686, #6f7b8a, #8b96a4) under the readable threshold.
- A forced navy page colour showing behind wide tables in light mode.

Fixes are in `src/chat-dark.css` and `src/theme-fixes.css`. After the fixes the re-scan of the worst modules shows no remaining low-contrast text.
