# Build status

Updated after every finished module. Scope was reduced to the features the owner uses today (docs/SCOPE.md). "Testable" means you can click through it in a running app (locally with
`npm run dev` after `npm run db:seed`, or on a Vercel preview). Seed login: `owner@example.com` / `password123`.

## Live now

Your site is live at https://calendar-scheduler-smoky.vercel.app (Vercel, free plan, Neon Postgres database).
- Sign in with Google as julian88tex@gmail.com (sign in asks only for your name and email; calendar and Gmail access
  are granted once under Calendar settings). Sign-ups are invite only, so nobody else can create an account.
- Your public page is https://calendar-scheduler-smoky.vercel.app/julianjoseph with your 3 event types copied from
  Calendly.
- Google Calendar is connected: bookings land on your calendar with a Google Meet link, and busy times on Julian -
  Personal and Julian - Church Clarity block booking times. Julian - Copado (free/busy only) is listed in Availability >
  Calendar settings since the release of October 15 (commit 7aa99d1); tick it there so work meetings block times too.
- Emails (confirmations, reminders, reschedules, cancellations, host notifications) are sent from your Gmail.
- Reminders and other background jobs run every 5 minutes, triggered by a Google Apps Script in your Google account
  (Vercel's free plan only allows a daily cron).
- On the booking calendar, available days show a stronger blue circle and bold numbers (release ddf650b, October 15)
  so they stand out on phones and under a browser's automatic dark mode.
- Checked live end to end: a booking created the calendar event with a Meet link and sent the emails, and cancelling it
  from the invitee link deleted the event and sent both cancellation emails.

How releases work: the `production` branch is what is live. A commit whose message contains `[deploy]` on that
branch builds and goes live; nothing else builds, so work in progress never reaches your site.

## Testable locally

Check out the `claude/scheduler-app` branch, then `npm install`, `npm run db:seed -- --demo`, `npm run dev`, and open
http://localhost:3000. Sign in with `owner@example.com` / `password123`. Everything listed under the milestones below
works there, with emails stored in the database outbox instead of being sent.

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
| meetings-dashboard | Meetings page: upcoming, past, filters, details, no-show, export | done |

### Milestone 5: meeting polls (the Doodle replacement)
| Module | What it gives you | Status |
|---|---|---|
| polls-core | Poll logic: proposing times, voting, booking the winner, emails | done |
| polls-ui | Create a poll on a week grid, voter page, results grid, book the final time | done |

### Milestone 6: the rest of what you use today
| Module | What it gives you | Status |
|---|---|---|
| workflows (lite) | Reminder emails before meetings (default 24h, multiple timings), kept in sync with reschedules and cancels | done |
| settings (lite) | Profile (name, avatar, welcome message, time zone), logo, your link, password and sessions | done |
| booking-parity | Pixel-level pass on the booking pages against live Calendly screenshots (desktop and phone) | done |
| golden-path-qa | End-to-end tests of every kept flow, email outbox page, deployment guide, QA report | done |

### Skipped (owner decision, see docs/SCOPE.md)
Teams and round robin, single-use links and one-off meetings, payments, contacts, routing forms, public API,
webhooks and embed, analytics, admin tools, marketing site, translations, Microsoft/iCloud/ICS calendars, Zoom and Jitsi,
Teams/Webex video, the custom workflow builder and SMS. Any of these can be added back later.

## Where things are
- Settings > Email outbox shows every email with its status (Sent, Waiting for Gmail with a reconnect link, Failed with
  the reason and Resend).
- Availability > Troubleshoot shows why any time is unavailable.
- The deployment guide is docs/DEPLOY.md and the end-to-end check of everything you use today is docs/QA_REPORT.md.

## Open questions for you
- Your live Calendly event types show a "Send text messages to" phone field, which means SMS reminders are switched on
  there. SMS is skipped right now (it needs a paid SMS provider such as Twilio). Say if you want it added.
- Should invitees get a Google Calendar invitation (what happens now, sent by Google) or a Calendly-style confirmation
  email from your Gmail with a calendar file attached?
- Google app verification (removes the "unverified app" screen on the one-time calendar connect): site ownership was
  verified in Search Console on October 15 (HTML file and meta tag). Google asks to wait 24 hours before retrying
  branding verification: Google Cloud console > Google Auth Platform > Branding > Verify branding (choose "I have
  fixed the issues"). Then record the demo video, add the scope justification and submit (docs/GOOGLE_VERIFICATION.md).
