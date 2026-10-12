# Build status

Updated after every finished module. Scope was reduced to the features the owner uses today (docs/SCOPE.md). "Testable" means you can click through it in a running app (locally with
`npm run dev` after `npm run db:seed`, or on a Vercel preview). Seed login: `owner@example.com` / `password123`.

## Testable right now

- Nothing interactive yet. The foundation is done (database, sessions, background jobs, placeholder pages), so the
  app runs and every sidebar link opens, but each page says "This page is being built."

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
| booking-pages | Your profile page, the month calendar and time slots, details form, confirmation page | building |

### Milestone 2: set up your own availability and event types
| Module | What it gives you | Status |
|---|---|---|
| availability | Schedules, weekly hours, date-specific hours, max meetings per day/week across all event types, Troubleshoot view (why a time is blocked) | building |
| event-types-editor | Create and edit one-on-one event types: duration, locations, questions, buffers, limits, notice, increments | queued |
| event-types-list | Scheduling home: event type cards, copy link, duplicate, on/off, search | queued |

### Milestone 3: real calendars and video links
| Module | What it gives you | Status |
|---|---|---|
| calendar-integrations | Google Calendar: conflict checking, adding events, detecting moves and deletes (applied by lifecycle-core) | done |
| conferencing | Google Meet links on created events, plus the stable join link | building |

### Milestone 4: life after booking
| Module | What it gives you | Status |
|---|---|---|
| lifecycle-core | Booking emails, cancel, reschedule, host changes synced back to the calendar | queued |
| lifecycle-ui | Cancel and reschedule pages for invitees, host meeting dialogs | queued |
| meetings-dashboard | Meetings page: upcoming, past, filters, details, no-show, export | queued |

### Milestone 5: meeting polls (the Doodle replacement)
| Module | What it gives you | Status |
|---|---|---|
| polls-core | Poll logic: proposing times, voting, booking the winner, emails | queued |
| polls-ui | Create a poll on a week grid, voter page, results grid, book the final time | queued |

### Milestone 6: the rest of what you use today
| Module | What it gives you | Status |
|---|---|---|
| workflows (lite) | Reminder emails before meetings (default 24h, multiple timings), kept in sync with reschedules and cancels | building |
| settings (lite) | Profile (name, avatar, welcome message, time zone), logo, your link, password and sessions | queued |
| golden-path-qa | End-to-end tests of every kept flow, email outbox page, deployment guide, QA report | last |

### Skipped (owner decision, see docs/SCOPE.md)
Teams and round robin, single-use links and one-off meetings, payments, contacts, routing forms, public API,
webhooks and embed, analytics, admin tools, marketing site, translations, Microsoft/iCloud/ICS calendars, Zoom and Jitsi,
Teams/Webex video, the custom workflow builder and SMS. Any of these can be added back later.

## Setup you can do now
- Vercel: import the repo at vercel.com/new, add a Neon database from the Storage tab (Production and Preview), and
  add `MIGRATE_ON_PREVIEW=1` for Preview. Previews of this branch will then work.
- Google Calendar connection needs a Google Cloud OAuth client; a step-by-step guide comes with calendar-integrations.
