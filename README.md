# Kairos

Kairos is a self-hostable scheduling app with Calendly parity: personal, group, round robin, collective and multi pool
event types, availability schedules, calendar sync (Google, Microsoft, CalDAV, ICS), conferencing (Google Meet,
Microsoft Teams, Zoom, Jitsi), booking pages and embeds, single-use links and one-off meetings, meeting polls, routing
forms, workflows (email and SMS automations), contacts, payments, webhooks and a Calendly-compatible REST API.

It is a Next.js 16 app (App Router, React 19, TypeScript, Tailwind CSS 4) on Postgres through Drizzle ORM. It runs with
zero configuration: locally it uses an embedded PGlite database, and on Vercel it needs only a Postgres database
(Neon). Everything else is optional and detected from environment variables.

- Product spec: [docs/SPEC.md](docs/SPEC.md)
- Technical design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Build plan and module ownership: [docs/WORKPLAN.json](docs/WORKPLAN.json)
- Verified library notes: [docs/research/tech-reference.md](docs/research/tech-reference.md)

## Local quickstart

Requirements: Node.js 22.

```bash
npm install
npm run db:seed        # optional demo account (run it while the dev server is stopped, see below)
npm run dev            # http://localhost:3000
```

Sign in with `owner@example.com` / `password123` (seeded demo account "Julian Joseph", local only). Without the seed,
sign up: the first account becomes the instance admin.

Without `DATABASE_URL` the app stores data in PGlite under `.data/pglite` (git ignored). PGlite allows one process per
directory, so stop `npm run dev` before running `npm run db:seed` against the same directory, or point one of them at
another directory with `PGLITE_DIR`. Missing `SESSION_SECRET` and `ENCRYPTION_KEY` are generated once and stored in the
database. Emails and SMS are stored in the outbox until a provider is configured (Admin > Outbox shows them).

To use a local Postgres instead, set `DATABASE_URL=postgres://...` in `.env.local`; migrations apply automatically.
`GET /api/health` answers `{ "ok": true, "db": "pglite", "setupRequired": false, "version": "...", "time": "..." }`.

### Demo data (seed)

`npm run db:seed` (never automatic, refused on Vercel) creates or updates the demo account from the owner's real
setup. Re-running it updates the same rows instead of duplicating them.

- **Owner**: "Julian Joseph", `owner@example.com` / `password123`, page `/julianjoseph`, time zone
  America/Los_Angeles, 12 hour clock, instance admin.
- **Schedules**: "Working hours" (default: Sun 14:00 to 19:00, Mon 12:00 to 17:00, Tue and Wed 11:00 to 23:00, Thu
  11:00 to 20:00, Fri 11:00 to 17:00) and "Block Off Work" (Sun 13:00 to 21:00, Tue to Thu 17:00 to 20:00).
- **Event types** (positions 0 to 2, 15 minute start increments, one required "What would you like to discuss?"
  question): "30 Minute Virtual" (`/julianjoseph/30min`, purple, Google Meet, 15 minute buffers before and after),
  "60 Minute Virtual" (`/julianjoseph/60min`, same settings) and "In-Person Meal or Coffee" (`/julianjoseph/meal`, 2
  hours, green, "Block Off Work" schedule, 8 venues plus "ask invitee").

Options (pass them after `--`):

| Command | Adds |
|---|---|
| `npm run db:seed -- --demo` | 3 meetings in the next two weeks, 2 contacts, and the demo workflow, routing form and poll of their modules |
| `npm run db:seed -- --scenario=team` | members `member1@example.com` (admin) and `member2@example.com` (same password) and the team "Sales" (`/sales`) with a round robin ("Sales Intro", `/sales/intro`) and a collective ("Team Demo", `/sales/demo`) event type |
| `npm run db:seed -- --scenario=empty` | nothing (applies migrations only) |

The seed uses the same database as the app (`DATABASE_URL`, else PGlite at `PGLITE_DIR` or `.data/pglite`). End to
end tests seed the same scenarios through `POST /api/test/seed`.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | `node scripts/migrate.ts && next build` (migrates first when a database URL exists) |
| `npm start` | serve a production build |
| `npm run lint` | ESLint 9 (flat config from eslint-config-next) |
| `npm run typecheck` | `next typegen && tsc --noEmit` for the whole project (through `scripts/heavy.sh tsc`) |
| `npm run typecheck:owned -- --module=<id> <paths...>` | incremental type check that prints only diagnostics in the given paths |
| `npm test` | Vitest: unit and PGlite integration tests |
| `npm run test:pg` | race and real Postgres tests (`*.pg.test.ts`) on a throwaway embedded Postgres |
| `npm run e2e` | Playwright (see "Testing") |
| `npm run db:generate` | drizzle-kit migration generation (foundation only) |
| `npm run db:seed` | demo account (see "Demo data"; `-- --demo` for meetings and contacts, `-- --scenario=team` for the team scenario) |
| `npm run check:dashes` | fails on em or en dashes anywhere (copy style rule GEN-11) |
| `npm run check:bundle` | fails when the booking page's gzipped client JS exceeds 250KB (GEN-07, after a build) |

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (Add New > Project). Framework: Next.js, build command
   `npm run build` (default), Node.js 22.
2. Open the project's **Storage** tab, create a **Neon** Postgres database and connect it to the project for all
   environments. This sets `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` and the legacy `POSTGRES_*` variables.
3. Optionally set `APP_URL` (your production domain), `ENCRYPTION_KEY`, `CRON_SECRET` and any integration variables
   (see below), then **Redeploy**.
4. To connect Google Calendar and Google Meet (and offer "Continue with Google"), follow
   [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md): it creates the Google OAuth client, registers the redirect URI and
   sets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Vercel.

Until a database is connected, every page shows the setup page with status 503, API routes answer 503
`{ "error": "setup_required" }` and `GET /api/health` answers `{ "ok": false, "db": "missing", "setupRequired": true }`;
the app never falls back to PGlite on Vercel. Never run `npm run db:seed` against a production database.

### Migrations

- `npm run build` runs `scripts/migrate.ts` before `next build`, and every cold start checks cheaply whether the
  database is behind the bundled migrations (one query on the pooled connection) and only then migrates over the
  unpooled connection under a transaction advisory lock. Concurrent cold starts apply each migration once.
- **Preview deployments never migrate** unless `MIGRATE_ON_PREVIEW=1`, because the Neon integration often attaches the
  production database to previews and an unmerged migration would land on production. With Neon preview branching
  (each preview gets its own branch database), set `MIGRATE_ON_PREVIEW=1` for the Preview environment only. A preview
  whose code is ahead of its database logs a warning and shows an admin banner.
- **Expand and contract**: Vercel Instant Rollback runs the previous release against the new schema, so every
  migration must stay compatible with the previous release. Add nullable columns or columns with defaults, new tables
  and new indexes; never rename or drop in the same release that stops using a column (drop it one release later);
  add new enum values in one release and use them in the next.

### OAuth redirect URIs

Register these exact URIs (built from `APP_URL`, never from the per-deployment `VERCEL_URL`). For Google, the
step-by-step guide is [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

| Provider | Redirect URI | Variables |
|---|---|---|
| Google (sign in, Calendar, Meet) | `{APP_URL}/api/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft (sign in, Outlook, Teams) | `{APP_URL}/api/auth/microsoft/callback` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (default `common`) |
| Zoom | `{APP_URL}/api/integrations/zoom/callback` | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |

Google apps in "Testing" status issue refresh tokens that expire after 7 days; calendar scopes need verification for
public use. Microsoft app registrations must allow accounts in any organizational directory and personal accounts.

### Optional environment variables

Every variable is optional and documented in [.env.example](.env.example): database URLs, `APP_URL`,
`NEXT_PUBLIC_APP_NAME`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `ADMIN_EMAILS`, `SIGNUP_POLICY`, Google,
Microsoft and Zoom OAuth, `JITSI_BASE_URL`, email (`RESEND_API_KEY` or `SMTP_*`, `EMAIL_FROM`), SMS (`TWILIO_*`),
payments (`STRIPE_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PAYPAL_*`), bot protection (`TURNSTILE_*`), uploads
(`BLOB_READ_WRITE_TOKEN`), tuning (`CALENDAR_CACHE_TTL_SECONDS`, `JOBS_POLL_INTERVAL_SECONDS`, `SAFE_FETCH_ALLOW_HOSTS`)
and logging (`LOG_LEVEL`). Integrations without their variables stay hidden or show "Not configured".

### Background jobs and cron

Reminders, calendar sync, webhooks, poll deadlines and other background work are durable jobs in the database. They run
right after the request that created them, and a periodic trigger catches up:

- **Vercel Cron** (`vercel.json`): `GET /api/cron` once a day (`17 13 * * *`), the most a Hobby plan allows. Vercel
  sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set.
- **GitHub Actions** (`.github/workflows/cron.yml`): every 10 minutes. Set the repository variable `APP_URL` and the
  repository secret `CRON_SECRET`; the workflow is skipped while either is missing. GitHub runs schedules late (often
  10 to 60 minutes) and disables them on public repositories after 60 days without activity. On a **private repository
  on the free plan** every run bills at least one minute (about 4,320 minutes a month against 2,000 included): change
  the schedule to `*/30 * * * *` or rely on the pinger below.
- **Recommended on Hobby**: a free external pinger (cron-job.org, or Upstash QStash schedules) calling
  `GET {APP_URL}/api/cron` every 5 minutes with the header `Authorization: Bearer {CRON_SECRET}`, so reminders arrive
  on time.

Self-hosted instances (not on Vercel) also run an in-process poller every `JOBS_POLL_INTERVAL_SECONDS` (default 30).

## Testing

- `npm test` runs Vitest with an in-memory PGlite per test file (`tests/helpers/db.ts`, factories in
  `tests/factories`, provider fakes in `tests/helpers/fake-providers.ts`).
- `npm run test:pg` starts a throwaway embedded Postgres (`scripts/with-embedded-pg.mjs`) and runs the `*.pg.test.ts`
  files: race tests must run on real Postgres because PGlite is a single backend.
- Playwright: `E2E_PORT=3400 PGLITE_DIR=.data/pglite-e2e-mine NEXT_DIST_DIR=.next-e2e-mine scripts/heavy.sh server
  npx playwright test e2e/<module>` starts its own `next dev` (or `next start` with `E2E_SERVER=start` after a build into
  the same `NEXT_DIST_DIR`) with `E2E_TEST_MODE=1` and a random `E2E_SECRET`. The test API (`/api/test/*`) answers 404
  unless both are set and the request carries the secret, and always on Vercel. In this repository's build sandbox
  Chromium is preinstalled; never run `playwright install` there (CI installs it).
- Specs use the fixtures in `e2e/fixtures` (`api.reset()`, `seed("owner" | "team" | "empty")`, `loginAs(page,
  email)`, `outbox`, `axe`). The foundation suite (`e2e/foundation`: test API harness, framing headers, every sidebar
  link, the setup page decision, the UI kit gallery, login and signup) runs with `E2E_PORT=3400
  PGLITE_DIR=.data/pglite-e2e-foundation NEXT_DIST_DIR=.next-e2e-foundation`; with `E2E_SERVER=start` it also starts
  the same build with `VERCEL=1` and no database to check the real setup mode responses.

## Module ownership model

The codebase is built by parallel agents, each owning a module from [docs/WORKPLAN.json](docs/WORKPLAN.json):

- Every file has exactly one owner (`ownedPaths`). Agents edit only their own files and import anything else.
- The foundation creates the complete schema, the shared libraries, typed stubs for every cross-module contract
  (ARCHITECTURE section 25, header comment `// OWNER: <module-id>`) and a placeholder for every route, so modules can
  work concurrently. Owners replace stub implementations but keep the exported signatures.
- Only the foundation changes `src/db/**` and `drizzle/**`. Modules that need a schema change file a request in
  [docs/schema-requests](docs/schema-requests/README.md) and use `metadata` jsonb columns meanwhile.
- Heavy commands go through `scripts/heavy.sh <server|tsc> <command...>` (at most two of each kind at once on the
  build machine). `npm run typecheck:owned -- --module=<id> <paths...>` type checks the whole project incrementally but
  reports only the module's own diagnostics.
- Conventions (server and client boundaries, `runAction`, authorization helpers, `now()` for business time and `$now`
  in SQL, `safeFetch` for user-supplied URLs, no em or en dashes) are in ARCHITECTURE section 26.
