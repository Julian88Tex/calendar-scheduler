# QA report: golden path (go-live)

Date: 2026-10-15. Branch `claude/scheduler-app`. Scope: the flows the owner uses today (docs/SCOPE.md), end to end in
the real Next.js server, plus the last go-live items (email outbox page, root URL, test fixture route, meeting poll
follow-ups).

## How it was tested

- **Golden-path e2e** (`e2e/golden-path/`, Playwright 1.64, Chromium 141): `next dev` on its own port and database,
  the seeded owner account (Julian Joseph, `julianjoseph`, America/Los_Angeles), the browser in America/New_York, the
  business clock pinned to Monday, October 7, 2030 at 6:00am Los Angeles through the E2E test API (the meeting poll
  test uses the real clock because its grid works in the browser's week). No Google account and no email provider:
  emails are stored in the outbox and read back through the test API; calendar conflicts come from the fake calendar.

  ```sh
  E2E_PORT=3499 PGLITE_DIR=.data/pglite-e2e-golden NEXT_DIST_DIR=.next-e2e-golden \
    scripts/heavy.sh server npx playwright test e2e/golden-path
  # Gmail sending (held emails and Resend), a second run with EMAIL_PROVIDER=gmail:
  EMAIL_PROVIDER=gmail E2E_PORT=3499 PGLITE_DIR=.data/pglite-e2e-golden-gmail NEXT_DIST_DIR=.next-e2e-golden \
    scripts/heavy.sh server npx playwright test e2e/golden-path/gmail-hold.spec.ts
  ```

- **Integration and unit tests** (Vitest, PGlite): the email outbox read model and Resend
  (`src/app/(dashboard)/app/settings/email-outbox/outbox.test.ts`), the fixture guard
  (`src/app/reschedulings/host-dialogs-fixture/page.test.ts`), and the whole default project (191 files).
- **Equivalence check** of the meeting poll time helpers rewritten without Luxon: 379,068 comparisons against the old
  Luxon implementation over 20 time zones (including Lord Howe's 30 minute DST, Santiago and Havana with DST at
  midnight, Casablanca, Apia, Chatham) and every day of 2024 to 2027: no difference.
- Type check (`npm run typecheck:owned`), ESLint and `npm run check:dashes` on every changed path; neighbouring e2e
  suites re-run on the same port (foundation harness, foundation-ui shell, polls-ui, lifecycle-ui host dialogs,
  settings-onboarding).

## Results

| Flow (docs/SCOPE.md) | Test | Result |
|---|---|---|
| Root URL: signed out goes to `/login` (a stale cookie counts as signed out), signed in to `/app/scheduling` | booking.spec "the root URL ..." | Pass |
| Public profile: name, welcome message, the 3 event types in order, axe | booking.spec "books each event type ..." | Pass |
| Book 30 Minute Virtual (first start after 4 hours notice, 15 minute increments), 60 Minute Virtual, and In-Person Meal or Coffee with a venue pick (9 locations, venue and address on the confirmation) | same | Pass |
| Confirmation page (time and zone in the invitee's zone, manage links), invitee confirmation email with ICS REQUEST and cancel and reschedule links, host "New Event" email with the answer | same | Pass |
| Buffers: the booked time and its 15 minute buffer are gone from the booking page | same | Pass |
| Invitee reschedule from the email link (former time struck through, prefilled answers, reason), "Updated:" email with ICS, host rescheduled email, old time freed | booking.spec "the invitee reschedules ..." | Pass |
| Invitee cancel from the old email link (follows the reschedule), reason in the email, ICS CANCEL, host canceled email, slot free again | same | Pass |
| Phone width (390 px): profile, calendar, details form and confirmation of the meal booking with a venue, no horizontal scroll, axe | booking.spec "phone" | Pass |
| Meetings list shows a new booking; host cancel with a message (the invitee's email carries it, ICS CANCEL); "Mark as no-show" on a past meeting | host.spec "meetings list ..." | Pass |
| Availability: a weekly hours edit auto-saves and moves the first bookable start; a host meeting limit (1 per day, Advanced) fills Tuesday for every event type after one booking | host.spec "availability edits ..." | Pass |
| Troubleshoot: MEETING LIMIT on the full day, "Outside your working hours", the calendar event by name ("Dentist") and the 15 minute buffers before and after it; the public page agrees (2:15pm and 4:15pm offered, 2:30pm to 4:00pm not) | same | Pass |
| Reminders: the 24 hour reminder job of a new booking is scheduled (nothing before its time); when the dispatcher is late the instance admin sees "1 reminder is past its send time." (the count reads the pending job in the jobs table); one reminder with cancel and reschedule links, never a second copy; a reschedule moves it to the new time | host.spec "a booking's 24 hour reminder ..." | Pass |
| Meeting poll: create on the week grid, share, a voter answers, close voting, reopen voting with the voter email (new), book the best time (meeting in Meetings, invitee confirmation), list shows "Booked for", Delete names the meeting with its end time and offers the voter email for a booked poll (new), the deleted link answers HTTP 410 (GET and HEAD) with "This poll is no longer available." and noindex, unknown slugs 404 | polls.spec | Pass |
| Email outbox page: settings navigation entry, transport line, rows with status, subject, template, recipient, provider and time, search, status filter, empty state, preview in a sandboxed frame and as plain text, axe; a member without the owner role gets no entry and the not found page | outbox.spec | Pass |
| Gmail sending not connected (EMAIL_PROVIDER=gmail): rows "Waiting for Gmail" with the reason (no internal prefix), "Reconnect Google" link to `/app/integrations/calendars/google`, the page banner; after 24 hours "Failed" with "Not sent: ..." (no "permanent: " prefix) and Resend, whose new copy waits for Gmail again | gmail-hold.spec | Pass |
| `/reschedulings/host-dialogs-fixture` is the 404 page outside E2E test mode (before any session or database read; generic metadata) and keeps working for the lifecycle-ui e2e | page.test.ts, lifecycle-ui host-dialogs.spec | Pass |

Golden-path suite: 10 tests in the default run plus 1 in the Gmail run, all passing (about 4 minutes in all). Vitest
default project: 2,535 tests passing.

## Changes made for go-live

- **Email outbox page** `/app/settings/email-outbox` (owner or instance admin; listed under Settings > Account):
  every email newest first, 25 per page, status (Sent, Stored, Queued, Waiting for Gmail, Failed with "Retrying
  automatically" while retries are left), provider, template, recipients, subject and time in the owner's zone and
  time format; status filter and search; "View" opens the email (sandboxed frame without scripts or same-origin access,
  links open in a new tab; plain text tab; headers, invite and attachments); "Resend" on an email that failed for good
  sends a new copy. Held emails link to Integrations > Google Calendar to reconnect. A resend first marks the original
  ("Resent as a new email.") with a compare-and-set on its version, so double clicks, stale pages and the original's
  retries never send twice.
- **Root URL** `/`: signed in goes to `/app/scheduling`, signed out to `/login` (the placeholder page is gone).
- **Fixture route**: `/reschedulings/host-dialogs-fixture` answered 404 already, but showed the fixture's title in its
  metadata and could be baked as a 404 at build time; it is now dynamic with generic metadata outside E2E mode.
- **Meeting polls**: a real HTTP 410 for the voter page of a deleted or canceled poll (the proxy asks the new
  `GET /api/public/polls/{slug}/state`, one indexed lookup, and answers the page's "no longer available" HTML with 410;
  errors and timeouts fall back to the normal page); the client time helpers (`src/lib/polls/grid.ts`, used by
  `display.ts`) no longer use Luxon, so the public voter page bundle has none; the poll list's booked meeting carries
  its end time and all-day date, so "Delete" and "Reopen" name the meeting time correctly (all-day meetings no longer
  show as midnight in another zone, also on the card's "Booked for"); "Reopen voting" emails the voters when asked and
  "Delete" of a booked poll can notify them (off by default there, since the meeting stays).

## Bugs found and fixed (inside the golden-path-qa paths)

1. The voter page of a deleted poll answered 200 (the JSON API answered 410): now 410.
2. "Reopen voting" ignored `notify` and "Delete poll" ignored it for booked polls; the dialogs never offered it.
3. The Delete dialog of a booked poll named the meeting without its end time, and a meeting booked from a date-only
   option showed as midnight in the viewer's zone (also on the list card's "Booked for").
4. The public voter page shipped Luxon through `display.ts` -> `grid.ts`.
5. The root URL showed "This page is being built."
6. The fixture route's metadata named it on the production 404 page.
7. The plain text preview of the new outbox dialog was a scrollable region without keyboard access (axe); fixed before
   release.

## Found outside these paths (not changed, for their owners)

1. **Not found pages under `/app` answer HTTP 200**: `/app/loading.tsx` streams the dashboard shell first, so a page
   that calls `notFound()` (a member opening the outbox, unknown meeting or poll ids) renders the not found page with
   status 200 (noindex). Harmless for people; only a real 404 status is missing (foundation-ui).
2. **`e2e/foundation-ui/shell.spec.ts` "help menu ..."** fails on the golden port: it clicks the Help button before
   hydration, React reports a hydration mismatch (Radix `aria-hidden` on the header) and the Next dev overlay then
   intercepts the next click. Not related to these changes; waiting for hydration (`networkidle`) before the first
   click fixes it (foundation-ui).
3. **`sitemap.xml` lists `/`**, which now redirects (to `/login`); it can be dropped from the marketing list
   (`src/app/sitemap.ts`).
4. **No test API for the jobs table**: reminder scheduling is verified through its effects (the overdue reminders
   notice, which counts pending jobs, and delivery at the right time). A `GET /api/test/jobs` would allow asserting
   `run_at` directly (foundation-platform test API).
5. **Without a Google connection every booking emails the host "We couldn't create a Google Meet link ..."** (seen in
   every e2e booking). Correct behavior, but in production a disconnected Google account means one such email per
   booking until it is reconnected.
6. The Integrations hub "Email delivery" tile could link to the new outbox page (`_shell/integrations-hub.tsx`).
7. The new route handler `src/app/api/public/polls/[slug]/state/route.ts` lives in the polls-core API folder (the
   proxy cannot read the database itself).

## Known gaps (not covered by this suite)

- Real Google Calendar, Google Meet and Gmail delivery (no credentials in tests; covered by unit tests with fake Google
  APIs in `tests/email-gmail` and `tests/calendar-integrations`, and by the manual checks in docs/DEPLOY.md steps 7
  and 9 on the live deployment).
- Host-side changes in Google Calendar (moves and deletes) end to end, and the Google push webhook.
- The production build (`next start`) and Vercel specifics (the proxy's self request to `/api/public/polls/{slug}/state`
  on a protected preview needs `VERCEL_AUTOMATION_BYPASS_SECRET`, otherwise the voter page of a deleted poll falls
  back to status 200 there; production domains are not protected).
- Browsers other than Chromium, real phones, email rendering in mail clients.
- Daylight saving transitions end to end (covered by the slot engine and poll grid unit tests and the equivalence
  check above).
- Load and concurrency beyond the race tests in `tests/pg`.
