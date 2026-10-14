# Build status

Updated after every finished module. Scope was reduced to the features the owner uses today (docs/SCOPE.md). "Testable" means you can click through it in a running app (locally with
`npm run dev` after `npm run db:seed`, or on a Vercel preview). Seed login: `owner@example.com` / `password123`.

## Testable right now

Run locally (no database or accounts needed): check out the `claude/scheduler-app` branch, then
`npm install`, `npm run db:seed -- --demo`, `npm run dev`, and open http://localhost:3000. Sign in with
`owner@example.com` / `password123`.

What works:
- Public booking flow: http://localhost:3000/julianjoseph (profile), pick an event type, pick a date and time,
  enter details (the meal event offers the 9 locations), book, and see the "You are scheduled" confirmation page with
  add-to-calendar links. The booking respects schedules, buffers, increments and limits.
- Availability (sidebar > Availability): edit weekly hours and date-specific hours, switch schedules, set meeting
  limits under Advanced, and open the Troubleshoot view to see why any time is unavailable.
- Google Calendar settings (Availability > Calendar settings) work once a Google OAuth client is configured
  (docs/GOOGLE_SETUP.md); without it the app runs with no calendar conflicts.

- Scheduling home (sidebar > Scheduling): event type cards with copy link, on/off, duplicate, delete and reorder;
  click a card to open the event type editor (duration, locations, questions, buffers, limits, notice, reminders).
- After booking: the confirmation page has "Cancel" and "Reschedule" links that open the invitee cancel and
  reschedule pages. Confirmation, reschedule, cancellation and reminder emails are generated with calendar invites;
  with no email provider configured they are stored in the database outbox (an outbox page comes with QA).
- Settings (account menu > Settings): profile (name, avatar, welcome message, time zone, time format), branding,
  your link, password and sessions.

Not working yet (being built): the Meetings list, meeting polls, a few booking page visual differences found by
comparing against live Calendly screenshots (back arrow position, location list style, field sizes, time zone picker
layout, error messages).

## Milestones (in build order)

Each milestone ends in something you can test. Reply any time to reorder, drop, or change anything.

### Milestone 1: book a meeting on your public page
| Module | What it gives you | Status |
|---|---|---|
| foundation-ui | Calendly look and feel: app shell, sidebar, buttons, calendar grid, time slots, time zone picker | done |
| foundation-auth | Sign up, log in, password reset, 2FA, Sign in with Google (also connects the calendar) | done |
| foundation-platform | Email sending with Calendly-style layout and calendar invites, background jobs, cron | done |
| slot-engine | The scheduling brain: hours, buffers, minimum notice, increments, limits, DST, why-blocked diagnostics | done |
| booking-core | Taking a booking safely (no double booking), daily/weekly and account-wide limits, slot API | done |
| booking-pages | Your profile page, the month calendar and time slots, details form, confirmation page | done |

### Milestone 2: set up your own availability and event types
| Module | What it gives you | Status |
|---|---|---|
| availability | Schedules, weekly hours, date-specific hours, max meetings per day/week across all event types, Troubleshoot view (why a time is blocked) | done |
| event-types-editor | Create and edit one-on-one event types: duration, locations, questions, buffers, limits, notice, increments | done |
| event-types-list | Scheduling home: event type cards, copy link, duplicate, on/off, search | done |

### Milestone 3: real calendars and video links
| Module | What it gives you | Status |
|---|---|---|
| calendar-integrations | Google Calendar: conflict checking, adding events, detecting moves and deletes (applied by lifecycle-core) | done |
| conferencing | Google Meet links on created events, plus the stable join link | done |

### Milestone 4: life after booking
| Module | What it gives you | Status |
|---|---|---|
| lifecycle-core | Booking emails, cancel, reschedule, host changes synced back to the calendar | done |
| lifecycle-ui | Cancel and reschedule pages for invitees, host meeting dialogs | done |
| meetings-dashboard | Meetings page: upcoming, past, filters, details, no-show, export | building |

### Milestone 5: meeting polls (the Doodle replacement)
| Module | What it gives you | Status |
|---|---|---|
| polls-core | Poll logic: proposing times, voting, booking the winner, emails | in review |
| polls-ui | Create a poll on a week grid, voter page, results grid, book the final time | queued |

### Milestone 6: the rest of what you use today
| Module | What it gives you | Status |
|---|---|---|
| workflows (lite) | Reminder emails before meetings (default 24h, multiple timings), kept in sync with reschedules and cancels | done |
| settings (lite) | Profile (name, avatar, welcome message, time zone), logo, your link, password and sessions | done |
| booking-parity | Pixel-level pass on the booking pages against live Calendly screenshots (desktop and phone) | next |
| golden-path-qa | End-to-end tests of every kept flow, email outbox page, deployment guide, QA report | last |

### Skipped (owner decision, see docs/SCOPE.md)
Teams and round robin, single-use links and one-off meetings, payments, contacts, routing forms, public API,
webhooks and embed, analytics, admin tools, marketing site, translations, Microsoft/iCloud/ICS calendars, Zoom and Jitsi,
Teams/Webex video, the custom workflow builder and SMS. Any of these can be added back later.

## Setup you can do now
- Vercel: import the repo at vercel.com/new, add a Neon database from the Storage tab (Production and Preview), and
  add `MIGRATE_ON_PREVIEW=1` for Preview. Previews of this branch will then work.
- Google Calendar connection needs a Google Cloud OAuth client: follow docs/GOOGLE_SETUP.md.

## Open questions for you
- Your live Calendly event types show a "Send text messages to" phone field, which means SMS reminders are switched on
  there. SMS is skipped right now (it needs a paid SMS provider such as Twilio). Say if you want it added.
