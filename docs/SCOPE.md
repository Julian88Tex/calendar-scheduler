# Reduced scope (owner decision, 2026-10-12)

## Owner's top priorities (in the owner's words, condensed). Weigh every decision against these.
1. A UI as close as possible to Calendly's (layout, copy, interactions, visuals).
2. Respect a variety of scheduling settings so the owner does not get too many meetings a day: per event type daily /
   weekly limits AND host-level meeting limits across ALL event types (Calendly "Meeting limits" in Availability
   advanced settings: max meetings per day and per week), buffers, minimum notice, date range, start increments.
3. Respect the owner's Google Calendar blocks exactly (busy events, all-day events, overlapping events, free vs busy).
4. Debugging: the owner must be able to see WHY a time was blocked off. Build Calendly's "Troubleshoot" availability
   view: for any date, every candidate start time with its status and reason (outside working hours, conflicting
   Google Calendar event with its title, buffer before/after a named event, minimum notice, beyond date range, daily
   limit reached, weekly limit reached, host meeting limit reached, existing booking). Reachable from the Availability
   page and from a host-only "Troubleshoot" link on the owner's own booking page, like Calendly.
5. Invitees get reminder emails as the event approaches (default 24 hours before; multiple reminders and timings
   configurable), and both sides get notifications: invitee confirmation, reschedule and cancellation emails with
   calendar invite updates; host emails for new, rescheduled and canceled bookings. Reminder delivery must be
   reliable on Vercel (the job dispatcher must run often enough: document an external pinger, show the cron warning
   banner when jobs are not being dispatched).
6. Invitees can reschedule or cancel on their own via links in every email and on the confirmation page.

The owner wants only the end-user features they use in Calendly today (plus meeting polls, which they asked for).
Anything they are not using right now is skipped. This file OVERRIDES the module descriptions in WORKPLAN.json and the
priorities in SPEC.md wherever they conflict. Module agents: build your module's description minus the parts listed
as skipped here, and do not build UI for skipped features (no disabled buttons, no "coming soon" teasers, no nav links
to skipped areas). Keep existing contracts and schema intact (the schema stays complete; unused tables are fine).

## What the owner uses today (from their Calendly account)
- One person, no team. Solo (one-on-one) event types only:
  - "30 Minute Virtual" (30 min, Google Meet) and "60 Minute Virtual" (60 min, Google Meet),
  - "In-Person Meal or Coffee" (120 min) offering 8 physical venues (name, notes, address) plus "ask invitee";
    the invitee picks one location at booking.
- One required custom question ("What would you like to discuss?").
- Two named availability schedules ("Working hours" default, "Block Off Work"); each event type picks one.
- 15 minute start increments, 15/15 minute buffers, minimum notice, rolling date range.
- Google Calendar connected for conflict checking and as the destination calendar (events created with Meet links).
  Moving or deleting the event in Google Calendar reschedules or cancels the booking. The owner does NOT use Zoom
  (only Google Meet on created events).
- Public profile page with avatar, logo, welcome message and the event type list; booking page; invitee details form;
  confirmation page; confirmation emails with calendar invites; cancel and reschedule links and pages; host can cancel.
- Meetings list (upcoming and past, details, cancel, mark no-show).
- Meeting polls (owner request: the Doodle replacement).

## Kept modules (remaining build order)
1. booking-core: solo event types end to end (slots API, reservations, locks, race-safe creation). Keep the engine
   calls generic, but do not build team pooling flows (round robin, collective, multi-pool) or group seats UI.
2. availability: schedules, weekly hours, date-specific hours, schedule time zone, per event type schedule choice,
   host-level meeting limits across all event types (max per day and per week), and the Troubleshoot view (top
   priority 4 above, built on the slot engine diagnostics). SKIP: holidays UI.
3. booking-pages: profile page, event booking page, details form with location choice and questions, confirmation.
   SKIP: team pages, routing form hand-off, payment step, translations (English only), embed specifics.
4. event-types-editor: ONE-ON-ONE event types only, every setting the owner uses (name, slug, color, description,
   duration incl. custom, multiple locations of kinds physical / Google Meet / ask invitee (the kinds the owner
   uses; keep the data model generic but build no UI for other kinds), custom questions of all answer types, schedule choice, buffers, increments, minimum
   notice, date range, daily/weekly limits, secret/hidden, active toggle, confirmation page and redirect, invitee
   guests toggle). SKIP: group, collective, round robin, managed events, payments section, workflows section beyond
   basic reminders.
5. calendar-integrations: GOOGLE CALENDAR ONLY (connect via OAuth, pick conflict calendars, pick destination
   calendar, busy sync, create/update/delete events, detect host-side moves and deletes). SKIP: Microsoft, CalDAV,
   iCloud, ICS feeds, Calendly import.
6. conferencing: Google Meet only (created through the Google Calendar event) and the stable /events/{id}/join
   redirect. SKIP: Zoom, Jitsi, custom link UI, Microsoft Teams, Webex, GoTo.
7. lifecycle-core: booking emails, cancel, reschedule, host cancel, no-show, calendar sync of host-side changes.
8. lifecycle-ui: invitee cancel and reschedule pages, host meeting dialogs.
9. event-types-list: scheduling home with event type cards (copy link, edit, duplicate, delete, on/off, reorder).
   SKIP: single-use links tab and bulk team features.
10. meetings-dashboard: upcoming / past / date range, details, cancel, reschedule link, no-show, notes.
    SKIP: CSV export only if expensive (keep if cheap).
11. polls-core: meeting polls logic, voting, booking the chosen time, emails.
12. polls-ui: host poll creation on a week grid with busy overlay, voter page, results grid, book the final time.
    Does NOT depend on links-sharing: include the minimal share UI (copy link) inside polls-ui's own paths.
13. workflows (lite): reminder emails (top priority 5): default email reminder to the invitee 24 hours before,
    optional host reminder, multiple reminders with configurable timings per event type, on/off per event type,
    reminders rescheduled or canceled when the meeting changes, backfill for meetings booked before a reminder setting
    changed, Calendly-faithful email content with reschedule and cancel links. SKIP: the custom workflow builder, SMS,
    follow-ups, reconfirmation, templates library.
14. settings (lite, from settings-onboarding): profile (name, avatar, welcome message, time zone, time format), branding
    (logo shown on booking pages, hide "powered by" ribbon), your link (slug), login and security (change password,
    sessions with ownership check). SKIP: onboarding wizard, Calendly import, privacy/cookie settings pages, admin
    branding.
15. golden-path-qa: end-to-end tests of the kept flows only, the deployment guide (Vercel + Neon + Google OAuth
    client setup + Resend), and a QA report. Also: a simple email outbox page for the owner when no email provider is
    configured, and the root URL behavior (signed in: go to the app; signed out: login page).

## Skipped modules (not built)
teams-org, links-sharing (single-use links, one-off meetings, book on behalf), payments, contacts, routing-forms,
api-v1, webhooks-embed, analytics, admin-compliance, marketing-site, localization.
The sidebar must only show kept areas: Scheduling, Meetings, Availability, Meeting polls (inside Scheduling or its
own entry, per Calendly), Integrations (Google Calendar only), Settings. Remove or hide entries for Contacts,
Workflows builder, Routing, Analytics, Admin center, Teams.
