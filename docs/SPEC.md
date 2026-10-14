# Product Specification: Calendly-parity scheduling app (working name "Kairos")

Status: authoritative product spec for every implementation agent. Version 1.1, 2026-10-12 (revised after the
completeness and feasibility reviews; new requirements use the next free number in their domain).

Sources: `docs/research/calendly-core-features.md`, `calendly-advanced-features.md`, `calendly-ux-walkthrough.md`,
`meeting-polls.md`, `tech-reference.md`, `owner-reference.md`, `calendly-account-observations.md`. Where this spec and a
research document disagree, this spec wins. Where the owner observations (live account) and anything else disagree,
the owner observations win and this spec already reflects them.

Technical design lives in `docs/ARCHITECTURE.md`; the parallel build plan lives in `docs/WORKPLAN.json`.

---

## 0. How to read this spec

### 0.1 Requirement format

Every requirement has a stable ID (`ET-16`), a title, a priority, and some of these parts:

- **Behavior**: what the product does, precisely.
- **Defaults / limits**: initial values, ranges, maximums.
- **Edge cases**: unusual inputs and how they resolve.
- **Acceptance**: testable criteria. An implementation is done when every acceptance bullet passes.

IDs are never renumbered. New requirements get the next free number in their domain. Cross references use the ID
only (for example "see SCH-07").

### 0.2 Priorities

| Priority | Meaning |
|---|---|
| **P0** | Core scheduling front end and back end. The product is not usable without it. Built first. |
| **P1** | Important parity feature that a Calendly user would notice within the first week. |
| **P2** | Secondary scope (meeting polls are P2 by owner decision, but must be built), advanced parity features. |
| **P3** | Nice to have, extensions beyond Calendly, or integrations that need third-party infrastructure. |

Everything in this document is to be built eventually. Priority only decides order.

### 0.3 Markers

- **(our choice)**: Calendly behavior is unknown, ambiguous, or plan-gated; we chose a sensible behavior. Implement
  exactly as written.
- **(extension)**: Calendly does not have this; we add it. Must be off by default or invisible unless used, so the
  default experience stays identical to Calendly.
- **(observed)**: verified on the owner's live Calendly account; ground truth.
- Quoted strings in double quotes are UI copy. Use them verbatim (English). Copy marked (our choice) may be refined
  but must keep the meaning.

### 0.4 Product identity

- The product must not impersonate Calendly. Our name, logo and "Powered by" ribbon use our own brand. The working
  name is **Kairos**, configurable with `NEXT_PUBLIC_APP_NAME` (see GEN-01). In this spec "{AppName}" means that
  value.
- Calendly naming is used only where needed for compatibility (embed API alias `window.Calendly`, postMessage event
  names `calendly.*`, webhook signature header name, API resource shapes), and never as visible branding.

### 0.5 Glossary

| Term | Meaning |
|---|---|
| Host | A user of this app who owns or attends a meeting as organizer. |
| Invitee | A person who books (or is booked into) a meeting. Needs no account. |
| Guest | An extra email an invitee adds to a booking (max 10). |
| Event type | A reusable template for a bookable meeting (Calendly "event type"). |
| Kind | `solo` (one invitee per slot) or `group` (many invitees per slot). |
| Pooling type | `null` (single host), `collective`, `round_robin`, `multi_pool`. |
| Scope | `personal` (user page), `shared` (multi-host, no landing page), `team` (team page). |
| Scheduled event | One booked meeting at a time (Calendly `scheduled_event`). Group slots hold many invitees. |
| Invitee record | One booking by one person (Calendly `invitee`), with its own cancel and reschedule links. |
| Schedule | A named set of weekly hours plus date-specific hours in one IANA time zone. |
| Busy interval | A time range in which a host cannot be booked, from any source. |
| Slot | A bookable start time computed by the slot engine. |
| Single-use link | A link to an event type that expires after one booking. |
| One-off meeting | A one-time meeting with hand-picked times (Calendly `AdhocEventType`). |
| Meeting poll | A poll where invitees vote on proposed times; the host books the winner. |
| Workflow | An automation: trigger plus timing plus actions (Calendly "Automations", formerly "Workflows"). |
| Routing form | A form whose answers route a visitor to an event type, a message or a URL. |
| Org | Organization (workspace). Every user belongs to exactly one. |
| Instance admin | A user allowed to manage the whole deployment (first user, plus `ADMIN_EMAILS`). |

### 0.6 Public URL map (canonical)

| Page | URL |
|---|---|
| User landing page | `/{userSlug}` |
| Team landing page | `/{teamSlug}` |
| Booking page | `/{slug}/{eventSlug}` with optional `?month=YYYY-MM&date=YYYY-MM-DD&back=1` |
| Details form for a slot | `/{slug}/{eventSlug}/{ISO8601 UTC start}` (example `/julianjoseph/30min/2026-10-13T18:00:00Z`) (observed) |
| Single-use link, one-off meeting, shared event type | `/d/{code}/{eventSlug}` and `/d/{code}/{eventSlug}/{ISO start}`; `/d/{code}` redirects to the canonical form |
| Booking confirmation | `/booking/{inviteeId}` |
| Invitee cancel | `/cancellations/{inviteeId}` |
| Invitee reschedule | `/reschedulings/{inviteeId}` |
| Invitee reconfirm | `/reconfirm/{inviteeId}` |
| Stable conferencing link | `/events/{scheduledEventId}/join` (observed pattern) |
| Booking ICS download | `/booking/{inviteeId}/event.ics` |
| Meeting poll voting | `/p/{pollSlug}` |
| Routing form | `/r/{formSlug}` |
| Embed script | `/embed.js` (alias `/widget.js`) and stylesheet `/widget.css` (Calendly snippets include it) |
| Setup page | `/setup` |
| App (dashboard) | `/app/...` (see each domain) |
| Public REST API | `/api/v1/...` |

Slugs for users and teams share one namespace. Reserved words are listed in GEN-02.

---

## 1. GEN: General and cross-cutting requirements

### GEN-01 Product identity and naming (P0)

- **Behavior**: The product name comes from `NEXT_PUBLIC_APP_NAME` (default "Kairos"). It appears in the app header
  logo wordmark, page titles ("{Page} - {AppName}"), email footers ("Powered by {AppName}"), the booking page ribbon
  ("POWERED BY" / "{AppName}"), and the marketing site. A simple geometric "K" mark in brand blue is the logo
  (our choice). The logo is an inline SVG component, never an image of Calendly's logo.
- **Acceptance**: Changing `NEXT_PUBLIC_APP_NAME` and restarting changes every visible occurrence. No visible string
  "Calendly" exists anywhere in the UI, emails or public pages, except in the API docs page where compatibility is
  explained.

### GEN-02 URL map, slugs and reserved words (P0)

- **Behavior**: Public URLs follow section 0.6 exactly. User and team slugs share one namespace and must match
  `^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$` (1 to 50 chars, lowercase letters, digits, hyphens, no leading or trailing
  hyphen). Event type slugs match `^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$` and are unique per profile (user or team)
  among non-deleted event types. Uppercase input is lowercased; spaces and underscores become hyphens; other
  characters are removed; repeated hyphens collapse.
- **Reserved user/team slugs** (case-insensitive): `app, api, admin, auth, login, logout, signup, register, onboarding,
  setup, settings, invite, oauth, d, p, r, poll, polls, booking, bookings, events, event, cancellations, reschedulings,
  reconfirm, embed, embed.js, widget.js, widget, team, teams, u, s, i, help, docs, privacy, terms, cookie-policy, payments,
  cookies, pricing, features, blog, about, contact, support, status, health, cron, static, public, assets, files,
  _next, favicon.ico, robots.txt, sitemap.xml, manifest.json, apple-touch-icon.png, verify-email, reset-password,
  forgot-password, me, new, null, undefined, www, mail, root, system`.
- **Edge cases**: Changing a user slug breaks old links (no redirect, Calendly parity, BR-08). Changing an event
  slug breaks old event links (no redirect). Unknown slugs show the 404 page (BK-23).
- **Acceptance**: Creating a user with slug `api` or `Login` fails with "This URL is not available." Creating a team
  with a slug already used by a user fails with the same message. `slugify("Student Office Hours!")` returns
  `student-office-hours`.

### GEN-03 Visual parity with the Calendly classic theme (P0)

- **Behavior**: The UI uses the Calendly classic visual language: colors, type scale, radii, shadows and component
  shapes listed in ARCHITECTURE section "Design tokens" (taken verbatim from `calendly-ux-walkthrough.md` section 1).
  Key facts: text `#0A2540`, secondary text `#476788`, hairlines `#D4E0ED`, canvas `#FAFAFA`, primary `#006BFF`
  (hover `#004EBA`, pressed `#004796`), action text `#004EBA`, soft action fill `#F4F8FF`, destructive `#D53C00`;
  pill buttons (radius 9999px, min height 40px, weight 600); 8px card and input radius; Figtree font as the Proxima
  Nova substitute.
- **Behavior (public pages)**: every blue on public pages (available days, selected day, buttons, links, time slot
  borders) reads from a CSS variable `--primary-color` so branding colors (BR-07) and embed `primary_color` (BK-26)
  apply everywhere.
- **Acceptance**: A visual comparison of `/{slug}` and `/{slug}/{eventSlug}` against `.reference/profile.png` and
  `.reference/booking-30min.png` matches layout, colors and typography within reasonable tolerance (card widths about
  1060px and 800px, divider colors, circle sizes 44px, 26px event color circles on the landing page).

### GEN-04 Responsive layouts and breakpoints (P0)

- **Behavior**: All pages work from 320px to 2560px wide with 16px minimum side gutters and no horizontal page scroll
  (wide grids scroll inside their own container). Booking page modes: desktop (1000px and up) two or three columns;
  tablet (600 to 999px) details panel on top, calendar below, times below the calendar with a sticky date subtitle;
  phone (below 600px) full-bleed card with no border or radius, separate times view with a back arrow. Dashboard:
  below 768px the sidebar becomes a drawer opened from a 56px top bar with a hamburger. Inputs use at least 16px font
  on phones (avoid iOS zoom). Minimum tap target 40px.
- **Acceptance**: Playwright screenshots at 390x844, 768x1024 and 1440x900 show no horizontal scroll on every public
  page and every dashboard page.

### GEN-05 Accessibility (P0)

- **Behavior**: WCAG 2.2 AA. All interactive elements are reachable and operable by keyboard with visible focus rings
  (2px `#006BFF`, offset 2px). Booking calendar day buttons have aria-labels "Monday, October 12 - Times available" or
  "Sunday, October 4 - No times available", the table has `aria-label="Select a Day"`, today has
  `aria-current="date"`, month arrows have aria-labels "Go to previous month" and "Go to next month", and a live region
  announces "October is now displayed". Dialogs trap focus and restore it. Color is never the only signal. Respect
  `prefers-reduced-motion`. Form errors are linked with `aria-describedby` and announced.
- **Acceptance**: axe-core finds no serious or critical violations on the landing page, booking page (all steps),
  confirmation, cancel, reschedule, poll voting page, routing form page, and the main dashboard pages.

### GEN-06 Time zones, DST and time formats (P0)

- **Behavior**: All instants are stored in UTC (timestamptz). Times of day are stored as minutes from local midnight
  (0 to 1440). Every schedule has exactly one IANA zone. Display zones: the viewer's chosen or detected zone on public
  pages, the user's profile zone in the dashboard unless a page offers a zone switch. DST transitions are handled by
  wall-clock math in the schedule zone (never adding 24 hours to step days). Nonexistent local times (spring forward)
  shift forward; ambiguous local times (fall back) take the earlier instant unless a UI explicitly offers both.
- **Time formats**: public pages default to 12h ("9:00am", lowercase, no space) unless the browser locale prefers 24h
  ("09:00"); the time zone dropdown has an "am/pm | 24h" toggle remembered in localStorage. Dashboard uses the user's
  `time_format` setting (12h default). Dates use `%A, %B %-d, %Y`, `%A, %B %-d`, `%b %-d` patterns localized via Intl.
- **Invitee zone and format persistence**: every booking stores `invitee.timezone` (the zone the times were displayed
  in: the locked zone for locked-zone events, otherwise the zone selected on the page), `invitee.detected_timezone`
  (the browser zone, kept for reference) and `invitee.time_format` (the "am/pm | 24h" choice on the booking page). The
  confirmation page, invitee emails, reminders and ICS descriptions render times in `invitee.timezone` with
  `invitee.time_format` (our choice).
- **Zone list**: a curated list with friendly names in Calendly style ("Eastern Time - US & Canada", "Pacific Time -
  US & Canada", "Central European Time", ...) grouped as US/CANADA, AMERICA, AFRICA, ASIA, ATLANTIC, AUSTRALIA,
  EUROPE, PACIFIC, UTC, each with current local time. Any valid IANA zone (including legacy aliases such as
  `Asia/Calcutta`) is accepted and stored as given.
- **Acceptance**: unit tests cover America/New_York and Europe/Berlin DST start and end weeks for slot generation,
  schedule display and ICS output; a 9:00 to 17:00 schedule produces 9:00 local slots on both sides of a DST change. A
  booking of a locked Europe/Berlin event from a browser in America/New_York with "24h" selected stores
  `timezone = Europe/Berlin`, `detected_timezone = America/New_York`, `time_format = 24h`, and the invitee confirmation
  email shows "14:00" in Berlin time.

### GEN-07 Performance budgets (P1)

- **Behavior**: Booking page first contentful paint under 1.5s on a warm serverless instance; month of slots returned
  in under 800ms p95 with cached calendar data and under 2.5s p95 with a cold external calendar fetch; booking
  submission completes (response sent) in under 2s p95 excluding payment redirects. Dashboard lists paginate (25 to 50
  items). No client bundle for public pages above 250KB gzipped JS.
- **Acceptance**: a benchmark test of the slot engine computes 31 days with 15-minute increments for a 3-host round
  robin with 500 busy intervals per host in under 150ms on Node 22. A bundle-size check (run in CI after `next build`)
  fails when the gzipped client JS loaded by `/[handle]/[eventSlug]` exceeds 250KB. An integration test calls the slots
  endpoint 50 times for a seeded month with cached calendar data and asserts p95 under 800ms, and a booking submission
  test asserts p95 under 2s with stub providers.

### GEN-08 Security baseline (P0)

- **Behavior**: Sessions in httpOnly, Secure (production), SameSite=Lax cookies; CSRF protection for all mutations
  (Server Actions origin check plus same-origin check on cookie-authenticated route handlers); OAuth tokens, CalDAV
  passwords, webhook signing keys and 2FA secrets encrypted at rest with AES-256-GCM; passwords hashed with scrypt;
  all tokens in URLs or emails are random with at least 128 bits and stored only as SHA-256 hashes, except invitee and
  scheduled event UUIDs which act as capability identifiers (Calendly parity); rate limits on every public write
  (ARCHITECTURE "Rate limiting"); HTML from users is sanitized on save and on render.
- **SSRF**: every server-side fetch of a user-supplied URL (ICS feeds, CalDAV servers including discovery redirects,
  webhook callbacks, the Calendly import API base is fixed and exempt) goes through one `safeFetch`: https only
  (`webcal://` rewritten); DNS resolved and private, loopback, link-local, CGNAT, unique-local, multicast and cloud
  metadata addresses rejected (IPv4, IPv6 and IPv4-mapped IPv6 forms), validated again at connect time; redirects
  followed manually (at most 5 hops) with every hop re-validated; responses capped at 5MB; 15 second timeout.
  Self-hosted instances may allow listed private hosts (for a LAN Nextcloud) via an env allowlist that is ignored on
  Vercel.
- **Cross-tenant references**: foreign keys do not prove ownership. Every write that references another record
  (schedules, hosts, calendars, conferencing connections, contacts, coupons, groups, event types, poll co-hosts)
  verifies that the record belongs to the actor or to the actor's organization (ARCHITECTURE "Authorization"); busy
  lookups for other users are limited to members of the same organization and event titles are returned only to the
  calendar owner.
- **Links in emails never change state on GET**: unsubscribe, email verification, email change confirmation and
  similar links open a page with a button; the change happens on POST (mail link scanners prefetch GETs). One-click
  unsubscribe uses `List-Unsubscribe` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Single-use tokens are
  consumed only by the POST.
- **Verification codes** (6 digits) are stored as HMAC-SHA256 with a server secret (never plain SHA-256, which is
  brute-forced offline) and expire per their requirement.
- **Cookies**: first-party cookies use `SameSite=Lax`. Cookies that must work inside third-party embeds ("Remember this
  device" for booking verification, poll edit cookies) are set with `SameSite=None; Secure; Partitioned` when the page
  runs in embed mode, with a localStorage fallback when the browser blocks them (our choice).
- **Headers**: dashboard and auth pages send `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Only pages meant to be
  embedded allow framing by any origin: landing pages, booking pages and their details form, `/d/*`, the booking
  confirmation `/booking/*`, poll voter pages `/p/*` and routing forms `/r/*`. Cancel, reschedule and reconfirm pages
  deny framing (our choice). All pages send `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Content-Type-Options: nosniff`.
- **Acceptance**: security tests prove that a cross-origin POST to a mutating route handler is rejected, that tokens
  are not stored in plaintext, that an ICS feed URL pointing at `http://127.0.0.1`, `https://[::ffff:127.0.0.1]/` or
  a public host that redirects to `169.254.169.254` is rejected, that a CalDAV discovery redirect to a private address
  is rejected, that saving an event type with another organization's schedule id returns 403, that a GET of an
  unsubscribe link changes nothing, and that `/reschedulings/{id}` sends `frame-ancestors 'none'`.

### GEN-09 Zero-config operation and setup page (P0)

- **Behavior**: The app runs with no environment variables at all. Locally (no `DATABASE_URL`) it uses an embedded
  PGlite database in `.data/pglite`. Missing `SESSION_SECRET` and `ENCRYPTION_KEY` are generated once and stored in the
  database (`app_secrets`). Optional integrations stay hidden or show "Not configured" until their env vars exist.
  On Vercel (`VERCEL=1`) without a database URL, every page renders the **Setup page** and API routes return 503 JSON
  `{ "error": "setup_required" }`.
- **Setup page** content: title "Finish setting up {AppName}", explanation that a Postgres database is required,
  numbered steps "Open your project in Vercel", "Go to the Storage tab", "Create a Neon Postgres database and connect it
  to this project (all environments)", "Redeploy"; a status checklist of detected configuration (database, session
  secret, encryption key, Google, Microsoft, Zoom, email provider, SMS, Stripe, cron secret) with green checks or gray
  "Not configured"; the exact OAuth redirect URIs to register (`{APP_URL}/api/auth/google/callback`,
  `{APP_URL}/api/auth/microsoft/callback`, `{APP_URL}/api/integrations/zoom/callback`), and links to the optional
  variables list in the README.
- **Acceptance**: with `VERCEL=1` and no DB URL, `GET /` and `GET /julianjoseph` render the setup page with status 503
  and `GET /api/health` returns `{ ok: false, setupRequired: true }`. With no env at all locally, `npm run dev`
  starts, the first signup works, and a restart keeps the same generated secrets.

### GEN-10 Invitee-facing localization (P2)

- **Behavior**: Each event type (and poll, routing form) has an invitee language: English (default), French, Spanish,
  German, Dutch, Portuguese (Brazil), Italian, Ukrainian. It localizes all invitee-facing system copy: booking pages,
  confirmation, cancel, reschedule and reconfirm pages, poll and routing pages, invitee emails and ICS descriptions,
  the default workflow and basic notification templates (NT-09, NT-14: created in the event type's language when a
  basic notification is enabled or a template is used), the link labels appended to reminders ("Need to make changes
  to this event?", "Cancel", "Reschedule"), payment copy ("Continue to payment", the hold countdown, "Pay {amount} and
  schedule", the refund message), the friendly time zone names in the zone picker, and date and time formats.
  User-entered text (names, descriptions, questions, workflow bodies the host edited) is never translated. The
  dashboard is English only (app UI languages are P3).
- **Acceptance**: setting an event type to German renders "Wählen Sie Datum und Uhrzeit" style headings (from the
  German catalog), German weekday names and German zone names ("Mitteleuropäische Zeit"); enabling Email reminders on
  that event type creates a German default subject; missing keys fall back to English.

### GEN-11 Copy style rules (P0)

- **Behavior**: Never use the em dash or en dash characters in any user-facing copy, documentation or code comment.
  Use commas, colons, parentheses or hyphens. Sentence case for buttons and headings except Calendly verbatim strings
  that use title case ("Select a Date & Time", "Schedule Event", "Enter Details", "Cancel Event"). Keep Calendly's exact
  strings where this spec quotes them.
- **Acceptance**: a CI test greps `src/`, `docs/`, `public/` and `e2e/` for U+2014 and U+2013 and fails if any are
  found.

### GEN-12 Error, empty and loading states (P0)

- **Behavior**: Every list has an empty state (illustration, heading, one sentence, primary action). Every async view
  has a skeleton (gray rounded bars) or spinner. Every mutation shows a pending state (button spinner, disabled) and a
  toast on success ("Changes saved", "Link copied") or an inline error. Global 404 page: heading "Page not found", text
  "This link isn't valid. Check the URL or go back to the homepage." with a "Go to homepage" button (our choice).
  Global error page: "Something went wrong" with "Try again". Server errors never leak stack traces to users.
- **Acceptance**: each dashboard list page renders its empty state when the user has no data; each form shows field
  errors returned by the server.

### GEN-13 Search engines and privacy headers (P1)

- **Behavior**: `robots.txt` allows `/`, the marketing pages and landing pages; disallows `/app`, `/api`, `/d/`,
  `/p/`, `/r/`, `/booking`, `/cancellations`, `/reschedulings`, `/reconfirm`. Secret event types, single-use links,
  one-off pages, polls, routing forms, confirmation pages and all invitee-token pages send `noindex, nofollow`.
  Landing and public booking pages have Open Graph tags (title "{Host name} - {Event name}", host avatar, no private
  data).
- **Acceptance**: secret event type pages and `/p/*` include a `robots` meta with `noindex`.

### GEN-14 Cookie consent and "Cookie settings" (P1)

- **Behavior**: Public pages show "Cookie settings" (and "Privacy Policy" on booking pages) links at the bottom of the
  left panel or card (observed). The app itself sets only essential cookies (session, short-lived OAuth state cookies,
  poll edit tokens, booking "remember this device", consent choice, 12h/24h preference). A consent banner appears on public pages only when a non-essential tracker is
  configured by the host (GA4 or Meta Pixel, AN-12) (our choice); trackers load only after consent. "Cookie settings"
  opens a modal with categories (Strictly necessary: always on; Analytics; Marketing) and buttons "Accept all", "Reject
  non-essential", "Confirm my choices". `hide_gdpr_banner=1` hides the banner in embeds (the host's site handles
  consent). The privacy policy link points to the host-configured URL or to `/privacy`.
- **Acceptance**: with GA4 configured, no GA script loads before "Accept all"; after acceptance the script loads and
  the choice persists for 365 days.

### GEN-15 Email and SMS delivery fallback (P0)

- **Behavior**: Emails send through Resend when `RESEND_API_KEY` is set, otherwise SMTP when `SMTP_HOST` is set,
  otherwise they are stored in the database outbox with status "stored" and are viewable in Admin > Outbox
  (ADM-04). The same applies to SMS (Twilio when `TWILIO_*` is set, else stored). Every message is recorded in the
  outbox or SMS log with status, provider id, error and related records, regardless of provider.
- **Acceptance**: with no email provider, booking a meeting creates outbox rows for the invitee confirmation and the
  host notification, each with an `.ics` attachment, visible in Admin > Outbox with rendered HTML preview.

### GEN-16 Background processing guarantees (P0)

- **Behavior**: All side effects of user actions (emails, SMS, calendar writes, conferencing, webhooks, workflows,
  reminders, holds) run as durable jobs in the database. Jobs run (a) immediately after the triggering request using
  `after()`, (b) on every `/api/cron` call, (c) opportunistically after dashboard and public page requests (throttled
  to once per minute per instance), and (d) every 30 seconds via an in-process poller when self-hosted (not on Vercel,
  and never when `E2E_TEST_MODE=1`). `/api/cron` triggers: the bundled GitHub Actions workflow every 10 minutes (GitHub schedules often
  run 10 to 60 minutes late and are disabled after 60 days without repository activity; on a private repository on the
  free plan this schedule uses about 4,320 Actions minutes a month against 2,000 included, so the README explains
  changing it to every 30 minutes or using a public repository), the daily Vercel Cron (Hobby limit), and, recommended
  for timely short reminders, a free external pinger every 5 minutes (cron-job.org or Upstash QStash).
  Jobs are idempotent, retried with exponential backoff (30s doubling, max 6h, 8 attempts), and visible in Admin > Jobs.
- **Edge cases**: Without a frequent trigger, timed jobs (reminders) may run late; the Admin overview warns when the
  last cron tick is older than 15 minutes ("Reminders may be sent late. Set up a pinger that calls /api/cron every 5
  minutes.") with setup instructions, and the workflow builder shows a hint on timings under 30 minutes when no tick
  arrived in the last 15 minutes (NT-11). Business-time comparisons in jobs (due time, leases, expiry) use the app clock
  (`now()`), never the database clock, so tests with a fake time behave like production.
- **Retention**: `system.cleanup` (daily) deletes succeeded and canceled jobs after 14 days and dead jobs after 90
  days, `domain_events` and webhook deliveries after 30 days, cached external events and sync windows not refreshed for
  7 days, expired sessions, rate limit buckets older than 2 days, and outbox HTML and text bodies after 30 days
  (metadata kept until the 90 day outbox purge, ADM-04). This keeps a Neon Free database (0.5 GB) small.
- **Acceptance**: an integration test that kills a job handler mid-way (throws) shows the job retried and completed;
  the same job enqueued twice with the same idempotency key runs once; with the fake clock advanced 15 days, cleanup
  removes a succeeded job and keeps a pending one.

### GEN-17 Auditability (P2)

- **Behavior**: Security and configuration actions write an audit log entry: login, logout, failed login, password
  change, 2FA change, login method change, token create or revoke, webhook create or delete, role change, invitation,
  user removal, data deletion, event type delete, calendar connect or disconnect, integration connect or disconnect,
  org settings change, slug change. Entries hold actor, action, namespace, target, details, IP, user agent, time.
- **Acceptance**: changing a member's role produces an entry visible in Admin > Activity log (ADM-07).

### GEN-18 Non-goals and deferred items (P3)

These Calendly features need third-party infrastructure or partnerships and are deferred (P3, design must not block
them): AI Notetaker and meeting recaps, "Callie" email assistant, browser extensions and Gmail add-on, mobile apps,
Outlook desktop plug-in, Exchange EWS connections (Microsoft 365 via Graph covers Exchange Online), Webex and GoTo
Meeting conferencing (VID-16), native CRM connectors (HubSpot, Salesforce, Dynamics, Marketo, Pardot, Mailchimp),
LinkedIn messaging, Slack app, SAML SSO and SCIM provisioning, meeting packages, invoices, payment links without a
meeting, sending emails from the host's own Gmail or Outlook mailbox (we send from our provider with Reply-To set to
the host). The REST API and webhooks (API domain) are the integration surface for these until built.

### GEN-19 Help menu (P3)

- **Behavior**: The sidebar "Help" item opens a flyout: "Help center" (links to `/help`, a static page of how-to
  articles written for this app), "Getting started" (reopens the onboarding wizard), "What's new" (static changelog),
  "Report a problem" (mailto the instance operator email, MK-02). No keyboard shortcut list is offered (our choice:
  the app defines no global shortcuts).
- **Acceptance**: every Help flyout item opens a working destination.

### GEN-20 Dashboard sidebar and header (P0)

- **Behavior**: Every `/app` page uses one shell. Left sidebar (240px, white, right border `#D4E0ED`): logo at the top,
  a full-width "+ Create" pill (opens the ET-02 menu), then nav items with lucide icons in this order: Scheduling
  (`/app/scheduling`), Meetings (`/app/meetings`), Availability (`/app/availability`), Contacts (`/app/contacts`),
  Workflows (`/app/workflows`), Integrations & apps (`/app/integrations`), Routing (`/app/routing`); a bottom group:
  Analytics (`/app/analytics`), Admin center (`/app/admin`, owners, admins and instance admins only), Help (flyout,
  GEN-19). The active item (current path or any sub-path) has a `#F4F8FF` pill background and `#004EBA` text and icon
  with `aria-current="page"`. A collapse button shrinks the sidebar to a 72px icon rail with tooltips and a
  "+" create button; the state persists per user (`users.preferences`). Below 768px the sidebar becomes a drawer opened
  from a 56px top bar with a hamburger (GEN-04). Header (right side): "Invite user" pill for owners and admins (opens
  TM-02), the account menu (BR-15), and dismissible banners stacked above the page content (calendar problem CAL-15,
  verify email AU-08, time zone mismatch GEN-23, cron warning for admins GEN-16).
- **Acceptance**: every nav item navigates and shows the active state on its sub-pages (`/app/workflows/new` keeps
  Workflows active); a plain user does not see Admin center or "Invite user"; collapsing persists after reload; at
  390px the drawer opens, traps focus and closes on Escape; keyboard Tab order follows the visual order.

### GEN-21 Report abuse (P2)

- **Behavior**: Public pages (landing, booking, confirmation, poll and routing pages) show a "Report abuse" link in the
  footer links next to "Cookie settings" and "Privacy Policy". It opens a `mailto:` to the instance operator email
  (MK-02 operator setting, defaulting to the first instance admin) with subject "Report abuse: {page URL}" and a body
  template asking what happened (our choice: no form, no stored report).
- **Acceptance**: the link exists on `/{slug}/{eventSlug}` and `/p/{slug}` and its href contains the operator email
  and the URL-encoded page URL.

### GEN-22 Appearance: Light, Dark, System (P3)

- **Behavior**: Settings > Profile "Appearance" with Light (default), Dark and System (follows
  `prefers-color-scheme`), stored in `users.preferences.theme`, applied to the dashboard by setting `data-theme` on
  `<html>` before paint (no flash). Dark mode redefines the design tokens (ARCHITECTURE "Design tokens"). Public pages
  stay in the light classic theme unless the host's booking page colors say otherwise (Calendly parity: invitees see
  the host's branding).
- **Acceptance**: choosing Dark persists across reloads and every dashboard page passes axe color contrast in dark
  mode.

### GEN-23 Time zone mismatch prompt (P2, our choice)

- **Behavior**: When the browser zone differs from the user's profile zone (compared by UTC offset now and in 6
  months, so aliases do not trigger it), the dashboard shows a dismissible banner "Your computer's time zone
  ({browser zone friendly name}) is different from your profile's ({profile zone}). Update your profile?" with
  "Update time zone" (sets the profile zone, not schedule zones) and "Dismiss" (hidden for that browser zone for 30
  days, stored in localStorage).
- **Acceptance**: with Playwright `timezoneId: Asia/Kolkata` and a profile in America/New_York the banner shows;
  "Update time zone" changes the profile zone and the banner disappears.

---

## 2. AU: Authentication, accounts and onboarding

### AU-01 Signup with email and password (P0)

- **Behavior**: `/signup` is a two-column page: left an illustration panel (hidden below 768px), right a form card.
  Title "Create a free account"; subtitle "No credit card required." (our choice, drops "Upgrade anytime."); input
  "Enter your email"; primary full-width button "Continue with email"; divider with "or"; full-width "Continue with
  Google" and "Continue with Microsoft" buttons (only when configured, AU-02, AU-03); helper "Continue with Google or
  Microsoft to connect your calendar."; footer "Already have an account? Log In". Step 2 (same page, animated): "Enter
  your full name", "Choose a password" (at least 8 characters, at least one letter and one number; hint shown below),
  terms microcopy "By creating an account, you agree to the Terms and Privacy Policy", button "Sign up".
- **On success**: creates user, organization (name "{Name}'s workspace" (our choice)), owner membership (if new
  org), handle (slug derived from the name, de-duplicated with numeric suffixes), default schedule and default event
  type (AU-13), a session, and redirects to `/onboarding`. Sends a welcome and verification email (AU-08).
- **Edge cases**: email already registered shows "An account with this email already exists. Log in instead." with a
  link; signups disabled by policy (AU-11) shows "Sign ups are closed. Ask an admin for an invitation." Email is
  normalized (trim, lowercase) for uniqueness; display keeps the original.
- **Acceptance**: an e2e test signs up, lands on onboarding, completes it, and sees the Scheduling page with "30 Minute
  Meeting".

### AU-02 Sign in with Google (P0)

- **Behavior**: When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, "Continue with Google" starts OAuth
  (PKCE S256, state cookie, 10 minute expiry) with scopes `openid email profile
  https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly`, `access_type=offline`,
  `prompt=consent`, `include_granted_scopes=true`. The callback (`/api/auth/google/callback`) finds an existing OAuth
  account (login), or a user with the same verified email (link and login), or creates a new user (if signup policy
  allows) with name and avatar from Google and `email_verified_at` set. In every case it also creates or refreshes a
  Google calendar connection for that account (CAL-17). New users go to `/onboarding` with the calendar step marked
  done.
- **Edge cases**: user denies consent returns to login with "Google sign in was canceled."; missing refresh token on a
  re-consent keeps the stored one; Google account email not verified is rejected ("Your Google email isn't verified.").
- **Acceptance**: with mocked Google endpoints, the callback creates exactly one user, one oauth account, one calendar
  connection and one session; running it again logs in without duplicates.

### AU-03 Sign in with Microsoft (P0)

- **Behavior**: Same as AU-02 using Microsoft identity platform (tenant from `MICROSOFT_TENANT`, default `common`),
  scopes `openid profile email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite`. Creates or
  refreshes an Outlook calendar connection. Refresh tokens rotate; always persist the newest.
- **Acceptance**: mocked flow behaves like AU-02; the `iss` claim is not validated against a fixed string (tenant
  templated issuer).

### AU-04 Login page (P0)

- **Behavior**: `/login` card: title "Log in to your account"; "Continue with Google", "Continue with Microsoft",
  divider "or", "Email address" + "Continue", then password step with "Forgot password?" link and "Log In" button;
  footer "Don't have an account? Sign up for free" (hidden when signups are closed). `?next=` returns to the original
  page after login (only same-site relative paths). Wrong credentials: "Incorrect email or password." (no account
  enumeration). Users with 2FA go to `/login/two-factor` (AU-09).
- **Acceptance**: e2e logs in with the seeded owner and lands on `/app/scheduling`; `?next=/app/meetings` lands there.

### AU-05 Logout (P0)

- **Behavior**: Account menu "Log out" revokes the current session server-side, clears the cookie, redirects to
  `/login`. Settings > Login lists active sessions with "Log out of all other sessions".
- **Acceptance**: after logout, reusing the old cookie value is rejected.

### AU-06 Sessions (P0)

- **Behavior**: Random 32-byte token in cookie `sid` (httpOnly, SameSite=Lax, Secure in production, path `/`);
  database stores SHA-256 of the token, user, created, last seen, expires (30 days, sliding: extended when older than 1
  day), IP and user agent. Session lookup happens once per request. Revoked or expired sessions redirect to login for
  dashboard pages and return 401 for route handlers.
- **Acceptance**: a session last seen 31 days ago is rejected; a session used today has its expiry extended.

### AU-07 Password reset (P0)

- **Behavior**: "Forgot password?" asks for email, always responds "If an account exists for {email}, we sent a link
  to reset your password." Sends a link `/reset-password/{token}` valid for 60 minutes, single use. The page asks for a
  new password twice, then logs the user in and revokes other sessions. Opening the link (GET) never consumes the
  token; only submitting the new password does (GEN-08). Accounts without a password (OAuth only) can set one this way.
- **Acceptance**: token reuse fails with "This link has expired. Request a new one."

### AU-08 Email verification (P1)

- **Behavior**: Email signups receive "Verify your email" with a link `/verify-email/{token}` (24 hours). The link opens
  a page with the email address and a "Verify email" button; verification happens on POST (GEN-08). Unverified
  users can use the app; a dismissible banner "Please verify your email address. Resend email" shows in the dashboard.
  Unverified accounts cannot send workflow emails to "other" recipients or create webhooks (our choice, abuse control).
- **Acceptance**: clicking the link sets `email_verified_at` and removes the banner.

### AU-09 Two-factor authentication (P2)

- **Behavior**: Settings > Login > "Two-factor authentication": enable with an authenticator app (TOTP, RFC 6238,
  SHA-1, 6 digits, 30s, accepts one step of drift). Setup shows a QR code and the base32 secret, asks for a code to
  confirm, then shows 10 one-time recovery codes ("Download" and "Copy"). Login asks for the 6-digit code on
  `/login/two-factor` with "Use a recovery code instead". Disabling requires the password (or a fresh OAuth login) and
  a current code. OAuth logins also require the second factor when enabled (our choice).
- **Acceptance**: integration test enrolls, logs out, logs in with a valid TOTP, fails with an invalid one, and logs in
  once with a recovery code that then stops working.

### AU-10 Login methods, email and password changes (P1)

- **Behavior**: Settings > Login shows login email ("Change email": sends a confirmation link to the new address; the
  change applies after clicking "Confirm new email" on the page the link opens), password ("Change password": current and new; or "Set password" for OAuth-only
  users), connected sign-in methods (Google, Microsoft) with "Connect" and "Disconnect" (cannot disconnect the last
  login method). Switching login method sends a 6-digit code to the current email for confirmation (Calendly parity).
  Calendar connections are managed separately (CAL-16).
- **Acceptance**: a user with password and Google can disconnect Google; a Google-only user cannot until a password is
  set.

### AU-11 Signup policy (P0)

- **Behavior**: Instance setting "Who can sign up" with options: "Only people I invite" (`invite_only`, default after
  the first account exists) (our choice), "Anyone" (`open`, each new signup creates their own organization), "Anyone
  with an email at these domains" (`domains`, joins the first organization as User). The very first signup on a fresh
  instance is always allowed and becomes the instance admin and org owner. Env `SIGNUP_POLICY` overrides the setting.
  Invited people can always sign up through their invitation link (TM-03), with email and password or with Google or
  Microsoft (OAuth intent `accept_invitation`, which requires the provider email to match the invitation email and
  creates the account directly in the inviting organization with the invited role, regardless of the policy). Other
  OAuth sign-ins for an unknown email follow the policy.
- **Acceptance**: with `invite_only`, `/signup` shows the closed message and the Google callback for a new email shows
  "Sign ups are closed. Ask an admin for an invitation."; with `invite_only`, accepting an invitation with Google
  (matching email) creates the user as a member of the inviting org, not a new org.

### AU-12 Onboarding wizard (P0)

- **Behavior**: `/onboarding` is a full-screen wizard (no sidebar): centered white card (max width 640px) on
  `#FAFAFA`, logo top-left, segmented blue progress bar ("Step 2 of 4"), "Back" bottom-left, primary "Continue"
  bottom-right, "Set up later" text link on optional steps. Steps:
  1. **Choose your URL**: title "Create your {AppName} URL", copy "Choose a URL that describes you or your business in
     a concise way. Make it short and easy to remember so you can share links with ease.", input with static prefix
     `{host}/` prefilled from the name, live validation (green "Available" or red "This URL is taken"), plus "Time zone"
     dropdown auto-detected from the browser.
  2. **Connect your calendar**: title "Connect your calendar", copy "Connect your calendar to auto-check for busy times
     and add new events as they are scheduled.", provider tiles: Google Calendar ("Gmail, Google Workspace"), Office 365
     / Outlook.com, iCloud (CalDAV), Other CalDAV, ICS feed (read-only). Tiles for unconfigured OAuth providers are
     disabled with "Not configured on this server". If already connected via sign-in, shows the connection with a
     green check and the text "{AppName} will check {email} for conflicts" and "{AppName} will add events to
     {calendar}". Optional.
  3. **Set your availability**: title "Set your availability", copy "Let {AppName} know when you're typically available
     to accept meetings.", "Available hours" two time dropdowns (default "9:00 am" to "5:00 pm"), "Available days"
     seven toggle chips Sun to Sat with Mon to Fri preselected, footnote "Don't worry! You'll be able to further
     customize your availability later on." Writes the default schedule.
  4. **What will you use {AppName} for?**: single-select tiles Sales, Marketing, Customer success, Recruiting,
     Education, Consulting, Freelance, IT, Operations, Personal, Other; plus "On my own" or "With my team". Optional.
  Finish lands on `/app/scheduling`. Onboarding can be resumed from Help > Getting started; completion is stored.
- **Acceptance**: e2e completes all steps; slug and time zone persist; the default schedule matches the chosen hours.

### AU-13 Defaults created for a new user (P0)

- **Behavior**: On user creation: default schedule "Working hours" (Mon to Fri 9:00 to 17:00 in the detected zone, or
  UTC when unknown), `is_default = true`; default one-on-one event type "30 Minute Meeting", slug `30min`, 30
  minutes, color `#8247F5`, location empty (or Google Meet when signing up with Google, Microsoft Teams with a work
  Microsoft account (our choice)), using the default schedule, with all event type defaults from ET-33.
- **Acceptance**: a fresh signup has exactly one schedule and one event type with those values.

### AU-14 Auth rate limiting and lockout (P0)

- **Behavior**: Login attempts: 10 per email per 15 minutes and 50 per IP per 15 minutes; then "Too many attempts.
  Try again in {minutes} minutes." Password reset and verification emails: 5 per email per hour. Signup: 20 per IP per
  hour. TOTP attempts: 5 per session per 5 minutes.
- **Acceptance**: the 11th failed login for an email within 15 minutes is rejected without checking the password.

### AU-15 Account deletion (P2)

- **Behavior**: Settings > Profile > "Delete account" (danger zone). Owners of an org with other members must
  transfer ownership first (dialog lists admins to choose). Confirmation requires typing the account email. Deleting:
  cancels all future meetings where the user is the only host (invitees notified with the standard cancellation email,
  reason "The host's account was deleted"), removes the user from multi-host event types (round robin pools continue
  with remaining hosts; collective events with no remaining host are turned off), disconnects calendars and revokes
  provider tokens, deletes personal event types, schedules, workflows, contacts, tokens, webhooks, and anonymizes past
  invitee data that belongs only to this user. An owner deleting a single-member org deletes the org. Meeting
  cancellations run as a background job (`lifecycle.cancel_user_meetings`), never inside the request. The deleted
  user's email and slug are released immediately (unique indexes ignore deleted rows).
- **Delete and disband** (owners of an org with other members, alternative to transferring ownership): the dialog
  offers "Delete my account and disband the organization" with the warning "Every member keeps their account in a new
  personal workspace. Team and shared event types are deleted; their upcoming meetings stay scheduled with their
  hosts." Disbanding moves each member into their own new organization (as owner), deletes teams, groups, team and
  shared event types (soft), routing forms and org webhooks, emails every member "{Org name} was disbanded", then
  deletes the owner's account as above (our choice).
- **Acceptance**: after deletion the slug becomes available and the user's landing page returns 404; signing up again
  with the same email works; disbanding an org with two members leaves both members in separate new orgs with their
  personal event types intact.

---

## 3. ET: Event types

### ET-01 Event type kinds and model (P0)

- **Behavior**: Event types are modeled exactly like Calendly's API: `kind` (`solo` | `group`), `pooling_type`
  (`null` | `collective` | `round_robin` | `multi_pool`), `type` (`standard` | `adhoc`), `booking_method`
  (`instant` | `poll`), plus our `scope` (`personal` | `shared` | `team`). UI kinds:

  | UI kind | kind | pooling_type | Hosts : invitees | Allowed scopes |
  |---|---|---|---|---|
  | One-on-One | solo | null | 1 : 1 (+ up to 10 guests) | personal, team (single host) |
  | Group | group | null | 1 : many per slot (2 to 9,999 seats) | personal, team |
  | Collective | solo | collective | many (all attend) : 1 | shared, team |
  | Round Robin | solo | round_robin | 1 assigned from a pool : 1 | shared, team |
  | Collective or Round Robin with pools | solo | multi_pool | required co-hosts + 1 per pool : 1 | shared, team |

  One-off meetings (`type = adhoc`) and polls (`booking_method = poll`) are event type rows too but never appear in
  event type lists (OO, MP domains). Kind and pooling type cannot change after creation (Calendly parity); to switch,
  duplicate into a new kind is not offered, create a new one.
- **Acceptance**: the API serializer (API-03) returns these fields with Calendly's names and values for every kind.

### ET-02 Create menu (P0)

- **Behavior**: "+ Create" (sidebar and Scheduling header) opens a 360px popover with two groups:
  - **Event type**: "One-on-one" ("1 host -> 1 invitee", "Good for coffee chats, 1:1 interviews, etc."), "Group" ("1
    host -> Multiple invitees", "Webinars, online classes, etc."), "Round robin" ("Rotating hosts -> 1 invitee",
    "Distribute meetings between team members"), "Collective" ("Multiple hosts -> 1 invitee", "Panel interviews, group
    sales calls, etc."). Arrows render as an arrow icon.
  - **More ways to meet**: "One-off meeting" ("Offer time outside your normal schedule"), "Meeting poll" ("Let invitees
    vote on a time to meet").
  Round robin and Collective first ask "Where should this event type live?" with options "Shared (no team page)" and
  each team the user can manage (our choice); with no teams and no other org members, a notice explains "Invite people
  to your workspace to create multi-host event types." with an "Invite users" button.
- **Acceptance**: each item opens the right creation flow; the editor opens with defaults from ET-33.

### ET-03 Scheduling page: event types tab (P0)

- **Behavior**: `/app/scheduling` with h1 "Scheduling", "+ Create" pill at right, tabs "Event types" (this page),
  "Single-use links" (`/app/scheduling/single-use-links`), "Meeting polls" (`/app/scheduling/meeting-polls`). Toolbar:
  "My {AppName}" dropdown (avatar + label + chevron) to switch the view to a team page or, for admins, another user;
  search "Search event types" (name or slug); filter menu (host, owner, permissions). Personal section header: avatar
  (40px), user name (600), public link `{host}/{slug}` as a blue link with copy, and "View landing page" (external icon).
  Sections: "Personal event types", "Shared", one per team "{Team name}" (only events the user hosts or manages).
- **Acceptance**: search filters cards by name or slug as you type (debounced 150ms); clearing restores order.

### ET-04 Event type card (P0)

- **Behavior**: Row-card layout (full width, white, 1px `#D4E0ED`, 8px radius, 6px left strip in the event color):
  leading checkbox (bulk select), event name (16 to 18px bold), slashed-eye icon when secret, gray "Off" badge and 50%
  text opacity when inactive, meta line "30 min, Google Meet, One-on-One" (durations: "15 min / 30 min" when multiple,
  location summary, kind label), availability summary "Weekdays, 9 am - 5 pm" or "Hours vary", optional "View booking
  page" link; right side "Copy link" secondary pill (changes to "Copied" for 2s and toasts "Link copied"), share icon
  (opens Share modal, OO-10), kebab menu (ET-05). Hover reveals quick actions in the card footer: "Book meeting"
  (OO-13), "Offer time slots" (OO-10), "Share availability" (OO-11), "Create single-use link" (OO-01). The whole card
  (outside buttons) opens the editor.
- **Acceptance**: "Copy link" puts `{APP_URL}/{slug}/{eventSlug}` on the clipboard (team events use the team slug,
  shared events `/d/{code}/{slug}`).

### ET-05 Card menu actions (P0)

- **Behavior**: Kebab items in this exact order: "View booking page", "Edit", "Edit permissions" (ET-31), "Add to
  website" (API-14), "Add internal note" or "Edit internal note" (ET-13), "Change invitee language" (ET-28), "Make
  secret" or "Make public" (ET-10), "Duplicate" (ET-11), "Event statistics" (team and shared only, ET-32), "Delete"
  (ET-12), and at the bottom an "On/Off" switch row (ET-09). Items the user lacks permission for are hidden.
- **Acceptance**: each menu item performs its action; keyboard navigation works in the menu.

### ET-06 Search, filter, sections (P1)

- **Behavior**: Filters: Host (multi-select org members), Owner, Permissions ("Can edit", "Can view"), Status (On,
  Off), Kind. Filter state in the URL query. "No event types match your search." when empty.
- **Acceptance**: filtering by Kind = Group shows only group event types.

### ET-07 Reorder (P1)

- **Behavior**: Drag and drop cards within a section (drag handle on hover at the left; keyboard: focus handle, Space
  to lift, arrows to move, Space to drop). Order persists as `position` (0-based) and is used on the landing page.
- **Acceptance**: after reordering, the landing page shows event types in the new order.

### ET-08 Bulk actions (P1)

- **Behavior**: Selecting one or more checkboxes shows a sticky bottom toolbar "{n} selected" with "Delete", "Toggle
  on/off" (turns all on if any is off, else all off), "Copy availability from" (team and shared types: pick a source
  event type, copies its availability settings), and "Clear" (x).
- **Acceptance**: bulk delete of 3 event types shows one confirmation and removes all 3.

### ET-09 On/Off (P0)

- **Behavior**: Off event types are hidden from landing pages and their booking links show "This event type is not
  currently available" (BK-23). Existing meetings are not affected. Single-use links of an off event type stop working
  until it is turned on.
- **Acceptance**: turning off makes `/{slug}/{eventSlug}` show the unavailable state with HTTP 200 and no slots API
  results.

### ET-10 Secret event types (P0)

- **Behavior**: Secret event types are hidden from the landing page but bookable by direct link. The card shows a
  slashed-eye icon. Secret pages carry `noindex`.
- **Acceptance**: a secret type does not appear on `/{slug}` but `/{slug}/{eventSlug}` works.

### ET-11 Duplicate (P1)

- **Behavior**: Creates a copy named "{Name} (copy)" with slug "{slug}-copy" (then "-copy-2"...), all settings,
  locations, questions, hosts, pools, custom schedule (copied as a new custom schedule), workflow assignments, coupons
  links; inactive is preserved; position right after the original. Booked meetings are not copied.
- **Acceptance**: the duplicate's editor shows identical settings and a unique slug.

### ET-12 Delete (P0)

- **Behavior**: Confirmation modal "Delete event type?" with body "Users will be unable to schedule further meetings
  with deleted event types. Meetings previously scheduled will not be affected." and buttons "Cancel" and red
  "Delete". Soft delete (`deleted_at`), so past meetings keep their event type reference; the slug becomes reusable.
  Pending single-use links of the type expire.
- **Acceptance**: after delete, the booking link returns 404 and existing meetings still show the event name.

### ET-13 Internal note (P2)

- **Behavior**: "Add internal note" opens a dialog with a textarea (max 2,000 chars) visible only to hosts and admins
  (card tooltip icon, editor header, meeting details). Never shown to invitees or in invitee emails.
- **Acceptance**: the note never appears in any public page HTML.

### ET-14 Event type editor layout and save model (P0)

- **Behavior**: `/app/event-types/{id}` (new: `/app/event-types/new?kind=one_on_one|group|collective|round_robin`
  plus `scope` and `team` params). Full-page view: left settings panel about 440px wide with its own scroll, right live
  preview on `#FAFAFA` (ET-29). Panel header: back arrow + "Event types", eyebrow with the kind label, kebab with
  event-level actions. Body: collapsible section rows (icon, bold title, one-line gray summary, chevron); several can be
  open. Primary sections always visible: Event name and color, Duration, Location, Availability, Host(s) (multi-host and
  group only). "More options" link reveals, in order: Description, Limits and buffers, Free/busy rules, Booking page
  options, Invitee form, Payment, Notifications and automations, Confirmation page. Sticky footer: "More options"
  (when hidden), "Preview" (narrow screens toggle preview), "Cancel", primary "Save changes".
- **Save model**: edits are local until "Save changes" (one validated server action that saves the whole event type
  atomically). Leaving with unsaved changes opens "You have unsaved changes" with "Discard changes" and "Keep editing".
  New event types are created on first save. Validation errors scroll to and expand the first failing section.
- **Acceptance**: editing name and duration then reloading without saving shows the old values; after "Save changes"
  the new values persist and a toast "Changes saved" appears.

### ET-15 Event name, color, slug (P0)

- **Behavior**: "Event name" required, 1 to 100 chars. Color dot opens the 10-swatch palette: Rambunctious red
  `#FF4F00`, Bubblegum pink `#FF758E`, Proudly pink `#E55CFF`, Princely plum `#8247F5`, Regal royal `#0099FF`, Spritely
  sky `#0AE8F0`, Loud lime `#17E885`, Lively lemon `#CCF000`, Yellin yellow `#F8E436`, Outrageous orange `#FFA600`,
  plus "Custom" hex input (`^#[0-9a-fA-F]{6}$`). The slug lives in Booking page options (ET-23) and is generated from
  the name on first save (`slugify`, de-duplicated with `-2`, `-3`).
- **Defaults**: new event colors rotate through the palette starting with Princely plum (our choice).
- **Acceptance**: invalid hex shows "Enter a valid color like #8247F5".

### ET-16 Duration and multiple durations (P0)

- **Behavior**: Duration select with presets 15, 30, 45, 60 min and "Custom" (number plus "min"/"hrs" unit), range 1
  to 720 minutes. "+ Add duration option" adds up to 4 unique options total (presets or custom); hovering an option
  shows "Make default"; the default is first in the invitee dropdown and is `duration`. Not available for Group events
  (hidden in the UI and rejected server-side, because a group slot is identified by event type and start only) and
  managed templates. Invitees switch duration in a dropdown replacing the "30 min" row on the booking page
  (BK-07); slots recompute.
- **Edge cases**: removing the default option makes the next one default. Duplicate values are rejected ("This
  duration is already an option").
- **Acceptance**: an event with options 30 and 60 (default 30) serializes `duration: 30, duration_options: [30, 60]`.

### ET-17 Locations (P0)

- **Behavior**: Location row of tiles: Zoom, Phone call, In-person, Google Meet, Microsoft Teams, Jitsi Meet, Custom,
  Ask invitee, and "+ More options" (Webex, GoTo shown as "Coming soon" (P3)). Each location kind is configured as in
  VID-01 to VID-10. "+ Add location" offers multiple options; the invitee chooses one on the form (BK-11); each has a
  position and can be removed or reordered. Video tools that are not connected show "Connect" linking to the
  integration page; Google Meet requires a Google destination calendar (VID-07 error text). Summary text: "No location
  given" or the kind names joined with commas.
- **Edge cases**: round robin hides "Phone call: I will call my invitee" (outbound) (Calendly parity, TM-11);
  multiple locations with round robin require at least one always-attending host (multi_pool) else per-host locations
  apply (TM-11). Group events support one location only (our choice: Calendly locks location after booking; allowing
  choice per invitee makes no sense for a shared slot).
- **Limits**: location text and additional info 255 chars each; up to 20 location options (our choice; observed owner
  uses 9).
- **Acceptance**: the owner's meal event (8 in-person options plus ask invitee) can be configured and renders 9 radio
  options on the form.

### ET-18 Description (P0)

- **Behavior**: Rich text editor (bold, italic, underline, bulleted list, numbered list, link) with placeholder "Write a
  summary and any details your invitee should know about the event." Max 10,000 characters of sanitized HTML; a plain
  text copy is stored too. Shown on the booking page left panel under the details, in confirmation emails as plain
  text when `{{event_description}}` is used.
- **Acceptance**: script tags and event handler attributes are stripped on save.

### ET-19 Availability section (P0)

- **Behavior**: Summary "Weekdays, 9 am - 5 pm" (or "Hours vary"). Date range sentence with inline dropdowns:
  "Invitees can schedule **60 days** into the future with at least **4 hours** notice". Range dropdown: "Number of days
  into the future" (number + "calendar days" | "week days" | "days with availability"), "Within a date range" (start and
  end date picker), "Indefinitely into the future". Notice dropdown: number + "minutes" | "hours" | "days". "Schedule:"
  dropdown lists the owner's schedules ("Working hours (default)", others) and "Custom schedule" (event-only hours,
  AV-11). An "Apply to/from event types" icon opens "Copy availability from..." or "Apply availability to..." with an
  event type checklist. Under it the weekly hours editor (shared component with AV-03), date-specific hours, and the
  schedule time zone (click to change). Multi-host types show "Set the same hours for all hosts" toggle versus per-host
  schedule selection (AV-12), and a hint "Showing times when all hosts are available" for collective.
- **Rules** are defined in SCH-02 to SCH-06.
- **Acceptance**: switching to "Custom schedule" copies the currently selected schedule's hours as the starting point
  and saves an event-specific schedule on "Save changes".

### ET-20 Hosts section (P1)

- **Behavior**: One-on-One personal: "You" (read only). Group: "Invitee limit" with "Max invitees in a spot" number (2
  to 9,999) and checkbox "Display remaining spots". Collective: host list with avatars, "+ Add co-host" (org members
  who accepted their invitation), remove (x), organizer radio ("Meeting organizer" used for conferencing, VID-13).
  Round robin: pool editor: hosts with priority control (5 levels: Lowest, Low, Medium (default), High, Highest,
  displayed as 1 to 5 stars), "+ Add host", assignment radio "Maximize for availability" (with helper "Book with any
  available host. Ties are broken by priority, then by who was booked least recently.") and "Optimize for equal
  distribution" (helper "Hides a host who is 3 or more meetings ahead until others catch up."), live fairness counts
  (TM-09), and "Rescheduling preferences" dropdown "Reassign host(s) through round robin" (default) or "Use same hosts as
  original meeting". "Schedule with multiple groups of hosts": "+ Add co-host" (always attend) and "Create rotating host
  pool" (name, members, distribution per pool) converts to `multi_pool`.
- **Edge cases**: removing all hosts is invalid ("Add at least one host"); adding or removing a pool member resets that
  pool's counts (TM-09); a host who leaves the org (or is removed, or deletes their account) is removed automatically
  and the owner is emailed. When that removal leaves the event type with no hosts, or leaves a pool with no members,
  the event type is turned off automatically and the owner's email says "{Event name} was turned off because it has no
  hosts left." (our choice of copy).
- **Acceptance**: a round robin with 3 hosts saves priorities and distribution and appears with correct values on
  reload.

### ET-21 Limits and buffers section (P0)

- **Behavior**: "Buffer time" ("+ Set buffer time" reveals "Before event" and "After event" selects: 0 min, 5, 10,
  15, 30, 45 min, 1 hr, 1.5 hrs, 2 hrs, 2.5 hrs, 3 hrs, plus "Custom" minutes 0 to 720), helper "Add time before or after
  booked events". "Meeting limits" ("+ Set limit" adds a row "Max number of meetings [n] per [day | week | month]";
  at most one row per period; n from 1 to 999). Semantics in SCH-07, SCH-08.
- **Acceptance**: setting 15/15 buffers serializes `buffer_before_minutes: 15, buffer_after_minutes: 15`.

### ET-22 Free/busy rules section (P2)

- **Behavior**: Title "Free/busy rules", subtitle "Choose what this meeting takes priority over". "+ Add meeting
  exception": select "Includes" or "Matches exactly", text input, Enter adds a chip. Below, a live preview "This will
  let invitees book over {n} upcoming meetings" listing up to 10 matched upcoming events (titles and dates) from
  conflict calendars and app meetings. Remove chips with x. Semantics in SCH-13.
- **Acceptance**: adding "Includes: Focus" lists external events whose titles contain "focus" (case-insensitive).

### ET-23 Booking page options section (P0)

- **Behavior**: "Event link": static prefix `{host}/{profileSlug}/` plus editable slug input (live uniqueness check,
  "This link is already used by another event type"); shared types show their `/d/{code}/` link read-only (slug part
  editable). "Start time increments": "Show available start times in increments of" select (5, 10, 15, 20, 30, 45, 60
  min, Custom 5 to 720) with example text "30 min: 9:00, 9:30, 10:00". "Align start times to" (extension): "The start of
  each available time block" (default, Calendly behavior) or "The hour" (SCH-10). "Time zone display": radio
  "Automatically detect and show the times in my invitee's time zone" (default, recommended) or "Lock the timezone
  (best for in-person events)" with a zone picker defaulting to the schedule zone.
- **Acceptance**: changing the slug and saving makes the old URL 404 and the new URL work.

### ET-24 Invitee form section and custom questions (P0)

- **Behavior**:
  - "Name": radio "Name" (single field, default) or "First Name, Last Name".
  - "Email": always required, not removable.
  - Checkbox "Allow invitees to add guests" (default on; hidden for Group, which never allows guests).
  - Checkbox "Autofill Invitee Name, Email, and Text Reminder Phone Number from prior bookings" (default off, BK-16).
  - Checkbox "Require email verification" (default off, BK-17) (also settable from Settings > Privacy defaults).
  - Checkbox "Ask invitees to subscribe to future emails" (marketing consent, default off, BK-14) (our choice of
    label, Calendly string "I'd like to subscribe to future emails.").
  - Questions list (drag to reorder), each with label, type badge, required asterisk, On/Off switch, edit, delete.
    New event types include one default question "Please share anything that will help prepare for our meeting."
    (Multiple lines, optional, on).
  - "+ Add new question" (max 10 questions including disabled ones): editor with "Question" (text, 1 to 500 chars; may
    contain a plain URL, rendered as a link), "Required" checkbox, "Answer type": One line, Multiple lines, Radio
    buttons, Checkboxes, Dropdown, Phone number; for choice types "Answer choices" (add or remove rows, 1 to 50
    choices, each 1 to 200 chars, unique) and "Include 'other' option" checkbox; "Status" On/Off; buttons "Cancel" and
    "Apply".
  - Locations needing invitee input (outbound call, ask invitee) and the SMS field (BK-13) are system fields placed by
    the form automatically, not questions.
- **Acceptance**: an event with 10 questions disables "+ Add new question" with tooltip "You can add up to 10
  questions".

### ET-25 Notifications and automations section (P1)

- **Behavior**: Rows with three-dots menus (Edit, On/Off):
  - "Calendar invitation" or "Email confirmation" (whichever applies per CAL-12; cannot be turned off). Edit opens
    the template editor (NT-08) with the banner action "Switch to email confirmation" or "Switch to calendar
    invitation" (disabled with explanation when not possible: group events, or no Google/Microsoft destination
    calendar), "Cancellation policy" textarea (CR-05), checkbox "Include cancel and reschedule links in email
    invitations and reminders (recommended)" (default on), checkbox "Include invitee answers in notifications"
    (default on), buttons "Cancel" and "Save and close".
  - "Email reminders", "Text reminders", "Email follow-up": basic notifications (NT-09), off by default; Edit opens a
    simplified workflow editor for that row (timing and message).
  - Section footer: list of workflows applied to this event type with toggles, "+ Add workflow" (pick existing) and
    "Create new workflow" (opens the builder with this event type preselected).
- **Backfill**: switching a basic notification on (or changing its timing) applies it to meetings that are already
  booked, exactly like a workflow gaining an event type (NT-15 backfill).
- **Acceptance**: turning on "Email reminders" with the default 24 hours before creates the basic workflow; newly
  booked meetings get a reminder job 24 hours before start, and an existing meeting 3 days away gets one too.

### ET-26 Confirmation page section (P1)

- **Behavior**: "After booking": radio "Display confirmation page" (default) or "Redirect to an external site" (URL
  input, https or http, plus checkbox "Pass event details to your redirected page"). Confirmation page links: built-in
  "Schedule another event" row with "Link name" (default "Schedule another event", 1 to 60 chars) and "Status" toggle
  (default on); "+ Add new link" rows (link name 1 to 60 chars, URL), up to 5 (our choice), removable.
- **Acceptance**: redirect with pass details appends the parameters listed in BK-21.

### ET-27 Payment section (P2)

- See PAY-02. The section renders "Connect Stripe" when payments are not configured.

### ET-28 Event language (P2)

- **Behavior**: "Change invitee language" dialog: select English, Français, Español, Deutsch, Nederlands, Português
  (Brasil), Italiano, Українська; "Save". Applies to the booking page and invitee notifications (GEN-10). Locked for
  group events after the first booking (ET-30).
- **Acceptance**: the API returns `locale` among `en, fr, es, de, nl, pt, it, uk`.

### ET-29 Live preview (P1)

- **Behavior**: The right side of the editor shows the actual booking page for the draft (not saved) settings,
  updating within 300ms of each edit: left panel (host, event name, duration or duration dropdown, location rows,
  description, price), calendar with real availability for saved availability settings (unsaved availability changes
  show a "Save to update availability" hint) (our choice). Banner on top: "This is a preview. To book an event, share
  the link with your invitees." and a "View booking page" link. Narrow screens toggle between editor and preview.
- **Acceptance**: typing a new event name updates the preview heading without saving.

### ET-30 Group event specifics (P1)

- **Behavior**: Group events: seats 2 to 9,999 (default 10 (our choice)); "Display remaining spots" shows "{n} spots
  left" under each time on the booking page; guests disabled; multiple durations disabled; notifications always use
  email confirmation (CAL-12); "Event is canceled" workflow trigger is not offered (NT-11); SMS actions limited to slots
  with 100 or fewer invitees. After the first active booking exists, language, location and duration are locked (gray
  box with "These settings can't be changed because invitees have already booked. Duplicate this event type to make
  changes." (our choice of copy)). Changing the seat limit affects future slots only; per-slot change in CR-20. Seats,
  holds and the host calendar event of a slot follow SCH-14 and CAL-11.
- **Acceptance**: with one booking on a group event, the duration field is disabled in the editor.

### ET-31 Event permissions (P2)

- **Behavior**: "Edit permissions" dialog lists org members with access level: "Can edit" or "Can view" (and the
  owner shown as "Owner"), "+ Add people", remove, "Transfer ownership" (host stays the same). Viewers can view, share,
  duplicate, book on behalf, view meetings, add meeting notes; editors can also change settings, turn on/off, manage
  hosts, reschedule, cancel, mark no-show; owners can also delete. Org owners and admins have editor rights on all
  event types; team managers on their team's event types.
- **Acceptance**: a "Can view" user cannot save changes (server returns 403 and the editor is read-only).

### ET-32 Event statistics (P2)

- **Behavior**: For team and shared event types, "Event statistics" downloads a CSV of the last 90 days: one row per
  host with columns Host, Email, Meetings booked, Completed, Canceled, Rescheduled, No-shows, Round robin
  assignments, Last assigned at.
- **Acceptance**: a round robin with 2 hosts and 3 bookings produces a CSV with 2 rows whose counts add up to 3.

### ET-33 New event type defaults and empty state (P0)

- **Defaults**: name "New Meeting" (Group: "New Group Meeting", Collective: "New Collective Meeting", Round robin: "New
  Round Robin Meeting"), duration 30, color from rotation, no location, schedule = owner's default schedule, date range
  60 calendar days, minimum notice 4 hours, increments 30 minutes aligned to block start, no buffers, no limits, time
  zone auto, name field single, guests allowed, one default question, calendar invitation/email confirmation auto,
  cancel and reschedule links included, confirmation page with "Schedule another event" on, active, not secret, locale
  = owner's locale if supported else `en`.
- **Empty state**: illustration (calendar with a plus), heading "Create scheduling links with event types", body
  "Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or
  office hours.", button "+ New event type".
- **Acceptance**: creating a one-on-one with only a name saves an event type whose fields equal the defaults above.

### ET-34 Shared event types (P2)

- **Behavior**: Event types with scope `shared` have multiple hosts but no team page; their URL is
  `/d/{code}/{slug}` where `code` is a random `xxxx-xxxx` string fixed at creation and the slug is editable; they never
  appear on any landing page. Any host, owner or admin can edit; hosts appear in the "Shared" section of each host's
  Scheduling page. Org setting controls who may create them (TM-16).
- **Acceptance**: a shared collective event type is bookable at its `/d/` URL and absent from all landing pages.

---

## 4. SCH: Scheduling rules and the slot engine

The slot engine is a pure library (no I/O) used by the booking page, troubleshooter, host booking, one-off pickers,
polls overlays and the public API. ARCHITECTURE section "Slot engine" defines its exact interfaces. The rules below are
normative.

### SCH-01 Slot generation pipeline (P0)

- **Behavior**: For an event type, a requested range (UTC instants) and `now`:
  1. Determine the booking window: `[now + minimum notice, window end]` (SCH-02 to SCH-06).
  2. For each host, for each local date of the host's schedule zone overlapping the range (plus one day margin on each
     side): take date-specific intervals if the date has an override, else the weekday intervals; drop the date if an
     active holiday falls on it (holidays beat date-specific hours, AV-13); ignore zero-length intervals (observed:
     "17:00-17:00" means unavailable); convert each interval to UTC with wall-clock math.
  3. **Merge rule (normative)**: touching or overlapping intervals are merged before candidates are generated (AV-04
     keeps them as separate rows in storage; 9:00 to 12:00 plus 12:00 to 17:00 is one block 9:00 to 17:00). Two levels
     are used: (a) **anchor blocks**: intervals merged within one local date; increments are anchored at each anchor
     block's start, so the grid of a date never depends on other dates or on the requested range; (b) **containment
     blocks**: anchor blocks merged across local midnight (22:00 to 24:00 plus 00:00 to 02:00 next day is one block);
     a candidate is valid when `[start, start + duration)` fits inside one containment block. So a 60-minute event can
     start at 23:30 in that example, and the next date's 00:00 block anchors its own grid at 00:00 (our choice: per-date
     anchoring keeps the grid deterministic for 24-hour schedules and odd increments).
  4. Combine the hosts' blocks per pooling type into **combined blocks** (both levels): single host: that host's
     blocks; collective: the intersection of all hosts' blocks; round robin: the union of the pool members' blocks
     (our choice); multi_pool: the intersection of every required co-host's blocks and, for each pool, the union of that
     pool's members' blocks. Generate candidate starts from the combined anchor blocks with the increment and alignment
     (SCH-10) such that the candidate fits a combined containment block. Existing active group slots of the event type
     are always added as candidates (SCH-14).
  5. Drop candidates outside the booking window (PAST, TOOSOON, RANGE).
  6. Check conflicts per host: `[start - buffer_before, end + buffer_after)` must not overlap any busy interval of that
     host (SCH-07, SCH-11). Buffers may extend outside the availability interval. Each host must also have the
     candidate inside one of their own containment blocks.
  7. Apply event type limits (SCH-08) and host limits (SCH-09).
  8. Decide availability per pooling type (SCH-15 to SCH-17); group seats (SCH-14). Reschedules exclude the meeting
     being moved everywhere (SCH-24).
  9. Return slots as UTC instants with `invitees_remaining` and, for multi-host types, the set of eligible hosts.
- **Acceptance**: the observed owner cases pass as unit tests: a 120-minute event on Tue 17:00 to 20:00
  America/Los_Angeles with 15-minute increments yields 17:00, 17:15, ..., 18:00 (last start = end - duration); a
  30-minute event with 15/15 buffers and an external busy block ending 21:45Z offers next start 22:00Z; a busy block
  starting 19:00Z makes 18:15Z the last start before it. Blocks 9:00 to 12:00 and 12:00 to 17:00 with a 60-minute event
  and 30-minute increments offer 11:30. Blocks 22:00 to 24:00 and 00:00 to 02:00 (next day) with a 60-minute event and
  30-minute increments offer 22:00, 22:30, 23:00, 23:30, 00:00, 00:30, 01:00. The slots returned for a date are
  identical whether the request range starts on that date or a month earlier.

### SCH-02 Date range: rolling calendar days (P0)

- **Behavior**: "N calendar days into the future" is a rolling window measured from the current time of day
  (observed: Calendly staff confirm that with 7 calendar days the 8:00am slot on April 23 opens at 8:00am on April
  16): a candidate is in range when its start is at or before `now` plus N days, computed as wall-clock "same local
  time N days later" in the range zone (DST safe). N from 1 to 3,650. "60 days" at 10:00 on Oct 12 allows starts up to
  10:00 on Dec 11.
- **Acceptance**: with N = 7 at 08:00 on Apr 16, a slot at 08:00 on Apr 23 is offered and one at 08:15 on Apr 23 is
  not; with N = 1 at 23:00 local, tomorrow's slots up to 23:00 are offered.

### SCH-03 Date range: rolling week days and days with availability (P1)

- **Behavior**: "N week days" rolls like SCH-02 (our choice, consistent with calendar days): starting from today, count
  N Monday-to-Friday dates after today (weekend dates are skipped while counting); the last allowed start is the
  current local time of day on the Nth counted date. Weekend dates inside the window remain bookable if they have
  availability (our choice). "N days with availability" (API `available_moving`) is date based: count local dates
  (range zone) whose combined availability (SCH-01 step 4: every required host for collective and multi-pool, any host
  per pool for round robin) is non-empty after holidays and date-specific hours, before busy times; the window ends at
  the end of the Nth counted date. Today counts only when at least one of its combined intervals ends after `now +
  minimum notice` (our choice). The count looks at all future date-specific hours and holidays, so the window end is
  the same for every month the booking page requests.
- **Acceptance**: on a Wednesday at 10:00 with N = 5 week days, starts are allowed up to 10:00 the next Wednesday; with
  "3 days with availability" at 16:00 when today's hours end at 17:00 and notice is 4 hours, today does not count; a
  vacation (unavailable override) next week extends the window by the same number of dates on every month page.

### SCH-04 Date range: within a date range (P0)

- **Behavior**: Fixed start and end dates (inclusive, schedule zone). End must be on or after start. Dates in the past
  simply yield no slots.
- **Acceptance**: a range Oct 20 to Oct 22 yields slots only on those three local dates.

### SCH-05 Date range: indefinitely (P0)

- **Behavior**: No end. Queries are still bounded by the requested range (at most 62 days per slots request; the
  booking page asks per visible month).
- **Acceptance**: a slots request for a month 2 years ahead returns slots when availability exists.

### SCH-06 Minimum scheduling notice (P0)

- **Behavior**: Candidates starting before `now + notice` are TOOSOON; before `now` are PAST. Notice from 0 minutes to
  365 days. Default 240 minutes (4 hours). Notice counts elapsed time, not business hours.
- **Acceptance**: with notice 4 hours at 10:07, the first candidate today is the first increment at or after 14:07.

### SCH-07 Buffers (P0)

- **Behavior**: Before and after buffers (0 to 720 minutes) belong to the event type being booked and are stored on
  each booked meeting (snapshot). Conflict test for a candidate uses `[start - before, end + after)`. Busy intervals
  from app meetings are expanded by their own stored buffers, so buffers stack (two 30-minute meetings with 15/15
  buffers keep 30 minutes between them). External calendar events are not expanded. Buffers are not required to fit
  inside working hours (a 4:30pm 30-minute slot with a 30-minute after buffer is bookable when hours end at 5pm). Changing
  buffers never changes booked meetings (CR-15 edits them explicitly). Meetings booked from one-off meetings and
  meeting polls snapshot 0/0 buffers (they have no buffer settings); host-booked (OO-13) and API bookings snapshot the
  event type's buffers. Reserved holds (SCH-19) are never expanded by buffers, but a candidate's own buffers still may
  not overlap a hold.
- **Acceptance**: unit tests for stacking, edge-of-hours, external events without buffers, and unbuffered holds.

### SCH-08 Event type meeting limits (P0)

- **Behavior**: Max meetings per day, week and month per event type. A candidate is blocked (DAILY_MAX, WEEKLY_MAX,
  MONTHLY_MAX) when the count of active scheduled events of this event type whose start falls in the same period is at
  least the limit. Periods are computed in the event's schedule zone (for multi-host: the event type's shared schedule
  zone, else the organizer or first host's zone (our choice)); weeks start on the owner's week start setting (Sunday
  default). Canceled meetings do not count. Group events count scheduled events (slots), not seats. Round robin limits
  apply to the event type total, not per host. Counts always cover whole periods, including weeks that straddle the
  requested month (a weekly limit on Monday Nov 30 counts meetings from the week start in November). A meeting being
  rescheduled does not count toward the limits evaluated for its new time (SCH-24).
- **Acceptance**: with a daily limit of 2 and two active bookings on Oct 13, no slots are offered on Oct 13; canceling
  one restores them; with a weekly limit of 1 and a Sunday week start, a meeting on Sunday Nov 29 blocks Tuesday Dec 1
  when only the December page is requested.

### SCH-09 Host meeting limits across event types (P1)

- **Behavior**: Per user (Availability > Advanced): max meetings per day, week, month across all event types where the
  user is a host (MEETING_LIMIT). Counts every active scheduled event where the user is a host, whatever its source
  (booking page, single-use link, one-off meeting, meeting poll, host-booked, API, calendar sync), by start date in the
  user's default schedule zone. For round robin, a host at the limit is ineligible (others may still take the slot);
  for collective, any host at the limit blocks the slot.
- **Enforcement by source** (our choice): booking pages, single-use links, shared and team pages, host bookings without
  "Override available times" (OO-13, `instant_book`) and API bookings (API-04) enforce event type and host limits. One-off
  meeting bookings (OO-09), meeting poll bookings (MP-18) and host bookings with "Override available times" (OO-14)
  ignore all limits (the host chose the time explicitly), but still count toward later limits.
- **Acceptance**: a host with a weekly limit of 5 and 5 meetings this week gets no slots in any event type this week; a
  poll booked this week counts toward the 5; booking a one-off meeting at the limit succeeds.

### SCH-10 Start time increments and alignment (P0)

- **Behavior**: Increment from 5 to 720 minutes (default 30), independent of duration and buffers. Alignment
  `interval_start` (default, Calendly): starts are `block.start + k * increment` where the block is a combined anchor
  block (SCH-01 steps 3 and 4: merged within the local date, intersected across collective hosts), so a block starting
  9:05 with 30-minute increments yields 9:05, 9:35, 10:05. Alignment `hour` (extension): starts are local times whose
  minutes since local midnight are a multiple of the increment, at or after the block start (9:05 block with 30-minute
  increments yields 9:30, 10:00). No dynamic increments (starts do not shift to right after existing meetings). The
  invitee never sees two starts closer than the increment from the same block, whatever the hosts' individual hours.
- **Acceptance**: unit tests for both alignments, including an increment longer than the duration (15-minute event,
  30-minute increments prevents back-to-back starts); a collective event with host A free 9:00 to 12:00 and host B free
  9:15 to 12:00 and 30-minute increments offers 9:15, 9:45, 10:15 and never 9:30.

### SCH-11 Busy sources and conflict detection (P0)

- **Behavior**: A host's busy intervals are the union of:
  1. Events on connected calendars marked "check for conflicts" that count as busy (SCH-12), excluding events created
     by this app for its own meetings (CAL-18) and excluding events matched by the event type's free/busy rules
     (SCH-13).
  2. Active app meetings where the user is a host, expanded by their stored buffers (busy even if the host marked the
     calendar copy "free"), excluding meetings matched by free/busy rules and the invitee's own meeting during a
     reschedule (our choice, SCH-24).
  3. Reserved holds: one-off meetings with "Reserve times", open polls with "Reserve times", and active booking
     reservations (payment or email verification holds) for the hosts the reservation holds (SCH-19).
  Overlapping intervals are merged. A host with a broken calendar connection that is checked for conflicts gets
  NOCAL: by default slots remain bookable using the last cached data younger than 24 hours, otherwise the host is
  treated as unavailable (our choice, safer against double booking) and the owner is emailed (CAL-15).
- **Acceptance**: overlapping and duplicate busy blocks from two calendars merge (observed behavior); an app meeting
  marked free on Google still blocks.

### SCH-12 All-day events and busy status mapping (P0)

- **Behavior**: All-day busy events block the whole local day in the host's schedule zone (observed: a 07:00Z to 07:00Z
  block removed every slot that Pacific day). Multi-day all-day events block every covered day. All-day events are
  always interpreted by their calendar dates, never by the UTC instants a provider returns.
  - Google: busy unless `transparency = transparent`, `status = cancelled`, or the user's attendee response is
    `declined`, refined by `eventType`: `workingLocation` is never busy; `outOfOffice` is always busy; `focusTime` is
    busy unless transparent; `default`, `birthday` and `fromGmail` follow transparency. The busy fetch requests these
    event types explicitly (`eventTypes=default,focusTime,outOfOffice,fromGmail,birthday`), so working locations are
    not even fetched.
  - Microsoft: busy when `showAs` is in the connection's unavailable statuses (default busy, tentative, oof,
    workingElsewhere; user can uncheck all but busy) and not cancelled; `showAs = unknown` is busy. Because events are
    fetched with UTC times, all-day events (`isAllDay = true`) come back with UTC-midnight bounds; they are re-anchored
    to the same calendar dates as whole local days in the host's schedule zone.
  - CalDAV and ICS: busy unless `TRANSP:TRANSPARENT` or `STATUS:CANCELLED`.
  Events without an end use their duration or zero length (all-day: one day).
- **Acceptance**: a Google event with transparency transparent does not block; a Google out of office event marked
  transparent still blocks; a working location event never blocks; a Microsoft tentative event blocks unless the user
  unchecked Tentative; a Microsoft all-day event on Oct 20 blocks exactly Oct 20 00:00 to 24:00 America/Los_Angeles;
  `showAs = unknown` blocks.

### SCH-13 Free/busy rules (meeting exceptions) (P2)

- **Behavior**: Per event type list of exceptions `{mode: includes | exact, text}`. Busy intervals whose title matches
  any exception (case-insensitive; `includes` = substring, `exact` = trimmed equality) are ignored for this event type,
  for both external events and app meetings (by meeting name). Full group meetings are never ignored. Holds, holidays
  and limits are not affected. Booking over an app meeting does not cancel it; the host's "New Event" email includes
  the alert "This meeting overlaps with {title} at {time}." with "View in {AppName}" (NT-02). Rescheduling still obeys
  normal availability for the meeting being rescheduled (exceptions of its event type still apply).
- **Acceptance**: with exception "Includes: Focus", a slot overlapping an external "Focus time" event is offered.

### SCH-14 Group event seats (P1)

- **Behavior**: For a group event type, a candidate that coincides with an existing active scheduled event of the same
  event type at the same start and duration is available while seats remain, ignoring that meeting as a busy interval
  for its own hosts. Seats: `invitees_remaining = slot limit - active invitees - active holds` where active holds are
  pending payment or email verification reservations for that slot (SCH-19); "{n} spots left" counts holds too. Other
  event types see a group slot with at least one invitee as busy. A full slot is GROUP. A group slot with zero
  remaining active invitees is canceled and the time frees up. Meeting limits count the slot once.
- **Existing slots**: every existing active group slot of the event type is a candidate even when it no longer sits on
  the current increment grid (the host changed increments or hours), as long as it passes the schedule (inside the
  host's availability), notice and range checks and the host is not busy from any other source (excluding the slot
  itself). A host who adds a conflicting external event or narrows their availability therefore stops new joins for
  that slot; invitees already booked are unaffected (our choice).
- **Same person twice**: an email that already holds an active seat in the slot (compared case-insensitively on the
  normalized email) cannot book it again: "You've already booked this time." (our choice of copy).
- **Host calendar event**: one provider event per slot on the host's destination calendar, created at the first booking,
  updated on every join or cancellation (invitee list and "{n} of {limit} spots filled" in the description), deleted
  when the last invitee leaves; invitees are never attendees (group events always use email confirmation, CAL-12).
- **Acceptance**: a group with 3 seats and 2 booked shows "1 spot left"; with 2 booked and 1 pending payment hold it
  shows no spot and the slot is full; after the third booking the slot disappears; the same email booking the same
  slot twice gets "You've already booked this time."; changing increments from 30 to 60 minutes keeps an existing 9:30
  slot with seats bookable.

### SCH-15 Collective availability (P1)

- **Behavior**: A slot is available only if every host is available (each with their own or the shared schedule, own
  busy, own host limits). Candidate starts come from the intersection of the hosts' blocks, anchored at each
  intersected block's start (SCH-01, SCH-10). Any unavailable host gives HOST (with that host's reasons in
  troubleshoot).
- **Acceptance**: hosts A (free 9 to 12) and B (free 10 to 13) yield slots only from 10 to 12 minus duration; hosts A
  (9:00 to 12:00) and B (9:15 to 12:00) with 30-minute increments yield 9:15, 9:45, 10:15, ... and no 9:30.

### SCH-16 Round robin availability and assignment (P1)

- **Behavior**:
  - A slot is available if at least one pool host is eligible: available per schedule and busy, under host limits, and
    for "Optimize for equal distribution" not hidden. Hidden rule: let `count(h)` be active round robin assignments of
    host h in this pool since the pool's counts reset; h is hidden when `count(h) - min(count over all pool hosts) >=
    3` (example: Jim 3, Karen 0 hides Jim; at 3 and 1 Jim is back; at 4 and 1 hidden again). Slot capacity equals the
    number of eligible hosts, so concurrent bookings at the same time go to different hosts.
  - Candidate starts come from the union of the pool members' blocks, anchored at each union block's start (our
    choice: one consistent grid per pool instead of each host's own grid, so the invitee never sees starts closer than
    the increment).
  - Assignment at booking time among eligible hosts: "Maximize for availability": highest priority; ties: least
    recently assigned for this event type (never assigned first); ties: random. "Optimize for equal distribution": lowest
    count first; ties: least recently assigned; ties: random (our choice; priority ignored, Calendly parity).
  - Canceled meetings do not count toward counts (our choice). Rescheduling with "Reassign" re-runs assignment with the
    moved meeting excluded from counts (SCH-24); with "Use same hosts" the slot must be available for the original
    host. "Least recently assigned" uses the assignment time, which a reschedule carries over unchanged.
  - Holds: a payment or email verification reservation on a round robin event assigns a provisional host when it is
    created and blocks only that host; completing it books that host if still free, otherwise assignment re-runs.
  - Reason codes: ROUNDROBIN (no eligible host), UNFAIR (available hosts exist but all hidden by equal distribution).
- **Acceptance**: unit tests for priority ties, least-recent tie break, equal distribution hide/unhide sequence, and
  two concurrent bookings at the same time assigned to two different hosts.

### SCH-17 Multiple host pools (P2)

- **Behavior**: A slot is available when every required co-host is available and every pool has at least one eligible
  host. Candidate starts come from the intersection of the required co-hosts' blocks with, for each pool, the union of
  its members' blocks (SCH-01 step 4). One host per pool is assigned with that pool's distribution method. The meeting
  includes all required co-hosts and the assigned host of each pool.
- **Acceptance**: required host A plus pools P1 {B, C} and P2 {D}: a slot where A and D are free but B and C are busy is
  not offered.

### SCH-18 Multiple durations (P1)

- **Behavior**: The slots request includes the chosen duration (must be one of the options, default the event's
  default). All rules use that duration. The booking stores the chosen duration.
- **Acceptance**: a 60-minute choice offers fewer late-day starts than a 30-minute choice.

### SCH-19 Reserved holds (P1)

- **Behavior**: Busy sources of type `reserved`: one-off meeting spots with Reserve times while the one-off is
  pending; poll options with Reserve times while the poll is open or closed (not booked); active booking reservations
  (payment or email verification). A booking reservation is created under the same per-host locks and recheck as a
  booking (SCH-20), so two invitees can never both hold the same solo slot. It holds exactly the hosts the meeting
  would have: all hosts for single-host and collective events, the required co-hosts plus the provisional assignee of
  each pool for round robin and multi-pool events (SCH-16), and one seat for group slots (SCH-14). Hold length: 10
  minutes for email verification and for inline payment; for the Stripe Checkout redirect the hold lasts until the
  Checkout session expires (30 minutes, the Stripe minimum) (our choice). A reservation for the same slot by the same
  invitee email is ignored for that invitee (so retrying payment works). Holds are never buffered (SCH-07). Reason
  code RESERVED.
- **Acceptance**: while a payment reservation is active, a second invitee cannot select the same solo slot; 10
  concurrent reservation attempts for one solo slot create exactly one reservation; a pending round robin hold on host A
  leaves host B bookable at the same time.

### SCH-20 Booking-time recheck and race safety (P0)

- **Behavior**: Creating a booking re-validates the exact slot inside a database transaction holding per-host
  transaction advisory locks (all candidate hosts, sorted), using fresh app meetings and reservations, and calendar
  busy data at most 60 seconds old (fetched just before the transaction; fresh fetch with 4 second timeout, falling back
  to cache). If the slot no longer passes, the request fails with "Sorry, that time is no longer available." / "Please
  select a different time to book this event." and the page offers "View Times". Group seat counts are checked under
  the same lock; a unique partial index prevents two active scheduled events for the same group slot. The same
  transaction also: returns the original result for a repeated client request id (double click) instead of
  "no longer available"; locks the old invitee of a reschedule and requires it to be still active and not yet
  rescheduled (a reschedule racing a cancel or a second reschedule loses); completes a payment or verification
  reservation at most once. Locks are always taken in one order: per-host locks (sorted), then the single-use link,
  one-off meeting, group slot or poll row, then everything else (ARCHITECTURE "Booking creation").
- **Acceptance**: 10 concurrent booking requests for one solo slot produce exactly 1 booking and 9 "no longer
  available" responses; two concurrent submits with the same client request id both return the same invitee id; two
  concurrent reschedules of one invitee produce exactly one new invitee; a Stripe webhook and the return page completing
  the same reservation create one invitee. These concurrency tests run against real Postgres (not PGlite, which
  serializes transactions).

### SCH-21 Troubleshoot reason codes (P1)

- **Behavior**: The engine can return, per candidate start, the list of reason codes: CALENDAR, NOCAL, DAILY MAX,
  WEEKLY MAX, MONTHLY MAX, DURATION (availability interval shorter than the duration, emitted for blocks that cannot
  fit), RANGE, TOOSOON, EVENT (another meeting of this event type), GROUP, OVERLAP (another app meeting), HOLIDAY,
  MEETING LIMIT, HOST, ROUNDROBIN, UNFAIR, BUFFER (only a buffer overlaps, the meeting itself would not), PAST, RESERVED.
  Fix hints (UX doc table 21.1) are shown in the troubleshooter (BK-24).
- **Rule**: BUFFER is reported when the candidate meeting itself (without its buffers) does not overlap the blocker
  itself (for app meetings: the other meeting without its buffers), so the collision exists only because of buffers on
  either side.
- **Acceptance**: a candidate blocked only by its own after-buffer reports BUFFER, not CALENDAR; a candidate whose
  meeting time falls only inside another meeting's after-buffer reports BUFFER, not EVENT or OVERLAP.

### SCH-22 Evaluation zones and invitee rendering (P0)

- **Behavior**: Schedules, date ranges, limits and holidays are evaluated in each host's schedule zone. Slots are
  returned as UTC instants. The booking page groups slots by the invitee's display zone local date (an evening slot
  for a Pacific host can appear on the next day for a European invitee). Locked time zone events display in the locked
  zone and hide the zone picker.
- **Acceptance**: a Los Angeles 17:00 slot shows as 01:00 next day in Europe/Berlin and is listed under that next date.

### SCH-23 Cancel and reschedule cutoff (P3, extension)

- **Behavior**: Optional event type setting "Prevent invitees from canceling or rescheduling within [n] [hours|days] of
  the start" (off by default). When active, invitee cancel and reschedule pages show "This meeting can no longer be
  changed online. Please contact {Host name}." with the host's email. Hosts are unaffected.
- **Acceptance**: with a 24 hour cutoff, the cancel page for a meeting in 3 hours shows the blocked message.

### SCH-24 Reschedule evaluation (P0)

- **Behavior**: When availability is computed for rescheduling an invitee (invitee page CR-03, host reschedule CR-07,
  API), the meeting being moved is treated as if it did not exist: it is excluded from busy times (SCH-11), from event
  type limits (SCH-08), from host limits (SCH-09), from round robin counts and equal distribution (SCH-16), from group
  seat counts (the invitee's own seat, SCH-14), and the invitee's own pending reservation is ignored (SCH-19). For
  group invitees only their own seat is excluded, never the whole slot. The new meeting uses the event type's current
  settings (buffers, locations, questions, notification templates), not the old meeting's snapshot.
- **Acceptance**: with a daily limit of 1, rescheduling the only meeting of the day to a later time the same day is
  offered; with a weekly host limit reached by the meeting itself, other times that week are offered; a round robin
  host who is 3 ahead only because of the moved meeting is not hidden.

---

## 5. AV: Availability

### AV-01 Availability page structure (P0)

- **Behavior**: `/app/availability` with h1 "Availability" and tabs "Schedules" (`/app/availability`), "Calendar
  settings" (`/app/availability/calendar-settings`, CAL-01), "Advanced settings" (`/app/availability/advanced`, AV-13,
  AV-14). Scheduling page links "Manage availability" here.
- **Acceptance**: all three tabs load and the active tab is underlined in `#006BFF`.

### AV-02 Schedules: list and management (P0)

- **Behavior**: Top card header: "Schedule" label with a dropdown of the user's schedules ("Working hours (default)"
  plus others) and "+ Create schedule" at the bottom (modal "New schedule" with "Schedule name" (1 to 60 chars) and
  "Cancel"/"Create"; the new schedule copies the default schedule's hours (our choice)). "Active on" dropdown
  ("Active on: 2 event types") with an event type checklist and "Apply" (AV-09). Kebab: "Rename", "Set as default",
  "Clone", "Delete". View switch "List" / "Calendar". Deleting a schedule used by event types asks which schedule
  those event types should use instead (defaults to the default schedule) (our choice). The default schedule cannot be
  deleted ("Set another schedule as default first"). Event-specific custom schedules (AV-11) are not listed here.
- **Limits**: up to 50 named schedules per user (our choice).
- **Acceptance**: "Set as default" moves the "(default)" label and new event types use it.

### AV-03 Weekly hours editor (P0)

- **Behavior**: Left column "Weekly hours" (subtitle "Set when you are typically available for meetings"). Seven rows,
  starting Sunday or Monday per the user's week start. Each row: day circle (32px, navy fill, white initial letter)
  and either "Unavailable" (gray) with a "+" button to add hours, or one or more interval rows: start time input, "-",
  end time input, "x" remove; the first interval row also has "+" (add another interval, default one hour after the
  last end, capped at midnight) and a copy icon (AV-05). Time inputs are typeable comboboxes with 15-minute steps
  ("9:00am", "9:15am"...), accepting typed values like "9", "930", "9:30 pm", "21:30" with any minute. Intervals are
  sorted on save. The same component is used for event custom hours and per-host hours.
- **Acceptance**: typing "1:05pm" stores 785 minutes; the row re-sorts if needed.

### AV-04 Interval validation (P0)

- **Behavior**: End must be later than start: "Choose an end time later than the start time." Intervals of the same day
  must not overlap: "Times overlap with another set of times." Touching intervals (9 to 12 and 12 to 17) are allowed
  and kept as separate rows in the editor and in storage; the slot engine merges them into one block (SCH-01). End time
  12:00am means midnight (1440). Zero-length intervals cannot be created in the UI but are
  accepted from the API and treated as unavailable (observed).
- **Acceptance**: an overlapping interval shows the error and is not saved.

### AV-05 Copy times to other days (P1)

- **Behavior**: The copy icon opens "Copy times to..." with a checkbox per weekday (the source day checked and
  disabled), "Select all", and "Apply". Copies all intervals of the source day, replacing the target days' intervals.
- **Acceptance**: copying Monday 9 to 5 to Tue to Fri sets those days identically.

### AV-06 Date-specific hours (P0)

- **Behavior**: Right column "Date-specific hours" (subtitle "Adjust hours for specific days") with "+ Hours". Modal
  title "Select the date(s) you want to assign specific hours": month calendar (multi-select, today dot, previous and
  next arrows, past dates disabled), below it "What hours are you available?" with interval rows ("+", "x"; removing
  all rows means "Unavailable"), buttons "Cancel" and "Apply". The list shows future overrides sorted by date: "Thu, Oct
  22, 2026" and "10:00am - 2:00pm" or "Unavailable", with edit (pencil) and delete (trash) on hover; past overrides are
  hidden behind "Show past dates" (our choice). Overrides replace the weekday hours for that date entirely. They can be
  set any distance into the future. Holidays still win over overrides (AV-13).
- **Limits**: up to 1,000 overrides per schedule (our choice).
- **Acceptance**: an override marking Oct 22 unavailable removes all Oct 22 slots for event types using that schedule.

### AV-07 Calendar view (P2)

- **Behavior**: Month grid where each day cell lists its effective hours (weekly or override, "Unavailable" in gray,
  holidays labeled). Clicking a date (or dragging across several) opens a popover: "Edit date(s)" (creates overrides)
  or "Edit all {Weekday}s" (edits weekly hours), then the interval editor and "Apply".
- **Acceptance**: editing one date from the calendar view creates exactly one override.

### AV-08 Schedule time zone (P0)

- **Behavior**: "Time zone" dropdown at the bottom of the list view (searchable, local time per option, GEN-06).
  Each schedule has exactly one zone; hours are wall-clock times in that zone. Changing the zone keeps the wall-clock
  hours (9 to 5 stays 9 to 5 in the new zone). Default: the user's profile zone. Travel guidance text under the
  dropdown: "Traveling? Add date-specific hours in the local time of your trip." (our choice).
- **Acceptance**: changing a schedule from New York to Los Angeles shifts the UTC slots by 3 hours.

### AV-09 Active on (P1)

- **Behavior**: "Active on" lists the user's single-host event types (personal) with checkboxes; checking assigns the
  schedule to that event type (replacing a custom schedule after a confirmation "This event type uses custom hours.
  Replace them with {schedule}?").
- **Acceptance**: checking an event type in "Active on" updates its "Schedule:" in the editor.

### AV-10 Auto-save (P0)

- **Behavior**: The Schedules page saves every change automatically (debounced 600ms, optimistic UI) and shows a small
  "Saved" toast or inline indicator; failures revert and show "Couldn't save your changes. Try again.". No Save button
  (Calendly parity). The event type editor's embedded hours editor follows the editor's save model instead (ET-14).
- **Acceptance**: changing Monday hours and reloading after 1 second shows the new hours.

### AV-11 Event-type custom schedules (P0)

- **Behavior**: An event type can use "Custom schedule": a schedule row tied to that event type (hidden from the
  Schedules list) with its own weekly hours, overrides and zone. Switching back to a named schedule deletes the custom
  one after confirmation.
- **Acceptance**: editing the custom schedule of event A does not affect event B.

### AV-12 Per-host schedules for multi-host event types (P1)

- **Behavior**: Collective, round robin and multi-pool event types offer "Set the same hours for all hosts" (one shared
  custom schedule) or per host: each host row has a schedule select (that host's named schedules, or "Custom hours for
  this event", editable by the host or by editors). Default: each host's default schedule.
- **Acceptance**: two hosts with different default schedules yield collective slots from the intersection.

### AV-13 Holidays (P1)

- **Behavior**: Advanced settings > "Holidays": "Country" select (Australia, Brazil, Canada, France, Germany, Mexico,
  Netherlands, Spain, United Kingdom, United States; plus "None", default) and a list of that country's public holidays
  for the current and next year with On/Off switches (On = unavailable; all On by default when a country is chosen).
  Observed and substitute days (for example "Christmas Day (substitute day)" when Dec 25 falls on a weekend) are listed
  as their own rows with their own switches and their own stable keys (our choice). Applies to all event types where
  the user is a host, on the holiday's local date in each schedule's zone; beats date-specific hours. Missing holidays
  are handled by date-specific hours. Troubleshoot code HOLIDAY.
- **Acceptance**: with United States selected and Thanksgiving On, Nov 26 2026 has no slots; turning it Off restores
  them; for United Kingdom 2027, the substitute bank holiday for Christmas (Dec 27) is listed with its own switch.

### AV-14 Host meeting limits (P1)

- **Behavior**: Advanced settings > "Meeting limits": "+ Add a meeting limit" rows "Max number of meetings [n] per [day
  | week | month]" across all event types; auto-saves. Admins can view but not edit other users' limits. Semantics in
  SCH-09.
- **Acceptance**: the limit row persists and the troubleshooter reports MEETING LIMIT when reached.

### AV-15 Default schedule for new users (P0)

- **Behavior**: See AU-13. Onboarding step 3 writes it. Users always have exactly one default schedule.
- **Acceptance**: no code path leaves a user without a default schedule.

---

## 6. CAL: Calendar connections

### CAL-01 Calendar settings page (P0)

- **Behavior**: `/app/availability/calendar-settings`. Card "Calendar connections" with header count "{n} of 6
  calendar accounts" (soft limit, our choice: warn above 6 but allow up to 20), a list of connections (provider logo,
  account email or display name, status chip "Connected" / "Action required" / "Error", kebab "Reconnect",
  "Disconnect"), and "+ Connect calendar account" which opens a modal with tiles: Google Calendar, Office 365 /
  Outlook.com, iCloud Calendar, Other CalDAV (Fastmail, Nextcloud, ...), ICS feed (read-only). Card "Configuration":
  "Calendars to check for conflicts" (per connection, checklist of calendars with color dots, "Edit" opens the selection
  modal; copy "These calendars will be used to prevent double bookings"), "Calendar to add events to" (single radio
  across writable calendars, "Edit"; copy "Set the calendar you would like to add new events to as they're
  scheduled"), and per destination calendar "Sync settings" (CAL-13, CAL-14). Microsoft connections show "What's
  considered unavailable?" (CAL-09).
- **Acceptance**: connecting a second Google account shows both connections and their calendars.

### CAL-02 Google Calendar (P0)

- **Behavior**: OAuth connect (same Google client as sign-in, intent `connect_calendar`), scopes as AU-02. Lists
  calendars via calendarList (`minAccessRole=reader`); writable when accessRole is owner or writer. Busy via events.list
  per checked calendar (`singleEvents=true`, explicit `eventTypes` per SCH-12, honoring transparency, status, declined
  responses, event type, all-day). Writes via events.insert, patch, delete with `conferenceDataVersion=1`; custom event
  id derived from our UUID for idempotent retries; `extendedProperties.private.kairosEventId` and `kairosPurpose` set.
  The returned `iCalUID` and `htmlLink` are stored on the meeting (CAL-12, BK-20). Token refresh on 401;
  `invalid_grant` marks the connection "Action required".
- **Acceptance**: with mocked Google API, busy fetch excludes transparent, declined and working location events,
  includes out of office events and all-day events as whole local days, and the request carries the `eventTypes`
  parameters.

### CAL-03 Microsoft Outlook / 365 (P0)

- **Behavior**: OAuth via Microsoft identity (intent `connect_calendar`), Graph v1.0. Lists `/me/calendars` (writable
  when `canEdit`); busy via `calendarView` per checked calendar with `Prefer: outlook.timezone="UTC"` and a `$select`
  that includes `isAllDay`, `showAs`, `isCancelled`, `start`, `end`, `subject`, `iCalUId`, `responseStatus`, following
  `@odata.nextLink`; all-day events re-anchored per SCH-12; writes via `/me/calendars/{id}/events` with UTC times and
  `transactionId` for idempotency, storing the returned `iCalUId` and `webLink`; cancellation via `/cancel` when
  attendees exist else DELETE. Personal accounts: Teams links unsupported (VID-08). Microsoft checks the first 10
  calendars returned by default and lets users check any (our choice: no 4-calendar cap).
- **Acceptance**: mocked Graph responses with showAs free, busy, tentative, oof and unknown produce the expected busy
  list; an all-day event returned as `2026-10-20T00:00:00Z` to `2026-10-21T00:00:00Z` blocks Oct 20 in the host's zone.

### CAL-04 CalDAV (iCloud, Fastmail, Nextcloud, generic) (P1)

- **Behavior**: Connect form: provider preset (iCloud: server `https://caldav.icloud.com`, help text "Use an
  app-specific password from appleid.apple.com"; Fastmail: `https://caldav.fastmail.com`; Nextcloud: "Server URL like
  https://cloud.example.com/remote.php/dav"; Other), username, password (stored encrypted), "Connect" which validates by
  logging in and listing calendars (VEVENT-capable only). Every CalDAV request, including principal discovery and its
  redirects (iCloud redirects to a `pNN-caldav.icloud.com` host), goes through the SSRF-safe fetch (GEN-08). Busy via calendar-query time range with local recurrence
  expansion (node-ical); writes via PUT of an iCalendar object (UTC times, no METHOD) using our UID; updates with ETag;
  deletes by URL. CalDAV destinations use email confirmations (CAL-12).
- **Edge cases**: servers that return non-`.ics` URLs are supported (no URL filter). Authentication failures show
  "We couldn't sign in to your calendar. Check the username and password."
- **Acceptance**: integration test against a mocked CalDAV server creates, updates and deletes an event and reads busy
  times including a recurring event with an exception.

### CAL-05 ICS feed (read-only) (P1)

- **Behavior**: "ICS feed" connect form: "Calendar name" and "Feed URL" (`https://` or `webcal://`, rewritten to
  https). Fetched only through the SSRF-safe fetch (GEN-08: redirects re-validated per hop, max 5MB, 15 second
  timeout), ETag and Last-Modified honored. Always
  checked for conflicts; never a destination. Refetched when older than 15 minutes (our choice).
- **Acceptance**: a feed with a weekly recurring event blocks each occurrence in range.

### CAL-06 Multiple connections (P0)

- **Behavior**: Any number of connections (soft hint at 6), any mix of providers, multiple accounts of the same
  provider. Each calendar belongs to one connection; the same external calendar connected twice is de-duplicated by
  provider calendar id within a user (our choice).
- **Acceptance**: busy times from two connections are unioned.

### CAL-07 Calendars to check for conflicts (P0)

- **Behavior**: Multi-select per connection. Defaults on first connect: the primary calendar checked (Google primary,
  Microsoft default calendar, first CalDAV calendar); others unchecked (our choice). Subscribed read-only calendars are
  allowed when the provider exposes them. Changes take effect immediately (cache invalidated).
- **Acceptance**: unchecking a calendar removes its events from availability within one slots request.

### CAL-08 Calendar to add events to (P0)

- **Behavior**: Exactly one destination per user across connections (any writable calendar), or "None" (meetings are
  not written to any calendar; email confirmations only). Default: the primary calendar of the first writable
  connection. Free/busy rules work best when the destination is also checked; the UI recommends checking it. Changing
  the destination affects new meetings only.
- **Acceptance**: after choosing a Microsoft calendar as destination, a new booking writes to it.

### CAL-09 Busy status mapping (P1)

- **Behavior**: Microsoft connections: "What's considered unavailable?" with checkboxes Busy (always checked,
  disabled), Tentative, Away / Out of office, Working elsewhere (all checked by default). Google: tentatively accepted
  invitations count as busy (our choice). See SCH-12.
- **Acceptance**: unchecking Tentative makes tentative events non-blocking.

### CAL-10 Busy fetching, caching and freshness (P0)

- **Behavior**: External events for checked calendars are cached per calendar for fetched windows (whole local days,
  fetched in 31 to 62 day windows). Freshness: booking page slot queries accept cache up to 3 minutes old
  (`CALENDAR_CACHE_TTL_SECONDS`, default 180); booking submission recheck accepts up to 60 seconds (SCH-20); ICS feeds
  15 minutes. Expired windows are refetched synchronously with a 4 second timeout per connection, falling back to stale
  data (and logging) on timeout. Cache invalidates on connection or selection changes and after our own writes. Google
  incremental sync tokens and push notifications are optional optimizations (P3).
- **Acceptance**: two slot requests within 3 minutes cause one provider fetch (verified by a mocked provider call
  counter).

### CAL-11 Writing booked meetings to calendars (P0)

- **Behavior**: For each new meeting, the organizer host's destination calendar receives an event (and, in email
  confirmation mode, each other host's destination calendar receives a copy). Title from the event type's calendar
  event title template (default "{{invitee_full_name}} and {{my_name}}" for one-on-one; group: "{{event_name}}";
  collective and round robin: "{{event_name}} with {{invitee_full_name}}" (our choice)). Description: event name,
  invitee name and email, guests, questions and answers (unless excluded), location or join link, "Need to make
  changes to this event?" with cancel and reschedule links (unless excluded), and a footer line "Booked with {AppName}".
  Location field: address, phone or join URL. Reminders: provider defaults. Updates on reschedule move the same
  provider event; cancellations delete it (calendar invitation mode: cancel with notification). Failures retry with
  backoff; persistent failure flags the meeting ("Calendar sync failed" in details, CAL-15) without blocking the
  booking.
- **Group slots**: one provider event per slot (never one per invitee): created at the first booking with no
  attendees, updated (PATCH) on every join, invitee cancellation and invitee limit change with the current invitee
  list and "{n} of {limit} spots filled" in the description, deleted when the slot is canceled because its last
  invitee left.
- **Acceptance**: a booking creates exactly one provider event; a retry after a timeout does not create a duplicate
  (idempotent id or transactionId); three invitees joining a group slot produce one provider event that is created
  once and updated twice and lists three invitees, none of them as attendees.

### CAL-12 Calendar invitation vs email confirmation (P0)

- **Behavior**: Per event type `notification_type`: `auto` (default), `calendar_invitation`, `email_confirmation`.
  Effective mode: `calendar_invitation` when the organizer's destination calendar is Google or Microsoft and the event
  is not a group event; otherwise `email_confirmation`. In calendar invitation mode the provider event includes the
  invitee and guests as attendees and the provider sends the invitation (Google `sendUpdates=all`); the app does not
  send its own invitee confirmation email, but still sends the host notification (NT-02). In email confirmation mode
  the provider event has no attendees (`sendUpdates=none`) and the app emails the invitee and each guest a confirmation
  with an `.ics` (NT-01, NT-06). If a calendar invitation cannot be created after 3 attempts within 10 minutes, the app
  falls back to sending the email confirmation (our choice) and records it on the meeting timeline.
- **Invitee calendars hold exactly one copy**: in calendar invitation mode the invitee and guests already hold the
  provider's event, so the app never sends them its own confirmation or "Updated" emails (NT-01, NT-04) and never
  attaches an ICS to any invitee or guest email; the cancellation notice (NT-03) is still sent, without ICS, because it
  carries the reason and the "Schedule again" link (our choice). The provider's iCal UID (Google `iCalUID`, Graph `iCalUId`) is stored on the meeting and used
  for every ICS the app does produce for it (the confirmation page download, BK-22), so importing it updates the same
  calendar entry instead of duplicating it. The fallback to email confirmation switches the meeting permanently to email
  mode with the app's own UID: from then on the provider event never gets attendees, even if a later retry of the
  provider write succeeds. Meeting polls always use email confirmation mode (MP-19).
- **Acceptance**: with a Google destination, the invitee receives no app email but the mocked Google insert has the
  invitee as attendee with `sendUpdates=all`; with no destination, the invitee gets an app email with ICS; rescheduling a
  calendar invitation meeting sends no app email to the invitee and the confirmation page ICS uses the Google iCalUID;
  after a fallback, a successful late retry writes the provider event without attendees and the invitee's ICS keeps the
  app UID.

### CAL-13 Include buffers on this calendar (P2)

- **Behavior**: Per destination calendar checkbox "Include buffers on this calendar" (default off). When on, each
  meeting with buffers also writes separate busy events titled "Buffer: {meeting title}" for the before and after
  buffer windows. Deleting a buffer event in the provider removes that buffer from the meeting (detected by CAL-14 sync)
  (Calendly parity).
- **Acceptance**: a meeting with 15/15 buffers writes 3 provider events when enabled.

### CAL-14 Sync cancellations and reschedules from the calendar (P1)

- **Behavior**: Per destination calendar checkbox "Automatically sync cancellations and reschedules from this calendar
  to {AppName}" (default on for Google and Microsoft, unavailable for CalDAV (our choice: on but best effort) and ICS).
  A periodic job (every cron tick, at most every 10 minutes per connection) checks app-created events for upcoming
  meetings (next 90 days): if deleted or the host declined, the meeting is canceled by the host with reason "Canceled
  from connected calendar event"; if the time moved, the meeting is rescheduled: the old meeting is canceled with
  reason "Rescheduled from connected calendar event" (`canceler_type = host`) and a new meeting is created at the new
  time reusing the same provider event (observed), invitees notified with the reschedule email. Invitee-side changes
  (their own calendar) never affect meetings. Moved buffer events update buffers (CAL-13).
- **Acceptance**: with a mocked provider event moved by one hour, the next sync produces a canceled old meeting and an
  active new meeting with `rescheduled` links between their invitees.

### CAL-15 Connection health and reconnect (P0)

- **Behavior**: Connection statuses: `active`, `needs_reauth` (token revoked or invalid_grant), `error` (repeated
  fetch failures), `disconnected`. On transition to `needs_reauth` or `error`, the user gets an email "There is a
  problem with your calendar connection" (once per 24 hours) and a red dashboard banner "There is a problem with your
  calendar connection. Reconnect" (NOCAL). Reconnect re-runs OAuth (or the CalDAV form) and keeps settings.
- **Acceptance**: a mocked `invalid_grant` on refresh sets `needs_reauth` and shows the banner.

### CAL-16 Disconnect (P0)

- **Behavior**: "Disconnect" confirms "Disconnect {email}? Events already added to this calendar stay there, but new
  meetings won't be added and it won't be checked for conflicts." Revokes the OAuth token (Google revoke endpoint)
  best effort, deletes stored credentials and cached events, unsets destination if it pointed there (falls back to
  "None" and warns). A connection created by sign-in can be disconnected without affecting login (AU-10).
- **Acceptance**: after disconnect, slots ignore that connection's events.

### CAL-17 Sign-in connects the calendar (P0)

- **Behavior**: Google or Microsoft sign-in (AU-02, AU-03) creates or updates a calendar connection for that account
  with the granted calendar scopes, checks the primary calendar for conflicts and makes it the destination if the user
  has none.
- **Acceptance**: a new Google signup has one connection with the primary calendar checked and set as destination.

### CAL-18 Own-event deduplication (P0)

- **Behavior**: Events the app created (meetings, buffer events, holds) are excluded from external busy, matched by
  stored provider event id or by the `kairosEventId` extended property or iCal UID, because app meetings and holds are
  already busy sources with correct buffers and group seat logic.
- **Acceptance**: a group slot written to Google does not block its own remaining seats.

### CAL-19 Connected calendar events in the app (P2)

- **Behavior**: Read-only display of external events (title, time, calendar color) in the Meetings page (MT-10), the
  one-off and poll time pickers, and the troubleshooter. Titles are visible only to the calendar owner; co-hosts' busy
  times are shown only to members of the same organization and without titles (GEN-08).
- **Acceptance**: the one-off picker shows a gray block for an external event in the visible week; a co-host's block
  has no title in the API response.

### CAL-20 Per event type destination calendar (P3, extension)

- **Behavior**: Event type Booking page options > "Add events to": "Default ({calendar})" or another writable calendar
  of the owner.
- **Acceptance**: an event type overriding the destination writes to the chosen calendar.

### CAL-21 Integrations hub (P1)

- **Behavior**: `/app/integrations` titled "Integrations & apps" with search "Find integrations, apps, and more",
  category chips (All, Calendars, Video conferencing, Payments, Messaging, Developer tools, Analytics) and a grid of
  tiles (logo, name, one-line description, status badge "Connected" green, "Not configured on this server" gray when env
  vars are missing). Tiles: Google Calendar, Outlook Calendar, iCloud Calendar, CalDAV, ICS feed, Google Meet, Microsoft
  Teams, Zoom, Jitsi Meet, Stripe, Twilio SMS, Email delivery (status only), Webhooks, API and personal access tokens,
  Embed, Google Analytics, Meta Pixel. Each tile opens its detail page with "Connect"/"Disconnect", description, "How it
  works" bullets and settings.
- **Acceptance**: the Zoom tile shows "Not configured on this server" when `ZOOM_CLIENT_ID` is missing.

### CAL-22 Imported Calendly meetings as busy blocks (P2, extension)

- **Behavior**: When the Calendly import (BR-17) brings in upcoming meetings, they are stored as a read-only calendar
  connection "Imported from Calendly" (provider `calendly_import`) whose events are always checked for conflicts,
  never written to and never refetched; the connection can be disconnected like any other (CAL-16), which removes the
  blocks.
- **Acceptance**: an imported meeting blocks its time on the booking page; disconnecting the import connection frees it.

---

## 7. VID: Locations and conferencing

### VID-01 Location kinds (P0)

- **Behavior**: Location configuration kinds (Calendly API names plus ours): `physical`, `outbound_call`,
  `inbound_call`, `google_conference`, `microsoft_teams_conference`, `zoom_conference`, `jitsi_conference` (extension),
  `custom`, `ask_invitee`, `webex_conference` and `gotomeeting_conference` (P3, hidden). Each configuration has an id,
  position and kind-specific fields. Scheduled meeting locations store the resolved kind, text, join URL, status
  (`processing`, `initiated`, `pushed`, `failed`), provider data (meeting id, passcode, dial-in) and the configuration
  id chosen.
- **Pre-booking display**: conferencing kinds show "Web conferencing details provided upon confirmation." (observed);
  after booking, before the link exists: "Web conferencing details to follow."
- **Acceptance**: serializers map scheduled event location `type` values like Calendly (`physical`, `outbound_call`,
  `inbound_call`, `google_conference`, `zoom`, `microsoft_teams_conference`, `custom`, `ask_invitee`).

### VID-02 In-person (P0)

- **Behavior**: Fields "Location" (address or venue name, can contain line breaks and notes such as "[Business Casual
  Dress Code]") and "Additional information" (street address, notes), plus checkbox "Display location only after
  confirmation" (default off). Booking page shows a pin icon and the location (or "Location will be provided after
  booking"). Calendar event location = location plus additional information.
- **Acceptance**: the observed owner meal locations render with line breaks preserved.

### VID-03 Phone call: host calls invitee (P0)

- **Behavior**: Option "Require invitee's phone number" (`outbound_call`). The form adds a required "Phone number"
  field with country selector and the hint "Require the invitee's phone number to help reduce no-shows" is shown to the
  host in the editor. Not available for round robin. Booking page: phone icon + "Phone call".
- **Acceptance**: booking without a valid phone fails with "This phone number format is not recognized. Please check
  the country and number."

### VID-04 Phone call: invitee calls host (P0)

- **Behavior**: Option "Provide a phone number to invitees after they schedule" (`inbound_call`) with required host
  phone (E.164) and optional additional info. Booking page: "You will call the Host. Phone number will be provided upon
  booking completion." Confirmation, emails and calendar show the number.
- **Acceptance**: the number never appears on the booking page before booking.

### VID-05 Custom location (P0)

- **Behavior**: Free text or URL (255 chars) with radio "Display on booking page" or "Display only after booking".
  URLs are clickable in confirmations and emails. Recommended for unsupported video tools.
- **Acceptance**: "only after booking" hides the text in public HTML before booking.

### VID-06 Ask invitee (P0)

- **Behavior**: Adds a required "Location" text field on the form (label "Location", placeholder "Any location"; when
  among multiple options the radio label is "Somewhere else") with an optional host prompt shown as helper text.
- **Acceptance**: the invitee's text becomes the meeting location.

### VID-07 Google Meet (P0)

- **Behavior**: Available when the organizer's destination calendar is Google. Created as part of the Google event
  insert (`conferenceData.createRequest`, `hangoutsMeet`); the join URL comes from `hangoutLink` or the video entry
  point; if `statusCode` is `pending`, the event is re-read until success (up to 3 times over 30 seconds). If the
  destination is not Google, the editor shows "You must configure your calendar connections to push events to a Google
  Calendar to host Google Meet web conferences on your events." and booking pages hide this option (our choice: the
  event type remains bookable with other options; if Meet is the only option, the meeting is booked with "Web
  conferencing details to follow." and the host is emailed to fix the setup).
- **Acceptance**: mocked Google insert returns a Meet link stored on the meeting and used by the stable join link.

### VID-08 Microsoft Teams (P1)

- **Behavior**: Available when the organizer's destination calendar is Microsoft and the calendar's
  `allowedOnlineMeetingProviders` includes `teamsForBusiness`. Created via Graph event `isOnlineMeeting=true`,
  `onlineMeetingProvider=teamsForBusiness`; join URL from `onlineMeeting.joinUrl`. Personal Microsoft accounts are not
  supported (the editor shows "Microsoft Teams requires a work or school Microsoft 365 account."). When the Teams link
  is not returned, status `failed` and the host is emailed.
- **Acceptance**: mocked Graph event response provides the join URL.

### VID-09 Zoom (P1)

- **Behavior**: When `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` are set, Integrations > Zoom "Connect" runs OAuth
  (PKCE), stores tokens (refresh tokens rotate, persist atomically) and the Zoom user email. At provisioning, creates a
  scheduled meeting (`POST /users/me/meetings`, type 2, UTC start, duration, topic = meeting title, agenda = description,
  settings from the user's Zoom defaults, `join_before_host: true` (our choice), waiting room per Zoom default), stores
  id, join URL, passcode and dial-in numbers. Reschedule PATCHes, cancel DELETEs (with `cancel_meeting_reminder=true`).
  Disconnect revokes the token.
- **Acceptance**: mocked Zoom API: create, update, delete called with the right payloads; tokens rotated on refresh.

### VID-10 Jitsi Meet (P0)

- **Behavior**: No credentials. At provisioning, the join URL is `https://meet.jit.si/{AppName}-{random 20 char
  base32}` (configurable base URL `JITSI_BASE_URL`). Kept on reschedule; nothing to delete on cancel.
- **Acceptance**: every Jitsi meeting gets a unique, unguessable room URL.

### VID-11 Stable join link (P1)

- **Behavior**: `/events/{scheduledEventId}/join` redirects (302) to the provider join URL when available; while
  processing, shows a small page "Your meeting link is being prepared. This page will refresh automatically." (refresh
  every 5 seconds, up to 2 minutes); for canceled meetings "This meeting was canceled."; for non-conferencing
  locations it shows the location details. Emails and ICS files include both the stable link and the provider link once
  known (our choice).
- **Acceptance**: the redirect target updates after a reschedule regenerates the link.

### VID-12 Conference generation lifecycle (P0)

- **Behavior**: Conference links are generated at booking time in the provisioning job, never at event type creation.
  Statuses: `processing` (queued), `initiated` (request sent), `pushed` (details available), `failed`. Failures retry
  with the job backoff (up to 8 attempts); after final failure the host gets "We couldn't create a {Provider} link for
  your meeting with {Invitee}" with a link to the meeting, where "Retry" re-runs provisioning. Conference details are
  kept indefinitely (no 6-month purge (our choice)).
- **Acceptance**: a provider 500 followed by success on retry ends with status `pushed`.

### VID-13 Multi-host conferencing (P1)

- **Behavior**: Collective: the event type's "Meeting organizer" host (default: the event owner or first host) creates
  the conference with their account and holds the calendar event; other hosts are attendees. Round robin: the assigned
  host's account. Multi-pool: the first required co-host, else the host of the first pool. If the organizer lacks the
  needed connection, the location falls back per VID-07 rules.
- **Acceptance**: a collective Zoom meeting uses the organizer's Zoom token.

### VID-14 Reschedule and cancel effects (P1)

- **Behavior**: Rescheduling keeps the same conference when the provider supports updates (Zoom PATCH, Google/Microsoft
  event move keeps the link, Jitsi unchanged) and updates times; round robin reassignment to a different host creates
  a new conference with the new host's account and deletes the old one. Cancel deletes standalone conferences (Zoom)
  and the calendar event (which removes Meet/Teams).
- **Acceptance**: rescheduling a Zoom meeting results in one PATCH and no new meeting.

### VID-15 Default location (P2)

- **Behavior**: Settings > Profile "Default location for new event types" (none, Google Meet, Teams, Zoom, Jitsi,
  phone, custom). Applied to new event types only.
- **Acceptance**: with default Jitsi, a new event type starts with a Jitsi location.

### VID-16 Webex and GoTo Meeting (P3)

- **Behavior**: Shown as "Coming soon" tiles; adapters follow the same conferencing provider interface when built.
- **Acceptance**: no booking page offers these kinds until implemented.

---

## 8. BK: Public booking flow (invitee side)

All public pages share the shell: `#FAFAFA` canvas, centered white card (1px `#D4E0ED`, 8px radius, shadow `0 1px 8px
0 rgb(0 0 0 / 8%)`), Figtree, "Cookie settings", "Privacy Policy" and "Report abuse" (GEN-21) links at the bottom of
the left panel, and the diagonal "POWERED BY / {AppName}" ribbon (GEN-01) in the card's top-right corner unless
branding hides it (BR-06). Landing pages render system copy in the owner's locale when it is one of the supported
invitee languages (GEN-10), otherwise English; event pages use the event type's language (ET-28).
Exact ribbon geometry: 105x105 clip box at `top: -5px; right: -5px`, 160px band rotated 45 degrees, fill `#505960`
(hover `#40474C`), "POWERED BY" 8px uppercase and the app name 14px bold, band shadow `0 2px 4px 0 rgb(0 0 0 / 20%)`,
two 6x6 fold squares; on phones `top: 15px; left: -5px` and 7px label.

### BK-01 User landing page (P0)

- **Behavior**: `/{userSlug}`. Card about 1060px max width, centered. Top center: avatar (64px circle; initials on
  `#E7EDF6` when no photo), host name (`#476788`, 600, 16px), welcome message (`#476788`, 14px, centered, max width about
  280px; default "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.").
  Optional logo (BR-05) at the top-left of the card. Then active, non-secret personal event types in a two-column grid
  (one column under 650px) ordered by position: each item has a top border `#D4E0ED`, a 26px filled color circle, the
  event name (`#0A2540`, bold 16px), an optional 2-line description excerpt (our choice), and a small dark
  right-pointing triangle at the far right; rows are tall (about 220px) with whitespace below the title (observed);
  the whole item is a link to `/{slug}/{eventSlug}?back=1` with hover background `#F4F8FF`. Bottom-left "Cookie
  settings" link (`#004EBA`). Page title "{Name} - {AppName}".
- **Edge cases**: no public event types: "No event types available" (our choice "{Name} doesn't have any events
  available right now."). Deactivated or deleted user: 404.
- **Acceptance**: the seeded owner page shows "30 Minute Virtual", "60 Minute Virtual", "In-Person Meal or Coffee"
  with purple, purple and green circles in a 2-column grid.

### BK-02 Team landing page (P1)

- **Behavior**: `/{teamSlug}` renders like BK-01 with the team avatar, team name, team welcome message, and the team's
  active, non-secret event types. Shared event types never appear (ET-34). System copy uses the organization owner's
  locale when supported, else English.
- **Acceptance**: a team with 2 public event types shows both; booking links are `/{teamSlug}/{eventSlug}`.

### BK-03 Booking page layout (P0)

- **Behavior**: `/{slug}/{eventSlug}`; document title "Select a Date & Time - {AppName}". Wrapper margin-top 66px,
  bottom 30px, side padding 5%. Card width 95%, max 800px, min height 550px before a date is chosen; after a date is
  chosen the card widens to min 900px, max 1060px with a 0.22s ease-out transition. Two panels: left details panel 50%
  (min 300px) with right border `#D4E0ED`, shrinking to 35% when the times column opens; right main panel.
- **Left panel** (top to bottom): optional circular back button (44px, 1px border, blue arrow) when `back=1`; optional
  branding logo or large host avatar (about 120px) with a divider below (observed screenshot); small host avatar
  (64px); host name (`#476788`, 16px bold); event name (h1, 28px bold, 32px line height, `#0A2540`); detail rows with
  20px icons in `#476788` and 16px semibold text: clock + "30 min" (or duration dropdown, BK-07), location row
  (VID-01 display rules; multiple locations list every option on its own row, in order, identical rows once), card
  icon + price "$100.00 USD" when paid (PAY-02), globe + locked time zone when locked; description rich text; bottom
  links "Cookie settings" and "Privacy Policy".
- **Right panel**: heading "Select a Date & Time" (22px bold); month calendar (BK-04); "Time zone" block (BK-05);
  troubleshoot link for the owner (BK-24).
- **Multi-host header** (replaces the single host avatar and name in the left panel): collective events show stacked
  avatars of the hosts (up to 3, then a "+{n}" circle) and the names "A, B" for two hosts or "A and {n} others" for
  three or more; round robin team events show the team avatar and team name (the assigned host is unknown before
  booking); round robin shared events show the pool's stacked avatars without names; multi-pool events show the
  required co-hosts like collective plus a "+{n}" circle for the pools (our choice for shared and multi-pool).
- **Acceptance**: the seeded `30min` page matches `.reference/booking-30min.png` layout; a 4-host collective event
  shows 3 avatars, "+1" and "Ana and 3 others".

### BK-04 Month calendar (P0)

- **Behavior**: Month header centered "October 2026" (14px bold) with 38px circular arrow buttons (blue chevrons,
  `#F4F8FF` fill when enabled), aria-labels "Go to previous month" / "Go to next month"; previous is disabled on the
  current month (in the invitee zone). Weekday header Sun..Sat (Monday first when the invitee locale's week starts on
  Monday) in `#476788` 12px semibold. Days are 44x44 circle buttons with 16px text: available days `#F4F8FF` fill, bold
  `#004EBA` text (driven by `--primary-color`); unavailable days no fill, `#476788` text, disabled; hover `#E6F0FF`;
  selected `#006BFF` fill with white text; today shows a 4px dot 13px below the number; adjacent-month days are
  rendered with `visibility: hidden`. If the initial month has no availability, the calendar jumps to the first month
  with availability within the next 12 months (our choice); if none, all days are disabled and the panel shows "No
  times available" with "View next month" (our choice for copy).
- **Data**: the client fetches a whole month of slots per request in the invitee zone (BK-31) and prefetches the next
  month after the first render.
- **Acceptance**: in a test month where only Tuesdays have slots, only Tuesday circles are enabled and filled.

### BK-05 Time zone selector (P0)

- **Behavior**: Below the calendar: label "Time zone" (bold), then a button with a globe icon, the friendly zone name
  ("Eastern Time - US & Canada") and the current local time in parentheses ("(6:53pm)", updates every minute) and a
  caret (observed). Opens a dropdown: search input, "am/pm | 24h" toggle, grouped list (GEN-06) with current times.
  Default zone: browser zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) (observed). If the browser zone
  differs from the displayed one (for example after a manual change or a locked zone), show "These times are currently
  listed in {zone}. Would you like to view times in {local zone} instead?" (our choice: shown only when the page loaded
  with a zone param or lock). Hidden when the event locks the zone. Changing the zone re-renders days and times and is
  carried into the details form and the booking, together with the detected browser zone and the "am/pm | 24h" choice
  (stored on the invitee, GEN-06).
- **Acceptance**: with Playwright `timezoneId: Asia/Kolkata`, the selector shows "India, Sri Lanka Time" (Calendly's
  zone label) and slot labels match IST.

### BK-06 Time slot list and Next (P0)

- **Behavior**: Selecting a date adds a third column: date subtitle "Wednesday, October 14" (16px, 38px tall, sticky on
  tablet) and a scrollable list of time buttons (100% width, 52px tall, 1px border `#006BFF`, `#004EBA` bold text,
  4px radius, 10px vertical gaps); hover/focus 2px border. Labels "9:00am" (12h) or "09:00" (24h). Group events with
  "Display remaining spots" show "{n} spots left" (or "1 spot left") under the time. Clicking a time splits it:
  left 48.5% the selected time on `rgba(10,37,64,0.5)` with white text; right 48.5% (3% gap) blue "Next" button
  (`#006BFF`, white text, shadow `0 1px 6px 0 rgba(10,37,64,0.1)`) sliding in from `translateX(40px)`. Clicking another
  time moves the split. "Next" navigates to the details form (BK-08). URL gains `&date=YYYY-MM-DD`.
- **Acceptance**: keyboard: Tab to a time, Enter selects it and focuses "Next"; Enter on "Next" opens the form.

### BK-07 Duration picker (P1)

- **Behavior**: With multiple durations, the clock row becomes a select ("30 min" with chevron) listing options in
  configured order (default first). Changing it refetches slots and keeps the selected date if still available. The
  chosen duration is carried as `duration` query param and into the booking. On a reschedule page the picker starts on
  the original meeting's duration when it is still an option, otherwise on the default (CR-03).
- **Acceptance**: switching to 60 min updates the times list and the details form shows "60 min".

### BK-08 URL state and deep links (P0)

- **Behavior**: `?month=YYYY-MM` opens a month; `&date=YYYY-MM-DD` preselects a date (in the invitee zone); the path
  `/{slug}/{eventSlug}/{ISO start}` opens the details form for that exact slot (observed), accepting `Z` or offset
  forms, with `month` and `date` params kept for the back button. If the deep-linked slot is not available, redirect to
  the calendar with the date preselected and show "Sorry, that time is no longer available." `back=1` shows the back
  button to the landing page. Other params (prefill, UTM, display params, embed params) persist across steps.
- **Acceptance**: opening `/julianjoseph/30min/2026-10-13T18:00:00Z` with an available slot shows the form with
  "11:00am - 11:30am, Tuesday, October 13, 2026" in Pacific time.

### BK-09 Details form ("Enter Details") (P0)

- **Behavior**: Left panel keeps the details and adds calendar icon + "10:00am - 10:30am, Wednesday, October 14, 2026"
  and globe + zone name (reschedules also show "Former Time" with the old time struck through, CR-03). Right panel:
  back arrow button (to the calendar, keeping state), heading "Enter Details", then fields in this order: Name ("Name
  *" or "First Name *" and "Last Name *"), "Email *", "Add Guests" (BK-10), location choice (BK-11), outbound phone
  (VID-03), custom questions in order (BK-12), SMS reminder number (BK-13), marketing consent (BK-14), payment block
  (PAY-03), terms text "By proceeding, you confirm that you have read and agree to {AppName}'s Terms of Use and Privacy
  Notice." (links to `/terms` and `/privacy`), then the primary pill "Schedule Event" (reschedule: "Update Event"),
  disabled with a spinner while submitting. Labels are bold 14px above inputs; required fields have an asterisk;
  inputs are about 46px tall.
- **Validation**: inline red text: "Can't be blank." (required text), "Enter a valid email address." (our choice),
  "One answer must be selected." (radio and dropdown), "At least one answer must be checked." (checkboxes), "This phone
  number format is not recognized. Please check the country and number." Email is lowercased for matching but stored
  as typed.
- **Acceptance**: submitting empty shows errors for Name and Email and required questions without losing other input.

### BK-10 Guests (P0)

- **Behavior**: "Add Guests" secondary pill reveals "Guest Email(s)" chips input (comma, space or Enter separates) with
  helper "Notify up to 10 additional guests of the scheduled event." Max 10 unique valid emails, excluding the invitee
  email. Hidden when the event disallows guests and for group events. Guests receive the invitation (calendar
  attendees or our email with ICS) and appear in meeting details; they cannot cancel or reschedule (our choice: their
  emails contain no manage links).
- **Acceptance**: an 11th guest email is rejected with "You can add up to 10 guests."

### BK-11 Location choice (P0)

- **Behavior**: With more than one location option, a required radio list "Location" shows each option with icon and
  label (in-person shows the location text; video shows the provider name; inbound call "Phone call (you will call the
  host)"; outbound "Phone call (the host will call you)" plus phone input when chosen; custom shows its text when
  displayed on the booking page; ask invitee "Somewhere else" plus text input). Error "One location must be selected."
- **Acceptance**: the choice is stored and becomes the meeting location.

### BK-12 Custom questions (P0)

- **Behavior**: Rendering per type: One line (input), Multiple lines (textarea, 4 rows), Radio buttons (radio group),
  Checkboxes (checkbox group; single-option checkbox works as consent), Dropdown (select with placeholder "Select..."),
  Phone number (phone input). "Other" option adds a free text input when chosen. Question text may contain a URL
  rendered as a link. Disabled questions are not rendered. Max answer length 10,000 chars (our choice). Answers are
  stored with the question text snapshot and position; multi-select answers stored as an array and joined with
  newlines in API output (Calendly parity).
- **Acceptance**: required checkbox questions block submission until one is checked.

### BK-13 SMS reminder number (P1)

- **Behavior**: When any active workflow or basic notification for the event type sends texts to invitees, the form
  shows "Send text messages to" phone input (never required) with consent text "By entering your phone number, you
  consent to receive messages for this event via SMS. Message and data rates may apply. Reply STOP to opt out." Numbers
  are stored in E.164. Numbers in unsupported countries (Russia, Singapore, Iran (our choice per Calendly)) are rejected
  with "Text messages aren't available for this country."
- **Acceptance**: with an SMS workflow, the field appears; without, it does not.

### BK-14 Marketing consent and terms (P2)

- **Behavior**: When enabled (ET-24), optional checkbox "I'd like to subscribe to future emails." stored on the invitee
  and contact; exported in CSV ("Invitee accepted marketing emails").
- **Acceptance**: the flag appears in the meetings export.

### BK-15 Prefill via URL parameters (P1)

- **Behavior**: `name`, `first_name`, `last_name`, `email`, `location` (location answer; the phone for outbound
  call), `a1` to `a10` (answers by question order: text for text types, 1-based option indexes for radios and checkboxes
  like `a3=2,3`, exact answer text for dropdowns), `guests` (comma-separated emails), `utm_source`, `utm_medium`,
  `utm_campaign`, `utm_content`, `utm_term`, `salesforce_uuid` (stored as tracking), `duration`, `routing_form_submission`
  (RF-11). Values are URL decoded; invalid prefill values are ignored silently. Prefilled fields remain editable.
  "Other" text and the SMS number cannot be prefilled (Calendly parity). Embed prefill objects map to these params
  (API-13).
- **Acceptance**: `?name=Ana%20Lima&email=ana@example.com&a1=Hello` fills the form.

### BK-16 Autofill from prior bookings (P2)

- **Behavior**: When the event type enables autofill, after a successful booking the browser stores name, email and
  SMS number in localStorage (key per app, not per host) and later forms on this app prefill them (our choice of
  mechanism: client-side only, no server lookup by email to avoid data leaks). A "Not you?" link clears them.
- **Acceptance**: a second booking in the same browser shows the stored name and email.

### BK-17 Email verification before booking (P2)

- **Behavior**: When enabled, "Schedule Event" validates the form, creates a 10-minute slot hold under the booking locks
  (SCH-19; one seat for group slots, a provisional host for round robin), sends a 6-digit code and shows "Verify your
  email": "To complete your booking, enter the 6-digit code sent to {email}", code input, "Remember this device"
  checkbox (365 days for that email, httpOnly cookie, embed-safe per GEN-08), "Didn't get it? Resend code" (max 5 per
  hour), "Continue". Codes expire in 10 minutes, 5 attempts. Unverified attempts create no booking and no notification.
  Remembered devices skip verification for that email. Reschedules (CR-03) never ask for verification: the invitee
  link already proves the email.
- **Acceptance**: an incorrect code shows "That code isn't correct. Try again."; the correct code completes the
  booking.

### BK-18 Bot protection (P1)

- **Behavior**: Every booking, poll vote and routing submission includes a hidden honeypot field and a minimum form
  time of 2 seconds since render (signed render timestamp); failures return a generic error and create nothing. When
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, an invisible Cloudflare Turnstile check runs on submit.
  Rate limits: 10 booking attempts per IP per 10 minutes per event type, 30 per IP per hour overall.
- **Acceptance**: a submission with the honeypot filled is rejected without creating any rows.

### BK-19 Submission and race handling (P0)

- **Behavior**: Submit sends the form plus slot, duration, zone, locale, tracking and context (single-use code,
  reschedule token, routing submission). Server validates (zod), checks blocked invitees (BK-28), runs SCH-20, then
  creates the scheduled event (or joins the group slot), invitee, guests, answers, round robin assignment, consumes
  single-use or one-off links atomically, publishes `booking.created`, and returns the invitee id. On "no longer
  available", the form stays filled and a banner offers "View Times" which returns to the calendar with the date
  preselected. Duplicate submits (double click) are absorbed by a client request id (idempotent for 10 minutes, checked
  again inside the locked transaction so the second click returns the first booking even while it is in flight). A
  group booking by an email that already holds a seat in that slot fails with "You've already booked this time."
  (SCH-14).
- **Acceptance**: double-clicking "Schedule Event" creates one booking and both responses carry the same invitee id.

### BK-20 Confirmation page (P0)

- **Behavior**: `/booking/{inviteeId}`: single centered card with optional host avatar, green check circle and heading
  "You are scheduled" (subtext "You are scheduled with {Host name}." for one-on-one), then "A calendar invitation has
  been sent to your email address." (calendar invitation mode) or "A confirmation has been sent to your email address."
  (email mode; with payment: "A confirmation and payment receipt have been sent to your email address."). Summary box:
  event name (bold 18px), person icon + host name(s) (round robin: the assigned host), calendar icon + "10:00am -
  10:30am, Wednesday, October 14, 2026", globe + zone name, location row (address, phone, "Web conferencing details to
  follow." or the join link once available). "Add to calendar" buttons (BK-22). In calendar invitation mode, when the
  provider returned a link to the event (Google `htmlLink`, Graph `webLink`), an optional secondary button "Open
  Invitation" opens it in a new tab (our choice: shown only when the link exists). Links: "Schedule another event"
  (custom label, ET-26) to the same booking page, then custom links. Optional footer "Powered by {AppName}". Times use
  the invitee's stored zone and time format (GEN-06). Reschedule confirmation title "You are rescheduled" / "You are
  rescheduled with {name}." Page is accessible only with the invitee id (capability URL) and is `noindex`.
- **Acceptance**: after booking, the page shows the exact time in the invitee zone and an ICS link that downloads a
  valid file.

### BK-21 Redirect after booking (P1)

- **Behavior**: When the event redirects, the page shows "You will be redirected to an external site." / "Redirecting"
  and navigates (top-level, also from embeds via postMessage to the parent and `target=_top` fallback) to the URL. With
  "Pass event details", append: `event_type_name`, `event_type_uuid`, `event_start_time`, `event_end_time` (ISO 8601 in
  the invitee zone), `guests` (comma list), `assigned_to` (host name), `invitee_uuid`, `invitee_email`,
  `invitee_first_name`, `invitee_last_name`, `invitee_full_name`, `invitee_payment_amount`, `invitee_payment_currency`,
  `text_reminder_number`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `answer_1` to
  `answer_10`.
- **Acceptance**: redirect URL contains `invitee_email` and `answer_1` URL-encoded.

### BK-22 Add to calendar (P0)

- **Behavior**: Confirmation page and invitee emails offer "Google", "Outlook.com", "Office 365", "Apple / iCal" (ICS
  download) links (our choice: always, Calendly shows them at least for email confirmations). Google and Outlook links
  are template URLs with title, times, location and details; ICS is `/booking/{inviteeId}/event.ics` with the same UID as
  emailed invites, or, in calendar invitation mode, the provider's iCal UID (CAL-12), so the file updates the invite the
  invitee already holds instead of adding a second copy.
- **Acceptance**: the Google link opens a prefilled event with correct UTC times; for a calendar invitation meeting the
  downloaded ICS UID equals the stored provider iCal UID.

### BK-23 Unavailable, off, secret and not found states (P0)

- **Behavior**: Unknown slug or event: 404 card "This page isn't available" with "The link may be broken or the page
  may have been removed." and a link to the homepage (our choice). Event off: card "This event type is not currently
  available" (200, `noindex`). Single-use link already used: "Someone has already used this link to book a meeting."
  (our choice wording from the community thread title). One-off already booked or expired: "This meeting has already
  been booked." / "This link has expired." Loading: skeleton bars in the details panel and a spinner in the calendar.
- **Acceptance**: each state renders with the right HTTP status (404 for unknown, 200 for off/used/expired).

### BK-24 Owner banner, troubleshoot and preview (P1)

- **Behavior**: When the logged-in host views their own booking page, a top banner shows "You are logged in as
  {email}. This message is only visible to you." and a toolbar with "Troubleshoot Availability", "Edit event type",
  "Copy link". Troubleshoot mode: pick a date to see every candidate start, available ones as normal buttons and
  unavailable ones with a dashed border `1px dashed #A6BBD1` and the reason code chip (SCH-21); clicking a code opens a
  side sheet with the explanation and fix hint, and for CALENDAR shows the blocking event title and calendar (owner
  only). "Stop troubleshooting" exits. Owners can book their own event (allowed, our choice). Preview mode for the
  editor (ET-29) renders draft data delivered by postMessage and disables booking ("Booking is disabled in preview").
- **Acceptance**: troubleshoot on a day with a busy external event shows CALENDAR on the overlapping starts.

### BK-25 Embed rendering mode (P1)

- **Behavior**: When loaded with `embed_type` (`Inline`, `PopupWidget`, `PopupText`) and `embed_domain`, public pages
  render without the outer canvas margins, use the modern embedded card (no border, 1.25rem radius, soft shadow
  `0 16px 48px 0 rgb(25 72 112 / 6%), 0 0 24px 0 rgb(25 72 112 / 6%)` (Inline) or full-bleed (popup)), open links
  inside the frame, and post messages to the parent (API-15). Responsive layout thresholds inside the frame: large
  (1100px and up), medium (650 to 1099px), small (below 650px); minimum width 320px. Cookie banner hidden when
  `hide_gdpr_banner=1`. Cookies the flow needs inside a third-party iframe use the embed-safe attributes with a
  localStorage fallback (GEN-08). Paid events in embed mode never load Stripe Checkout inside the iframe (Stripe
  refuses to be framed): PAY-03 defines the embed path.
- **Acceptance**: an inline embed posts `calendly.event_type_viewed` and `calendly.page_height` on load; booking with
  email verification and "Remember this device" inside a cross-site iframe skips verification on the next booking.

### BK-26 Display parameters (P1)

- **Behavior**: `hide_event_type_details=1` hides avatar, host name, event name, duration, location and description
  on event pages (the card becomes single-column calendar). `hide_landing_page_details=1` hides avatar, name and
  welcome message on landing pages. `hide_gdpr_banner=1` hides the cookie banner. `background_color`, `text_color`,
  `primary_color` (hex without `#`) override the card background, text color and `--primary-color` (buttons, links,
  available days). Invalid colors are ignored. Params work on direct links and embeds (our choice: no plan gating). The
  embed script maps Calendly's `pageSettings` object to these params (API-13).
- **Acceptance**: `?primary_color=ff0000` turns available day text and the Next button red.

### BK-27 Single-use, one-off and shared links (P1)

- **Behavior**: `/d/{code}/{slug}` resolves the code to a single-use link (event type plus overrides, OO-02), a
  one-off meeting (OO-09), or a shared event type (ET-34), and renders the same booking flow with the resolved
  settings; `/d/{code}` redirects to the canonical slug path, and `/d/{code}/{anyOtherSlug}` (for example an old slug
  after the link ending or event slug changed) redirects with 301 to the current slug, keeping the start segment and
  query. Consumed or expired links show BK-23 states. The details form path is `/d/{code}/{slug}/{ISO start}`. All `/d/*`
  pages are `noindex` (GEN-13).
- **Acceptance**: a single-use link shows its overridden name and duration and becomes "already used" after one
  booking; after renaming a one-off link ending, the old `/d/{code}/{oldSlug}` URL answers 301 to the new one.

### BK-28 Blocked invitees (P2)

- **Behavior**: Bookings from emails (or email domains, our extension) on the host's block list (BR-13) fail with the
  generic "Sorry, that time is no longer available." after a realistic delay (no disclosure of the block) (our
  choice). Blocks apply to all event types where the blocking host is a host.
- **Acceptance**: a blocked email cannot complete a booking and no notification is sent.

### BK-29 Booking page analytics events (P2)

- **Behavior**: The booking flow records first-party analytics events (AN-11): `profile_page_viewed`,
  `event_type_viewed`, `date_and_time_selected`, `event_scheduled`, with event type, host, UTM, embed flag and a
  per-tab anonymous session id (no cookies, no PII). Also emits GA4/Meta Pixel events after consent (AN-12) and
  postMessage events in embeds (API-15).
- **Acceptance**: viewing a booking page creates one `event_type_viewed` row.

### BK-30 Responsive behavior (P0)

- **Behavior**: GEN-04 modes. Phone: details centered at top (event name 26px, side padding 25px), calendar full width,
  selecting a date navigates to a times view with a back arrow and the date heading; details form single column with a
  sticky submit button.
- **Acceptance**: e2e on 390x844 completes a booking.

### BK-31 Public booking endpoints (P0)

- **Behavior**: `GET /api/public/slots?target={eventTypeId|link code}&start=YYYY-MM-DD&end=YYYY-MM-DD&tz=Area/City&duration=30`
  returns `{ timeZone, days: { "YYYY-MM-DD": [{ start: ISO UTC, remaining: number }] }, firstAvailableDate?: string }`
  grouped by the requested zone's local dates; the range is at most 62 days; responses `Cache-Control: no-store`.
  Owners can add `troubleshoot=1` to receive reason codes. Abuse limits: 60 slot requests per IP per minute and 600 per
  hour (429 beyond); a range that lies entirely outside the booking window answers `days: {}` immediately without
  loading busy times or calling calendar providers (our choice). Booking submission is a server action (or `POST
  /api/public/bookings` with the same contract for embeds) returning `{ ok: true, inviteeId, redirectUrl? }` or `{ ok:
  false, code: "slot_unavailable" | "validation" | "blocked" | "verification_required" | "payment_required" |
  "already_booked" | "link_used", ... }`.
  Verification and payment continue via `/api/public/bookings/{reservationId}/verify` and the payments flow (PAY-03).
- **Acceptance**: the slots endpoint returns identical slots to the engine unit test fixtures for the seeded data.

### BK-32 Paid booking step (P2)

- See PAY-03 and PAY-04.

### BK-33 Mutual availability: "Show times you're free" (P3)

- **Behavior**: When a signed-in user of this instance (any organization) opens someone else's booking page, the
  calendar header shows a toggle "Show times you're free". When on, the page loads the viewer's own conflict-calendar
  busy times and app meetings for the visible month (same logic as MP-13 for signed-in voters, via the viewer's own
  session, never exposing the host's data to the viewer or the viewer's titles to the host), marks overlapping time
  buttons with a "Conflict" label and a muted style (still selectable), and adds a legend. The choice persists in
  localStorage. Signed-out visitors do not see the toggle.
- **Acceptance**: a signed-in viewer with a busy event at 10:00 sees the 10:00 slot labeled "Conflict"; the slots API
  response for the host is unchanged.

---

## 9. CR: Cancellation, rescheduling, no-shows and host actions

### CR-01 Cancel and reschedule links (P0)

- **Behavior**: Invitee confirmation emails, calendar event descriptions and reminders include "Need to make changes to
  this event?" with "Cancel" (`/cancellations/{inviteeId}`) and "Reschedule" (`/reschedulings/{inviteeId}`) links when
  the event type setting "Include cancel and reschedule links" is on (default; all or nothing). SMS messages include
  links only when the template uses `{{cancel_url}}` or `{{reschedule_url}}`. Disabling links does not prevent the
  invitee from booking again through the public page.
- **Acceptance**: with links off, no invitee email contains `/cancellations/`.

### CR-02 Invitee cancel page (P0)

- **Behavior**: `/cancellations/{inviteeId}`: two-panel card; left: event details (name, host, time, zone, location);
  right: heading "Cancel Event?" (Calendly string), optional "Reason for canceling" textarea (required when the event
  type sets "Require a reason" (extension)), cancellation policy text if set, primary pill "Cancel Event". Group
  events and meetings with guests show "This event will be canceled for {invitee_name} and {count} guests" when guests
  exist. After submit: "Cancellation Confirmed", "Your meeting with {Host name} has been canceled.", and "Schedule
  another event" (back to the booking page). Already canceled: "This event has already been canceled."; past (the
  meeting's start time has passed, our choice for both cancel and reschedule): "This event has already occurred.";
  cutoff active: SCH-23 message. A link of an old invitee that was rescheduled follows the `new_invitee` chain and
  redirects to the page of the currently active invitee of that chain (so links in older emails keep working); only
  when the chain ends in a canceled invitee does it show the canceled state. Canceling still works when the event type
  is now off or deleted. Canceling takes the same row lock as rescheduling (SCH-20), sets the invitee canceled
  (`canceler_type = invitee`), cancels guests, cancels the scheduled event when no active invitee remains, triggers
  CR-16 side effects and NT-03 notifications, frees the slot, and fires `invitee.canceled`.
- **Acceptance**: e2e cancels via the link from the outbox email and sees the slot available again on the booking
  page.

### CR-03 Invitee reschedule flow (P0)

- **Behavior**: `/reschedulings/{inviteeId}` opens the booking flow for the same event type (or same single-use
  overrides) with the left panel showing a small "Former Time" label above the old date and time struck through. Slots
  are computed per SCH-24 (the invitee's own meeting is excluded from busy, limits, round robin counts, seats and its
  own reservation). The new meeting uses the event type's current settings (buffers, locations, questions,
  templates). With multiple durations, the duration picker starts on the original duration when it is still an option,
  otherwise on the default (BK-07). Step 2 is prefilled with the stored name, email, guests, location choice and answers
  (all editable; the location radio keeps the original choice when that option still exists) and adds "Reason for
  change" (optional; cannot be required, Calendly parity). Email verification (BK-17) is skipped. Button "Update
  Event". Confirmation "You are rescheduled" with the new time and the old time struck through. Rescheduling obeys
  normal availability (no override). Paid events show "You have previously paid for this event and will not be charged
  again." Round robin follows the reschedule preference (CR-09). Old invitees' links follow the `new_invitee` chain
  (CR-02). Not available (page shows "This event can no longer be rescheduled." with "Schedule another event", while
  the cancel link keeps working) for canceled meetings, meetings whose start time has passed, event types that are now
  off or deleted, one-off meetings (OO-09) and poll meetings (MP-21).
- **Acceptance**: e2e reschedules from the email link; the old meeting is canceled, the new one active, and both
  invitees linked; opening the old invitee's reschedule link afterwards lands on the new invitee's reschedule page; with
  the event type turned off, the reschedule page shows "This event can no longer be rescheduled." and the cancel page
  still cancels.

### CR-04 Reschedule data model (P0)

- **Behavior**: A reschedule cancels the old invitee (`status = canceled`, `rescheduled = true`, `new_invitee_id` set,
  cancellation reason = reschedule reason, canceler = whoever rescheduled) and creates a new invitee (`old_invitee_id`
  set) on a new scheduled event (one-on-one and multi-host) or on the target group slot. For one-on-one and multi-host
  meetings, the new scheduled event inherits the provider calendar event (moved, not recreated), the conference (if
  the host is unchanged), and the ICS UID with SEQUENCE + 1, so invitee calendars update in place (our choice). The old
  scheduled event is canceled when it has no active invitees. Webhooks fire `invitee.canceled` (old, with
  `rescheduled: true`) then `invitee.created` (new). Workflows: pending executions of the old invitee are canceled and
  the new invitee gets the "Event is rescheduled" trigger plus normal scheduling (NT-15). An old invitee has at most one
  new invitee (enforced by a unique index); round robin assignment time and payments move to the new records.
- **Acceptance**: API shows the old invitee with `rescheduled: true, new_invitee` and the new with `old_invitee`.

### CR-05 Cancellation policy (P1)

- **Behavior**: Event type text (up to 2,000 chars) set in the invitation/confirmation editor (ET-25), shown on the
  cancel and reschedule pages, in confirmation emails, and before payment. Display only, not enforced (the optional
  cutoff is SCH-23).
- **Acceptance**: the policy appears on the cancel page.

### CR-06 Host cancel (P0)

- **Behavior**: From meeting details: "Cancel" opens "Cancel event" modal with the event summary, a textarea "Add a
  cancellation message" (optional, up to 2,000 chars, included in invitee emails as "Reason: ..."), buttons "Cancel"
  (dismiss) and red "Yes, cancel". Group meetings: canceling cancels all invitees ("Remove invitee" cancels one,
  CR-10). Invitee cancellation emails include a "Schedule again" link to the booking page unless links are disabled.
  Deleting or declining the event in the host's calendar cancels it (CR-17).
- **Acceptance**: host cancel sends the invitee a cancellation email with the reason and frees the slot.

### CR-07 Host "Reschedule meeting now" (P1)

- **Behavior**: From meeting details "Reschedule": a dialog with two choices: "Reschedule meeting now" (host picks a
  new time using the event's availability, with "Switch to your invitee's time zone" / "Switch to my time zone" toggle,
  and optional "Override available times" for single-host events (OO-14), then "Reschedule") and "Share new times to
  meet" (CR-08). Round robin asks "Keep {host} as host" or "Choose a specific host" or "Reassign through round robin"
  (our choice of copy). The invitee gets the reschedule email (NT-04).
- **Acceptance**: host reschedule moves the meeting and sends one reschedule email to the invitee.

### CR-08 Request reschedule ("Share new times to meet") (P2)

- **Behavior**: Cancels the current meeting (reason "The host asked to find a new time" or the host's message) and
  emails the invitee "{Host} would like to reschedule" with the host message and a button "Pick a new time" linking to
  the booking page prefilled with name, email and answers (`/reschedulings/{inviteeId}` stays valid for this purpose
  for 30 days (our choice)). Optional automatic reminder if the invitee has not rebooked in 1, 3 or 7 days.
- **Acceptance**: the reminder job is canceled when the invitee books again.

### CR-09 Round robin reschedule preference (P1)

- **Behavior**: "Reassign host(s) through round robin" (default): the reschedule runs assignment for the new time (the
  original host may or may not be chosen). "Use same hosts as original meeting": only times when the original host(s)
  are available are offered. Host-initiated reschedules from the Meetings page use round robin logic unless the host
  picks a specific host.
- **Acceptance**: with "Use same hosts", the reschedule page shows only the original host's availability.

### CR-10 Group meeting per-invitee actions (P1)

- **Behavior**: Group meeting details list invitees with a kebab per invitee: "Reschedule invitee" (moves only that
  invitee, CR-04 group variant: CANCEL for their old ICS UID, REQUEST for the new slot), "Remove invitee" (host cancel
  for one), "Mark as no-show" (CR-11), "Copy email". Meeting-level "Cancel" cancels everyone.
- **Acceptance**: removing one of 3 invitees leaves 2 active and the slot shows 1 more remaining seat.

### CR-11 No-shows (P1)

- **Behavior**: After the meeting's start time, meeting details show "Mark as no-show" per invitee (button). Confirm
  dialog "Mark {name} as a no-show?". Marked invitees show a "No-show" badge with "Undo". Marking fires
  `invitee_no_show.created`, the "No-show marked" workflow trigger, and suppresses post-meeting workflows for that
  invitee (NT-19); undo fires `invitee_no_show.deleted`. Exported as "Marked as No-Show".
- **Acceptance**: the button is absent before the start time and present after.

### CR-12 Block invitee (P2)

- **Behavior**: Within 90 days of a meeting's creation, details offer "Block invitee" (upcoming) or "Block attendee"
  (past): form with reason (Spam, Harassment, Other plus text), checkbox "Also block everyone at {domain}" (extension,
  off). Blocking cancels the invitee's upcoming non-group meetings with this host (standard cancellation email without
  reason text) and prevents future bookings (BK-28). Unblock from Settings > Privacy > Blocked people or from the past
  meeting ("Unblock attendee").
- **Acceptance**: after blocking, a new booking by that email fails.

### CR-13 Schedule invitee again / follow-up (P2)

- **Behavior**: Canceled or past meetings show "Book a follow-up meeting" (alias "Schedule invitee again"): opens the
  host booking dialog (OO-13) prefilled with the invitee and event type.
- **Acceptance**: the follow-up creates a new independent meeting.

### CR-14 Meeting notes (P1)

- **Behavior**: Meeting details "Notes" tab or "Add meeting notes" link: rich text editor (up to 10,000 chars) visible
  only to hosts and event editors; "Save". Notes appear in the CSV export ("Meeting Notes") and API
  (`meeting_notes_plain`, `meeting_notes_html`).
- **Acceptance**: notes never appear on invitee pages or emails.

### CR-15 Edit buffers of a booked meeting (P3)

- **Behavior**: With "Show buffers" on (MT-09), buffer blocks show a pencil to edit before/after minutes for that
  meeting or remove them; updates busy calculation and provider buffer events.
- **Acceptance**: removing the after buffer frees the following increment.

### CR-16 Calendar and conference side effects (P0)

- **Behavior**: Cancel: delete provider events (calendar invitation mode: provider sends cancellation; email mode: our
  email with ICS METHOD:CANCEL, same UID, SEQUENCE + 1), delete standalone conferences, release holds, cancel pending
  workflow jobs, fire webhooks. Reschedule: CR-04. All side effects are jobs (GEN-16).
- **Acceptance**: integration test: cancel produces one provider delete call and one CANCEL ICS email.

### CR-17 Host-side calendar changes (P1)

- **Behavior**: See CAL-14. Notifications to invitees use the standard reschedule or cancellation emails with reason
  "Rescheduled from connected calendar event" / "Canceled from connected calendar event".
- **Acceptance**: covered by CAL-14 tests.

### CR-18 Cutoff for invitee changes (P3, extension)

- See SCH-23.

### CR-19 Reassign a round robin host (P3, extension)

- **Behavior**: Meeting details for round robin meetings: "Reassign host" lists pool hosts available at that time (with
  priority and count); choosing one moves the calendar event (new host creates it, old host's copy deleted), regenerates
  the conference for the new host, updates assignment counts, and emails the invitee ("{New host} will now host your
  meeting") and both hosts.
- **Acceptance**: after reassigning, the meeting's host is the new user and counts update.

### CR-20 Edit invitee limit of a booked group slot (P2)

- **Behavior**: Group meeting details "Edit invitee limit": number input (at least the current active invitee count, at
  most 9,999), "Apply". Affects only that slot.
- **Acceptance**: raising the limit from 3 to 5 shows "2 spots left" for that slot when 3 are booked.

### CR-21 Payments on cancel and reschedule (P2)

- See PAY-07.

---

## 10. NT: Notifications and workflows

### NT-01 Invitee confirmation (P0)

- **Behavior**: Mode per CAL-12. Email confirmation: sent to the invitee and each guest within one minute of booking.
  Default subject "Confirmed: {{event_name}} with {{my_name}} on {{event_date}}". Body: "Hi {{invitee_first_name}},"
  (guests: "Hi,"), "Your {{event_name}} with {{my_name}} at {{event_time}} ({{event_time_zone}}) on {{event_date}} is
  scheduled.", then blocks **Event**, **Date and time** (in the invitee's stored zone and time format, GEN-06),
  **Location** (address, phone, join link
  or "Web conferencing details to follow."), **Invitee time zone**, **Questions** (unless excluded), description (when
  the template includes it), "Need to make changes to this event?" with **Cancel** and **Reschedule** links (unless
  disabled; never for guests), "Add to calendar" links (BK-22), payment receipt line when paid, footer "Powered by
  {AppName}" (hidden when branding is off) with the host avatar or logo in the header. Attachment `invite.ics` (NT-06).
  Calendar invitation mode: no app email; the provider invitation description contains the same content.
- **Acceptance**: the outbox email for a booking contains the time in the invitee zone and the cancel URL.

### NT-02 Host new booking notification (P0)

- **Behavior**: Every host of the meeting gets an email (cannot be turned off, Calendly parity) subject "New Event:
  {{invitee_full_name}} - {{event_time}} {{event_date}} - {{event_name}}" with "Hi {{my_name}}, A new event has been
  scheduled." and fields Event Type, Invitee, Invitee Email, Guests, Event Date/Time (host zone), Location, Invitee Time
  Zone, Questions, routing form answers (when routed), payment, and button "View event in {AppName}" (deep link to the
  meeting). Free/busy overlap alert block when booked over another meeting (SCH-13). Round robin includes "You were
  assigned this meeting." Group: "{n} of {limit} spots filled". Attachment ICS (METHOD:REQUEST) for hosts without a
  writable destination calendar (our choice).
- **Acceptance**: a collective booking sends one host email per host.

### NT-03 Cancellation notifications (P0)

- **Behavior**: Invitee (and guests) get "Canceled: {{event_name}} with {{my_name}} on {{event_date}}" with "Your
  {{event_name}} with {{my_name}} at {{event_time}} on {{event_date}} has been canceled.", "Reason: ..." when given,
  canceled by (host or invitee), and "Schedule again" link (unless links are off), plus ICS METHOD:CANCEL in email mode.
  Hosts get "Canceled: {{event_name}} with {{invitee_full_name}} on {{event_date}}" with reason and canceler. The person
  who canceled still receives their copy (our choice).
- **Acceptance**: invitee cancel sends one invitee and one host email; host cancel sends the same pair.

### NT-04 Reschedule notifications (P0)

- **Behavior**: Invitee (email confirmation mode only): "Updated: {{event_name}} with {{my_name}} on {{event_date}}"
  with the new time and "Former time" struck through, reason for change, new manage links, ICS METHOD:REQUEST with the
  same UID and incremented SEQUENCE (one-on-one) or CANCEL plus REQUEST pair (group). Guests in email mode get the same
  email without manage links. In calendar invitation mode the provider event is moved and the provider notifies the
  invitee and guests; the app sends them nothing (CAL-12). Hosts (every mode): "Rescheduled: ..." with old and new
  times. Round robin reassignment: the old host gets a cancellation, the new host a new event email.
- **Acceptance**: the reschedule ICS has the same UID as the original and SEQUENCE 1; rescheduling a calendar
  invitation meeting creates outbox rows for hosts only.

### NT-05 Email layout and branding (P0)

- **Behavior**: All emails share one responsive HTML layout (600px max, white card on `#FAFAFA`, logo or avatar at top,
  `#0A2540` text, blue `#006BFF` buttons with pill radius, footer with "Powered by {AppName}" (hideable) and a line why
  the recipient got it) and a plain text alternative. Links are absolute (`APP_URL`). No tracking pixels.
- **Acceptance**: every template renders valid HTML and text; snapshot tests pass.

### NT-06 ICS attachments (P0)

- **Behavior**: ICS built with ical-generator in UTC (never native Date plus TZID). One-on-one and multi-host UID
  `{scheduledEventId}@{APP_URL host}` inherited across reschedules; group invitees `{inviteeId}@{host}`; meetings in
  calendar invitation mode use the stored provider iCal UID instead (CAL-12; such ICS files are only produced for the
  confirmation page download, never emailed to invitees). ORGANIZER = the
  organizer host; ATTENDEE = the invitee and guests (RSVP true) and co-hosts; SUMMARY = invitee-facing title (default
  "{{event_name}} with {{my_name}}" (our choice)); DESCRIPTION and LOCATION as NT-01; URL = confirmation page;
  METHOD REQUEST or CANCEL; STATUS CONFIRMED or CANCELLED; SEQUENCE increments on every change. SMTP sends it as a
  `text/calendar; method=...` alternative plus attachment; Resend sends an attachment.
- **Acceptance**: generated ICS parses with node-ical and has correct UTC DTSTART/DTEND.

### NT-07 Template variables (P1)

- **Behavior**: Supported in workflow messages, invitation titles and descriptions, confirmation subjects and bodies:
  `{{event_name}}`, `{{event_date}}`, `{{event_time}}`, `{{event_end_time}}`, `{{event_time_zone}}`,
  `{{event_description}}`, `{{location}}`, `{{join_url}}`, `{{my_name}}` (host name, alias `{{host_name}}`),
  `{{host_email}}`, `{{invitee_full_name}}`, `{{invitee_first_name}}`, `{{invitee_last_name}}`, `{{invitee_email}}`,
  `{{invitee_phone_number}}` (only for text-to-invitee actions), `{{invitee_uuid}}`, `{{invitees_count}}`,
  `{{questions_and_answers}}`, `{{answer_1}}` to `{{answer_10}}`, `{{guests}}`, `{{utm_source}}`, `{{utm_medium}}`,
  `{{utm_campaign}}`, `{{utm_content}}`, `{{utm_term}}`, `{{cancel_url}}`, `{{reschedule_url}}`, `{{reconfirm_url}}`,
  `{{event_type_url}}`. Dates and times render in the recipient's zone and time format (invitee messages: the invitee's
  stored zone and time format, GEN-06; host messages: host profile zone and format; "other": the event's display zone)
  and locale. Unknown variables render as empty text. The editor inserts variables via a "+ Variables" menu showing
  friendly labels (Event Name, Event Organizer Name, Event Date, Event Time, Event End Time, Event Time Zone, Event
  Description, Invitees count, Questions and Answers, Answer 1 to 10, Invitee First Name, Invitee Last Name, Invitee
  Full Name, Invitee Email, Invitee Phone Number, Invitee UUID, Guests, UTM Source, UTM Medium, UTM Campaign, UTM
  Content, UTM Term, Location, Join link, Cancel link, Reschedule link, Reconfirm link) as chips.
- **Acceptance**: a template "Hi {{invitee_first_name}}, see you at {{event_time}}" renders with the invitee's local
  time.

### NT-08 Customizing invitation and confirmation templates (P1)

- **Behavior**: ET-25 editor fields: calendar invitation mode: "Event title (host calendar)", "Event title (invitee
  calendar)" (Calendly lets both be customized), "Description"; email confirmation mode: "Email subject", "Email body"
  (rich text with variables and hyperlinks); both: cancellation policy, links checkbox, answers checkbox. "Reset to
  default" per field. Templates are stored on the event type and snapshotted onto each meeting at booking time.
- **Acceptance**: a custom subject is used for new bookings and not for meetings booked before the change.

### NT-09 Basic notifications per event type (P1)

- **Behavior**: "Email reminders" (default timing 24 hours before; up to 3 timings per row (our choice), each minutes,
  hours or days before), "Text reminders" (invitee opts in with the SMS field; default 1 hour before), "Email follow-up"
  (default 1 day after end). Each row has its own subject/body (defaults: reminder subject "Reminder: {{event_name}}
  with {{my_name}} at {{event_time}} {{event_date}}" and body "This is a friendly reminder that {{event_name}} with
  {{my_name}} is at {{event_time}} on {{event_date}}."; follow-up subject "Thanks for meeting with {{my_name}}" (our
  choice)) and "Include cancel and reschedule links" (reminders). Default subjects and bodies come from the event type
  language's catalog when the row is first enabled (GEN-10). They are stored as event-type-scoped workflows
  (`is_basic = true`) and executed by the workflow engine, including the NT-15 backfill when switched on.
- **Acceptance**: enabling Email reminders produces a scheduled execution 24 hours before each new booking and before
  each already booked meeting that is still more than 24 hours away.

### NT-10 Workflows list (P1)

- **Behavior**: `/app/workflows` titled "Workflows" with "+ Create workflow"; tabs "My workflows" and "Templates"
  (NT-14). Rows: name, trigger summary ("24 hours before event starts"), action summary ("Send email to invitees",
  "+2 more"), "Active on {n} event types", on/off toggle, kebab "Edit", "Clone", "Delete". Sorted by creation date
  (no manual reorder, Calendly parity). Team workflows section for team managers (scope team). Empty state "Automate
  reminders and follow-ups" with "+ Create workflow".
- **Acceptance**: cloning creates "{name} (copy)" with identical steps and no event types.

### NT-11 Workflow builder: triggers and timing (P1)

- **Behavior**: `/app/workflows/new` and `/app/workflows/{id}`: "Workflow name" (1 to 100 chars); "When this happens":
  trigger select "New event is booked", "Before event starts", "Event starts", "Event is rescheduled", "Event ends",
  "Event is canceled", "No-show marked"; timing: "Immediately" or "[n] [minutes | hours | days] after" for booked,
  starts, ends, no-show; "[n] [minutes | hours | days] before event starts" for before-start (n at least 1 minute);
  rescheduled and canceled are immediate. Max offset 365 days (supports the 90, 180 and 270 day follow-ups Calendly
  recommends). When the timing is under 30 minutes and the instance has no recent frequent cron tick (GEN-16), the
  builder shows the hint "Short timings need a pinger that runs every 5 minutes. Messages may be sent late." with a
  link to the setup docs (our choice).
- **Acceptance**: "Before event starts, 2 hours" saves `trigger = before_start, offset_minutes = 120`; "Event ends, 270
  days after" saves; 366 days is rejected with "Choose a time up to 365 days."

### NT-12 Workflow actions (P1)

- **Behavior**: "Do this" with one or more actions ("+ Add action"), each: "Send email to invitees", "Send email to
  host", "Send email to other emails" (up to 10 addresses), "Send text to invitees", "Send text to host", "Send text to
  other phone numbers" (up to 10, E.164). Email actions: subject, rich text body with variables and links (destination:
  custom URL, current event type, or a specific event type), "Include cancel and reschedule links" checkbox, optional
  "Reply-to" (host email default). Text actions: plain text with variables and a live counter "{n}/180"; answers are
  truncated to 40 characters in texts; overflowing variables are still sent (Calendly parity); URLs are not shortened.
  "Send email to invitees" also sends to guests (our choice: off by default, checkbox "Also send to guests").
- **Acceptance**: a workflow with two actions creates two executions per booking.

### NT-13 Event type assignment (P1)

- **Behavior**: "Which event types will this apply to?" checkbox list with search and "Select all", "Apply"; includes
  personal, shared and team event types the user can edit (verified server-side, GEN-08). A workflow with no event
  types is inactive in effect. Assigning an event type applies the workflow to that event type's already booked
  meetings (NT-15 backfill).
- **Acceptance**: unassigning an event type stops new executions for its future bookings and cancels unsent ones for
  meetings not yet started (our choice); assigning it again re-creates them without duplicates.

### NT-14 Templates gallery (P2)

- **Behavior**: Cards with icon, title, description and "Use workflow" (creates a prefilled draft): Email reminder to
  invitee (1 day before), Email reminder to host, Email reminder to someone else, Text reminder to invitee (1 hour
  before), Text reminder to host, Text booking confirmation to invitee, Text booking confirmation to host, Text
  cancellation notification to invitee, Text cancellation notification to host, Cancellation notification to someone
  else, Send thank you email (15 minutes after end), Email additional resources (4 hours after end), Request follow-up
  meeting, Email your own feedback survey, Text follow-up to invitee, Email invitees to reconfirm (1 day before), Text
  invitee to reconfirm (1 hour before), Email no-shows to book a new time, Remind invitees to join via email (Event
  starts, immediately, body with `{{join_url}}`), Ask for a review (Event ends, 1 day after, email to invitees with a
  placeholder review link the host replaces). Template copy is localized (GEN-10).
- **Acceptance**: "Use workflow" on "Send thank you email" opens the builder with trigger Event ends, 15 minutes after.

### NT-15 Execution semantics (P1)

- **Behavior**:
  - On booking, the engine creates one execution per (workflow action, invitee) for active workflows assigned to the
    event type, storing a snapshot of the action config ("edits apply only to meetings booked after the change").
  - Run time: booked = created + offset; before_start = start - offset; starts = start + offset; ends = end + offset;
    rescheduled/canceled/no-show = event time + offset.
  - If a before-start run time is already past when scheduling (booked too close), the execution is `skipped` with
    reason "booked_too_close". Other past run times run immediately.
  - Canceling a meeting cancels its pending executions, then schedules "Event is canceled" executions (not for group
    events). Rescheduling cancels the old invitee's pending executions (no canceled trigger) and schedules the new
    invitee's executions plus "Event is rescheduled" ones, using the current workflow config.
  - At send time the dispatcher re-checks: meeting still active (except canceled trigger), invitee not canceled,
    workflow not deleted (a disabled workflow skips), recipient present (SMS number for texts), not unsubscribed from
    SMS (STOP).
  - Group events: one execution per invitee for invitee actions; one per slot for host and other actions (our choice);
    SMS only when the slot has 100 or fewer invitees.
  - Not applicable to one-off meetings and polls (Calendly parity) except the poll "Send meeting reminders" option
    (MP-18).
  - **Backfill** (Calendly applies a new workflow to meetings already booked whose time has not passed): when a workflow
    is created, turned on, or gains an event type (including a basic notification being switched on or retimed in
    ET-25), the engine creates executions for every active invitee of the newly covered event types whose run time is
    still in the future, for the `before_start`, `starts` and `ends` triggers only (event-driven triggers never
    backfill), using the current workflow config as the snapshot. Run times already past create nothing (no `skipped`
    rows). Backfill is idempotent on (workflow action, invitee or slot, trigger): an existing execution with that key is
    left as is, except one canceled by unassignment or deactivation, which is rescheduled with the current config.
    Switching a workflow off and on again therefore creates no duplicates. It runs as a background job
    (`workflows.backfill`) right after the save.
- **Acceptance**: integration tests for snapshot semantics, booked-too-close skip, cancel and reschedule handling; a
  new "24 hours before" workflow schedules a reminder for an existing meeting in 3 days and none for a meeting in 2
  hours; turning it off and on again leaves exactly one execution for the 3-day meeting.

### NT-16 SMS delivery (P2)

- **Behavior**: Twilio REST when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (or
  `TWILIO_MESSAGING_SERVICE_SID`) are set; else stored in the SMS log (GEN-15). Replies are not monitored; inbound "STOP"
  (via Twilio's opt-out handling and the `/api/webhooks/twilio` inbound webhook) records an opt-out for that number,
  and later texts to it are skipped. The inbound webhook verifies `X-Twilio-Signature` (HMAC-SHA1 over the full
  request URL plus the POST parameters sorted by name, keyed with `TWILIO_AUTH_TOKEN`) and answers 403 otherwise. Max
  180 characters per message body as composed (counter), segments handled by Twilio. Anti SMS pumping caps (our
  choice): at most 10 texts per destination number per 24 hours across the instance, at most 3 bookings with a text
  reminder number per IP per hour, and texts to a number are paused for 24 hours after 3 failed deliveries.
- **Acceptance**: a text to an opted-out number is skipped with reason "opted_out"; an inbound STOP with a wrong
  signature changes nothing; the 11th text to one number within 24 hours is skipped with reason "rate_limited".

### NT-17 Host phone verification (P2)

- **Behavior**: "Send text to host" requires a verified host phone in Settings > Notifications: enter number, "Send
  code", enter the 6-digit code; "Verified" badge. Unverified hosts see "Verify your phone number to receive texts."
- **Acceptance**: texts to hosts without a verified number are skipped with reason "host_phone_unverified".

### NT-18 Reconfirmation (P2)

- **Behavior**: Reconfirmation templates include `{{reconfirm_url}}` (`/reconfirm/{inviteeId}`). Sending sets
  `reconfirmation_requested_at`. The invitee page shows the meeting and "Confirm" (and "Cancel" and "Reschedule" links);
  confirming shows "Thanks for confirming you'll attend this event." and sets `reconfirmed_at`. Meetings with requested
  but unconfirmed reconfirmation appear in the Meetings "Unconfirmed" tab (MT-04) and the CSV column "Invitee
  Reconfirmed".
- **Acceptance**: visiting the reconfirm link and clicking Confirm marks the invitee reconfirmed.

### NT-19 No-show workflows (P2)

- **Behavior**: "No-show marked" trigger runs for the marked invitee. Invitees marked no-show skip pending "Event ends"
  executions (thank you, survey, follow-up) at send time.
- **Acceptance**: marking a no-show before a 15-minutes-after-end thank you executes cancels that email.

### NT-20 Sender identity (P0)

- **Behavior**: From address `EMAIL_FROM` (default `"{AppName}" <notifications@{APP_URL host}>`, which must be a
  verified sender with the provider); From display name "{Host name} via {AppName}" for invitee-facing meeting emails,
  "{AppName}" for system emails (our choice); Reply-To the host's login email (or the workflow's reply-to). Host
  setting "Use a no-reply address for invitee emails" (Settings > Notifications, default off, Calendly parity): when
  on, invitee-facing emails for meetings the user organizes have no Reply-To header (workflow actions with an explicit
  reply-to keep it).
- **Acceptance**: an invitee confirmation's Reply-To equals the host email; with the no-reply setting on, the stored
  outbox row has no Reply-To.

### NT-21 Host notification preferences (P2)

- **Behavior**: Settings > Notifications: "New bookings" (always on, disabled toggle with tooltip "Booking
  notifications can't be turned off"), "Cancellations and reschedules" (always on), "Meeting poll votes" (Instant,
  Daily digest, Off; MP-23), "Calendar connection problems" (on), "Daily agenda email" (off, NT-22), "Emails when
  you're added to an event type" (on, TM-17), "Use a no-reply address for invitee emails" (off, NT-20), SMS phone
  verification (NT-17).
- **Acceptance**: switching poll votes to Off stops vote emails.

### NT-22 Daily agenda email (P3, extension)

- **Behavior**: Optional email at 07:00 in the host's zone listing today's meetings (time, invitee, event, location
  link), sent only when there is at least one meeting.
- **Acceptance**: enabled hosts with meetings today get one email per day.

### NT-23 Delivery timing (P0)

- **Behavior**: Immediate notifications are sent from `after()` and typically arrive within seconds; timed ones depend on
  job triggers (GEN-16): with a 5-minute pinger reminders arrive within about 5 minutes of their time; with only the
  GitHub schedule (every 10 minutes, often delayed) a "15 minutes before" reminder can arrive late or be skipped. A job due more than 30
  minutes late for a reminder still sends unless the meeting has started (our choice); reminders whose meeting already
  started are skipped ("too_late").
- **Acceptance**: a reminder job processed after the meeting start is skipped.

### NT-24 Limits (P2)

- **Behavior**: Up to 50 workflows per user and 50 per team (Calendly parity); up to 10 actions per workflow (our
  choice); invitee email bodies up to 20,000 chars.
- **Acceptance**: creating a 51st workflow fails with "You can have up to 50 workflows."

---

## 11. MT: Meetings dashboard (Scheduled events)

### MT-01 Page structure (P0)

- **Behavior**: `/app/meetings` titled "Meetings". Top controls: "My {AppName}" dropdown (switch to a team or, for
  admins, any user or "All users"), "Show buffers" toggle (MT-09), counter "Displaying 1 - 25 of 42 Events". Tabs:
  "Upcoming", "Unconfirmed" (only when any reconfirmation workflow exists), "Pending", "Past", "Date Range". Right side:
  "Export" and "Filter".
- **Acceptance**: tabs are reflected in the URL (`?tab=past`) and keep filters.

### MT-02 Upcoming, Past and Date Range (P0)

- **Behavior**: Upcoming: meetings whose end is in the future, sorted ascending; the Status filter defaults to "Active events"
  and canceled meetings appear when "Canceled events" is selected (our choice). Past: meetings whose end has passed, descending. Date Range: a range picker (start and end dates in the
  viewer zone), ascending. Grouped under date headers ("Wednesday, October 14, 2026") in the viewer's profile zone.
- **Acceptance**: a meeting ending 5 minutes ago appears in Past, not Upcoming.

### MT-03 Pending (P1)

- **Behavior**: Lists one-off meetings awaiting booking and meeting polls that are open or closed but not booked,
  with name, offered dates summary, created date, "Copy link", and actions ("View poll results", "Edit", "Clear reserved
  times" for one-offs with holds).
- **Acceptance**: booking a one-off removes it from Pending and adds the meeting to Upcoming.

### MT-04 Unconfirmed (P2)

- **Behavior**: Upcoming meetings with at least one active invitee whose reconfirmation was requested and not
  confirmed.
- **Acceptance**: confirming the reconfirmation removes the meeting from the tab.

### MT-05 Meeting row (P0)

- **Behavior**: White container card; rows separated by 1px lines. Each row: event color dot (16px) and time range
  "10:00am - 10:30am"; middle: invitee name bold (group: "{n} invitees"; poll meetings show a small "Poll" badge) and
  "Event type **{name}**"; canceled rows show a red "Canceled" badge and strike-through time; small gray "{n} host(s) |
  {m} non-hosts" (guests); right: "Details" toggle with chevron that expands inline (desktop) or opens a side panel
  (2026 style, our choice: inline expansion on desktop, full-screen sheet on mobile). Rescheduled meetings show a
  "Rescheduled" badge on the canceled old one.
- **Acceptance**: clicking Details expands the row and the URL gains `?event={id}` for deep linking.

### MT-06 Details panel (P0)

- **Behavior**: Two columns. Left: action buttons "Reschedule", "Cancel" (upcoming only), then links "Edit Event
  Type", "Filter by Event Type", "Book a follow-up meeting" (canceled or past), "Report this event" (opens Block invitee
  CR-12). Right: labeled blocks (eyebrow labels): EMAIL (invitee email with copy and contact hover card CT-10),
  LOCATION (with "Join now" for video, and "Retry" when conferencing failed), INVITEE TIME ZONE, QUESTIONS (question and
  answer pairs), ROUTING (routing form answers when routed), PAYMENT (amount, status, provider link, PAY-06), MEETING
  HOST(S) (avatars; round robin shows the assigned host and pool), GUESTS, TRACKING (UTM values if any), NOTES ("Add
  meeting notes", CR-14), a "No-show" control after start (CR-11), status messages (calendar sync failed, conferencing
  failed, cancellation details "Canceled by {name} ({host|invitee}): {reason}"), footer "Created {date} by {invitee or
  host name}" and "Scheduled by {host}" when booked on behalf. Group meetings show the invitee list with per-invitee
  actions (CR-10) and "Edit invitee limit" (CR-20).
- **Acceptance**: every listed block renders from seeded data, and blocks with no data are omitted.

### MT-07 Host actions (P0)

- **Behavior**: Actions call CR-06 to CR-14 services; permission: hosts of the meeting, event type editors, org owners
  and admins (TM-01). Viewers (ET-31) can view and add notes only.
- **Acceptance**: a "Can view" user does not see Cancel or Reschedule.

### MT-08 Filters and search (P1)

- **Behavior**: Filter panel: Teams, Hosts, Event Types, Status ("Active events", "Canceled events"), Tracking ID (UTM
  campaign, source, medium, content, term contains), Invitee Emails (comma list); "Clear all filters". Search box
  filters by invitee name or email and event name (our choice). Filters persist in the URL.
- **Acceptance**: filtering by an event type and Status Canceled shows only canceled meetings of that type.

### MT-09 Show buffers (P2)

- **Behavior**: When on, rows show small gray blocks before and after meetings with buffers ("15 min buffer"), with a
  pencil to edit (CR-15).
- **Acceptance**: the toggle state persists per user.

### MT-10 Connected calendar events (P3)

- **Behavior**: Toggle "Show events from my calendars" adds view-only external events (gray rows, calendar name) to
  Upcoming and Date Range.
- **Acceptance**: external events never show actions.

### MT-11 Export CSV (P1)

- **Behavior**: "Export" downloads a CSV of the current tab and filters (up to 10,000 rows synchronously; larger exports
  run as a job and email a download link valid 7 days (our choice)). Columns (Calendly order): User Name, Team, Invitee
  Name, Invitee First Name, Invitee Last Name, Invitee Email, Invitee Time Zone, Invitee accepted marketing emails, Text
  Reminder Number, Event Type Name, Start Date & Time, End Date & Time, Location, Event Created Date & Time, Canceled,
  Canceled By, Cancellation Reason, Question 1, Response 1, ... Question 10, Response 10, UTM Campaign, UTM Source, UTM
  Medium, UTM Term, UTM Content, Salesforce UUID, Event Price, Payment Currency, Guest Email(s), Invitee Reconfirmed,
  Marked as No-Show, Meeting Notes, Group, User Email, Event UUID, Invitee UUID, Invitee scheduled by, Scheduling method.
  One row per invitee. Times in the exporter's zone with offset.
- **Acceptance**: the CSV for 3 invitees has 3 data rows and the header above.

### MT-12 Activity timeline (P2)

- **Behavior**: Details "Activity" section lists chronological entries: booked (source), emails and texts sent (with
  status), calendar synced or failed, conference created or failed, rescheduled, canceled, no-show marked, notes
  updated, reconfirmation requested and confirmed, payment received, host reassigned.
- **Acceptance**: a booking shows at least "Booked" and "Email sent to invitee" (or "Calendar invitation sent").

### MT-13 Group meetings in the list (P1)

- **Behavior**: One row per group slot with "{n} invitees" and "{n} of {limit} spots filled"; details list invitees.
- **Acceptance**: two invitees in one group slot produce one row.

### MT-14 Viewing other users (P2)

- **Behavior**: Owners and admins can switch "My {AppName}" to a member or "All users and teams"; team managers can
  view their team's meetings. Shared event type meetings are visible to all their hosts.
- **Acceptance**: an admin viewing a member sees that member's meetings with full actions.

### MT-15 Empty states and pagination (P0)

- **Behavior**: "No Upcoming Events", "No Past Events", "No events in this date range", "No Pending Events" with an
  illustration and a "Share your link" button that copies the landing page URL. Pagination: 25 meetings per page with
  "Previous" and "Next" (keyset by start time and id).
- **Acceptance**: 30 meetings show 25 on page 1 and 5 on page 2.

---

## 12. TM: Organizations, teams and multi-host scheduling

### TM-01 Organizations and roles (P1)

- **Behavior**: Each user belongs to one organization. Roles: Owner (exactly one; everything, can transfer ownership),
  Admin (everything except changing the owner), User (own settings and event types; hosts team events they are added
  to). Team manager is a per-team role (TM-05); group admin per group (TM-14). Instance admin (ADM-01) is separate from
  org roles. Permission matrix follows `calendly-advanced-features.md` section 1.1 (add users: owner, admin; remove
  users: owner, admin; view all event types and meetings: owner, admin; reschedule others' meetings: owner, admin,
  team managers for their team; analytics org-wide: owner, admin).
- **Acceptance**: authorization tests cover every role against event type edit, meeting cancel, user removal and
  analytics scope.

### TM-02 Invite users (P1)

- **Behavior**: Admin > People "Invite users" (also header "Invite user" button for admins): modal with email chips
  (up to 50 per send), role select (User, Admin), optional teams to add them to, "Send invitations". Each invitation
  email: "{Inviter} invited you to join {Org name} on {AppName}" with "Accept invitation" (`/invite/{token}`, valid 14
  days). Pending invitations list with "Resend" (updates `last_sent_at`) and "Revoke". Statuses pending, accepted,
  declined, revoked, expired. Inviting an email that already belongs to another org shows "{email} already has an
  account in another workspace." (our choice; no multi-org membership).
- **Acceptance**: an invitation can be accepted once; revoked links show "This invitation is no longer valid."

### TM-03 Accept invitation (P1)

- **Behavior**: `/invite/{token}` shows "Join {Org name}" with the inviter, then: existing logged-in user with the same
  email: "Accept" (moves them only if they are alone in their current org and it has no other data (our choice);
  otherwise shows a conflict message); new user: signup form with the email locked (or Google/Microsoft with matching
  email through the `accept_invitation` OAuth intent, AU-11; signup policy never blocks an invitation). After
  acceptance: membership with the invited role, team memberships, redirect to onboarding (new) or Scheduling.
  "Accept" and "Decline" are POST actions (the GET page changes nothing, GEN-08). "Decline" marks the invitation
  declined. Accounts created this way are flagged as created through an invitation (TM-04).
- **Acceptance**: accepting creates the membership and the invitation status becomes accepted; accepting with
  Microsoft whose email differs from the invitation shows "Use {invited email} to accept this invitation."

### TM-04 People management (P1)

- **Behavior**: Admin > People table: Name (avatar), Email, Role, Status (Active, Pending), Teams, Last active; row
  menu: "Change role", "Remove from workspace" (owner/admin; confirmation lists effects: their future meetings stay
  scheduled with them unless "Cancel their upcoming meetings" is checked, which enqueues a `lifecycle.cancel_user_meetings`
  job; they are removed from team event types and pools (ET-20 turns off event types left without hosts); personal
  event types are turned off; the user keeps their account in a new personal workspace (our choice, mirrors Calendly
  keeping accounts)), "Delete account" (owner/admin, only for users whose account was created through an invitation to
  this organization; confirmation by typing the email; runs AU-15 deletion for that user), "Transfer ownership" (owner
  only). Search and role filter.
- **Leave workspace**: non-owner members see Settings > Profile "Leave {Org name}" (Calendly's "keep account but leave
  the organization"): confirmation lists the effects (removed from teams, team and shared event types and pools; upcoming
  meetings of those event types stay scheduled; personal event types, schedules and calendars stay as they are (our
  choice)); the user ends up as owner of a new personal workspace and the org admins get an email.
- **Acceptance**: removing a member removes them from all pools and teams; leaving a workspace keeps the account and
  its active personal event types in a new organization; an admin can delete an account created through an invitation
  but not one that existed before joining.

### TM-05 Teams (P1)

- **Behavior**: Teams need at least one member (our choice; Calendly says two active users, we allow one for single
  owners testing). Create from Admin > Teams or the Scheduling "My {AppName}" dropdown "+ New team" (owners, admins,
  group admins). Fields: name, team page URL (slug in the shared namespace), welcome message (up to 265 chars), avatar
  ("Upload picture"), team time zone, members with a "Can manage team" checkbox (team manager; admins pre-checked and
  locked). `/app/teams/{id}` settings page with tabs Details, Members, Event types. Deleting a team turns off and
  soft-deletes its event types after confirmation ("{n} event types will be deleted").
- **Acceptance**: a team manager can create team event types; a plain member cannot.

### TM-06 Team landing page and event types (P1)

- **Behavior**: See BK-02. Team event types live in the team's section on the Scheduling page for members who host them
  and for managers, with the same card features. Team event types use team slug URLs and can be any kind.
- **Acceptance**: a team round robin event is bookable at `/{teamSlug}/{eventSlug}`.

### TM-07 Collective event types (P1)

- **Behavior**: See ET-20, SCH-15, VID-13. One scheduled event with every host as a member; calendar event on the
  organizer's calendar with other hosts as attendees (calendar invitation mode) or a copy on each host's destination
  (email mode). Any host or admin can manage the meeting.
- **Acceptance**: booking adds all hosts to the meeting and each receives the host notification.

### TM-08 Round robin event types (P1)

- **Behavior**: See ET-20, SCH-16, CR-09. Invitees never see the pool; the confirmation shows the assigned host. Only
  the assigned host, event editors or admins can manage the meeting.
- **Acceptance**: the confirmation page names the assigned host.

### TM-09 Round robin counts and fairness display (P2)

- **Behavior**: The hosts section shows per host "{n} meetings since {date}" and for equal distribution a status "Ahead
  by 3: hidden until others catch up". Counts reset to zero for the pool when membership changes (add or remove host)
  and via "Reset counts" (extension). Switching distribution takes effect for the next booking and ignores history
  older than the last reset.
- **Acceptance**: adding a host resets everyone's count to 0.

### TM-10 Multiple host pools (P2)

- **Behavior**: See ET-20 and SCH-17. Location: if a required co-host exists, standard location options; with video one
  co-host is the organizer; if all hosts are in pools, location is set per host of the first pool. Reschedule from the
  Meetings page uses round robin logic without host choice.
- **Acceptance**: a multi-pool booking includes the required host and one host per pool.

### TM-11 Per-host locations (P1)

- **Behavior**: Round robin (and pools) location settings: "Set location for all hosts" (same location options, invitee
  can choose only when a required co-host exists) or "Set location per host": each host row picks their own single
  location (for example their own Zoom, phone number or address). Outbound call is unavailable.
- **Acceptance**: a booking assigned to host B uses host B's configured location.

### TM-12 Shared event types (P2)

- **Behavior**: See ET-34. Hosts added to a shared event type receive an email (TM-17) and see it under "Shared".
- **Acceptance**: removing yourself from a shared event type removes it from your Scheduling page.

### TM-13 Event type permissions and book on behalf (P2)

- **Behavior**: See ET-31 and OO-13. Booking on behalf of a teammate's event type requires "Can view" or higher.
- **Acceptance**: a user without permission gets 403 when booking on behalf.

### TM-14 Groups and group admins (P3)

- **Behavior**: Admin > Groups: create groups (name), add members (a user can be in many groups), assign group admins
  (who need not be members). Group admins see reporting and meetings for group members, can create teams and routing
  forms, invite users to their group (if allowed by TM-16), manage members' personal event types, and create managed
  events for the group. Meetings and analytics filters support Group.
- **Acceptance**: a group admin can view a group member's meetings but not a non-member's.

### TM-15 Managed event types (P3)

- **Behavior**: Admin > Managed events "+ Create" (one-on-one or group template). Assign to users or teams; each
  assignee gets a linked copy (card shows the "admin managed" icon). Per section lock toggles (Details, Availability,
  Limits and buffers, Booking form, Notifications and workflows, Confirmation page, Payment, Permissions; Location is
  always editable). Locked sections sync on every template save; unlocked sections stop syncing; re-locking overrides
  user edits on the next update. Unassigning removes the copy (meetings kept). Managed workflows attach to the template
  and apply to all copies.
- **Acceptance**: editing a locked section of the template updates all copies.

### TM-16 Organization settings (P3)

- **Behavior**: Admin > Permissions: "Who can create shared event types" (Everyone, Only admins), "Who can invite users"
  (Admins only, Admins and group admins), "Default booking email verification for new event types" (off).
- **Acceptance**: with "Only admins", a user's Create menu hides Collective and Round robin shared options.

### TM-17 Host added notifications (P2)

- **Behavior**: When a user is added as a host to a shared or team event type, they get an email "{Actor} added you as
  a host of {Event name}" with a link; unsubscribe via the email footer or Settings > Notifications.
- **Acceptance**: adding a host sends one email to that host.

---

## 13. RF: Routing forms

### RF-01 Routing forms list (P1)

- **Behavior**: `/app/routing` titled "Routing" with "+ New routing form" (menu "Create a new form"). Rows: form name,
  status (Published or Draft), submissions count, last updated, "Copy link", kebab "Edit", "Duplicate", "View
  responses", "Export", "Edit permissions", "Delete". Empty state "Route visitors to the right meeting" with the button.
  Owners, admins and group admins create forms; everyone can view and share published forms in their org (Calendly
  parity); editors need permission (RF-13).
- **Acceptance**: duplicating creates "{name} (copy)" in Draft with the same questions and routes.

### RF-02 Create form (P1)

- **Behavior**: Modal "Form name" + "Create form" opens the builder `/app/routing/{id}` with steps (tabs) "Form",
  "Routing logic", plus header actions "Preview form" and "Publish form" (or "Unpublish" / "Update" when published).
  Form settings: optional headline (up to 200 chars), optional description (rich text, 5,000 chars), submit button text
  (default "Submit", up to 40 chars), invitee language (GEN-10).
- **Acceptance**: a new form starts as Draft with a fallback route.

### RF-03 Questions (P1)

- **Behavior**: "Add a question" with formats Name, Email, Phone, Short text, Long text, Dropdown, Radio buttons,
  Checkboxes (extension beyond the API's types), Number (extension). Each question card: label (1 to 500 chars),
  required toggle, options list for choice types (1 to 100 options, unique), placeholder (text types), "Hidden" toggle
  (hidden questions are only filled by URL prefill, extension), and "Pass to booking form as" mapping (Invitee name,
  Invitee email, SMS phone, or one of the destination event type's questions by label; default: name, email and phone
  types map automatically, other questions map by identical label (our choice)). Drag to reorder. Up to 30 questions
  (our choice). Deleting a question used in routes asks to remove those conditions.
- **Acceptance**: question positions define `a1..aN` prefill indexes.

### RF-04 Routes and conditions (P1)

- **Behavior**: "Routing logic" lists routes in evaluation order (drag to reorder; first match wins). "+ Create route"
  -> "Use form answers". A route has conditions: each condition = question + qualifier + one or more answers; multiple
  answers in one condition combine with "or" (any) or "and" (all, for checkboxes); "Add another question" adds more
  conditions combined with "and" (default) or "or" (route-level toggle "Match all conditions" / "Match any condition")
  (our choice). Qualifiers by type: text (is, is not, contains, does not contain, starts with, ends with, is empty, is
  not empty), email (same plus "domain is", "domain is not"), choice (is any of, is none of, is empty), checkboxes
  (includes any of, includes all of, includes none of), number (equals, greater than, less than, between). Comparisons
  are case-insensitive and trim whitespace. Each route has a destination (RF-05) and an optional internal name.
- **Acceptance**: unit tests of the pure evaluator cover every qualifier and ordering.

### RF-05 Destinations (P1)

- **Behavior**: "Event type" (select any active event type the form owner can share: personal, shared, team), "Custom
  message" (headline and body, for disqualified visitors), "External URL" (https URL; option "Pass answers as query
  parameters" (extension)).
- **Acceptance**: a route to an event type redirects to its booking page with prefill (RF-11).

### RF-06 Fallback route (P1)

- **Behavior**: Always present at the bottom, not deletable, applies when no route matches. Default destination:
  custom message headline "Thanks for your interest" and body "We'll be in touch soon." (our choice); editable to any
  destination type.
- **Acceptance**: answers matching no route show the fallback message.

### RF-07 Preview and test console (P2)

- **Behavior**: "Preview form" opens a modal rendering the public form; submissions are not recorded; after submit the
  preview shows "Matched route: {route name or number}" and the destination instead of navigating (extension test
  console).
- **Acceptance**: preview submissions do not appear in Responses.

### RF-08 Publish and share (P1)

- **Behavior**: "Publish form" validates (at least one question, every route has a destination) then opens the share
  dialog: "Share a link" (`{APP_URL}/r/{slug}` where slug defaults to a random `xxx-xxx-xxx` and is editable in form
  settings) with "Copy link", and "Add to website" (inline embed code and popup code via the embed script, RF-15).
  Unpublished forms show "This form isn't available." publicly. Edits to a published form go live on "Update".
- **Acceptance**: a draft form's public URL returns the unavailable state.

### RF-09 Public form page (P1)

- **Behavior**: `/r/{slug}` uses the public shell, single-column card: headline, description, questions (validation
  like BK-09), submit button. Honeypot and rate limits (BK-18). After submit: event type destination navigates to the
  booking page; custom message shows headline and body in the card; external URL redirects.
- **Acceptance**: e2e submits a form and lands on the matched booking page with the name and email prefilled.

### RF-10 Prefill and autofill (P2)

- **Behavior**: `?a1=John%20Smith&a2=English` prefills by question number (case-sensitive exact option text for
  choices); `autofill=true` auto-submits when all required questions are prefilled and routes immediately; UTM params
  are recorded on the submission's tracking.
- **Acceptance**: `?a1=Ana&a2=ana@example.com&autofill=true` routes without user interaction.

### RF-11 Handoff to booking (P1)

- **Behavior**: The redirect to an event type passes `name`, `email`, mapped `a1..a10` answers, UTM params and
  `routing_form_submission={submissionId}`. When the invitee books, the invitee links the submission
  (`routing_form_submission_id`) and the submission gets `submitter` = the invitee. Host notifications and meeting
  details show the routing answers. Submissions never booked remain with no submitter.
- **Acceptance**: after booking, the submission row references the invitee and the meeting details show the answers.

### RF-12 Responses (P1)

- **Behavior**: `/app/routing/{id}/responses`: table with Submitted at, Result (event type name, custom message, URL),
  Booked (yes with link to the meeting, or no), and one column per question; filters Result type, Event type, Date
  range, Booked; "Export CSV" with the same columns; row click opens details. Deleting a form keeps its responses
  hidden but restorable for 30 days (our choice).
- **Acceptance**: the CSV includes one row per submission with answers.

### RF-13 Permissions (P3)

- **Behavior**: "Edit permissions" at the bottom of the builder: add users with "Can edit". Owners and admins always
  can edit.
- **Acceptance**: a user without permission sees the builder read-only.

### RF-14 Spam control (P2)

- **Behavior**: Recommended pattern from Calendly: a route with condition "Email domain is gmail.com, yahoo.com,
  hotmail.com, outlook.com" to a custom message. The builder offers a one-click template "Reject personal email
  domains" that inserts that route at the top (extension).
- **Acceptance**: the template inserts a correctly configured route.

### RF-15 Embed routing forms (P2)

- **Behavior**: The embed script supports routing form URLs for inline and popup embeds, with `calendly.*` events for
  form submission (`calendly.routing_form_submitted`, extension name) and booking.
- **Acceptance**: an inline embed of `/r/{slug}` renders and routes inside the iframe.

---

## 14. OO: Single-use links, one-off meetings and sharing tools

### OO-01 Create a single-use link (P1)

- **Behavior**: From an event type card ("Create single-use link" or the "1x" icon) or the Share modal. A right-side
  panel "Create single-use link": "Add contact" (optional: search contacts or enter name and email; prefills the
  booking form), and for one-on-one event types "Customize" sections (OO-02). Buttons "Save and copy link" (creates the
  link, copies `{APP_URL}/d/{code}/{slug}` and toasts "Link copied") and "Share" (OO-11 email with the link). Links are
  created one at a time.
- **Acceptance**: the created link appears in the Single-use links tab with status "Not scheduled".

### OO-02 Single-use link customization (P1)

- **Behavior**: One-on-one only: meeting name (up to 55 chars), duration and duration options (max 4), location(s),
  availability (custom weekly hours and date-specific hours, schedule zone) and date range (period type rolling
  calendar days, rolling available days, fixed range, indefinitely). Group, collective and round robin: contact only.
  Anything not customized is inherited live from the event type at booking time (our choice: overrides are
  snapshotted; non-overridden fields follow the event type).
- **Acceptance**: a single-use link with duration 45 on a 30-minute event type books a 45-minute meeting.

### OO-03 Single-use links tab (P1)

- **Behavior**: `/app/scheduling/single-use-links` lists single-use links and one-off meetings, newest first: color
  dot, name, badge "Single-use" or "One-off", contact (if any), created date, status "Not scheduled", "Scheduled" (with
  the meeting time and "View meeting") or "Expired", "Copy link", kebab "Share", "Duplicate", "Edit", "Delete", and for
  one-offs with holds "Clear reserved times" (confirm "Clear reservations"). Filters: Status, Type. Empty state "No
  single-use links yet" with "Create a link that can only be booked once."
- **Acceptance**: a scheduled single-use link shows its meeting time.

### OO-04 Expiry and states (P1)

- **Behavior**: A single-use link has `max_event_count` (default 1) and becomes `booked` atomically with the booking
  (BK-19). Canceling that meeting does not reopen the link (Calendly parity; "Duplicate" creates a fresh one). Links
  of deleted or off event types are `expired` or unavailable. API-created scheduling links can set
  `max_event_count` (OO-15).
- **Acceptance**: concurrent bookings on one single-use link produce exactly one meeting.

### OO-05 One-off meeting: choose times (P1)

- **Behavior**: `/app/one-off/new` full-screen step 1 "Choose times to offer": left column "Time zone" (default profile
  zone), "Duration" (15, 30, 45, 60, 90, 120 minutes, custom 5 to 720), "Add hosts" (up to 9 additional org members,
  which makes it collective). Main area: a week grid (Google Calendar style, 15-minute rows, all-day lane, today
  marker, previous and next week, "Today") showing the host's (and co-hosts') external events (gray blocks with titles
  for own calendars), app meetings with buffers as one block, and other holds (dashed). Click a time to add a slot (blue
  block with the time) of the chosen duration; drag to create a custom-length slot; click a slot's x to remove; day
  header "+ Add times" adds all free times of that day (back-to-back slots within working hours, skipping busy). Slots
  can be over non-app events, over buffers and outside available hours, but not in the past. All slots must lie within
  3 months of each other. Counter "{n} times selected" with list popover. "Next" (at least one slot).
- **Acceptance**: e2e adds 3 slots, one overlapping an external event, and proceeds.

### OO-06 One-off meeting: details (P1)

- **Behavior**: Step 2 "Set up meeting details": "Meeting name" (required, up to 55 chars), "Location" (single,
  location editor from event types), "Description/Instructions" (rich text), "Optional settings": "Reserve times"
  (OO-08), "Allow invitees to add guests" (on), "Invitee questions" (same question editor, up to 10), "Invitee language".
  Button "Share meeting link".
- **Acceptance**: the one-off is created with status pending and its ad hoc event type.

### OO-07 One-off meeting: share (P1)

- **Behavior**: Step 3: link `{APP_URL}/d/{code}/{slug}` with editable link ending (the slug part), "View live page",
  "Copy Link", and "Add times to email" (copies an HTML snippet of the offered times in the chosen display zone, each
  time linking to its details form, plus a "See all times" link). Appears under Single-use links and Meetings > Pending.
- **Acceptance**: pasted "Add times to email" HTML contains one link per future slot.

### OO-08 Reserve times (P2)

- **Behavior**: When on, each offered slot is written as a placeholder busy event "Reserved: {Meeting name}" (private,
  no attendees) on the host's and co-hosts' destination calendars and acts as a `reserved` busy source in our engine
  (SCH-19) for all their event types. On booking, all holds are removed (the real meeting is created separately);
  "Clear reserved times" removes all holds at once (no partial clear) and keeps the one-off bookable. Holds for past
  slots are removed by a cleanup job.
- **Acceptance**: with Reserve times, the host's 30-minute event type does not offer a reserved slot.

### OO-09 One-off booking rules (P1)

- **Behavior**: The booking page shows only offered slots (spots) that are still free for the host(s) at booking time,
  ignoring the hosts' working hours (offered times are explicit) but respecting app meetings and external busy events
  created after the one-off (our choice: external events existing at creation were knowingly overlapped and are
  ignored only if they overlapped at creation time; all app meetings block). One-off bookings ignore event type and
  host limits and snapshot 0/0 buffers (SCH-07, SCH-09) but count toward later limits. One booking closes the one-off
  (`booked`), guarded by a unique index so a double click or two visitors cannot book it twice.
  One-off meetings cannot be rescheduled ("This meeting can't be rescheduled. Cancel it and create a new one." on the
  reschedule page) and workflows do not apply (Calendly parity). Invitees can cancel. API `date_setting` variants
  `date_range` and `days_in_future` (OO-15) use the host's default schedule within that range.
- **Acceptance**: after one booking, the one-off link shows "This meeting has already been booked."

### OO-10 Offer time slots and the Share modal (P2)

- **Behavior**: Share modal from the card share icon: title "Share {Event name}", sections "Copy link" (URL with "Copy
  link" and a "Customize once and share" link that opens OO-01), "Add times to email" (pick a date range "Offer
  availability", "Displayed time zone" select, per date "Edit times" or "Remove date", then "Copy to clipboard" which
  copies rich HTML with time links to the details form and a "See all available times" link), "Add to website" (API-14),
  footer "Create single-use link". "Offer time slots" quick action opens directly on "Add times to email".
- **Acceptance**: copied times link to `/{slug}/{eventSlug}/{ISO start}` URLs.

### OO-11 Share availability by email (P2)

- **Behavior**: "Share availability" (card quick action, contact actions, single-use "Share"): composer with To
  (contacts autocomplete, up to 20 recipients), Subject (default "Schedule time with {Host name}"), editable message
  (default "Hi, please pick a time that works for you:"), the link (event type or single-use), optional "Remind them if
  they haven't scheduled in [1, 3, 7] days" (reminder text not customizable), "Send". Sent through our email provider
  from "{Host name} via {AppName}" with Reply-To the host (GEN-18 notes the mailbox difference). Each send is recorded.
- **Acceptance**: the reminder is skipped if the recipient books the event type before it fires.

### OO-12 Recommended follow-ups (P3)

- **Behavior**: Recipients of shared availability who have not booked within 3 days appear in Contacts > "Recommended
  follow-ups" (and a dashboard card) with "Send follow-up" (prefilled message), "View original message", "Dismiss",
  and conversion tracking.
- **Acceptance**: a recipient who books disappears from the list.

### OO-13 Book meeting on behalf (P1)

- **Behavior**: "Book meeting" (card quick action, contact profile, follow-up actions) opens a dialog: invitee "Name" and
  "Email" (contact search), "+ Add guests", optional "Customize this meeting" (meeting name, duration, location for this
  booking only; not for group events), a slot picker (calendar and times, "Time zone display" select to view in the
  invitee's zone), optional "Override available times" (OO-14), invitee questions answered by the host (required
  questions not enforced for hosts (our choice)), "Book meeting". Creates a normal booking with `scheduling_method =
  instant_book` and `scheduled_by_user_id`; without "Override available times" it obeys every availability rule
  including event type and host limits (SCH-09); invitee receives the standard confirmation, reminders and workflows. When
  text reminders exist and a phone is entered, the invitee first receives a text asking to reply YES to opt in (our
  choice: an SMS with a confirmation link) before further texts are sent.
- **Acceptance**: booking on behalf creates a meeting marked "Scheduled by {host}" in details and CSV.

### OO-14 Override available times (P2)

- **Behavior**: In the host booking dialog, "Override available times" shows a free time picker (any date and time,
  15-minute steps, custom allowed) ignoring schedules, event type and host limits and notice for the current user's own
  availability but never another host's busy calendar; not available for round robin. The meeting still counts toward
  later limits. The UI warns when the chosen time conflicts with
  the host's own events ("This overlaps 'Team sync'").
- **Acceptance**: a host can book themselves at 22:00 outside working hours via override.

### OO-15 Scheduling links API parity (P2)

- **Behavior**: `POST /api/v1/scheduling_links` (max_event_count, owner event type) and `POST /api/v1/shares` (Customize
  once and share fields: name, duration, duration_options, period_type, start_date, end_date, max_booking_time,
  hide_location, location_configurations, availability_rule) create single-use links; `POST /api/v1/one_off_event_types`
  creates one-off meetings with `date_setting` `spots`, `date_range` or `days_in_future`. Response shapes per Calendly.
- **Acceptance**: API-created links behave like UI-created ones.

---

## 15. MP: Meeting polls (the Doodle replacement)

Design principle: Calendly's look, flow and defaults; Doodle's depth as opt-in settings. A host who never opens "More
settings" gets an experience indistinguishable from Calendly. Detailed rationale and copy sources:
`docs/research/meeting-polls.md` Part B (this section is normative; where it is shorter, the research Part B details
apply).

### MP-01 Entry points (P2)

- **Behavior**: "+ Create" > More ways to meet > "Meeting poll"; Scheduling tab "Meeting polls"
  (`/app/scheduling/meeting-polls`); Meetings > Pending lists open polls; contact profile "Create meeting poll" with the
  contact pre-invited. Routes: `/app/polls/new`, `/app/polls/{id}` (results), `/app/polls/{id}/edit`, public `/p/{slug}`.
- **Who manages a poll**: the creator and every co-host (Calendly allows both) can view results, edit, invite people,
  close or reopen voting and Book; only the creator (and org owners and admins) can delete the poll or remove
  co-hosts. Co-hosts see the poll in their own Meeting polls list and Meetings > Pending.
- **Acceptance**: every entry point opens the right page; a co-host can open results and book; a co-host gets 403 on
  delete.

### MP-02 Create step 1: choose times (P2)

- **Behavior**: Same full-screen layout as OO-05: left "Time zone", "Duration" (15, 30, 45, 60, 90, 120, Custom 5 min to
  24 h, All day; applies to newly added options so durations can mix), "Hosts" (owner locked plus up to 10 co-hosts,
  members of the same organization only, whose busy times overlay the grid without event titles, GEN-08), counter "{x}/100 times selected" with list popover and "Clear all", "Next"
  (disabled until 1 option; hint recommends 2+). Week grid (default) with Week/Month toggle: overlays of busy events
  from all conflict calendars (titles), app meetings with buffers, other polls' holds, working hours shading; click to
  add (15-minute boundary), drag to create, drag to move, resize, x to remove; overlapping options allowed (side by
  side); options over busy blocks get an amber outline "Overlaps '{title}'" but are allowed; past times disabled; day
  header menu "Add all free times" and "Copy this day's times to..."; keyboard cell navigation (Enter adds or removes).
  Month view: select dates then add start times and a duration, or all-day (date-only) options. Mobile: single-day
  column with an "Add time" sheet. Draft persisted in localStorage until shared.
- **Validation**: 1 to 100 options, future starts, duration 5 minutes to 24 hours, starts within 365 days, exact
  duplicates toggle instead of adding, options may cross midnight.
- **Acceptance**: e2e adds 3 options (one overlapping another) and reaches step 2.

### MP-03 Step 2: meeting details (P2)

- **Behavior**: "Meeting name" (1 to 100 chars, required), "Location" (single: Google Meet, Teams, Zoom, Jitsi, custom,
  in-person, inbound phone; no outbound call or ask invitee), "Description/Instructions" (rich text up to 8,000 chars),
  "Optional settings": "Show votes on page", "Reserve times", "Invitee language"; "More settings" (MP-04) collapsed;
  buttons "Back" and "Share meeting poll". Conferencing links are created only at booking.
- **Acceptance**: sharing creates the poll (status open), its ad hoc event type (`booking_method = poll`, secret), and
  options.

### MP-04 Settings reference (P2)

- **Behavior**: Settings with defaults chosen for Calendly parity:

  | Setting | Values | Default |
  |---|---|---|
  | Results visibility ("Show votes on page" toggles `everyone` / `host_only`) | `host_only`, `counts_only`, `after_vote`, `everyone` | `host_only` |
  | Reserve times | on/off | off |
  | Invitee language | locales (GEN-10) | host locale |
  | Allow "If need be" | on/off | off (Calendly voting is yes or no only) |
  | Hide invitees from each other in the invite (MP-20) | on/off | off (Calendly shows attendees in the invite even when votes are hidden) |
  | Require email | on/off | on (name always required) |
  | Verify email (6-digit code) | on/off | off (on implies Require email) |
  | Allow comments | on/off | off |
  | Deadline | date and time in poll zone, or none | none (must be future and not after the last option start) |
  | Max votes per option (Yes and If need be count) | 1 to 1,000 or none | none |
  | Max choices per participant | 1 to number of options or none (1 = single choice, radio UI) | none |
  | Time zone display | `auto` (each voter's zone), `fixed` (poll zone) | `auto` |
  | Notify me when people vote | instant, daily digest, off | instant |
  | Automatic reminders to people who haven't voted | off, smart, custom | smart once invites are sent |
  | Book automatically when everyone agrees | on/off | off (P3, MP-31) |
  | Allow participants to suggest times | on/off | off (P3 stretch) |
  | Link ending | `^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$` | random 10 chars |
- **Acceptance**: each setting persists and is enforced server-side on vote submit.

### MP-05 Share screen (P2)

- **Behavior**: "Your meeting poll is ready": the link `{APP_URL}/p/{slug}` with inline "Edit link ending" (live
  uniqueness), "Copy link" (primary), "View live page" (opens with a banner "Preview, your votes will not be saved" for the
  signed-in host), "Invite people" (MP-06), "Copy times as text" (options in the host zone plus the link), "Done" (to
  results).
- **Acceptance**: editing the link ending keeps the old slug redirecting for 90 days.

### MP-06 Email invitations (P2)

- **Behavior**: "Invite people" dialog: recipients (paste lists separated by commas or new lines, contacts and past
  invitees autocomplete), editable subject (default "{Host name} wants to find a time: {Poll title}") and message, per
  recipient "Mark as required", "Send". Each recipient becomes a participant with status `invited` and a personal link
  `/p/{slug}?i={inviteToken}` that pre-fills and ties votes. Email body: host avatar and name, title, duration, location
  type, number of options, deadline, personal message, button "Vote on times", list of up to 5 options in the host zone
  with zone label, footer "You received this because {Host name} invited you. Unsubscribe from this poll." Per-row
  "Resend invite"; removing an invited non-respondent is allowed. Limits: 200 recipients per send, 1,000 per poll, 200
  invite emails per host per day.
- **Acceptance**: an invited participant's personal link pre-fills their name and email read-only.

### MP-07 Voter page layout (P2)

- **Behavior**: `/p/{slug}` in the booking page shell (two columns desktop, about 1060px; single column mobile). Left:
  host avatar(s) and names ("{Name} and {n} others"), label "Meeting poll", title (28px bold), clock + duration (or
  "Varies"), location row (pre-booking display rules), calendar icon + "Voting closes {date time}" when a deadline
  exists, description, "Cookie settings" and "Privacy Policy". Right: heading "Select all the times you're available to
  meet", subtext "The meeting host will see your preferences when deciding on a final time.", legend when If need be is
  on (green check Yes, yellow tilde If need be, empty No), time zone control (BK-05; replaced by "Times are shown in
  {zone}" in fixed mode), options grouped by local date ("Tuesday, October 20, 2026") with time ranges, duration badge
  when durations differ, answer control (MP-08), vote summaries when visibility allows ("3 Votes", "(1 if need be)",
  names on hover or tap; a Grid view toggle in `everyone` mode), badges "Full", "Past", "Conflict" (MP-13). Sticky
  footer: "{n} preferred time(s)" and "Share times"; secondary link "None of these work for me" (MP-10).
- **Acceptance**: with `timezoneId: Asia/Kolkata`, options render in IST and may group under different dates than the
  host sees.

### MP-08 Answer control (P2)

- **Behavior**: If need be off: checkbox per option (checked Yes, unchecked No). On: three-state toggle cycling Yes ->
  If need be -> No on click, plus a hover segmented control "Yes | If need be | No" and long-press menu; ARIA
  `role="checkbox"` with `aria-checked` true, mixed, false and a label like "Tuesday Oct 20, 10:00 to 10:30am: If need
  be". Max choices reached: other options disabled with tooltip "You can choose up to {n} times." (limit 1 renders a
  radio list). Capacity: an option is selectable only while other participants' Yes plus If need be is below the max;
  the voter's own existing selection on a full option can be removed but not re-added. Selecting exactly 1 option when
  the poll has 3 or more shows " Reminder: Voting for multiple times helps the poll host find the best meeting time for
  everyone." (non-blocking). Capacity is enforced in the vote transaction with the chosen option rows locked (in a
  stable order), so two voters cannot both take the last place; votes on deleted options never count.
- **Acceptance**: a full option cannot be newly selected; two concurrent votes for the last place on an option accept
  exactly one (real Postgres test).

### MP-09 Voter details step (P2)

- **Behavior**: After "Share times", the right panel switches (with a back arrow) to "Share your preferred times":
  Name (required, 1 to 100), Email (required unless Require email is off; read-only for invite links and signed-in
  users), Comment (when comments are on), checkbox "Get updates when others vote" (only when visibility shows others),
  honeypot and timing check, verification code step when Verify email is on, submit "Share times". Duplicate email
  without a valid edit token does not overwrite: "You've already voted with this email. We've sent you a link to update
  your response." and a magic edit link is emailed.
- **Acceptance**: typing someone else's email cannot change their votes.

### MP-10 Decline (P2)

- **Behavior**: "None of these work for me" asks for name and email, saves No on every non-past option, marks the
  participant `declined`; hosts see a "Declined" chip.
- **Acceptance**: a declined participant counts as a respondent with all No.

### MP-11 Confirmation and editing later (P2)

- **Behavior**: Confirmation panel: check icon, "Thanks for voting!", "You'll receive a calendar invitation when the
  host decides a final time from submitted votes.", summary of chosen times in the voter's zone, "Edit your preferred
  times". Voter confirmation email with selections and "Review or change your response" (magic link). An httpOnly edit
  cookie scoped to `/p/{slug}` (365 days; embed-safe attributes with a localStorage fallback inside embeds, GEN-08) lets
  the same device edit directly; magic links set it and redirect to the clean URL (setting the cookie changes no vote,
  so link scanners are harmless). Editing is allowed while open and before the deadline; votes on past options are
  frozen.
- **Acceptance**: reopening the page on the same browser shows "Edit your preferred times" with saved answers.

### MP-12 Results visibility to voters (P2)

- **Behavior**: `host_only`: voters see only their own answers (Full still enforced and shown); `counts_only`:
  per-option counts, no names; `after_vote`: nothing until the viewer submits, then like everyone; `everyone`: counts,
  names and grid. Emails are never exposed. Enforced server-side (the API omits other participants unless allowed).
- **Acceptance**: in `host_only`, the public JSON contains no other participant names.

### MP-13 Check my calendar (P3)

- **Behavior**: Voter button "Check my calendar": Google (FreeBusy with `calendar.freebusy` scope) or Microsoft
  (calendarView with `Calendars.Read`) in a popup with tokens kept in memory only and discarded, or "Paste an ICS link";
  signed-in app users use their conflict calendars automatically. Options get "Busy" (red dot "Conflicts with your
  calendar") or "Free" (green); "Mark all free times as Yes". Hidden when OAuth is not configured (ICS stays).
- **Acceptance**: no voter token is persisted in the database.

### MP-14 Comments (P3)

- **Behavior**: When enabled: thread under the options (author, "Host" badge, relative time, text with line breaks and
  autolinked URLs `rel="nofollow ugc noopener"`), add box (name required if not voted, up to 2,000 chars, "Comment"),
  authors delete their own (edit token), hosts delete any. In `host_only` comments are visible only to hosts and the
  author ("Only the host can see comments"). Max 200 per poll.
- **Acceptance**: a host-only poll's comment is not visible to another voter.

### MP-15 Page states (P2)

- **Behavior**: Open (normal; banner "Voting closes in {relative time}" within 24 hours of the deadline); Closed ("Voting
  for this poll has closed." read-only, "The host will share the final time soon."); Booked ("This meeting has been
  scheduled." with the final time in the voter zone, location, add-to-calendar buttons, results read-only if visible);
  Canceled ("This poll is no longer available.", HTTP 410, no details); Expired ("This poll has ended."); unknown slug:
  404.
- **Acceptance**: a deleted poll returns 410.

### MP-16 Host results: Top times (P2)

- **Behavior**: `/app/polls/{id}` header: title, status badge (Open, Closed, Booked, Canceled, Expired), "{r} of {i}
  responded" (or "{r} responses"), deadline countdown, duration, location, hosts; actions "Copy link", "Invite people",
  "Edit", "Close voting" / "Reopen voting", kebab "Duplicate", "Export CSV", "Delete poll". View "Top times" (default):
  options ranked by MP-28 in the host zone (zone picker), each with an availability bar (green Yes, yellow If need be,
  gray No, light no answer), counts "5 Yes, 1 If need be, 2 No", "Best" star on the top tie group, "All required can
  attend" indicator, host calendar status (free, amber "Conflicts with '{title}'", red "Booked: {event}"), and "Book";
  hover counts list names; past options collapsed under "Past times". Side sections: "Not responded yet" (invited
  non-respondents with "Send reminder now" (throttled once per participant per 12 hours) and last reminder time),
  "Activity" feed, "Comments". Live updates every 15 seconds with toasts "{Name} voted".
- **Acceptance**: the best option shows the star; a booked app meeting overlapping an option shows red status.

### MP-17 Host results: Grid and participants (P2)

- **Behavior**: Grid view: rows = host availability row (computed Free/Busy per option from conflict calendars and app
  meetings, plus optional "Your preference" row; not counted unless "Count my preference" is on), respondents in
  submission order, invited non-respondents grayed ("Invited, no response"); columns = options grouped by date; cells
  check, tilde, empty (No), "?" (option added after their last submit), dash (no answer). Totals row with a star over
  the best column. Sticky first column and header, horizontal scroll inside the container. Row menu: "Edit votes" (host
  edits on behalf; participant emailed), "Copy email", "Mark as required", "Resend invite", "Remove" (confirm; votes
  deleted; participant emailed unless unchecked). "Add participant (vote on behalf)": name required, email optional.
- **Acceptance**: a host-added participant appears with source host_added.

### MP-18 Book dialog (P2)

- **Behavior**: "Book" opens "Book meeting time": summary (title, date and time in host zone, "{n} participants in other
  zones", duration, location, hosts); live conflict check: app meeting conflicts block ("You already have '{event}' at
  this time" with a link), buffers do not block, external conflicts warn (amber) but allow, this poll's holds never
  conflict; invitee list with checkboxes: respondents with Yes or If need be checked, respondents with No or declined
  checked too (filter "Only people who can attend"), invited non-respondents unchecked in "Didn't respond" with
  "Include all", participants without email disabled ("No email, can't send an invite"), "+ Add invitee" rows, remove
  (x); optional message to invitees; toggle "Send meeting reminders" (24 h and 1 h before, default off); primary "Book
  meeting". Booking is allowed while open or closed. Poll bookings ignore event type and host limits and use 0/0
  buffers (SCH-07, SCH-09), but count toward later host limits.
- **Acceptance**: booking with an app conflict is impossible; with only an external conflict it succeeds.

### MP-19 Booking side effects (P2)

- **Behavior**: In one transaction, taking locks in the global order (ARCHITECTURE "Booking creation": the hosts' locks
  first, then the poll row): re-validate (status, future option, no app conflict), create the scheduled event through
  the bookings service (hosts = owner and co-hosts, collective style, `source = poll`, `poll_id`), one invitee per
  selected person (with `poll_participant_id`), set poll `booked` with `booked_option_id`, `booked_scheduled_event_id`,
  `booked_at`, `booked_by_user_id`. A unique index allows only one active scheduled event per poll, so a double click
  or auto-book racing the host books once. Then jobs: conferencing and calendar write, booking confirmation emails
  with ICS to every invitee and host (with a "Booked from meeting poll" line), release holds, optional "The time has
  been chosen" email to respondents not included (default off), webhooks `invitee.created` per invitee and
  `poll.booked`, cancel pending reminder jobs.
- **Notification mode** (our choice): poll meetings always use email confirmation mode (CAL-12), whatever the owner's
  destination calendar: the host's provider event has no invitee attendees, and each invitee receives their own email
  with ICS and their own cancel link. Per-invitee links therefore appear only in per-invitee emails, never in a
  description shared by several invitees (GEN-08).
- **Acceptance**: integration test: booking creates the meeting, invitees, outbox emails with ICS, and removes holds;
  two concurrent Book requests for one poll create one meeting; with a Google destination, the provider event has no
  invitee attendees and each invitee email contains only that invitee's cancel link.

### MP-20 Hidden poll invites (P2)

- **Behavior**: When "Hide invitees from each other in the invite" is on (MP-04, default off, independent of results
  visibility), invitees receive individual ICS invites (own UID `{inviteeId}@{host}`, attendees = hosts plus that
  invitee) so they do not see each other; the host calendar gets one event listing everyone in its description. The
  Book dialog notes "Invitees won't see each other in the invite." When off (default), every invitee's ICS lists all
  invitees as attendees with the shared UID, like Calendly.
- **Acceptance**: with the setting on, each invitee's ICS lists only themselves among non-host attendees; with the
  default, a `host_only` poll's ICS lists all invitees.

### MP-21 Reopen, rebook, cancel (P2)

- **Behavior**: "Reopen poll" on a booked poll sets status open (meeting untouched) and optionally emails respondents
  "{Host} reopened the poll for {title}, you can update your response." Booking again: same option returns to booked;
  a different option moves the same scheduled event in place (the lifecycle `moveScheduledEvent` service: same row,
  same UID, SEQUENCE + 1, "Updated invitation" emails, calendar and conference updated) and reconciles invitees (new
  ones invited, removed ones get CANCEL). Deleting a reopened poll asks "Also cancel the
  scheduled meeting at {old time}?". Canceling the booked meeting from Meetings leaves the poll booked with "Meeting
  canceled" and a "Reopen poll" action. Invitees of poll meetings can cancel their own attendance ("Can't make it?"),
  not reschedule.
- **Acceptance**: rebooking a different option updates the same scheduled event row.

### MP-22 Lifecycle (P2)

- **Behavior**: States open, closed, booked, canceled, expired with transitions: share -> open; deadline or "Close
  voting" -> closed; "Reopen voting" (clear or move the deadline first) -> open; book -> booked; "Reopen poll" -> open;
  last option start passes -> expired (job plus lazy check); delete -> canceled (soft delete; booked polls ask "Keep the
  scheduled meeting" or "Cancel it too"); expired -> open when future options are added. A pure state machine enforces
  transitions; every vote write checks `deadline_at > now` regardless of status. Canceled polls are purged after 30 days.
- **Acceptance**: unit tests cover every allowed and forbidden transition.

### MP-23 Notifications (P2)

- **Behavior**: Emails per `meeting-polls.md` B10: invitation, vote received (subject "{Name} has voted in a poll for
  {Title}", with answers, top 3 times, "{x} of {y} responded", "View results", "Book this time" deep link that opens the
  dialog, never one-click booking), daily digest (08:00 host zone), voter confirmation, others voted (subscribed voters,
  batched max one per 10 minutes), new comment, reminder, poll updated (new times), votes edited or added or removed by
  host, voting closed, deadline approaching (24 h before, when responses < invited), ended without booking (offer
  duplicate), meeting booked (standard booking email), reopened, time changed, poll canceled, verification code, edit
  link. All participant emails have a per-poll unsubscribe (stops invites, reminders and updates, not booking invites):
  the footer link opens `/p/{slug}/unsubscribe?t=...`, which shows an "Unsubscribe" button and changes nothing until
  POST, and the emails carry `List-Unsubscribe` with `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (GEN-08).
- **Acceptance**: a vote with notify instant creates one host email.

### MP-24 Reminders to non-respondents (P2)

- **Behavior**: Only for invited, subscribed, non-responding participants. Smart mode: anchor = deadline or first future
  option start; lead = anchor - first invite send time; lead > 5 days: one reminder 48 h before anchor (plus an early
  nudge 3 days after the invite when lead > 7 days); 2 to 5 days: 36 h before; under 2 days: none. Custom: up to 3
  reminders "N after invite" or "N before deadline". Max 3 automatic reminders per participant. Jobs are recomputed when
  deadline, options or invites change and re-check eligibility at send time.
- **Acceptance**: unit tests for lead boundaries exactly 2 and 5 days.

### MP-25 Reserve times (P2)

- **Behavior**: When on, holds "Reserved: {Poll title}" (busy, private, no attendees) on the owner's and co-hosts'
  writable destination calendars for every future option, and our engine treats open poll options as `reserved` busy
  for those users (SCH-19) even without calendars. Removed on booking, cancel, expiry, option removal or turning the
  setting off; "Clear reserved times" on the results page. Hold failures show "Couldn't reserve {n} times on {Provider}.
  Retry".
- **Acceptance**: a reserved option blocks the owner's regular event type at that time.

### MP-26 Meeting polls list (P2)

- **Behavior**: `/app/scheduling/meeting-polls`: filter chips Open (default, includes closed unbooked), Booked, Ended,
  All; search; "Hosted by" filter. Cards with colored left border, title, status, "{duration} · {n} times" ("Mixed
  durations"), option date range, responses with mini progress bar and "New" dot, deadline or "Booked for {time}" with
  "View meeting", "Top time: Tue 10:00am (5 yes)", "Copy link", "View results", kebab (Edit, Invite people, Close or
  Reopen voting, Duplicate, Export CSV, Delete). Sorting: open by deadline then created desc; booked by meeting time; 25
  per page. Empty state: "Find the best time for everyone. Propose times, share a link, and book the winner." with "+ New
  meeting poll".
- **Acceptance**: a new vote shows the "New" dot until the host opens the poll.

### MP-27 Editing after publish (P2)

- **Behavior**: Always editable while open or closed: title, description, location, language, visibility (to more
  private immediately; to more public with warning "Voters chose their answers expecting their names to be hidden"),
  comments, notify, reminders, deadline (past deadline closes voting), hosts (holds updated). Options: add (cap 100;
  existing respondents see "?"; checkbox "Email the {n} people who already voted about the new times", default on);
  remove without votes silently; remove with votes after a confirm listing voters; changing a time = remove + add; past
  options frozen. Max votes per option: raise freely, lower only to the current maximum; enabling later only if
  consistent. Max choices lowered below a respondent's count flags them "Over the limit". Poll zone change affects
  display only. Link ending edits keep redirects 90 days. Booked polls: details edits update the scheduled event.
- **Acceptance**: adding an option shows "?" for existing respondents in the grid.

### MP-28 Ranking (P2)

- **Behavior**: Pure function `rankPollOptions`. Per non-past option: `requiredOk` (all required participants answered
  Yes or If need be; true when none required), `attendable = yes + maybe`, `yes`, `hostFree`, `no`, `start`. Sort:
  requiredOk desc, attendable desc, yes desc, hostFree desc, no asc, start asc. "Best" = all options tying the first on
  the first five keys; no badge when nobody responded.
- **Acceptance**: unit tests for ties, required participants and host conflicts.

### MP-29 Time zones and DST (P2)

- **Behavior**: Options store UTC instants; date-only options store a date and display the same day for everyone (ICS
  `VALUE=DATE`). Poll zone used for grid default, fixed mode, deadline entry and host emails. Voter display converts per
  voter; options crossing local midnight show "(ends next day)". Grid creation uses wall-clock conversion: nonexistent
  spring-forward cells are hatched "Doesn't exist (DST)"; fall-back hour shows two labeled rows "1:00am (EDT)" and
  "1:00am (EST)". Copying a day's times copies wall-clock times.
- **Acceptance**: e2e voters in Asia/Kolkata and America/Los_Angeles vote on a Europe/Berlin poll around DST weeks.

### MP-30 Limits, privacy, abuse (P2)

- **Behavior**: Limits: 100 options, 1,000 participants, comments 200, co-hosts 10. Tokens (edit, invite) are 32 random
  bytes stored as SHA-256 hashes. Rate limits: vote submits 10 per IP per poll per hour, comments 20 per IP per hour,
  verification codes 5 per email per hour. Honeypot plus 2-second minimum, optional Turnstile. `/p/*` is `noindex`.
  CSV exports (with emails) host-only.
- **Acceptance**: the 11th vote submit from one IP within an hour is rejected.

### MP-31 Auto-book on consensus (P3)

- **Behavior**: When enabled, after each vote: if every invited (or every required) participant has responded and at
  least one option has all of them at Yes and the host is free, book the earliest such option with the default invitee
  selection and email the host "We booked {time} because everyone agreed." Only while open; never over app conflicts.
- **Acceptance**: the last required Yes vote triggers the booking.

### MP-32 Duplicate and export (P2)

- **Behavior**: Duplicate copies settings and future options (title + " (copy)"), not participants. Export CSV: rows =
  participants, columns = options (host zone), cells Yes / If need be / No / blank, plus email, status, comment count.
- **Acceptance**: the CSV has one row per participant.

### MP-33 API parity (P3)

- **Behavior**: `GET /api/v1/event_types` includes poll-backed types with `booking_method: "poll"`, `type:
  "AdhocEventType"`, `secret: true`, `active` true while open or closed, `pooling_type: "collective"` with co-hosts,
  `scheduling_url` = poll link. Read-only `GET /api/v1/meeting_polls` (extension). Webhooks `poll.created`,
  `poll.vote_created`, `poll.vote_updated`, `poll.booked`, `poll.canceled` (extension events).
- **Acceptance**: the event types list includes the poll's ad hoc type.

---

## 16. CT: Contacts

### CT-01 Contacts list (P1)

- **Behavior**: `/app/contacts` titled "Contacts" with search "Search contacts" and "+ Add contact". Table columns: Name
  (avatar + name), Email, Phone, Company, Job title, Location, Last meeting, Next meeting; sortable headers; row hover
  `#F4F8FF`; checkbox selection with bulk "Delete", "Add to list", "Export". 50 per page. Empty state "Contacts are
  created automatically when someone schedules with you, or you can add them manually." with "+ Add contact".
- **Acceptance**: sorting by Last meeting puts the most recent first.

### CT-02 Automatic creation and updates (P1)

- **Behavior**: Contacts are per user (owner). Each booking upserts a contact for every host of the meeting, matched by
  normalized email: creates with `creation_source = booking` (name, email, time zone, phone from SMS number or phone
  answers); updates name if empty, time zone, last and next meeting dates, last interaction. Guests do not become contacts
  (our choice). Poll participants and routing submissions with emails create contacts on booking only.
  Cancellations and reschedules update next meeting dates.
- **Acceptance**: two bookings by the same email produce one contact with the latest meeting dates.

### CT-03 Manual create, edit, delete (P1)

- **Behavior**: "Add contact" form: Name (required), Emails (1 to 10, one primary), Phones (up to 10), Company, Job title,
  City, State, Country, Time zone, LinkedIn URL. Edit the same fields on the profile. Delete (soft) with confirmation;
  deleting does not affect meetings. Duplicate primary email per owner is rejected ("A contact with this email already
  exists.").
- **Acceptance**: a manually created contact is linked to later bookings by the same email.

### CT-04 Contact profile (P1)

- **Behavior**: `/app/contacts/{id}`: header (avatar, name, primary email, phone, company, job title, LinkedIn, time zone
  with local time), actions "Book meeting" (OO-13 prefilled), "Share availability" (OO-11), "Create meeting poll"
  (MP-01), "Email" (mailto link (our choice: no in-app composer)), "Edit", "Delete"; sections "Upcoming meetings", "Past
  meetings" (meeting history with status), "Notes" (CT-05), "Reminders" (CT-06), "Custom fields" (CT-07), "Lists" (CT-08).
- **Acceptance**: the profile lists all meetings where the contact was the invitee.

### CT-05 Notes (P2)

- **Behavior**: Timestamped notes (author, rich text up to 5,000 chars), edit and delete own notes.
- **Acceptance**: notes are private to the contact owner.

### CT-06 Reminders (P3)

- **Behavior**: "Remind me" with date/time and text; due reminders email the owner and show a dashboard badge; mark done.
- **Acceptance**: a due reminder sends one email.

### CT-07 Custom fields (P3)

- **Behavior**: Contacts settings: define fields (label, type text, single select (options), number, boolean, currency
  (ISO currency), date, tags); values editable per contact; filterable in the list.
- **Acceptance**: a single select value must be one of the defined options.

### CT-08 Lists (P3)

- **Behavior**: Named lists; add or remove contacts; list filter in the table.
- **Acceptance**: filtering by a list shows only its members.

### CT-09 Schedule from contact (P2)

- **Behavior**: See CT-04 actions; the event type picker lists the user's event types.
- **Acceptance**: "Book meeting" from a contact preselects them as invitee.

### CT-10 Hover card (P2)

- **Behavior**: Hovering a contact name (meetings details, contacts table) shows a card with email, phone, LinkedIn, time
  zone and actions "Book meeting", "Share availability", "Send email".
- **Acceptance**: the hover card is keyboard accessible (focus shows it).

### CT-11 Import and export (P2)

- **Behavior**: Export CSV of the current filter (all standard fields plus custom fields). Import CSV (extension): upload,
  map columns, preview first 10 rows, import with upsert by email, summary "{n} created, {m} updated, {k} skipped".
  Max 10,000 rows per import.
- **Acceptance**: importing then exporting round-trips the standard fields.

### CT-12 Missed opportunities (P3)

- **Behavior**: See OO-12; contacts who received shared availability and did not book.
- **Acceptance**: covered by OO-12.

### CT-13 Search and filters (P1)

- **Behavior**: Search across name, email, company, phone (partial, case-insensitive). Filters: company, country, time
  zone, has upcoming meeting, list, creation source.
- **Acceptance**: searching a partial email finds the contact.

---

## 17. AN: Analytics

### AN-01 Analytics page and access (P2)

- **Behavior**: `/app/analytics` titled "Analytics" with tabs "Events" and "Routing" (AN-10). Owners and admins see
  org-wide data; group admins their groups; team managers their teams (our choice: Calendly says no, we allow
  team-scoped); users see only their own meetings. Data from the last 12 months (older data excluded from widgets; still
  in exports up to 24 months (our choice)).
- **Acceptance**: a plain user's numbers include only meetings where they are a host.

### AN-02 Filters (P2)

- **Behavior**: Date range (presets Last 7 days, Last 30 days (default), Last 90 days, This month, Last month, Custom up to
  1 year), User, Team, Group, Event type (shared event types filter by host). Filters in the URL. All widgets in the
  viewer's profile zone.
- **Acceptance**: changing the range updates all widgets.

### AN-03 KPI widgets (P2)

- **Behavior**: Tiles with big number, change vs previous period (arrow and percent), and sparkline: "Created events"
  (invitees created in range), "Completed events" (active meetings whose end is in range and before now), "Rescheduled
  events" (invitees with `rescheduled = true` canceled in range), "Canceled events" (split host vs invitee in the tooltip),
  "No-shows" (extension). Each tile has an info icon (definition) and three-dots menu ("Download CSV").
- **Acceptance**: seeded data with 4 created, 1 canceled shows those numbers.

### AN-04 Event distribution by duration (P2)

- **Behavior**: Bar chart of meetings by duration bucket (15, 30, 45, 60, 90, 120+ minutes, plus "Other").
- **Acceptance**: buckets sum to the created count.

### AN-05 Popular events (P2)

- **Behavior**: Ranked list of event types by meetings created with counts and share bars; click filters the page.
- **Acceptance**: the top event type has the highest count.

### AN-06 Popular times (P2)

- **Behavior**: Heatmap of meeting starts by local weekday (rows) and hour (columns) in the viewer zone; hover shows
  count; click drills into the meetings list for that cell (opens Meetings with filters).
- **Acceptance**: a meeting on Tuesday 10:00 local increments that cell.

### AN-07 User data view (P3)

- **Behavior**: Admin toggle "Event data" / "User data": table per user (meetings created, completed, canceled,
  rescheduled, no-shows, round robin assignments).
- **Acceptance**: rows sum to the org totals.

### AN-08 Customize widgets (P3)

- **Behavior**: "Customize" lets the viewer show or hide widgets (persisted per user).
- **Acceptance**: hidden widgets stay hidden after reload.

### AN-09 CSV exports (P2)

- **Behavior**: "Export" offers "Event data" (one row per meeting invitee with event type, host, times, status,
  duration, UTM) and "User data" (AN-07 columns).
- **Acceptance**: export rows equal the widget totals for the same filters.

### AN-10 Routing analytics (P3)

- **Behavior**: Per routing form: submissions, routed to event type, booked, conversion rate, by route and by day.
- **Acceptance**: conversion = booked / submissions.

### AN-11 Booking funnel (P3, extension)

- **Behavior**: Widget "Booking page funnel": landing page views, event page views, date and time selected, scheduled,
  from BK-29 events.
- **Acceptance**: funnel counts are monotonic non-increasing.

### AN-12 Google Analytics 4 and Meta Pixel (P3)

- **Behavior**: Integrations: "Google Analytics" (measurement ID `G-XXXX`) and "Meta Pixel" (pixel ID) per user. On
  public pages for that host, after consent (GEN-14), load the tag and send events: GA4 `page_view` plus custom events
  named with the lowercase app name as prefix (our choice: `{app}_event_type_viewed`, `{app}_date_selected`,
  `{app}_event_scheduled`, `{app}_routing_form_submitted`) with UTM as campaign data; Pixel `PageView`, `Schedule`.
- **Acceptance**: no tracker requests happen without consent.

### AN-13 Admin overview activity (P3)

- **Behavior**: Admin overview card "Activity last week": created, completed, canceled events in the past 7 days.
- **Acceptance**: numbers match AN-03 for a 7-day range.

---

## 18. API: Public REST API, webhooks and embeds

### API-01 Personal access tokens (P2)

- **Behavior**: Integrations > API: "Personal access tokens" list (name, prefix `kai_pat_abcd`, scopes, created, last
  used, expires) with "Create token" (name, scopes checklist (Calendly scope names, default all), expiry: never, 30, 90,
  365 days) showing the token once ("Copy"), and "Revoke". Tokens are stored hashed. Requests use `Authorization: Bearer
  {token}` and act as the token's user with that user's permissions intersected with scopes.
- **Acceptance**: a revoked token gets 401.

### API-02 Conventions (P2)

- **Behavior**: Base `{APP_URL}/api/v1`, JSON, snake_case, Calendly-compatible shapes: resources identified by full URIs
  (`{APP_URL}/api/v1/event_types/{uuid}`); single GET returns `{ "resource": {...} }`; lists return `{ "collection": [...],
  "pagination": { count, next_page, previous_page, next_page_token, previous_page_token } }` with keyset `count` (1 to
  100, default 20) and `page_token`; errors `{ "title", "message", "details": [{ parameter, message, code }] }` with 400,
  401, 403 (includes `required_scopes`), 404, 409, 422, 424 (external calendar unreachable), 429, 500. Timestamps ISO
  8601 UTC with microseconds. Explicit filters (`user`, `organization`) are required where Calendly requires them.
- **Acceptance**: contract tests compare response keys with Calendly's documented fields for each resource.

### API-03 Resources (P2)

- **Behavior**: Implement read endpoints and listed writes:
  - `GET /users/me`, `GET /users/{uuid}`
  - `GET /organizations/{uuid}`, `GET|POST /organizations/{uuid}/invitations`, `GET|DELETE
    /organizations/{org}/invitations/{uuid}`, `GET /organization_memberships`, `GET|DELETE
    /organization_memberships/{uuid}`
  - `GET /teams?user=`, `GET /teams/{uuid}`, `GET /groups`, `GET /groups/{uuid}`, `GET /group_relationships`
  - `GET /event_types` (filters user, organization, team (ext), active, admin_managed, user_availability_schedule,
    booking_method (ext); sort name, position, created_at, updated_at), `POST /event_types`, `GET|PATCH
    /event_types/{uuid}`, `POST /one_off_event_types`, `GET /event_type_memberships?event_type=`, `GET
    /event_type_available_times?event_type=&start_time=&end_time=` (max 31 days, start not in the past; returns `status,
    invitees_remaining, start_time, scheduling_url`), `GET|PATCH /event_type_availability_schedules?event_type=`
  - `GET /user_availability_schedules?user=`, `GET /user_availability_schedules/{uuid}`, `GET
    /user_busy_times?user=&start_time=&end_time=` (max 7 days; types `calendly` (name kept for
    compatibility), `reserved`, `external`; buffered times)
  - `GET /locations?user=`
  - `GET /scheduled_events` (filters user, organization, group, invitee_email, status, min_start_time, max_start_time;
    sort start_time), `GET /scheduled_events/{uuid}`, `POST /scheduled_events/{uuid}/cancellation {reason}`, `GET
    /scheduled_events/{uuid}/invitees` (filters status, email; sort created_at), `GET
    /scheduled_events/{event}/invitees/{uuid}`
  - `POST /invitee_no_shows {invitee}`, `GET|DELETE /invitee_no_shows/{uuid}`
  - `POST /scheduling_links`, `POST /shares`
  - `GET /routing_forms`, `GET /routing_forms/{uuid}`, `GET /routing_form_submissions?form=`, `GET
    /routing_form_submissions/{uuid}`
  - `GET|POST /webhook_subscriptions`, `GET|DELETE /webhook_subscriptions/{uuid}`, `GET /sample_webhook_data`
  - `GET|POST /contacts`, `GET|PATCH|DELETE /contacts/{uuid}`, `GET /contacts/custom_field_definitions`, `GET
    /contacts/custom_field_definitions/{uuid}`
  - `GET /activity_log_entries` (owner and admin)
  - `POST /data_compliance/deletion/invitees {emails[]}`, `POST /data_compliance/deletion/events {start_time, end_time}`
  - `GET /outgoing_communications?organization=&min_created_at=&max_created_at=`
  - `GET /meeting_polls`, `GET /meeting_polls/{uuid}` (extension, read-only)
- **Acceptance**: every listed endpoint has a passing integration test with a PAT.

### API-04 Scheduling API (P2)

- **Behavior**: `POST /invitees` books like the public form: `event_type` (URI), `start_time` (UTC), `invitee { name |
  first_name + last_name, email, timezone, text_reminder_number }`, `location` (must match an event type location; not
  allowed for round robin per-host locations), `questions_and_answers [{question (exact text), answer, position}]` (all
  required questions), `tracking { utm_*, salesforce_uuid }`, `event_guests` (max 10). Marks `scheduling_method = api`.
  Same validation, race safety, availability rules (including event type and host limits, SCH-09) and notifications.
  Rate limit 10 per minute, 100 per day per user (our choice).
- **Acceptance**: an API booking for a taken slot returns 409 with title "Slot unavailable" (our choice).

### API-05 Write extensions (P3)

- **Behavior**: Beyond Calendly: PATCH event types accepts buffers, notice, increments, limits, date range, questions,
  hosts, secret, locations; `POST|PATCH|DELETE /routing_forms`; `POST /scheduled_events/{uuid}/reschedule` (host);
  `PATCH /scheduled_events/{uuid}` (meeting notes, location). Documented as extensions.
- **Acceptance**: PATCH with `buffer_before_minutes` updates the editor value.

### API-06 Rate limits (P2)

- **Behavior**: 500 requests per minute per token (fixed window); headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` (seconds); 429 on exceed with `Retry-After`.
- **Acceptance**: the 501st request in a minute returns 429.

### API-07 Webhook subscriptions UI (P2)

- **Behavior**: Integrations > Webhooks: list (callback URL, events, scope, state Active/Disabled, created, last delivery
  status), "Create webhook" form: callback URL (https; http allowed only for localhost in development), events
  checklist, scope (user for everyone; organization for owners and admins; group P3), optional signing key (generated if
  empty; shown once and retrievable by owners), "Send test" (API-12). Delete with confirmation; "Re-enable" for disabled
  subscriptions (extension; Calendly requires recreating).
- **Acceptance**: creating a webhook stores an encrypted signing key and lists it as Active.

### API-08 Webhook events and payloads (P2)

- **Behavior**: Events: `invitee.created`, `invitee.canceled` (also for the old invitee of a reschedule, with
  `rescheduled: true` and `new_invitee`), `invitee_no_show.created`, `invitee_no_show.deleted`,
  `routing_form_submission.created`, `event_type.created`, `event_type.updated`, `event_type.deleted`, `contact.created`,
  `contact.updated`, `contact.deleted`, plus extensions `poll.created`, `poll.vote_created`, `poll.vote_updated`,
  `poll.booked`, `poll.canceled`, `payment.succeeded`. Envelope `{ "event", "created_at", "created_by", "payload" }`.
  Invitee payloads equal the invitee resource plus an embedded `scheduled_event` (uri, name, status, times, event_type,
  location, invitees_counter, created_at, updated_at, event_memberships, event_guests, meeting notes, cancellation).
  Scope: user subscriptions receive events where the user is a host or owner; organization subscriptions all org events.
- **Acceptance**: a booking delivers one `invitee.created` to each matching subscription.

### API-09 Signing (P2)

- **Behavior**: Header `Calendly-Webhook-Signature: t={unix},v1={hex}` (compatibility) and identical `X-Webhook-Signature`
  where `v1 = HMAC_SHA256(signing_key, t + "." + raw_body)`. Docs recommend a 3-minute tolerance. Each delivery also
  sends `X-Webhook-Id` (delivery id) and `X-Webhook-Event`.
- **Acceptance**: a verification helper in tests validates the signature of a delivered payload.

### API-10 Delivery, retries, disable (P2)

- **Behavior**: POST JSON with connect timeout 10s and read timeout 15s. 2xx = success. Other responses or timeouts
  retry with exponential backoff (1, 2, 4, 8, 16, 32 minutes, then hourly) for 24 hours from the first failure
  (`retry_started_at`); if still failing after 24 hours the subscription becomes `disabled` and the creator is emailed.
  Other events continue to be attempted meanwhile. Deliveries are independent jobs (ordering not guaranteed). Each
  (subscription, domain event, webhook event) produces at most one delivery row, so a retried fan-out never sends
  duplicates (manual redeliveries, API-11, are separate rows). Callback URLs are fetched only through the SSRF-safe
  fetch (GEN-08), validated at create time and on every delivery.
- **Acceptance**: a mocked endpoint failing for 25 hours ends with the subscription disabled; running the fan-out job
  twice for one booking creates one delivery per subscription.

### API-11 Delivery log and redelivery (P2, extension)

- **Behavior**: Webhook detail page: last 30 days of deliveries (time, event, status code, duration, attempt), payload
  and response body (truncated to 10KB) viewer, "Redeliver".
- **Acceptance**: redelivery creates a new delivery row with the same payload.

### API-12 Sample data and test send (P3)

- **Behavior**: `GET /sample_webhook_data?event=...` returns a realistic payload; "Send test" in the UI posts a sample for
  a chosen event to the URL and shows the response.
- **Acceptance**: sample payloads validate against the same schema as real ones.

### API-13 Embed script and widgets (P1)

- **Behavior**: `/embed.js` (alias `/widget.js`), vanilla JS (no dependencies, under 15KB minified) that defines
  `window.Kairos` (named after the app) and, when not already present, `window.Calendly` with the same methods:
  `initInlineWidget({ url, parentElement, prefill, utm, resize, pageSettings })`, `initPopupWidget({ url, prefill, utm,
  pageSettings })`, `initBadgeWidget({ url, text, color, textColor, branding, prefill, utm, pageSettings })`,
  `closePopupWidget()`, `destroyBadgeWidget()`, and the legacy alias `showPopupWidget(url)` (same as
  `initPopupWidget({ url })`). `pageSettings` keys map to the BK-26 params: `backgroundColor` -> `background_color`,
  `textColor` -> `text_color`, `primaryColor` -> `primary_color` (leading `#` stripped), `hideEventTypeDetails` ->
  `hide_event_type_details=1`, `hideLandingPageDetails` -> `hide_landing_page_details=1`, `hideGdprBanner` ->
  `hide_gdpr_banner=1`. Auto-init elements `.calendly-inline-widget[data-url]` and `.kairos-inline-widget[data-url]`
  (with `data-resize="true"`) on DOM ready unless the element has `data-auto-load="false"` (then only an explicit
  `initInlineWidget` call renders it), and links with `data-kairos-popup`. `/widget.css` is served (the stylesheet
  Calendly snippets link to; it holds the same popup, badge and inline styles the script injects, so pages that link it
  render correctly before the script runs). Prefill keys `name`, `firstName`, `lastName`, `email`, `guests[]`, `location`,
  `smsReminderNumber`, `customAnswers {a1..a10}`, `date`; UTM keys `utmCampaign`, `utmSource`, `utmMedium`, `utmContent`,
  `utmTerm` (auto-read from the parent page URL, max 255 chars each). Adds `embed_domain` and `embed_type` params. Badge
  default: bottom-right, text "Schedule time with me", background `#0069FF`, white text, optional "Powered by {AppName}".
  Popup: dark scrim, white rounded frame with close x, spinner while loading, Esc closes. Inline min width 320px, default
  height 700px; auto-resize from `page_height` messages.
- **Acceptance**: a static HTML test page using the Calendly snippet syntax (including the `widget.css` link) with our
  script URL renders the inline widget; `pageSettings: { primaryColor: "#ff0000", hideEventTypeDetails: true }` produces
  an iframe URL with `primary_color=ff0000&hide_event_type_details=1`; an element with `data-auto-load="false"` stays
  empty until `initInlineWidget` is called; `Calendly.showPopupWidget(url)` opens the popup.

### API-14 "Add to website" generator (P1)

- **Behavior**: Modal from the event card, landing page actions and Integrations > Embed: step 1 three option cards
  "Inline Embed" ("Add a scheduling page to your site"), "Popup Widget" ("Add a floating button that opens a popup"),
  "Popup Text" ("Add a text link that opens a popup"), "Continue"; step 2 left settings (checkboxes "Hide event type
  details", "Hide cookie banner"; colors "Background color", "Text color", "Button & link color"; Popup widget: "Widget
  text" default "Schedule time with me", "Widget text color", "Widget background color", "Hide {AppName} branding"; Popup
  text: "Link text" default "Schedule time with me"), right live preview, bottom code textarea and "Copy code". Works for
  a landing page (all event types) or a single event type, team pages and routing forms.
- **Acceptance**: the generated snippet pasted into a test page works and reflects the chosen colors.

### API-15 Embed postMessage events (P1)

- **Behavior**: Embedded pages post to `window.parent` (target origin `*`, payload without PII except URIs):
  `calendly.profile_page_viewed`, `calendly.event_type_viewed`, `calendly.date_and_time_selected`,
  `calendly.event_scheduled` (`{ event: { uri }, invitee: { uri } }`), `calendly.page_height` (`{ height: "1200px" }`),
  and duplicates with the `kairos.` prefix. Plain iframes without `embed_domain` still post (harmless).
- **Acceptance**: an e2e test listens on the parent page and receives `calendly.event_scheduled` with URIs after
  booking.

### API-16 API documentation page (P3)

- **Behavior**: `/app/integrations/api/docs` renders endpoint reference (generated from route metadata or a hand-written
  OpenAPI 3.1 document served at `/api/v1/openapi.json`) with the compatibility notes.
- **Acceptance**: the OpenAPI document validates.

### API-17 Calendar feed of bookings (P3, extension)

- **Behavior**: Availability > Calendar settings, card "Calendar feed" (the "Calendar sync" entry of the account menu
  opens this page): a private ICS URL (`/api/feeds/{token}.ics`) listing the user's upcoming and last 30 days of
  meetings for subscription in any calendar app, shown again on later visits (the token is stored encrypted besides its
  hash), "Copy", "Regenerate URL" (the old URL stops working).
- **Acceptance**: the feed contains one VEVENT per active meeting; the card shows the same URL after a reload;
  regenerating makes the old URL return 404.

### API-18 Outgoing communications (P3)

- **Behavior**: `GET /outgoing_communications` lists emails and SMS sent for the org (type, recipient, status, created,
  related invitee) from the outbox and SMS log.
- **Acceptance**: a booking's confirmation email appears in the list.

---

## 19. PAY: Payments

### PAY-01 Stripe availability (P2)

- **Behavior**: Payments exist when `STRIPE_SECRET_KEY` is set (one Stripe account for the whole instance; per-user
  Stripe Connect is P3). Integrations > Stripe shows mode (test or live from the key prefix), account name, webhook
  status (`STRIPE_WEBHOOK_SECRET` set), and the webhook URL to configure (`{APP_URL}/api/webhooks/stripe`). Without the
  webhook secret, payment completion relies on the return URL verification (PAY-03).
- **Acceptance**: with a `sk_test_` key the page shows "Test mode".

### PAY-02 Event type payment settings (P2)

- **Behavior**: Payment section: toggle "Require payment to book this meeting", processor (Stripe; PayPal P3), "Amount"
  (0.50 to 99,999.99), "Currency" (AUD, CAD, EUR, GBP, USD), "Payment terms and cancellation policy" (up to 1,024
  chars, shown before payment), coupons (PAY-05), "Do not collect payments for this event" to revert. Booking page shows
  card icon + "$100.00 USD". Group events: each invitee pays for their own seat (our choice). Round robin and collective
  use the instance account.
- **Acceptance**: `is_paid` is true in the API when enabled.

### PAY-03 Checkout during booking (P2)

- **Behavior**: On the details form of a paid event, the submit button reads "Continue to payment" (our choice). Submit
  validates the form, creates a reservation under the booking locks (PAY-04, SCH-19), then: if
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set, renders the Stripe Payment Element inline in the right panel (cards,
  Apple Pay, Google Pay, Link per Stripe settings) with "Pay {amount} and schedule" and the terms text; otherwise
  redirects to Stripe Checkout (success URL `/payments/return?reservation={id}&session_id={CHECKOUT_SESSION_ID}`, cancel
  URL back to the form, `expires_at` 30 minutes ahead, the Stripe minimum). Completion: the webhook
  (`payment_intent.succeeded` or `checkout.session.completed`) or the return URL (server retrieves the session or intent
  and verifies amount, currency, metadata) completes the reservation into a booking exactly once (the reservation moves
  to completed in a single conditional update and the invitee row references it uniquely), records the payment, and
  shows the confirmation. Failed or canceled payment: no booking; the reservation is released after expiry. SCA and 3D
  Secure handled by Stripe.
- **Embed mode** (Stripe Checkout refuses to load inside an iframe): with the publishable key the inline Payment Element
  is used as usual (it works in iframes); without it, "Continue to payment" opens Checkout in a new top-level window
  (popup, or a new tab when popups are blocked) and the embedded page shows "Complete your payment in the new window."
  with the hold countdown; the return page posts `kairos:payment_complete` to its opener and closes, and the embedded
  page also polls the reservation status every 3 seconds as a fallback, then shows the confirmation inside the iframe
  (our choice).
- **Acceptance**: with mocked Stripe, a succeeded intent completes exactly one booking even if both webhook and return
  URL arrive concurrently (real Postgres test); in an embed without the publishable key, Checkout opens in a new window
  and the iframe shows the confirmation after completion.

### PAY-04 Slot hold during payment (P2)

- **Behavior**: The reservation holds the slot (SCH-19) for that invitee email: 10 minutes with the inline Payment
  Element, until the Checkout session expires (30 minutes) on the Checkout path; the countdown shows the real remaining
  time ("We're holding this time for you for 9:42"). On a group slot the hold takes one seat; on a round robin event it
  holds only the provisionally assigned host (SCH-16). If payment succeeds after expiry and the slot is still free, the
  booking completes; if the slot was taken, the payment is refunded automatically and the invitee sees "Sorry, that
  time is no longer available. Your payment was refunded." (our choice).
- **Acceptance**: an expired hold with a taken slot triggers a refund call; a pending hold on the last seat of a group
  slot makes the slot full for others.

### PAY-05 Coupons (P3)

- **Behavior**: Coupon codes (Stripe only): code (unique per account, case-insensitive, 3 to 40 chars), name (on
  receipts), type percent off (1 to 100) or amount off (currency of the event), options "First-time invitees only" (by
  email, never paid before for this host), "Usage limit" (total redemptions), "Expires on". Attach coupons to event types
  in the payment section. Booking form shows "Have a coupon code?" link revealing an input and "Apply"; shows the
  discounted price. A 100% coupon skips payment entirely. Discounts cannot reduce the charge below 0.50 in the currency
  (else rejected "This coupon can't be applied to this price").
- **Acceptance**: a 100% coupon books without any Stripe call.

### PAY-06 Payment records and display (P2)

- **Behavior**: Payments table per invitee (provider, external id, amount, currency, coupon, discount, status, terms
  snapshot, receipt URL). Meeting details "Payment" block with amount, status and "View in Stripe" link. Confirmation
  email includes the receipt line and Stripe sends its own receipt when enabled in Stripe. CSV columns "Event Price" and
  "Payment Currency". API invitee `payment { external_id, provider, amount, currency, terms, successful }`.
- **Acceptance**: the API returns the payment object for a paid invitee.

### PAY-07 Reschedule and cancel (P2)

- **Behavior**: Rescheduling a paid meeting does not charge again ("You have previously paid for this event and will
  not be charged again."); the payment moves to the new invitee record. Canceling does not refund automatically
  (Calendly parity); the host gets a reminder in the cancellation email "This meeting was paid. Refund it in Stripe if
  your policy requires it." with a link. Disconnecting payments (removing the key) makes paid event types bookable
  without payment (Calendly parity) and shows a warning banner on those event types.
- **Acceptance**: a reschedule of a paid meeting creates no new payment.

### PAY-08 Refunds (P3, extension)

- **Behavior**: Meeting details "Refund" button (full or partial amount) calls Stripe refunds and records status
  `refunded`.
- **Acceptance**: a refund updates the payment status.

### PAY-09 PayPal (P3)

- **Behavior**: With `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, offer PayPal (wallet, Venmo US, cards) via the Orders
  API with the PayPal JS buttons; no coupons (Calendly parity).
- **Acceptance**: a sandbox order capture completes a booking.

### PAY-10 Team payments account (P3)

- **Behavior**: Team and shared event types use the instance account; per-user Stripe Connect accounts for personal
  event types are a later option.
- **Acceptance**: documented; no per-user account UI before it is built.

---

## 20. BR: Branding, profile and account settings

### BR-01 Profile settings (P0)

- **Behavior**: `/app/settings/profile` ("Profile" under "Account settings" in the settings sub-nav): avatar (BR-02),
  "Name" (1 to 100), "Welcome Message" (BR-03), "Language" (app language: English only selectable for now, P3 others),
  "Date Format" (MM/DD/YYYY, DD/MM/YYYY), "Time Format" (12h (am/pm), 24h), "Week starts on" (Sunday, Monday)
  (extension), "Country", "Time Zone" (GEN-06), "Default location for new event types" (VID-15), "Appearance"
  (GEN-22), "Save changes". Danger zone "Leave {Org name}" for non-owner members (TM-04) and "Delete account" (AU-15).
- **Acceptance**: changing the time zone updates times in the Meetings page.

### BR-02 Avatar upload (P1)

- **Behavior**: "Upload picture" accepts JPG, PNG, GIF, WEBP up to 5MB; client-side square crop dialog; stored resized to
  256x256 (WEBP or PNG). "Remove". Google/Microsoft avatars are used until a custom upload exists. Shown on landing and
  booking pages, emails and the app.
- **Acceptance**: a 6MB upload is rejected with "Images must be smaller than 5 MB."

### BR-03 Welcome message (P0)

- **Behavior**: Textarea (up to 265 characters with counter), default "Welcome to my scheduling page. Please follow the
  instructions to add an event to my calendar." Shown on the landing page.
- **Acceptance**: updating the message updates the landing page.

### BR-04 Locale, formats and zone (P1)

- **Behavior**: See BR-01; formats affect the dashboard and host emails; invitee-facing pages follow the invitee
  (GEN-06, GEN-10).
- **Acceptance**: 24h format shows "14:00" in Meetings.

### BR-05 Logo (P1)

- **Behavior**: `/app/settings/branding`: "Logo" upload (PNG, JPG, SVG sanitized, up to 5MB; recommended minimum 440x240;
  stored resized to max 880px wide), preview, "Remove". Copy "Your logo will appear on your booking pages and in
  notifications". Shown top-left of booking pages (or top of the details panel) and in email headers.
- **Acceptance**: the logo appears on the booking page after upload.

### BR-06 Powered-by ribbon (P1)

- **Behavior**: Branding toggle "Use {AppName} branding" (default on). Off hides the ribbon on all public pages, the
  "Powered by" footer in emails (avatar or logo replaces the app logo), and the embed badge branding. Team and shared
  event types follow the org owner's setting (Calendly parity).
- **Acceptance**: toggling off removes the ribbon from `/{slug}`.

### BR-07 Booking page colors (P2)

- **Behavior**: Branding "Booking page colors": "Background color", "Text color", "Button & link color", each empty by
  default; empty means the classic tokens (GEN-03: background `#FFFFFF`, text `#0A2540`, buttons `#006BFF` with hover
  `#004EBA` and link text `#004EBA`). The pickers show Calendly's custom-theme suggestions (`#FFFFFF`, `#4D5055`,
  `#0069FF`) as placeholders only; choosing a color stores it, "Reset" clears all three back to the classic tokens.
  Live preview. Applies to hosted public pages and embeds (extension: Calendly applies to embeds only). Contrast check
  warns when button text contrast is below 4.5:1.
- **Acceptance**: setting the button color changes `--primary-color` on the booking page; a user who never opened
  Branding gets `#006BFF` buttons, not `#0069FF`.

### BR-08 My link (P0)

- **Behavior**: `/app/settings/link`: warning "Changing your {AppName} URL will mean that all of your copied links will
  no longer work and will need to be updated.", input with `{host}/` prefix, live availability check, "Save changes".
  Old slug stops working immediately (no redirect, Calendly parity) and is released.
- **Acceptance**: after changing the slug, `/{old}` returns 404 and `/{new}` works.

### BR-09 Notification preferences (P2)

- **Behavior**: See NT-21.
- **Acceptance**: covered by NT-21.

### BR-10 Login and security page (P1)

- **Behavior**: `/app/settings/login`: login email (AU-10), password, connected sign-in methods, two-factor (AU-09),
  active sessions (device, browser, IP city if known, last active; "Log out" per session and "Log out of all other
  sessions").
- **Acceptance**: logging out another session invalidates it.

### BR-11 Cookie settings (P2)

- **Behavior**: `/app/settings/cookies` shows the user's own cookie preferences for the app (essential only) and explains
  invitee consent (GEN-14).
- **Acceptance**: page renders with current preferences.

### BR-12 Privacy: booking verification defaults (P2)

- **Behavior**: `/app/settings/privacy` "Booking": "Require email verification for new event types" default and "Apply to
  all my event types" action.
- **Acceptance**: the default applies to newly created event types.

### BR-13 Privacy: blocked people (P2)

- **Behavior**: "Blocked people" list (email or domain, reason, blocked on, source meeting link) with "Unblock"; "+ Block
  someone" manual entry (email or domain (extension)).
- **Acceptance**: unblocking allows the email to book again.

### BR-14 Settings navigation (P0)

- **Behavior**: `/app/settings` redirects to Profile. Sub-nav groups: "Account" (Profile, Branding, My link, Login and
  security, Notifications, Cookie settings, Privacy, Import from Calendly), "Calendar" (links to Availability tabs:
  Calendar settings, Availability, Advanced), "Integrations" (link to hub). Mobile: sub-nav becomes a select.
- **Acceptance**: each item navigates to its page.

### BR-15 Account menu (P0)

- **Behavior**: Header avatar (32px, initials fallback) with chevron opens a 280px popover: name and email header;
  "Account settings": Profile, Branding, My Link, Notifications, Login and security, Cookie settings; "Calendar sync"
  (Calendar settings); "Share your link" with copy; "Help"; divider; "Log out". Admins also see "Admin center" and
  "Invite users".
- **Acceptance**: the menu is keyboard navigable and closes on Escape.

### BR-16 Organization branding (P3)

- **Behavior**: Admin > Branding: org logo and "Apply branding to all members" (members' pages use the org logo and
  ribbon setting).
- **Acceptance**: applying org branding shows the org logo on a member's page.

### BR-17 Import from Calendly (P2, extension)

- **Behavior**: `/app/settings/import` "Import from Calendly", the owner's migration path. The user pastes a Calendly
  personal access token (Calendly > Integrations > API and webhooks), which is used for this import only and never
  stored after the run (kept encrypted in the job payload until the job finishes, our choice). "Preview" lists what
  will be imported; "Import" runs a background job with a progress view and a summary ("{n} event types, {m} schedules
  imported, {k} skipped"). Imported:
  - Event types owned by the token's user (`GET /event_types?user=`): name, slug, duration, duration options, color,
    description, locations (kinds mapped to VID-01; unsupported kinds become Custom with their text), custom questions
    (types mapped to ET-24), secret, active, position, minimum notice and date range when present.
  - Availability schedules (`GET /user_availability_schedules`): name, rules (weekly hours and date overrides), time
    zone, default flag.
  - Profile: slug (only when free in this instance's namespace, else kept and reported), welcome message (when
    available), time zone.
  - Optional checkbox "Also block my upcoming Calendly meetings": upcoming active scheduled events (next 12 months)
    become read-only busy blocks (CAL-22) so nothing double books during the switch.
  Idempotent: each imported record remembers its Calendly URI; re-running updates the records it created earlier
  (unless edited here since, which is reported as skipped) and never duplicates them. Calendly API errors show
  "Calendly rejected the token. Create a new personal access token and try again." for 401.
- **Acceptance**: with a mocked Calendly API, importing twice creates each event type and schedule once; imported
  meetings block their times; an event type with a Calendly slug already used here gets a de-duplicated slug and is
  listed in the summary.

---

## 21. ADM: Administration and operations

### ADM-01 Admin center access and navigation (P1)

- **Behavior**: `/app/admin` (sidebar "Admin center", visible to org owners and admins and instance admins). Sub-nav:
  Overview, People, Teams, Groups, Managed events, Permissions, Branding (org), Security and data, Activity log, and for
  instance admins: Instance, Outbox, SMS log, Jobs. Instance admins: the first user and anyone listed in `ADMIN_EMAILS`
  (comma-separated).
- **Acceptance**: a plain user gets 403 on `/app/admin/*`.

### ADM-02 Instance settings (P1)

- **Behavior**: `/app/admin/instance`: "Who can sign up" (AU-11), "Allowed domains" (for the domains policy), app name
  display (read-only, from env), default invitee language, links to the setup checklist.
- **Acceptance**: changing the signup policy takes effect immediately.

### ADM-03 Integration status (P1)

- **Behavior**: Overview card "Configuration" (also on `/setup` and `/app/admin/instance`): green or gray status per
  integration (GEN-09 list) with the env var names to set, redirect URIs to register, last cron tick time (warning when
  older than 15 minutes, GEN-16, with the pinger setup steps), job backlog size, email provider in use.
- **Acceptance**: removing `RESEND_API_KEY` switches the email status to "Outbox only".

### ADM-04 Email outbox viewer (P0)

- **Behavior**: `/app/admin/outbox` (instance admins; also each user sees "My sent emails" filtered to their own
  meetings (our choice)): table with time, to, subject, template, status (queued, sent, stored, failed), provider; filters
  status, recipient, date; detail view renders the HTML in a sandboxed iframe, the text version, headers, ICS attachment
  (download and parsed summary), error; actions "Resend" and "Copy link" for magic links. HTML and text bodies are
  purged after 30 days (the row then shows "Content removed after 30 days" and cannot be resent) and rows older than
  90 days are purged (our choice, GEN-16 retention).
- **Acceptance**: in a local install with no email provider, the owner can open the invitee confirmation and click its
  cancel link.

### ADM-05 SMS log (P2)

- **Behavior**: `/app/admin/sms`: time, to, body, status, provider sid, error; same filters.
- **Acceptance**: stored SMS rows render.

### ADM-06 Jobs monitor (P2)

- **Behavior**: `/app/admin/jobs`: counts by status, table (type, run at, status, attempts, last error, idempotency key),
  filters, actions "Run now", "Retry", "Cancel"; button "Run due jobs now" (calls the dispatcher with a 20 second budget).
- **Acceptance**: "Retry" on a dead job sets it pending and it runs.

### ADM-07 Activity log (P2)

- **Behavior**: `/app/admin/activity`: entries from GEN-17 with search (actor, action, namespace) and date filters,
  CSV export; retained 1 year (our choice).
- **Acceptance**: login events appear with IP and user agent.

### ADM-08 Data deletion (P2)

- **Behavior**: `/app/admin/security` "Data deletion": "Delete invitee data by email" (up to 100 emails, comma
  separated) and "Delete invitee data by date range"; confirmation "This can't be undone"; runs as a job: invitee and
  contact names deleted, emails anonymized to `{hash}@deleted.invalid`, answers, notes about them, guests, tracking,
  phone numbers removed, poll participants and routing submissions anonymized, outbox and SMS log rows for them purged.
  Request list with status and completion time. API equivalent (API-03).
- **Acceptance**: after deletion by email, no table contains that email in plain text.

### ADM-09 Health endpoint (P0)

- **Behavior**: `GET /api/health` returns `{ ok, db: "pglite" | "postgres" | "missing", setupRequired, version, time }`
  without secrets; 200 when healthy, 503 when the DB is unreachable or setup is required.
- **Acceptance**: health returns `db: "pglite"` locally.

### ADM-10 Seed and demo data (P0)

- **Behavior**: `npm run db:seed` (never automatic in production) creates the owner demo account from
  `docs/research/owner-reference.md` and observations: user "Julian Joseph", slug `julianjoseph`, email
  `owner@example.com`, password `password123` (local only), time zone America/Los_Angeles, 12h; schedules "Working hours"
  (default; Sun 14:00 to 19:00, Mon 12:00 to 17:00, Tue 11:00 to 23:00, Wed 11:00 to 23:00, Thu 11:00 to 20:00, Fri 11:00
  to 17:00, Sat unavailable) and "Block Off Work" (Sun 13:00 to 21:00, Mon 17:00 to 17:00, Tue to Thu 17:00 to 20:00, Fri
  17:00 to 17:00, Sat none); event types "30 Minute Virtual" (`30min`, 30 min, `#8247F5`, Google Meet, 15-minute
  increments, 15/15 buffers, schedule Working hours), "60 Minute Virtual" (`60min`, 60 min, `#8247F5`, Google Meet, 15
  minute increments, 15/15 buffers (our choice)), "In-Person Meal or Coffee" (`meal`, 120 min, `#17E885`, 8 generic
  in-person locations named like "Venue - Neighborhood - $$" with addresses in additional info plus ask invitee, 15-minute
  increments, schedule Block Off Work), each with one required "What would you like to discuss?" (Multiple lines)
  question, positions 0 to 2; a few sample meetings, contacts, a workflow, a routing form and a poll (flag `--demo`;
  the workflow, routing form and poll come from `seedDemo()` functions exported by the workflows, routing forms and
  meeting polls modules, which the seed script calls when they exist). Seed is idempotent (re-running updates rather
  than duplicates). The owner photo is never embedded.
- **Acceptance**: after seeding, `/julianjoseph` matches BK-01 acceptance and `/julianjoseph/meal` offers 9 location
  options.

### ADM-11 Setup page (P0)

- **Behavior**: See GEN-09; owned with ADM-03 content.
- **Acceptance**: covered by GEN-09.

---

## 22. MK: Marketing site

### MK-01 Landing page (P2)

- **Behavior**: `/` for signed-out visitors: header (logo, "Log in", primary "Get started" (to signup, or "Log in" when
  signups are closed)); hero "Easy scheduling, without the back-and-forth" (our copy) with subtext and CTAs, product
  illustration built from our own UI (booking card mock); feature sections: event types and booking pages, calendar
  connections (Google, Outlook, iCloud, CalDAV), workflows and reminders, team scheduling (round robin, collective),
  routing forms, meeting polls, embeds and API; "How it works" 3 steps; FAQ (self-hosted, free, data ownership); footer
  (Privacy, Terms, Cookie policy, GitHub link optional). Fully responsive, Lighthouse performance 90+. Never uses
  Calendly's name or logo.
- **Acceptance**: `/` renders for signed-out users with working CTAs.

### MK-02 Legal pages (P2)

- **Behavior**: `/privacy`, `/terms`, `/cookie-policy` with template text naming the instance operator (from an instance
  setting "Operator name and contact email", defaulting to the instance admin) and the processors used (configured email,
  SMS, payments, calendar providers).
- **Acceptance**: pages render and are linked from public page footers.

### MK-03 Signed-in behavior (P2)

- **Behavior**: Signed-in users visiting `/` are redirected to `/app/scheduling`.
- **Acceptance**: covered by an e2e test.

### MK-04 Help center page (P3)

- **Behavior**: `/help` static articles: connecting calendars, setting availability, sharing links, embedding, workflows,
  polls, routing forms, deploying on Vercel, configuring Google/Microsoft/Zoom OAuth, email and SMS providers.
- **Acceptance**: each article has a heading and steps.

---

## Appendix A: Defaults and limits cheat sheet

| Setting | Default | Range / limit | Spec |
|---|---|---|---|
| Event duration | 30 min | 1 to 720; up to 4 options (not group) | ET-16 |
| Date range | 60 calendar days (rolling from the current time of day) | rolling 1 to 3,650 days (calendar, week, available days), fixed range, indefinite | SCH-02 to SCH-05 |
| Minimum notice | 4 hours | 0 to 365 days | SCH-06 |
| Buffers | 0 / 0 | 0 to 720 min each | SCH-07 |
| Increments | 30 min, aligned to block start | 5 to 720 min; align to hour (ext) | SCH-10 |
| Event type limits | none | 1 to 999 per day, week, month | SCH-08 |
| Host limits | none | 1 to 999 per day, week, month | SCH-09 |
| Time zone display | auto | auto or locked | ET-23 |
| Name field | single | single or first + last | ET-24 |
| Guests | allowed | max 10 (not group) | BK-10 |
| Custom questions | 1 default question | max 10, 6 answer types | ET-24 |
| Group seats | 10 (new group) | 2 to 9,999 | ET-30 |
| Locations per event | none | up to 20 | ET-17 |
| Cancel/reschedule links | on | all or nothing | CR-01 |
| Calendar connections | none | soft hint 6, hard 20 | CAL-01 |
| Workflows | none | 50 per user, 50 per team; 10 actions each; offsets up to 365 days | NT-24, NT-11 |
| SMS length | | 180 chars; answers truncated to 40 | NT-12 |
| Round robin equal distribution | | hide at 3+ ahead | SCH-16 |
| Round robin priority | Medium | 5 levels | ET-20 |
| One-off extra hosts | | 9 | OO-05 |
| One-off slot spread | | within 3 months | OO-05 |
| Poll options / participants | | 100 / 1,000 | MP-30 |
| Poll "If need be" / hide invitees | off / off | on or off | MP-04 |
| Single-use name | | 55 chars | OO-02 |
| Location text / info | | 255 chars each | VID-02 |
| Welcome message | default text | 265 chars | BR-03 |
| Block window | | within 90 days of meeting creation | CR-12 |
| Email verification code | | 6 digits, 10 min, 5 attempts | BK-17 |
| Payment hold | | 10 minutes inline; 30 minutes on the Checkout redirect | PAY-04 |
| Slots API | | 62 days per request; 60 per IP per minute, 600 per hour | BK-31 |
| SMS caps | | 10 texts per number per 24 h; 3 SMS bookings per IP per hour | NT-16 |
| Cron trigger | | GitHub Actions every 10 min; daily Vercel Cron; external pinger every 5 min recommended; warning after 15 min | GEN-16 |
| Calendar cache TTL | 180 s (booking page), 60 s (submit) | | CAL-10 |
| Webhook retries | | 24 hours then disabled | API-10 |
| API rate limit | | 500 req/min per token | API-06 |
| Embed min width | | 320px; layouts at 650 and 1100px | BK-25 |
| Invitee languages | English | en, fr, es, de, nl, pt, it, uk | GEN-10 |
| Holiday countries | none | 10 countries | AV-13 |

## Appendix B: Troubleshoot reason codes

| Code | Meaning | Fix hint |
|---|---|---|
| CALENDAR | A "Busy" calendar event is blocking the time | Change the event to "Free" or remove it |
| NOCAL | {AppName} can't access your calendar | Reconnect your calendar |
| DAILY MAX / WEEKLY MAX / MONTHLY MAX | Event type meeting limit reached | Adjust limits under Limits and buffers |
| DURATION | Not enough time for your event | Shorten the event or extend availability |
| RANGE | Date is outside your availability window | Adjust the date range |
| TOOSOON | Too soon based on minimum notice | Adjust minimum scheduling notice |
| EVENT | Another meeting of this event type is booked | Reschedule or use Free/busy rules |
| GROUP | Group event has max attendees | Increase the max invitee number |
| OVERLAP | Another meeting is booked | Reschedule or use Free/busy rules |
| HOLIDAY | Date is marked as a holiday | Edit holidays |
| MEETING LIMIT | Host-level meeting limit reached | Host adjusts their meeting limit |
| HOST | One or more Collective hosts unavailable | Make sure all hosts are free |
| ROUNDROBIN | No host available under distribution rules | Update host availability or distribution |
| UNFAIR | Booking would distribute meetings unfairly | Adjust distribution settings |
| BUFFER | A buffer is blocking this time | Edit or remove the buffer |
| PAST | Time is in the past | Choose a future date |
| RESERVED | A poll, one-off meeting or checkout holds this time | Clear reserved times |

## Appendix C: Key invitee-facing copy (English)

| Context | String |
|---|---|
| Booking heading | Select a Date & Time |
| Times heading | Select a Time |
| Next button | Next |
| Form heading | Enter Details |
| Guests | Add Guests; Guest Email(s); Notify up to 10 additional guests of the scheduled event. |
| Submit | Schedule Event (reschedule: Update Event) |
| Confirmation | You are scheduled; You are scheduled with %{name}.; Confirmed |
| Calendar invitation sent | A calendar invitation has been sent to your email address. |
| Email confirmation sent | A confirmation has been sent to your email address. |
| Conferencing before booking | Web conferencing details provided upon confirmation. |
| Conferencing after booking | Web conferencing details to follow. |
| Cancel | Cancel Event; Cancel Event?; Reason for canceling; Cancellation Confirmed; Your meeting with %{name} has been canceled.; This event will be canceled for %{invitee_name} and %{count} guests |
| Reschedule | Reschedule Event; Former Time; Reason for change; Reschedule Confirmed; You are rescheduled; You are rescheduled with %{name}.; This event will be rescheduled for %{invitee_name} and %{count} guests |
| Reconfirmation | Thanks for confirming you'll attend this event. |
| Slot taken | Sorry, that time is no longer available.; Please select a different time to book this event.; View Times |
| Already in this group slot | You've already booked this time. |
| Not reschedulable | This event can no longer be rescheduled.; Schedule another event |
| Footer links | Cookie settings; Privacy Policy; Report abuse |
| Owner banner | You are logged in as %{email}. This message is only visible to you. |
| Troubleshoot | Troubleshoot Availability; Stop troubleshooting; Edit event type; Copy link |
| Badge | Powered by {AppName}; Report abuse |
| Poll | Meeting poll; Select all the times you're available to meet; The meeting host will see your preferences when deciding on a final time.; %{count} preferred time(s); Share your preferred times; Share times; Thanks for voting!; You'll receive a calendar invitation when the host decides a final time from submitted votes.; Edit your preferred times; %{count} Vote(s) |
| Date formats | `%A, %B %-d, %Y`; `%A, %B %-d`; `%b %-d`; "min", "hr" |

## Appendix D: Priority summary

- **P0 (build first)**: GEN-01 to GEN-06, GEN-08, GEN-09, GEN-11, GEN-12, GEN-15, GEN-16, GEN-20; AU-01 to AU-07, AU-11
  to AU-14; ET-01 to ET-05, ET-09, ET-10, ET-12, ET-14 to ET-19, ET-21, ET-23, ET-24, ET-33; SCH-01, SCH-02, SCH-04 to
  SCH-08, SCH-10 to SCH-12, SCH-20, SCH-22, SCH-24; AV-01 to AV-04, AV-06, AV-08, AV-10, AV-11, AV-15; CAL-01 to CAL-03, CAL-06 to CAL-08,
  CAL-10 to CAL-12, CAL-15 to CAL-18; VID-01 to VID-07, VID-10, VID-12; BK-01, BK-03 to BK-06, BK-08 to BK-12, BK-19,
  BK-20, BK-22, BK-23, BK-30, BK-31; CR-01 to CR-04, CR-06, CR-16; NT-01 to NT-06, NT-20, NT-23; MT-01, MT-02, MT-05 to
  MT-07, MT-15; BR-01, BR-03, BR-08, BR-14, BR-15; ADM-04, ADM-09 to ADM-11.
- **P1**: everything marked P1 above (teams, round robin, collective, workflows core, routing forms, single-use links,
  one-offs, embeds, contacts core, branding, reschedule extras).
- **P2**: meeting polls core, analytics, API and webhooks, payments, privacy and admin tools, localization.
- **P3**: extensions and deferred integrations.
