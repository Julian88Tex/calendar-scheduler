# Build status

Updated after every finished module. "Testable" means you can click through it in a running app (locally with
`npm run dev` after `npm run db:seed`, or on a Vercel preview). Seed login: `owner@example.com` / `password123`.

## Testable right now

- Nothing interactive yet. The foundation is done (database, sessions, background jobs, placeholder pages), so the
  app runs and every sidebar link opens, but each page says "This page is being built."

## Milestones (in build order)

Each milestone ends in something you can test. Reply any time to reorder, drop, or change anything.

### Milestone 1: book a meeting on your public page
| Module | What it gives you | Status |
|---|---|---|
| foundation-ui | Calendly look and feel: app shell, sidebar, buttons, calendar grid, time slots, time zone picker | building |
| foundation-auth | Sign up, log in, password reset, 2FA, Sign in with Google/Microsoft (also connects the calendar) | building |
| foundation-platform | Emails (confirmation, reminders) with calendar invites, SMS, background jobs, cron | building |
| slot-engine | The scheduling brain: hours, buffers, minimum notice, increments, limits, DST, round robin math | building |
| booking-core | Taking a booking safely (no double booking), seat holds, slot API | next |
| booking-pages | Your profile page, the month calendar and time slots, details form, confirmation page | next |

### Milestone 2: set up your own availability and event types
| Module | What it gives you | Status |
|---|---|---|
| availability | Schedules, weekly hours, date-specific hours, holidays, troubleshoot view | next |
| event-types-editor | Create and edit event types: duration, locations, questions, buffers, limits, notice, increments | queued |
| event-types-list | Scheduling home: event type cards, copy link, duplicate, on/off, search | queued |

### Milestone 3: real calendars and video links
| Module | What it gives you | Status |
|---|---|---|
| calendar-integrations | Google, Outlook/Microsoft 365, iCloud/CalDAV, ICS feeds: conflict checking and adding events | queued |
| conferencing | Google Meet, Teams, Zoom, Jitsi links and the stable join link | queued |

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
| links-sharing | Single-use links, one-off meetings, share tools, book on behalf (polls UI needs it) | queued |
| polls-ui | Create a poll on a week grid, voter page, results grid, book the final time | queued |

### Milestone 6: everything else Calendly has
| Module | What it gives you | Status |
|---|---|---|
| workflows | Automated reminders, follow-ups, SMS, reconfirmation | queued |
| teams-org | Organization, people, invitations, teams, round robin, collective, managed events | queued |
| settings-onboarding | Profile, branding, your link, security, privacy, Calendly import, onboarding flow | queued |
| routing-forms | Routing forms with conditional routing to event types | queued |
| contacts | Contacts built from invitees, meeting history | queued |
| payments | Stripe payments, coupons, refunds | queued |
| analytics | Analytics dashboard (created, completed, canceled, popular times) | queued |
| api-v1 | Public REST API (Calendly-compatible), personal access tokens, calendar feed | queued |
| webhooks-embed | Webhooks and the embed script for websites | queued |
| admin-compliance | Admin overview, outbox, jobs, audit log, data deletion | queued |
| marketing-site | Landing page, legal and help pages | queued |
| localization | Invitee-facing translations (FR, ES, DE, NL, PT, IT, UK) | queued |
| golden-path-qa | End-to-end test suite over every main flow, deployment guide, QA report | last |

## Setup you can do now
- Vercel: import the repo at vercel.com/new, add a Neon database from the Storage tab (Production and Preview), and
  add `MIGRATE_ON_PREVIEW=1` for Preview. Previews of this branch will then work.
- Google Calendar connection needs a Google Cloud OAuth client; a step-by-step guide comes with calendar-integrations.
