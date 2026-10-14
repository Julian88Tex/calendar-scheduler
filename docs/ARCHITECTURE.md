# Architecture

Status: authoritative technical design for every implementation agent. Version 1.1, 2026-10-12 (revised after the
completeness and feasibility reviews: lock order, reservations under locks, slot grid rules, safe fetch, split
foundation and module plan).

Read with `docs/SPEC.md` (what to build, requirement IDs) and `docs/research/tech-reference.md` (verified library APIs
and gotchas; when this document and the tech reference disagree about a library API, the tech reference wins because it
was executed). `docs/WORKPLAN.json` assigns every file path below to exactly one owner.

---

## 1. Principles

1. **Calendly parity first.** Data shapes, enums and URLs mirror Calendly's API and UI so the product feels identical
   and the public API is drop-in compatible. Extensions are additive and off by default.
2. **One database, zero config.** Postgres everywhere (PGlite locally and in tests, Neon or any Postgres on Vercel).
   No Redis, no queues, no blob store required. Everything optional is detected from env vars.
3. **Pure core, thin edges.** The slot engine, routing evaluator, poll ranking, workflow timing and similar logic are
   pure functions with exhaustive unit tests. Server code assembles inputs from the DB and calls them.
4. **Durable side effects.** Every external side effect (email, SMS, calendar, conferencing, webhooks, reminders) is a
   job row written in the same transaction as the state change (outbox pattern), executed immediately via `after()` and
   retried by cron.
5. **Contract-first parallel build.** The foundation core (F0) creates the complete schema, every cross-module interface
   (as typed stubs, including the UI kit props) and every route placeholder, so module agents can work concurrently in
   one tree without editing each other's files (at most 4 agents at a time on the 4 vCPU build machine, section 26).
6. **Server Components by default.** Reads happen in Server Components; mutations in Server Actions (or route handlers
   for public JSON endpoints and embeds); client components only where interaction requires it.

---

## 2. Stack (exact versions, from tech-reference section 0)

| Concern | Choice |
|---|---|
| Framework | Next.js 16.4 (App Router, Turbopack, `src/` dir, `typedRoutes: true`, Cache Components OFF, root layout `dynamic = "force-dynamic"`) |
| UI runtime | React 19.3, TypeScript 5.9 (strict), Node 22.x (`engines`) |
| Styling | Tailwind CSS 4.3 via `@tailwindcss/postcss`, CSS variables tokens, `@fontsource-variable/figtree` (self-hosted font, no network at build) |
| UI primitives | Radix UI (`@radix-ui/react-*` packages: dialog, alert-dialog, popover, dropdown-menu, select, tabs, tooltip, toast, checkbox, radio-group, switch, collapsible, accordion, scroll-area, toggle-group, hover-card, separator, slot, visually-hidden), `lucide-react` icons, `clsx` + `tailwind-merge` (`cn()`) |
| Database | Postgres via Drizzle ORM 0.45.4 + drizzle-kit 0.31.11; `postgres` 3.4.9 (prod, `prepare: false`); `@electric-sql/pglite` 0.5.8 with `btree_gist` (dev, tests) |
| Validation | zod 4.6 |
| Time | luxon 3.7 (`Settings.defaultZone = "utc"` on the server) |
| Calendars | Google Calendar v3 REST and Microsoft Graph v1.0 via `fetch`; `tsdav` 2.4 (CalDAV); `node-ical` 0.27 (ICS parse and recurrence expansion) |
| ICS | `ical-generator` 11.1 (UTC dates only) |
| Email | `resend` 6.32 or `nodemailer` 10.1 (SMTP) or DB outbox |
| OAuth | `arctic` 3.7 (project decision) for Google, Microsoft Entra ID and Zoom, wrapped in `src/lib/auth/oauth/*`; arctic is deprecated on npm (July 2026) but works, and the verified dependency-free PKCE helper (tech-reference 5.2) lives next to it as a drop-in fallback so the wrapper can switch without touching callers |
| Holidays | `date-holidays` (public holidays only) for the 10 supported countries |
| Payments | `stripe` (official Node SDK) when `STRIPE_SECRET_KEY` is set; `@stripe/stripe-js` for the inline Payment Element |
| SMS | Twilio REST via `fetch` |
| HTML sanitize | `sanitize-html` (server) |
| QR codes (2FA) | `qrcode` |
| Safe outbound fetch | `undici` (pure JS; its `Agent` with a validating `connect.lookup` pins the checked IP, section 18.9) |
| Scripts (dev only) | `tsx` runs `scripts/seed.ts` and other dev scripts with tsconfig paths and the `react-server` condition; `scripts/migrate.ts` stays plain Node (it runs in the Vercel build) |
| Tests | Vitest 5.0 (unit + PGlite integration; race tests on real Postgres via `embedded-postgres` (dev dependency, binaries from the npm registry) or `TEST_DATABASE_URL`), Playwright 1.64 with Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (never `playwright install`), `@axe-core/playwright` |

No other runtime dependency may be added without updating this table (module agents: ask in your final report instead
of adding heavy dependencies; small pure utilities are fine if justified in the report).

---

## 3. Directory layout

```
/
|- drizzle/                         # generated SQL migrations + meta (foundation only; never edited by modules)
|- docs/                            # SPEC, ARCHITECTURE, WORKPLAN, research, schema-requests/
|- e2e/                             # Playwright: e2e/<module-id>/*.spec.ts, e2e/fixtures/*
|- public/                          # static assets; embed.js, widget.js, widget.css (webhooks-embed); logos/ (foundation-ui)
|- scripts/                         # migrate.ts, seed.ts, seed-data.ts, typecheck-owned.mjs, check-dashes.mjs, heavy.sh,
|                                   # with-embedded-pg.mjs, check-bundle-size.mjs (foundation)
|- .cache/                          # per-module tsc build info (git ignored)
|- src/
|  |- app/                          # routes (section 3.1)
|  |- components/
|  |  |- ui/                        # UI kit (props stubs by foundation F0, implemented by foundation-ui)
|  |  |- shell/                     # dashboard shell: sidebar, header, account menu, create menu (foundation-ui)
|  |  |- public/                    # public page shell: card, ribbon, cookie banner, footer links (foundation-ui)
|  |  `- <domain>/                  # domain components owned by modules (booking, lifecycle, event-types, ...)
|  |- db/
|  |  |- index.ts                   # getDb(), driver switch, singleton
|  |  |- migrate.ts                 # migrateGuarded()
|  |  |- helpers.ts                 # pgCode, pgConstraint, rowsOf, paginate, withTx
|  |  |- types.ts                   # shared jsonb TypeScript types (LocationConfig, WeeklyHours, ...)
|  |  `- schema/<domain>.ts + index.ts
|  |- lib/
|  |  |- (foundation shared libs)   # env, url, brand, ids, slugs, crypto, secrets, errors, actions, authz, audit,
|  |  |                             # logger, http, cookies, html, pagination, rate-limit, files, validation, net/
|  |  |- time/  client/  integrations/  auth/session.ts   (foundation F0)
|  |  |- auth/** (except session.ts)                      (foundation-auth)
|  |  |- email/  sms/  jobs/  events/  i18n core  template.ts  template-context.ts   (foundation-platform)
|  |  `- <domain>/                  # module-owned domain logic (section 3.2)
|  |- instrumentation.ts            # self-hosted in-process job poller (foundation-platform)
|  `- proxy.ts                      # setup gating, /app auth redirect, headers (foundation F0)
|- tests/                           # Vitest integration tests: tests/<module-id>/**, tests/helpers/**, tests/factories/**
|- drizzle.config.ts  next.config.ts  postcss.config.mjs  eslint.config.mjs  vitest.config.ts  playwright.config.ts
|- vercel.json  .github/workflows/{ci.yml,cron.yml}  .env.example  README.md
```

### 3.1 Routes and owners

Route groups: `(marketing)` public marketing, `(auth)` auth pages, `(dashboard)` the `/app` area. `[handle]` is a user or
team slug. Owners are WORKPLAN module ids. The foundation is split into `foundation` (F0, serial first: scaffold,
config, schema, test harness, shared libs, stubs, placeholders) and three parallel modules `foundation-ui` (F1),
`foundation-auth` (F2) and `foundation-platform` (F3); F0 creates every file below first (placeholders and stubs) and
hands it to its owner.

| URL | File (under `src/app`) | Owner |
|---|---|---|
| `/`, `/privacy`, `/terms`, `/cookie-policy`, `/help` | `(marketing)/**` | marketing-site |
| `/login`, `/login/two-factor`, `/signup`, `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]` | `(auth)/**` | foundation-auth |
| `/setup` | `setup/page.tsx` | foundation-auth |
| `/onboarding/**` | `onboarding/**` | settings-onboarding |
| `/confirm-email/[token]` (AU-10 email change, page with a POST button) | `confirm-email/**` | settings-onboarding |
| `/invite/[token]` | `invite/[token]/**` | teams-org |
| `/app` (redirect to `/app/scheduling`), shell layout | `(dashboard)/app/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `_shell/**` (shell server actions such as the GEN-23 time zone update) | foundation-ui |
| `/app/scheduling` (layout with tabs) | `(dashboard)/app/scheduling/layout.tsx` | foundation-ui |
| `/app/scheduling` (Event types tab) | `(dashboard)/app/scheduling/page.tsx`, `scheduling/_components/**`, `scheduling/actions.ts` | event-types-list |
| `/app/scheduling/single-use-links` | `(dashboard)/app/scheduling/single-use-links/**` | links-sharing |
| `/app/scheduling/meeting-polls` | `(dashboard)/app/scheduling/meeting-polls/**` | polls-ui |
| `/app/event-types/new`, `/app/event-types/[id]` | `(dashboard)/app/event-types/**` | event-types-editor |
| `/app/one-off/new`, `/app/one-off/[id]` | `(dashboard)/app/one-off/**` | links-sharing |
| `/app/polls/new`, `/app/polls/[id]`, `/app/polls/[id]/edit` | `(dashboard)/app/polls/**` | polls-ui |
| `/app/meetings` | `(dashboard)/app/meetings/**` | meetings-dashboard |
| `/app/availability` layout (tabs) | `(dashboard)/app/availability/layout.tsx` | foundation-ui |
| `/app/availability`, `/app/availability/advanced` | `availability/page.tsx`, `availability/_components/**`, `availability/actions.ts`, `availability/advanced/**` | availability |
| `/app/availability/calendar-settings` | `(dashboard)/app/availability/calendar-settings/**` (embeds the API-17 `CalendarFeedCard`) | calendar-integrations |
| `/app/contacts/**` | `(dashboard)/app/contacts/**` | contacts |
| `/app/workflows/**` | `(dashboard)/app/workflows/**` | workflows |
| `/app/integrations` hub | `(dashboard)/app/integrations/page.tsx`, `layout.tsx` | foundation-ui |
| `/app/integrations/calendars/[provider]` | `integrations/calendars/**` | calendar-integrations |
| `/app/integrations/conferencing/[provider]` | `integrations/conferencing/**` | conferencing |
| `/app/integrations/stripe` | `integrations/stripe/**` | payments |
| `/app/integrations/twilio` | `integrations/twilio/**` | workflows |
| `/app/integrations/api/**` (tokens, API docs) | `integrations/api/**` | api-v1 |
| `/app/integrations/webhooks/**`, `/app/integrations/embed` | `integrations/{webhooks,embed}/**` | webhooks-embed |
| `/app/integrations/analytics` (GA4, Meta Pixel) | `integrations/analytics/**` | analytics |
| `/app/routing/**` | `(dashboard)/app/routing/**` | routing-forms |
| `/app/analytics` | `(dashboard)/app/analytics/**` | analytics |
| `/app/admin` layout (sub-nav) | `(dashboard)/app/admin/layout.tsx` | foundation-ui |
| `/app/admin` (Overview), `/instance`, `/security`, `/activity`, `/outbox`, `/sms`, `/jobs` | `admin/page.tsx`, `admin/{instance,security,activity,outbox,sms,jobs}/**` | admin-compliance |
| `/app/admin/people`, `/teams`, `/groups`, `/managed-events`, `/permissions` | `admin/{people,teams,groups,managed-events,permissions}/**` | teams-org |
| `/app/admin/branding` | `admin/branding/**` | settings-onboarding |
| `/app/teams/[id]` | `(dashboard)/app/teams/**` | teams-org |
| `/app/settings` layout (sub-nav) | `(dashboard)/app/settings/layout.tsx` | foundation-ui |
| `/app/settings`, `/profile`, `/branding`, `/link`, `/login`, `/notifications`, `/cookies`, `/privacy`, `/import` | `settings/page.tsx`, `settings/{profile,branding,link,login,notifications,cookies,privacy,import}/**` | settings-onboarding |
| `/app/dev/ui` (UI kit gallery, dev only) | `(dashboard)/app/dev/**` | foundation-ui |
| `/[handle]`, `/[handle]/[eventSlug]`, `/[handle]/[eventSlug]/[start]` | `[handle]/**` | booking-pages |
| `/d/[code]`, `/d/[code]/[slug]`, `/d/[code]/[slug]/[start]` | `d/**` | booking-pages |
| `/booking/[inviteeId]`, `/booking/[inviteeId]/event.ics` | `booking/**` | booking-pages |
| `/payments/return` (Stripe Checkout return, also the embed popup return) | `payments/**` | payments |
| `/cancellations/[inviteeId]`, `/reschedulings/[inviteeId]`, `/reschedulings/[inviteeId]/[start]` | `cancellations/**`, `reschedulings/**` | lifecycle-ui |
| `/reconfirm/[inviteeId]` | `reconfirm/**` | workflows |
| `/events/[id]/join` | `events/**` | conferencing |
| `/p/[slug]`, `/p/[slug]/unsubscribe` (page with a POST button) | `p/**` | polls-ui |
| `/r/[slug]` | `r/**` | routing-forms |
| `layout.tsx`, `globals.css`, `not-found.tsx`, `error.tsx`, `global-error.tsx`, `icon.svg` | `src/app/*` | foundation-ui |
| `robots.ts`, `sitemap.ts` (`dynamic = "force-dynamic"`, never prerendered at build) | `src/app/*` | foundation |

API routes:

| Path | Owner |
|---|---|
| `/api/auth/google/{start,callback}`, `/api/auth/microsoft/{start,callback}`, `/api/auth/logout` | foundation-auth |
| `/api/cron` | foundation-platform |
| `/api/health`, `/api/files/[id]`, `/api/test/**` (E2E only, section 24.2) | foundation |
| `/api/public/slots`, `/api/public/bookings/**` | booking-core |
| `/api/public/polls/**`, `/api/polls/**` | polls-core |
| `/api/public/routing/**`, `/api/routing/**` | routing-forms |
| `/api/public/track` | analytics |
| `/api/analytics/**` (CSV exports) | analytics |
| `/api/meetings/**` (CSV export) | meetings-dashboard |
| `/api/contacts/**` (CSV import/export) | contacts |
| `/api/admin/**` (exports) | admin-compliance |
| `/api/v1/**`, `/api/feeds/**` | api-v1 |
| `/api/webhooks/stripe` | payments |
| `/api/webhooks/twilio` (signature verified, NT-16) | workflows |
| `/api/webhooks/calendars/**` (Google push, Graph subscriptions, optional) | calendar-integrations |
| `/api/integrations/zoom/{start,callback}` | conferencing |
| `/api/integrations/calendars/**` (CalDAV test, ICS validate if not server actions) | calendar-integrations |

Static files: `public/embed.js`, `public/widget.js`, `public/widget.css` (webhooks-embed); `public/logos/**`,
`public/illustrations/**` (foundation-ui).

### 3.2 `src/lib` domains and owners

| Path | Owner | Contents |
|---|---|---|
| `src/lib/{env,url,brand,ids,slugs,crypto,secrets,errors,actions,authz,audit,logger,http,cookies,html,pagination,rate-limit,files,validation,cn,embed-events}.ts` | foundation | shared helpers (section 21) |
| `src/lib/net/**` | foundation | `safeFetch` (section 18.9) |
| `src/lib/auth/session.ts` | foundation | sessions core (create, get, require, revoke), used by the shell and `/api/test/login` |
| `src/lib/auth/**` (all other files) | foundation-auth | passwords flows, signup (`createUserAccount`), login, OAuth (PKCE, Google, Microsoft, intents), TOTP verify, guards, auth emails |
| `src/lib/time/**`, `src/lib/client/**`, `src/lib/integrations/**` | foundation | luxon setup, zone catalog, formatting, `now()`; client hooks; integrations hub tile metadata |
| `src/lib/email/**`, `src/lib/sms/**`, `src/lib/jobs/**`, `src/lib/events/**`, `src/lib/template.ts`, `src/lib/template-context.ts` | foundation-platform | transports, layout renderer, ICS; SMS and Twilio signature; jobs runner; domain events; template rendering and context |
| `src/lib/i18n/{index.ts,locales.ts,catalog.ts}`, `src/lib/i18n/messages/en/{common,zones}.ts` | foundation-platform | i18n core |
| `src/lib/i18n/messages/en/{booking,lifecycle,lifecycle-pages,polls,poll-emails,routing,workflows,payments}.ts` | booking-pages, lifecycle-core, lifecycle-ui, polls-ui, polls-core, routing-forms, workflows, payments | English catalogs (stubs created by foundation) |
| `src/lib/i18n/messages/{fr,es,de,nl,pt,it,uk}/**` | localization | translations (`index.ts` stubs exporting `{}` created by foundation) |
| `src/lib/slots/**`, `src/lib/holidays/**` | slot-engine | pure slot engine, holiday data |
| `src/lib/availability/**` | availability | schedule CRUD services, schedule-to-engine conversion |
| `src/lib/calendars/**` | calendar-integrations | providers, busy cache, linked events, sync, OAuth connect |
| `src/lib/conferencing/**` | conferencing | Zoom, Meet, Teams, Jitsi adapters |
| `src/lib/event-types/**` | event-types-editor | every event type service (create, update, duplicate, delete, toggle, reorder, permissions, notes, statistics), validation, serializers |
| `src/lib/booking/**` | booking-core | slot service (DB to engine), target resolution, booking creation, reservations, verification, prefill |
| `src/lib/lifecycle/**` | lifecycle-core | provisioning, cancel, reschedule, move, no-show, notes, block, host actions, booking emails |
| `src/lib/meetings/**` | meetings-dashboard | meetings queries, filters, CSV export |
| `src/lib/workflows/**` | workflows | workflow CRUD, engine, backfill, templates, SMS opt-out, reconfirmation, `seedDemo` |
| `src/lib/teams/**`, `src/lib/org/**` | teams-org | org, invitations, people, teams, groups, managed events, permissions |
| `src/lib/routing/**` | routing-forms | form CRUD, evaluator, submissions, subscribers, `seedDemo` |
| `src/lib/links/**` | links-sharing | single-use links, one-off meetings, holds, share availability, book on behalf |
| `src/lib/polls/**` | polls-core | polls services, pure modules, jobs, emails, `seedDemo` (research Part F2 layout) |
| `src/lib/contacts/**` | contacts | contacts services and subscribers |
| `src/lib/analytics/**` | analytics | metrics queries, tracking |
| `src/lib/api/**` | api-v1 | REST v1 handlers, serializers (shared with webhooks), PATs, calendar feed |
| `src/lib/webhooks/**` | webhooks-embed | webhook subscriptions, fan-out, delivery |
| `src/lib/payments/**` | payments | Stripe, coupons, payment completion, subscribers |
| `src/lib/settings/**`, `src/lib/onboarding/**` | settings-onboarding | profile, branding, link, security, privacy, onboarding, Calendly import (`src/lib/settings/import/**`) |
| `src/lib/admin/**`, `src/lib/compliance/**` | admin-compliance | instance settings, audit viewer, data deletion, outbox/jobs/sms viewers |

Component folders follow the same owners: `src/components/{ui,shell,public}` foundation-ui; `booking` booking-pages;
`lifecycle` lifecycle-ui; `polls` polls-ui; `event-types` event-types-editor; `developer` api-v1; `embed` and
`webhooks` webhooks-embed; `scheduling-grid` and `links` links-sharing; every other `src/components/<domain>` the module
of that domain.

---

## 4. Request lifecycle

1. **`src/proxy.ts`** (Node runtime, cheap checks only):
   - If `process.env.VERCEL === "1"` and no database URL: rewrite every page request to `/setup` (status 503 set by the
     page) and API requests to a 503 JSON response, except `/api/health`, `/_next/*` and static files. The proxy is not
     the only guard: `getDb()` itself throws a typed `SetupRequiredError` in that situation (section 5.1), which pages,
     route handlers and jobs map to the setup page or a 503, so code that bypasses the proxy (prerendering, `after()`,
     cron) never falls back to PGlite.
   - `/app/*` without a `sid` cookie: redirect to `/login?next=...`.
   - Adds security headers per GEN-08: `frame-ancestors *` only on embeddable pages (`/{handle}`,
     `/{handle}/{eventSlug}/**`, `/d/**`, `/booking/**`, `/p/**`, `/r/**`); `frame-ancestors 'none'` plus
     `X-Frame-Options: DENY` everywhere else, including `/cancellations/**`, `/reschedulings/**` and `/reconfirm/**`.
   - Matcher excludes `_next/static`, `_next/image`, favicon and static file extensions.
2. **Root layout** `src/app/layout.tsx`: `export const dynamic = "force-dynamic"`, loads Figtree, global CSS tokens,
   `<Toaster />`, sets `lang`.
3. **Dashboard layout** `src/app/(dashboard)/app/layout.tsx`: `requireUser()` (redirects), loads actor (user, org role,
   team roles), renders the shell, and calls `after(() => maybeRunDueJobs())` (throttled once per 60 seconds per server
   instance via a module-level timestamp plus a DB lease, section 12.5).
4. **Server Actions** and **route handlers** re-check authentication and authorization themselves (proxy is not trusted).
5. **Public pages** never require a session; when a session exists (owner viewing their own page) they show owner tools.

---

## 5. Database layer

### 5.1 Driver switch and migrations

Exactly as tech-reference sections 3.4 and 3.5 (verified):

- `src/db/index.ts` exports `getDb(): Promise<DB>` (singleton on `globalThis`), `dbUrl()`, `normalizePgUrl()`, `rowsOf()`,
  `schema`, `SetupRequiredError`, `setDbForTests()`. With `DATABASE_URL` or `POSTGRES_URL`: postgres.js (`max: 5,
  prepare: false, idle_timeout: 20, connect_timeout: 10`). Without: PGlite with `btree_gist` at `PGLITE_DIR` or
  `.data/pglite` (in-memory under `NODE_ENV=test`), loaded with a dynamic `import()` only. When `VERCEL=1` and no URL
  exists, `getDb()` throws `SetupRequiredError` and never touches PGlite (its wasm and data files are excluded from
  Vercel function bundles, section 23).
- `src/db/migrate.ts` exports `migrateGuarded(db, opts)` (transaction advisory lock 727001, Drizzle-compatible journal
  table) and `migrationsBehind(db, migrations): Promise<boolean>`.
- **When migrations run** (both build time and runtime use one predicate `shouldMigrate()`): always locally and when
  self-hosted (`VERCEL_ENV` unset); on Vercel only when `VERCEL_ENV === "production"`, or when `MIGRATE_ON_PREVIEW=1`
  (set it when Neon preview branching gives each preview its own database). Preview deployments otherwise never
  migrate, because the Neon integration often attaches the production database to previews and unmerged migrations
  would land on production. A preview whose bundled migrations are ahead of the database logs a warning and shows an
  admin banner "This preview runs on a database schema older than its code." (our choice).
- **Build time**: `npm run build` is `node scripts/migrate.ts && next build`; the script exits 0 without connecting when
  no URL exists or `shouldMigrate()` is false.
- **Runtime fast path** (every cold start): over the pooled client, `select max(created_at) from
  drizzle.__drizzle_migrations` (a missing table counts as behind) compared with the newest bundled `folderMillis`.
  Only when behind (and `shouldMigrate()`), open the unpooled client (`DATABASE_URL_UNPOOLED` or
  `POSTGRES_URL_NON_POOLING`), take the advisory lock and apply. Up-to-date cold starts open no extra connection.
- **Expand and contract**: Vercel Instant Rollback runs old code against the new schema, so every migration must be
  backward compatible with the previous release: add nullable columns or columns with defaults, new tables and
  indexes; never rename or drop in the same release that stops using a column (drop it one release later); new enum
  values are added in one release and used in the next (tech-reference 3.4 caveat).
- **Plain Node constraint**: `scripts/migrate.ts` runs under plain Node 22 type stripping in the Vercel build, so every
  file it reaches (`src/db/migrate.ts` and its imports, which must stay limited to drizzle packages and `node:*`) uses
  relative imports with explicit `.ts` extensions (no `@/` aliases) and never imports `server-only`. No file in
  `src/db/**` imports `server-only` (seed and tests load them). The whole project uses only erasable TypeScript syntax
  (`erasableSyntaxOnly: true` in tsconfig: no enums, parameter properties or namespaces). Other scripts (`db:seed`)
  run through `tsx` with `NODE_OPTIONS=--conditions=react-server` (which makes `server-only` an empty module), so they
  may import any `src/**` module including `@/` aliases.
- Only the foundation runs `drizzle-kit generate`. Module agents never change `src/db/**` or `drizzle/**`. If a module
  needs a schema change it writes `docs/schema-requests/<module-id>.md` (table, columns, reason) and works around it
  using the `metadata` jsonb columns provided on the main tables; the integrator applies requests afterwards.

### 5.2 Conventions

- Table names snake_case plural; columns snake_case; TypeScript properties camelCase (Drizzle maps).
- Primary keys `id uuid default gen_random_uuid()` unless noted. UUIDs are used directly in public capability URLs
  (invitee, scheduled event), matching Calendly.
- Every table has `created_at timestamptz not null default now()`; mutable tables also `updated_at timestamptz not null
  default now()` with `$onUpdate(() => new Date())`. Soft-deletable tables have `deleted_at timestamptz null`.
- Instants: `timestamp(..., { withTimezone: true })` (timestamptz) in UTC. Time of day: `integer` minutes from local
  midnight (0 to 1440). Dates without time: `date` (string mode `YYYY-MM-DD`). Zones: `text` IANA.
- Money: integer minor units (`amount_minor`) plus `currency` ISO code.
- Emails: stored as typed plus `email_normalized` (trim + lowercase) for matching and unique indexes.
- Secrets (OAuth tokens, CalDAV passwords, ICS URLs with tokens, webhook signing keys, TOTP secrets): `text` holding
  `encrypt()` output (`v1.iv.ct.tag`), column names end in `_enc`.
- Hashed tokens: `text` hex SHA-256, column names end in `_hash`.
- jsonb columns are typed with `$type<...>()` using types from `src/db/types.ts`.
- `bytea` uses a Drizzle `customType` defined in `src/db/schema/files.ts`.
- Every schema file exports its tables, enums and `relations()`; `src/db/schema/index.ts` re-exports all.
- Indexes listed below are required. Partial indexes use `.where(sql\`...\`)`. In addition, every foreign key column
  that is a cascade or set-null target lookup, or a filter used by a module, gets a plain index even when not listed
  (for example `invitee_guests.scheduled_event_id`, `availability_schedules.event_type_id`,
  `availability_schedules.single_use_link_id`, `workflow_executions.workflow_id`, `meeting_poll_votes.option_id`,
  `payments.reservation_id`); the foundation adds them.
- Unique indexes on human identifiers of soft-deletable rows (emails, slugs, codes) are partial `where deleted_at is
  null`, so deleting an account or contact releases its email and slug (AU-15, CT-03).
- Business-time comparisons in SQL never use the database clock: pass `$now` from `now()` (`src/lib/time/now.ts`) as a
  parameter (`run_at <= $now`, `expires_at > $now`). `defaultNow()` is allowed only for `created_at` and `updated_at`
  audit columns, and `enqueueJob` always sets `run_at` explicitly.

### 5.3 Shared jsonb types (`src/db/types.ts`)

```ts
export type MinuteRange = { start: number; end: number };          // minutes 0..1440, start <= end
export type WeeklyHours = [MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[]]; // index 0 = Sunday

export type LocationKind =
  | "physical" | "outbound_call" | "inbound_call" | "google_conference" | "microsoft_teams_conference"
  | "zoom_conference" | "jitsi_conference" | "custom" | "ask_invitee" | "webex_conference" | "gotomeeting_conference";

export type LocationConfig = {
  id: string;                    // stable uuid, referenced by invitee choices
  kind: LocationKind;
  position: number;
  location?: string | null;      // physical address/venue, custom text or URL, ask_invitee prompt
  additionalInfo?: string | null;
  phoneNumber?: string | null;   // inbound_call host number (E.164)
  displayBeforeBooking?: boolean; // physical/custom: show on booking page (default true for physical, per setting for custom)
  connectionId?: string | null;  // zoom: which conferencing connection (default: user's)
};

export type ConferenceStatus = "processing" | "initiated" | "pushed" | "failed";
export type ResolvedLocation = {
  configId: string | null;       // LocationConfig.id chosen
  kind: LocationKind | null;     // null = no location
  location: string | null;       // text shown (address, phone, invitee answer, custom text)
  additionalInfo: string | null;
  joinUrl: string | null;
  status: ConferenceStatus | null;
  providerMeetingId: string | null;
  password: string | null;
  dialIn: { number: string; country?: string; type?: string }[] | null;
  data: Record<string, unknown> | null;
  error: string | null;
};

export type FreeBusyException = { mode: "includes" | "exact"; text: string };
export type ConfirmationLink = { label: string; url: string };
export type NotificationTemplates = {
  hostEventTitle?: string; inviteeEventTitle?: string; invitationDescription?: string;   // calendar invitation mode
  confirmationSubject?: string; confirmationBody?: string;                              // email confirmation mode
  cancellationSubject?: string; cancellationBody?: string;
};
export type QuestionAnswer = {
  questionId: string | null; question: string; type: string; position: number;
  answer: string;              // multi-select joined with "\n" (Calendly parity)
  values?: string[];           // raw selections for multi_select
};
export type Tracking = { utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string; salesforceUuid?: string };
export type MeetingSettingsSnapshot = {
  notificationMode: "calendar_invitation" | "email_confirmation";   // effective CAL-12 mode; a fallback rewrites it to email_confirmation permanently
  includeCancelRescheduleLinks: boolean; includeAnswersInNotifications: boolean;
  templates: NotificationTemplates; cancellationPolicy: string | null; locale: string;
  timeZoneDisplay: "auto" | "locked"; lockedTimeZone: string | null; color: string;
  afterBooking: "confirmation_page" | "redirect"; redirectUrl: string | null; redirectPassDetails: boolean;
  scheduleAnotherEnabled: boolean; scheduleAnotherLabel: string; confirmationLinks: ConfirmationLink[];
  changeCutoffMinutes: number | null; requireCancelReason: boolean;
};
export type RoutingCondition = { questionId: string; operator: string; values: string[]; valuesLogic: "any" | "all" };
export type RoutingConditions = { logic: "all" | "any"; conditions: RoutingCondition[] };
export type RoutingDestination =
  | { type: "event_type"; eventTypeId: string }
  | { type: "custom_message"; headline: string; body: string }
  | { type: "external_url"; url: string; passAnswers?: boolean };
export type NotificationPrefs = {
  pollVotes: "instant" | "daily_digest" | "off"; calendarProblems: boolean; dailyAgenda: boolean; hostAdded: boolean;
  noReplyInviteeEmails: boolean;                  // NT-20: omit Reply-To on invitee emails
};
export type UserPreferences = {                   // users.preferences (UI prefs, all optional)
  theme?: "light" | "dark" | "system"; sidebarCollapsed?: boolean; showBuffers?: boolean; analyticsHiddenWidgets?: string[];
  [key: string]: unknown;
};
export type BrandColors = { background?: string; text?: string; primary?: string };
```

### 5.4 Complete schema

Notation in the sketches below (implement with the real Drizzle builders; `src/db/schema/_columns.ts` provides the
helpers):

```ts
// helpers (foundation, src/db/schema/_columns.ts)
const pk = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());
const deletedAt = () => ts("deleted_at");
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
// "ref(x)" below means uuid(...).references(() => x.id, { onDelete }) with the stated onDelete (default "cascade").
// Columns are NOT NULL unless marked "null". Defaults shown with "= value".
```

Each file also exports `relations()` for every foreign key listed (one/many both sides) so `db.query.*` works.

#### 5.4.1 `src/db/schema/auth.ts`

```ts
export const oauthProvider = pgEnum("oauth_provider", ["google", "microsoft"]);
export const authTokenPurpose = pgEnum("auth_token_purpose", ["password_reset", "email_verification", "email_change", "login_method_change"]);
export const verificationPurpose = pgEnum("verification_purpose", ["booking", "poll_vote", "login_method_change", "phone_verification"]);

export const users = pgTable("users", {
  id: pk(),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  emailVerifiedAt: ts("email_verified_at"),                       // null
  passwordHash: text("password_hash"),                             // null (OAuth-only accounts)
  name: text("name"),
  slug: text("slug"),                                              // mirrors handles.slug
  avatarFileId: uuid("avatar_file_id"),                            // null, ref(files) set null
  avatarUrl: text("avatar_url"),                                   // null, provider avatar
  timezone: text("timezone"),                                      // = 'UTC'
  locale: text("locale"),                                          // = 'en'
  timeFormat: text("time_format"),                                 // = '12h'  ('12h' | '24h')
  dateFormat: text("date_format"),                                 // = 'MM/DD/YYYY' ('MM/DD/YYYY' | 'DD/MM/YYYY')
  weekStart: smallint("week_start"),                               // = 0 (0 Sunday, 1 Monday)
  country: text("country"),                                        // null, ISO 3166-1 alpha-2
  welcomeMessage: text("welcome_message"),                         // = 'Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.'
  destinationCalendarId: uuid("destination_calendar_id"),          // null, ref(calendars) set null
  defaultLocation: jsonb("default_location").$type<LocationConfig | null>(), // null
  meetingLimitDay: integer("meeting_limit_day"),                   // null
  meetingLimitWeek: integer("meeting_limit_week"),                 // null
  meetingLimitMonth: integer("meeting_limit_month"),               // null
  holidayCountry: text("holiday_country"),                         // null (AU, BR, CA, FR, DE, MX, NL, ES, GB, US)
  logoFileId: uuid("logo_file_id"),                                // null, ref(files) set null
  showBranding: boolean("show_branding"),                          // = true
  brandColors: jsonb("brand_colors").$type<BrandColors>(),         // = {}
  notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>(), // = { pollVotes: 'instant', calendarProblems: true, dailyAgenda: false, hostAdded: true, noReplyInviteeEmails: false }
  bookingEmailVerificationDefault: boolean("booking_email_verification_default"), // = false
  ga4MeasurementId: text("ga4_measurement_id"),                    // null
  metaPixelId: text("meta_pixel_id"),                              // null
  phoneNumber: text("phone_number"),                               // null, E.164 (host SMS)
  phoneVerifiedAt: ts("phone_verified_at"),                        // null
  twoFactorEnabled: boolean("two_factor_enabled"),                 // = false
  twoFactorSecretEnc: text("two_factor_secret_enc"),               // null
  isInstanceAdmin: boolean("is_instance_admin"),                   // = false
  onboardingStep: text("onboarding_step"),                         // null
  onboardingCompletedAt: ts("onboarding_completed_at"),            // null
  useCase: text("use_case"),                                       // null
  usageMode: text("usage_mode"),                                   // null ('solo' | 'team')
  lastLoginAt: ts("last_login_at"),                                // null
  lastActiveAt: ts("last_active_at"),                              // null
  createdViaInvitationId: uuid("created_via_invitation_id"),       // null; ref(organizationInvitations) set null (TM-04 admin delete)
  preferences: jsonb("preferences").$type<UserPreferences>(),      // = {} (theme, sidebarCollapsed, showBuffers, analyticsHiddenWidgets, ...)
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),    // = {}
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.emailNormalized).where(sql`deleted_at is null`),
  uniqueIndex("users_slug_uq").on(t.slug).where(sql`deleted_at is null`)]);
// AU-15 deletion also nulls slug and calls releaseHandle(), so the handles row (primary key slug) is freed too.

export const sessions = pgTable("sessions", {
  id: pk(), userId: ref(users), tokenHash: text("token_hash"),
  expiresAt: ts("expires_at"), lastSeenAt: ts("last_seen_at").defaultNow(),
  ip: text("ip") /* null */, userAgent: text("user_agent") /* null */,
  twoFactorPending: boolean("two_factor_pending") /* = false */, revokedAt: ts("revoked_at") /* null */, createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: pk(), userId: ref(users), provider: oauthProvider("provider"), providerAccountId: text("provider_account_id"),
  email: text("email"), emailNormalized: text("email_normalized"), lastLoginAt: ts("last_login_at") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("oauth_provider_account_uq").on(t.provider, t.providerAccountId), index("oauth_user_idx").on(t.userId)]);

export const authTokens = pgTable("auth_tokens", {
  id: pk(), userId: uuid("user_id") /* null, ref(users) cascade */, purpose: authTokenPurpose("purpose"),
  tokenHash: text("token_hash"), email: text("email") /* null */, data: jsonb("data") /* = {} */,
  expiresAt: ts("expires_at"), usedAt: ts("used_at") /* null */, createdAt: createdAt(),
}, (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.purpose)]);

export const verificationCodes = pgTable("verification_codes", {   // 6-digit codes (booking, poll vote, login method change, phone)
  id: pk(), purpose: verificationPurpose("purpose"), emailNormalized: text("email_normalized") /* null */,
  phone: text("phone") /* null */,
  codeHash: text("code_hash") /* hashCode(): HMAC-SHA256(session_secret, purpose + ":" + contextId + ":" + code), never plain SHA-256 */,
  contextId: text("context_id") /* null: reservation, poll or user id */,
  attempts: integer("attempts") /* = 0 */, expiresAt: ts("expires_at"), consumedAt: ts("consumed_at") /* null */, createdAt: createdAt(),
}, (t) => [index("verification_lookup_idx").on(t.purpose, t.emailNormalized, t.createdAt)]);

export const trustedDevices = pgTable("trusted_devices", {         // booking "Remember this device"
  id: pk(), emailNormalized: text("email_normalized"), tokenHash: text("token_hash"), expiresAt: ts("expires_at"), createdAt: createdAt(),
}, (t) => [uniqueIndex("trusted_devices_token_uq").on(t.tokenHash)]);

export const twoFactorRecoveryCodes = pgTable("two_factor_recovery_codes", {
  id: pk(), userId: ref(users), codeHash: text("code_hash"), usedAt: ts("used_at") /* null */, createdAt: createdAt(),
}, (t) => [index("recovery_user_idx").on(t.userId)]);

export const appSecrets = pgTable("app_secrets", { key: text("key").primaryKey(), value: text("value"), createdAt: createdAt() });
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(), value: jsonb("value"), updatedAt: updatedAt(), updatedByUserId: uuid("updated_by_user_id") /* null */,
});
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key"), windowStart: ts("window_start"), count: integer("count") /* = 0 */,
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limit_window_idx").on(t.windowStart)]);
```

Instance settings keys: `signup_policy` (`"invite_only" | "open" | "domains"`), `signup_domains` (string[]),
`operator` (`{ name, email }`), `default_invitee_locale`, `last_cron_at`, `job_runner_lease` (`{ holder, until }`).
App secrets keys: `session_secret`, `encryption_key`, `cron_secret_generated`.

#### 5.4.2 `src/db/schema/organizations.ts`

```ts
export const orgRole = pgEnum("org_role", ["owner", "admin", "user"]);
export const teamRole = pgEnum("team_role", ["manager", "member"]);
export const groupRole = pgEnum("group_role", ["admin", "member"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "declined", "revoked", "expired"]);
export type OrgSettings = { sharedEventTypeCreators: "everyone" | "admins"; invitePermission: "admins" | "admins_and_group_admins"; defaultEmailVerification: boolean };

export const organizations = pgTable("organizations", {
  id: pk(), name: text("name"), logoFileId: uuid("logo_file_id") /* null, ref(files) set null */,
  applyBrandingToMembers: boolean("apply_branding_to_members") /* = false */, showBranding: boolean("show_branding") /* = true */,
  settings: jsonb("settings").$type<OrgSettings>() /* = { sharedEventTypeCreators: 'everyone', invitePermission: 'admins', defaultEmailVerification: false } */,
  plan: text("plan") /* = 'self_hosted' (API parity) */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
});

export const organizationMemberships = pgTable("organization_memberships", {
  id: pk(), organizationId: ref(organizations), userId: ref(users), role: orgRole("role") /* = 'user' */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("org_membership_user_uq").on(t.userId), index("org_membership_org_idx").on(t.organizationId, t.role),
  uniqueIndex("org_single_owner_uq").on(t.organizationId).where(sql`role = 'owner'`)]);

export const organizationInvitations = pgTable("organization_invitations", {
  id: pk(), organizationId: ref(organizations), email: text("email"), emailNormalized: text("email_normalized"),
  role: orgRole("role") /* = 'user'; check role <> 'owner' */, teamIds: uuid("team_ids").array() /* = {} */,
  tokenHash: text("token_hash"), status: invitationStatus("status") /* = 'pending' */,
  invitedByUserId: uuid("invited_by_user_id") /* null, ref(users) set null */, acceptedUserId: uuid("accepted_user_id") /* null */,
  lastSentAt: ts("last_sent_at").defaultNow(), expiresAt: ts("expires_at"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("org_invitation_token_uq").on(t.tokenHash),
  uniqueIndex("org_invitation_pending_uq").on(t.organizationId, t.emailNormalized).where(sql`status = 'pending'`)]);

export const teams = pgTable("teams", {
  id: pk(), organizationId: ref(organizations), name: text("name"), slug: text("slug") /* mirrors handles.slug */,
  welcomeMessage: text("welcome_message") /* null */, avatarFileId: uuid("avatar_file_id") /* null, ref(files) set null */,
  timezone: text("timezone") /* = 'UTC' */, createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("teams_slug_uq").on(t.slug).where(sql`deleted_at is null`), index("teams_org_idx").on(t.organizationId)]);

export const teamMemberships = pgTable("team_memberships", {
  teamId: ref(teams), userId: ref(users), role: teamRole("role") /* = 'member' */, createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index("team_memberships_user_idx").on(t.userId)]);

export const groups = pgTable("groups", { id: pk(), organizationId: ref(organizations), name: text("name"), createdAt: createdAt(), updatedAt: updatedAt() });
export const groupMemberships = pgTable("group_memberships", {
  groupId: ref(groups), userId: ref(users), role: groupRole("role") /* = 'member' */, createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId, t.role] }), index("group_memberships_user_idx").on(t.userId)]);

export const handles = pgTable("handles", {                       // shared namespace for user and team slugs
  slug: text("slug").primaryKey(), userId: uuid("user_id") /* null, ref(users) cascade */, teamId: uuid("team_id") /* null, ref(teams) cascade */,
  createdAt: createdAt(),
}, (t) => [uniqueIndex("handles_user_uq").on(t.userId), uniqueIndex("handles_team_uq").on(t.teamId),
  check("handles_one_owner", sql`num_nonnulls(user_id, team_id) = 1`)]);
```

#### 5.4.3 `src/db/schema/files.ts`

```ts
export const filePurpose = pgEnum("file_purpose", ["avatar", "logo", "team_avatar", "org_logo", "import", "export", "attachment"]);
export const files = pgTable("files", {
  id: pk(), ownerUserId: uuid("owner_user_id") /* null, ref(users) set null */, organizationId: uuid("organization_id") /* null */,
  purpose: filePurpose("purpose"), contentType: text("content_type"), byteSize: integer("byte_size"), sha256: text("sha256"),
  data: bytea("data") /* null when stored in Vercel Blob */, blobUrl: text("blob_url") /* null */,
  width: integer("width") /* null */, height: integer("height") /* null */, expiresAt: ts("expires_at") /* null (exports) */,
  createdAt: createdAt(),
}, (t) => [index("files_owner_idx").on(t.ownerUserId)]);
```

Served by `GET /api/files/{id}` (public for avatar, logo, team_avatar, org_logo with `Cache-Control: public, max-age=31536000,
immutable` and content-hash ETag; owner-only for import and export).

#### 5.4.4 `src/db/schema/availability.ts`

```ts
export const availabilitySchedules = pgTable("availability_schedules", {
  id: pk(), userId: ref(users), name: text("name"), timezone: text("timezone"), isDefault: boolean("is_default") /* = false */,
  weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>(),
  eventTypeId: uuid("event_type_id") /* null: set for event-type custom schedules (and per-host custom hours), ref(eventTypes) cascade */,
  singleUseLinkId: uuid("single_use_link_id") /* null: single-use custom availability, ref(singleUseLinks) cascade */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [index("schedules_user_idx").on(t.userId), index("schedules_event_type_idx").on(t.eventTypeId),
  index("schedules_single_use_idx").on(t.singleUseLinkId),
  uniqueIndex("schedules_one_default_uq").on(t.userId).where(sql`is_default and event_type_id is null and single_use_link_id is null and deleted_at is null`)]);

export const availabilityDateOverrides = pgTable("availability_date_overrides", {
  id: pk(), scheduleId: ref(availabilitySchedules), date: date("date", { mode: "string" }),
  intervals: jsonb("intervals").$type<MinuteRange[]>() /* = [] (empty = unavailable) */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("overrides_schedule_date_uq").on(t.scheduleId, t.date)]);

export const userHolidayOverrides = pgTable("user_holiday_overrides", {   // absent row = holiday observed (unavailable)
  userId: ref(users), holidayKey: text("holiday_key") /* '{country}:{stable rule id}', year independent, e.g. 'US:thanksgiving'; observed/substitute days append ':substitute' (AV-13) */,
  observed: boolean("observed"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.holidayKey] })]);
```

#### 5.4.5 `src/db/schema/event-types.ts`

```ts
export const eventTypeScope = pgEnum("event_type_scope", ["personal", "shared", "team"]);
export const eventTypeType = pgEnum("event_type_type", ["standard", "adhoc"]);
export const bookingMethod = pgEnum("booking_method", ["instant", "poll"]);
export const eventKind = pgEnum("event_kind", ["solo", "group"]);
export const poolingType = pgEnum("pooling_type", ["collective", "round_robin", "multi_pool"]);
export const availabilitySetting = pgEnum("availability_setting", ["host", "shared"]);
export const dateRangeType = pgEnum("date_range_type", ["rolling", "fixed", "unlimited"]);
export const dateRangeMode = pgEnum("date_range_mode", ["calendar_days", "weekdays", "available_days"]);
export const slotAlignment = pgEnum("slot_alignment", ["interval_start", "hour"]);
export const timeZoneDisplay = pgEnum("time_zone_display", ["auto", "locked"]);
export const nameFormat = pgEnum("name_format", ["full", "first_last"]);
export const reschedulePreference = pgEnum("reschedule_preference", ["reassign", "same_hosts"]);
export const notificationType = pgEnum("notification_type", ["auto", "calendar_invitation", "email_confirmation"]);
export const afterBooking = pgEnum("after_booking", ["confirmation_page", "redirect"]);
export const paymentProvider = pgEnum("payment_provider", ["stripe", "paypal"]);
export const questionType = pgEnum("question_type", ["string", "text", "single_select", "multi_select", "dropdown", "phone_number"]);
export const rrDistribution = pgEnum("rr_distribution", ["availability", "equal"]);
export const permissionLevel = pgEnum("permission_level", ["view", "edit"]);
export type ManagedSection = "details" | "availability" | "limits" | "booking_form" | "notifications" | "confirmation" | "payment" | "permissions";

export const eventTypes = pgTable("event_types", {
  id: pk(),
  organizationId: ref(organizations),
  ownerUserId: uuid("owner_user_id"),                 // null for team event types; ref(users) set null
  teamId: uuid("team_id"),                            // null; ref(teams) cascade
  scope: eventTypeScope("scope"),                     // = 'personal'
  type: eventTypeType("type"),                        // = 'standard' ('adhoc' = one-off meetings and polls)
  bookingMethod: bookingMethod("booking_method"),     // = 'instant'
  kind: eventKind("kind"),                            // = 'solo'
  poolingType: poolingType("pooling_type"),           // null
  name: text("name"),
  slug: text("slug"),
  shareCode: text("share_code"),                      // null; '/d/{code}/...' for shared types (and adhoc types reuse their link's code)
  color: text("color"),                               // = '#8247f5'
  descriptionHtml: text("description_html"),          // null
  descriptionPlain: text("description_plain"),        // null
  internalNote: text("internal_note"),                // null
  position: integer("position"),                      // = 0
  active: boolean("active"),                          // = true
  secret: boolean("secret"),                          // = false
  locale: text("locale"),                             // = 'en'
  durationMinutes: integer("duration_minutes"),       // = 30, check 1..720
  durationOptions: integer("duration_options").array(), // null; max 4, includes duration_minutes
  locations: jsonb("locations").$type<LocationConfig[]>(), // = []
  scheduleId: uuid("schedule_id"),                    // null = each host's default schedule; ref(availabilitySchedules) set null
  availabilitySetting: availabilitySetting("availability_setting"), // = 'host' ('shared' = everyone uses schedule_id)
  dateRangeType: dateRangeType("date_range_type"),    // = 'rolling'
  dateRangeDays: integer("date_range_days"),          // = 60
  dateRangeMode: dateRangeMode("date_range_mode"),    // = 'calendar_days'
  dateRangeStart: date("date_range_start", { mode: "string" }), // null
  dateRangeEnd: date("date_range_end", { mode: "string" }),     // null
  minimumNoticeMinutes: integer("minimum_notice_minutes"),      // = 240
  bufferBeforeMinutes: integer("buffer_before_minutes"),        // = 0
  bufferAfterMinutes: integer("buffer_after_minutes"),          // = 0
  slotIncrementMinutes: integer("slot_increment_minutes"),      // = 30
  slotAlignment: slotAlignment("slot_alignment"),               // = 'interval_start'
  limitPerDay: integer("limit_per_day"),                        // null
  limitPerWeek: integer("limit_per_week"),                      // null
  limitPerMonth: integer("limit_per_month"),                    // null
  timeZoneDisplay: timeZoneDisplay("time_zone_display"),        // = 'auto'
  lockedTimeZone: text("locked_time_zone"),                     // null
  freeBusyExceptions: jsonb("free_busy_exceptions").$type<FreeBusyException[]>(), // = []
  nameFormat: nameFormat("name_format"),                        // = 'full'
  allowGuests: boolean("allow_guests"),                         // = true
  autofillInvitee: boolean("autofill_invitee"),                 // = false
  requireEmailVerification: boolean("require_email_verification"), // = false
  collectMarketingConsent: boolean("collect_marketing_consent"),   // = false
  maxInvitees: integer("max_invitees"),                         // = 1 (group: 2..9999)
  showRemainingSpots: boolean("show_remaining_spots"),          // = false
  reschedulePreference: reschedulePreference("reschedule_preference"), // = 'reassign'
  notificationType: notificationType("notification_type"),      // = 'auto'
  notificationTemplates: jsonb("notification_templates").$type<NotificationTemplates>(), // = {}
  includeCancelRescheduleLinks: boolean("include_cancel_reschedule_links"), // = true
  includeAnswersInNotifications: boolean("include_answers_in_notifications"), // = true
  cancellationPolicy: text("cancellation_policy"),              // null
  requireCancelReason: boolean("require_cancel_reason"),        // = false (extension)
  changeCutoffMinutes: integer("change_cutoff_minutes"),        // null (extension, SCH-23)
  afterBooking: afterBooking("after_booking"),                  // = 'confirmation_page'
  redirectUrl: text("redirect_url"),                            // null
  redirectPassDetails: boolean("redirect_pass_details"),        // = false
  scheduleAnotherEnabled: boolean("schedule_another_enabled"),  // = true
  scheduleAnotherLabel: text("schedule_another_label"),         // = 'Schedule another event'
  confirmationLinks: jsonb("confirmation_links").$type<ConfirmationLink[]>(), // = []
  paymentEnabled: boolean("payment_enabled"),                   // = false
  paymentProvider: paymentProvider("payment_provider"),         // null
  priceMinor: integer("price_minor"),                           // null
  currency: text("currency"),                                   // null ('AUD'|'CAD'|'EUR'|'GBP'|'USD')
  paymentTerms: text("payment_terms"),                          // null
  destinationCalendarId: uuid("destination_calendar_id"),       // null (extension CAL-20), ref(calendars) set null
  calendarEventTitleTemplate: text("calendar_event_title_template"), // null = kind default (CAL-11)
  organizerUserId: uuid("organizer_user_id"),                   // null; collective "Meeting organizer" (VID-13), ref(users) set null
  adminManaged: boolean("admin_managed"),                       // = false
  isManagedTemplate: boolean("is_managed_template"),            // = false
  managedTemplateId: uuid("managed_template_id"),               // null, self ref set null
  managedLocks: jsonb("managed_locks").$type<Partial<Record<ManagedSection, boolean>>>(), // null
  managedSyncedAt: ts("managed_synced_at"),                     // null
  createdByUserId: uuid("created_by_user_id"),                  // null
  metadata: jsonb("metadata").$type<Record<string, unknown>>(), // = {}
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex("event_types_user_slug_uq").on(t.ownerUserId, t.slug).where(sql`team_id is null and scope = 'personal' and type = 'standard' and deleted_at is null`),
  uniqueIndex("event_types_team_slug_uq").on(t.teamId, t.slug).where(sql`team_id is not null and deleted_at is null`),
  uniqueIndex("event_types_share_code_uq").on(t.shareCode).where(sql`share_code is not null`),
  index("event_types_owner_pos_idx").on(t.ownerUserId, t.position),
  index("event_types_team_pos_idx").on(t.teamId, t.position),
  index("event_types_org_idx").on(t.organizationId),
  check("event_types_duration_ck", sql`duration_minutes between 1 and 720`),
  check("event_types_seats_ck", sql`max_invitees between 1 and 9999`),
  check("event_types_group_durations_ck", sql`kind <> 'group' or duration_options is null`),   // sched_group_slot_uq ignores duration
]);

export const eventTypeHostPools = pgTable("event_type_host_pools", {
  id: pk(), eventTypeId: ref(eventTypes), name: text("name") /* = 'Pool 1' */, distribution: rrDistribution("distribution") /* = 'availability' */,
  position: integer("position") /* = 0 */, countsResetAt: ts("counts_reset_at").defaultNow(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("pools_event_type_idx").on(t.eventTypeId)]);

export const eventTypeHosts = pgTable("event_type_hosts", {
  id: pk(), eventTypeId: ref(eventTypes), userId: ref(users),
  poolId: uuid("pool_id"),                            // null = required host (solo owner, collective co-host, multi_pool always-attending)
  priority: smallint("priority"),                     // = 3 (1 Lowest .. 5 Highest)
  scheduleId: uuid("schedule_id"),                    // null = host default schedule; ref(availabilitySchedules) set null
  locationOverride: jsonb("location_override").$type<LocationConfig | null>(), // null (TM-11 per-host location)
  position: integer("position"),                      // = 0
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("event_type_hosts_uq").on(t.eventTypeId, t.userId), index("event_type_hosts_user_idx").on(t.userId)]);

export const eventTypeQuestions = pgTable("event_type_questions", {
  id: pk(), eventTypeId: ref(eventTypes), position: integer("position"), label: text("label"), type: questionType("type"),
  required: boolean("required") /* = false */, enabled: boolean("enabled") /* = true */,
  answerChoices: text("answer_choices").array() /* = {} */, includeOther: boolean("include_other") /* = false */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("questions_event_type_idx").on(t.eventTypeId, t.position)]);

export const eventTypePermissions = pgTable("event_type_permissions", {
  eventTypeId: ref(eventTypes), userId: ref(users), level: permissionLevel("level"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.eventTypeId, t.userId] })]);

export const managedEventAssignments = pgTable("managed_event_assignments", {
  id: pk(), templateEventTypeId: ref(eventTypes), userId: uuid("user_id") /* null, ref(users) cascade */, teamId: uuid("team_id") /* null, ref(teams) cascade */,
  copyEventTypeId: uuid("copy_event_type_id") /* null, ref(eventTypes) set null */, createdAt: createdAt(),
}, (t) => [index("managed_assign_template_idx").on(t.templateEventTypeId)]);
```

Event type rules (enforced by event type services, with cross-tenant checks per section 18.7: `schedule_id`,
`event_type_hosts.user_id` and `schedule_id`, `destination_calendar_id`, `organizer_user_id` and every
`LocationConfig.connectionId` must belong to the owner, the hosts or the organization): `scope = 'team'` requires `team_id`; `scope in ('personal','shared')` requires `owner_user_id`;
`pooling_type` non-null requires scope shared or team; `kind = 'group'` requires `pooling_type is null` and `max_invitees
>= 2`; `type = 'adhoc'` rows are excluded from all event type lists and landing pages. Personal solo types have exactly
one `event_type_hosts` row (the owner, pool null), created with the type. Round robin types have one pool and all hosts
in it; multi_pool has required hosts (pool null) plus one or more pools; collective has all hosts with pool null.

#### 5.4.6 `src/db/schema/calendars.ts`

```ts
export const calendarProvider = pgEnum("calendar_provider", ["google", "microsoft", "caldav", "ics", "calendly_import"]);
// calendly_import (CAL-22): read-only connection whose external_events rows are written by the BR-17 importer and never refetched.
export const connectionStatus = pgEnum("connection_status", ["active", "needs_reauth", "error", "disconnected"]);
export const linkedEventPurpose = pgEnum("linked_event_purpose", ["meeting", "buffer_before", "buffer_after", "one_off_hold", "poll_hold"]);
export const linkedEventStatus = pgEnum("linked_event_status", ["pending", "synced", "failed", "deleted"]);

export const calendarConnections = pgTable("calendar_connections", {
  id: pk(), userId: ref(users), provider: calendarProvider("provider"),
  accountEmail: text("account_email") /* null */, displayName: text("display_name") /* null */,
  providerAccountId: text("provider_account_id") /* null: Google sub, Microsoft oid, CalDAV principal URL, ICS url hash */,
  oauthAccountId: uuid("oauth_account_id") /* null, ref(oauthAccounts) set null: connection created by sign-in */,
  accessTokenEnc: text("access_token_enc") /* null */, refreshTokenEnc: text("refresh_token_enc") /* null */,
  tokenExpiresAt: ts("token_expires_at") /* null */, scopes: text("scopes").array() /* = {} */,
  caldavServerUrl: text("caldav_server_url") /* null */, caldavUsername: text("caldav_username") /* null */,
  caldavPasswordEnc: text("caldav_password_enc") /* null */, caldavPrincipalUrl: text("caldav_principal_url") /* null */,
  icsUrlEnc: text("ics_url_enc") /* null */, icsEtag: text("ics_etag") /* null */, icsLastModified: text("ics_last_modified") /* null */,
  status: connectionStatus("status") /* = 'active' */, lastError: text("last_error") /* null */, lastErrorAt: ts("last_error_at") /* null */,
  consecutiveFailures: integer("consecutive_failures") /* = 0 */, lastSyncedAt: ts("last_synced_at") /* null */,
  problemNotifiedAt: ts("problem_notified_at") /* null */,
  unavailableStatuses: text("unavailable_statuses").array() /* = {busy,tentative,oof,workingElsewhere} (Microsoft) */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("cal_conn_user_idx").on(t.userId),
  uniqueIndex("cal_conn_account_uq").on(t.userId, t.provider, t.providerAccountId).where(sql`provider_account_id is not null and status <> 'disconnected'`)]);

export const calendars = pgTable("calendars", {
  id: pk(), connectionId: ref(calendarConnections), userId: ref(users) /* denormalized */,
  externalId: text("external_id"), name: text("name"), color: text("color") /* null */, timezone: text("timezone") /* null */,
  isPrimary: boolean("is_primary") /* = false */, canWrite: boolean("can_write") /* = false */,
  checkConflicts: boolean("check_conflicts") /* = false */, includeBuffers: boolean("include_buffers") /* = false */,
  syncChanges: boolean("sync_changes") /* = true (CAL-14) */, syncToken: text("sync_token") /* null */, ctag: text("ctag") /* null */,
  allowedOnlineMeetingProviders: text("allowed_online_meeting_providers").array() /* = {} */,
  deletedAt: deletedAt(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("calendars_conn_ext_uq").on(t.connectionId, t.externalId), index("calendars_user_conflicts_idx").on(t.userId, t.checkConflicts)]);

export const calendarSyncWindows = pgTable("calendar_sync_windows", {   // which ranges of external_events are cached and how fresh
  id: pk(), calendarId: ref(calendars), windowStart: ts("window_start"), windowEnd: ts("window_end"),
  fetchedAt: ts("fetched_at"), status: text("status") /* 'ok' | 'error' */, error: text("error") /* null */,
  fetchLeaseUntil: ts("fetch_lease_until") /* null: single-flight lease, section 10.3 */, fetchLeaseHolder: text("fetch_lease_holder") /* null */,
}, (t) => [uniqueIndex("sync_windows_uq").on(t.calendarId, t.windowStart, t.windowEnd), index("sync_windows_fetched_idx").on(t.calendarId, t.fetchedAt)]);

export const externalEvents = pgTable("external_events", {          // cached, expanded instances of provider events
  id: pk(), calendarId: ref(calendars), userId: uuid("user_id") /* denormalized */,
  externalId: text("external_id"), icalUid: text("ical_uid") /* null */, recurringEventId: text("recurring_event_id") /* null */,
  startAt: ts("start_at"), endAt: ts("end_at"), allDay: boolean("all_day") /* = false */,
  allDayStartDate: date("all_day_start_date", { mode: "string" }) /* null */, allDayEndDate: date("all_day_end_date", { mode: "string" }) /* null, exclusive */,
  title: text("title") /* null */, busy: boolean("busy"), showAs: text("show_as") /* null */, status: text("status") /* null */,
  isOwn: boolean("is_own") /* = false: created by this app (CAL-18) */, remoteUpdatedAt: ts("remote_updated_at") /* null */,
  fetchedAt: ts("fetched_at").defaultNow(),
}, (t) => [uniqueIndex("external_events_uq").on(t.calendarId, t.externalId, t.startAt),
  index("external_events_user_range_idx").on(t.userId, t.startAt, t.endAt), index("external_events_cal_start_idx").on(t.calendarId, t.startAt)]);

export const calendarLinkedEvents = pgTable("calendar_linked_events", {   // provider events this app created
  id: pk(), userId: ref(users), connectionId: uuid("connection_id") /* null, ref(calendarConnections) set null */,
  calendarId: uuid("calendar_id") /* null, ref(calendars) set null */, purpose: linkedEventPurpose("purpose"),
  scheduledEventId: uuid("scheduled_event_id") /* null, ref(scheduledEvents) cascade */,
  oneOffMeetingId: uuid("one_off_meeting_id") /* null, ref(oneOffMeetings) cascade */,
  pollId: uuid("poll_id") /* null, ref(meetingPolls) cascade */, pollOptionId: uuid("poll_option_id") /* null, ref(meetingPollOptions) cascade */,
  oneOffSpotId: uuid("one_off_spot_id") /* null, ref(oneOffMeetingSpots) cascade */,
  externalId: text("external_id") /* null until created */, icalUid: text("ical_uid") /* null */, etag: text("etag") /* null */,
  syncedStartAt: ts("synced_start_at") /* null: last known provider start (CAL-14 change detection) */, syncedEndAt: ts("synced_end_at") /* null */,
  status: linkedEventStatus("status") /* = 'pending' */, attempts: integer("attempts") /* = 0 */, lastError: text("last_error") /* null */,
  lastCheckedAt: ts("last_checked_at") /* null */, idempotencyKey: text("idempotency_key"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("linked_events_idem_uq").on(t.idempotencyKey), index("linked_events_event_idx").on(t.scheduledEventId),
  index("linked_events_conn_status_idx").on(t.connectionId, t.status), index("linked_events_poll_idx").on(t.pollId),
  index("linked_events_one_off_idx").on(t.oneOffMeetingId), index("linked_events_cal_ext_idx").on(t.calendarId, t.externalId)]);

export const calendarWatchChannels = pgTable("calendar_watch_channels", {   // P3 push notifications
  id: pk(), calendarId: ref(calendars), provider: calendarProvider("provider"), channelId: text("channel_id"),
  resourceId: text("resource_id") /* null */, tokenHash: text("token_hash"), expiresAt: ts("expires_at"), createdAt: createdAt(),
}, (t) => [uniqueIndex("watch_channel_uq").on(t.channelId)]);
```

#### 5.4.7 `src/db/schema/conferencing.ts`

```ts
export const conferencingProvider = pgEnum("conferencing_provider", ["zoom", "webex", "gotomeeting"]);
export const conferencingConnections = pgTable("conferencing_connections", {
  id: pk(), userId: ref(users), provider: conferencingProvider("provider"),
  accountEmail: text("account_email") /* null */, providerUserId: text("provider_user_id") /* null */,
  accessTokenEnc: text("access_token_enc"), refreshTokenEnc: text("refresh_token_enc") /* null */, tokenExpiresAt: ts("token_expires_at") /* null */,
  scopes: text("scopes").array() /* = {} */, status: connectionStatus("status") /* = 'active' */, lastError: text("last_error") /* null */,
  settings: jsonb("settings").$type<Record<string, unknown>>() /* = {} */, isDefault: boolean("is_default") /* = true */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("conf_conn_uq").on(t.userId, t.provider, t.providerUserId), index("conf_conn_user_idx").on(t.userId)]);
```

Google Meet and Microsoft Teams have no row here: they use the Google or Microsoft calendar connection of the
organizer's destination calendar. Jitsi needs no credentials.

#### 5.4.8 `src/db/schema/bookings.ts`

```ts
export const scheduledEventStatus = pgEnum("scheduled_event_status", ["active", "canceled"]);
export const inviteeStatus = pgEnum("invitee_status", ["active", "canceled"]);
export const cancelerType = pgEnum("canceler_type", ["host", "invitee", "system"]);
export const bookingSource = pgEnum("booking_source", ["booking_page", "single_use_link", "one_off", "poll", "host", "api", "routing_form", "calendar_sync"]);
export const schedulingMethod = pgEnum("scheduling_method", ["instant_book", "api"]);   // null = invitee self-serve (Calendly parity)
export const eventHostRole = pgEnum("event_host_role", ["organizer", "cohost", "assigned"]);
export const provisionStatus = pgEnum("provision_status", ["pending", "done", "partial", "failed"]);
export const reservationKind = pgEnum("reservation_kind", ["payment", "email_verification"]);
export const reservationStatus = pgEnum("reservation_status", ["pending", "completed", "expired", "canceled"]);
export const actorType = pgEnum("actor_type", ["user", "system", "api", "invitee"]);
export const meetingActivityType = pgEnum("meeting_activity_type", [
  "booked", "rescheduled_from", "rescheduled_to", "canceled", "invitee_canceled", "invitee_added", "invitee_removed",
  "no_show_marked", "no_show_unmarked", "notes_updated", "email_sent", "email_failed", "sms_sent", "sms_failed",
  "calendar_synced", "calendar_failed", "conference_created", "conference_failed", "notification_fallback",
  "reconfirmation_requested", "reconfirmed", "payment_succeeded", "payment_refunded", "host_reassigned",
  "invitee_limit_changed", "location_changed", "buffers_changed", "workflow_sent", "workflow_skipped",
]);

export const scheduledEvents = pgTable("scheduled_events", {
  id: pk(),                                           // public capability id: /events/{id}/join
  organizationId: ref(organizations),
  eventTypeId: uuid("event_type_id").references(() => eventTypes.id, { onDelete: "restrict" }),
  name: text("name"),
  status: scheduledEventStatus("status"),             // = 'active'
  startAt: ts("start_at"), endAt: ts("end_at"), durationMinutes: integer("duration_minutes"),
  bufferBeforeMinutes: integer("buffer_before_minutes") /* = 0 */, bufferAfterMinutes: integer("buffer_after_minutes") /* = 0 */,
  isGroup: boolean("is_group") /* = false */, inviteesLimit: integer("invitees_limit") /* = 1 */,
  location: jsonb("location").$type<ResolvedLocation>(),
  organizerUserId: uuid("organizer_user_id").references(() => users.id, { onDelete: "restrict" }),
  source: bookingSource("source"),                    // = 'booking_page'
  singleUseLinkId: uuid("single_use_link_id"),        // null, ref(singleUseLinks) set null
  oneOffMeetingId: uuid("one_off_meeting_id"),        // null, ref(oneOffMeetings) set null
  pollId: uuid("poll_id"),                            // null, ref(meetingPolls) set null
  settingsSnapshot: jsonb("settings_snapshot").$type<MeetingSettingsSnapshot>(),
  meetingNotesHtml: text("meeting_notes_html") /* null */, meetingNotesPlain: text("meeting_notes_plain") /* null */,
  icsUid: text("ics_uid"), icsSequence: integer("ics_sequence") /* = 0 */,
  providerIcalUid: text("provider_ical_uid") /* null: Google iCalUID / Graph iCalUId of the organizer's provider event (CAL-12); ICS uses it when notificationMode = calendar_invitation */,
  invitationUrl: text("invitation_url") /* null: Google htmlLink / Graph webLink for "Open Invitation" (BK-20) */,
  rescheduledFromEventId: uuid("rescheduled_from_event_id"), // null, self ref set null
  provisionStatus: provisionStatus("provision_status") /* = 'pending' */, provisionError: text("provision_error") /* null */,
  provisionedAt: ts("provisioned_at") /* null */,
  canceledAt: ts("canceled_at") /* null */, cancelReason: text("cancel_reason") /* null */, cancelerType: cancelerType("canceler_type") /* null */,
  canceledByUserId: uuid("canceled_by_user_id") /* null */, canceledByName: text("canceled_by_name") /* null */,
  locale: text("locale") /* = 'en' */, metadata: jsonb("metadata").$type<Record<string, unknown>>() /* = {} */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index("sched_org_start_idx").on(t.organizationId, t.startAt), index("sched_type_start_idx").on(t.eventTypeId, t.startAt),
  index("sched_organizer_start_idx").on(t.organizerUserId, t.startAt), index("sched_poll_idx").on(t.pollId),
  index("sched_single_use_idx").on(t.singleUseLinkId), index("sched_one_off_idx").on(t.oneOffMeetingId),
  uniqueIndex("sched_group_slot_uq").on(t.eventTypeId, t.startAt).where(sql`status = 'active' and is_group`),
  uniqueIndex("sched_poll_active_uq").on(t.pollId).where(sql`status = 'active' and poll_id is not null`),
  uniqueIndex("sched_one_off_active_uq").on(t.oneOffMeetingId).where(sql`status = 'active' and one_off_meeting_id is not null`),
  check("sched_times_ck", sql`end_at > start_at`),
]);

export const scheduledEventHosts = pgTable("scheduled_event_hosts", {   // Calendly event_memberships; also the busy index
  id: pk(), scheduledEventId: ref(scheduledEvents), userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
  eventTypeId: uuid("event_type_id") /* denormalized */, poolId: uuid("pool_id") /* null, ref(eventTypeHostPools) set null */,
  role: eventHostRole("role"), isActive: boolean("is_active") /* = true; false when the meeting is canceled */,
  startAt: ts("start_at"), endAt: ts("end_at"), bufferedStartAt: ts("buffered_start_at"), bufferedEndAt: ts("buffered_end_at"),
  assignmentReason: text("assignment_reason") /* null: 'priority' | 'least_recent' | 'random' | 'equal' | 'manual' | 'same_host' */,
  assignedAt: ts("assigned_at") /* set explicitly at assignment; copied unchanged to the new row on reschedule (SCH-16 least recent) */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("sched_hosts_uq").on(t.scheduledEventId, t.userId),
  index("sched_hosts_busy_idx").on(t.userId, t.isActive, t.bufferedStartAt, t.bufferedEndAt),
  index("sched_hosts_rr_idx").on(t.eventTypeId, t.poolId, t.userId, t.assignedAt).where(sql`role = 'assigned' and is_active`)]);

export const invitees = pgTable("invitees", {
  id: pk(),                                           // public capability id: /cancellations/{id}, /reschedulings/{id}, /booking/{id}
  scheduledEventId: ref(scheduledEvents), eventTypeId: uuid("event_type_id") /* denormalized */, organizationId: uuid("organization_id"),
  email: text("email"), emailNormalized: text("email_normalized"),
  name: text("name"), firstName: text("first_name") /* null */, lastName: text("last_name") /* null */,
  timezone: text("timezone") /* null: zone the invitee saw (locked zone for locked events), used for every invitee message (GEN-06) */,
  detectedTimezone: text("detected_timezone") /* null: browser zone at booking */,
  timeFormat: text("time_format") /* null: '12h' | '24h' chosen on the booking page */, locale: text("locale") /* null */,
  status: inviteeStatus("status") /* = 'active' */,
  questionsAndAnswers: jsonb("questions_and_answers").$type<QuestionAnswer[]>() /* = [] */,
  locationAnswer: jsonb("location_answer").$type<{ configId: string; value: string | null } | null>() /* null */,
  textReminderNumber: text("text_reminder_number") /* null, E.164 */, marketingConsent: boolean("marketing_consent") /* = false */,
  utmSource: text("utm_source"), utmMedium: text("utm_medium"), utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"), utmTerm: text("utm_term"), salesforceUuid: text("salesforce_uuid"),   // all null
  rescheduled: boolean("rescheduled") /* = false */, oldInviteeId: uuid("old_invitee_id") /* null */, newInviteeId: uuid("new_invitee_id") /* null */,
  routingFormSubmissionId: uuid("routing_form_submission_id") /* null, ref(routingFormSubmissions) set null */,
  pollParticipantId: uuid("poll_participant_id") /* null, ref(meetingPollParticipants) set null */,
  contactId: uuid("contact_id") /* null, ref(contacts) set null */,
  schedulingMethod: schedulingMethod("scheduling_method") /* null */, scheduledByUserId: uuid("scheduled_by_user_id") /* null */,
  reconfirmationRequestedAt: ts("reconfirmation_requested_at") /* null */, reconfirmedAt: ts("reconfirmed_at") /* null */,
  canceledAt: ts("canceled_at") /* null */, cancelReason: text("cancel_reason") /* null */, cancelerType: cancelerType("canceler_type") /* null */,
  canceledByUserId: uuid("canceled_by_user_id") /* null */, canceledByName: text("canceled_by_name") /* null */,
  rescheduleReason: text("reschedule_reason") /* null */, emailVerifiedAt: ts("email_verified_at") /* null */,
  ipHash: text("ip_hash") /* null */, anonymizedAt: ts("anonymized_at") /* null */,
  clientRequestId: text("client_request_id") /* null: BK-19 double-submit idempotency */,
  reservationId: uuid("reservation_id") /* null, ref(bookingReservations) set null: the reservation this invitee completed (at most one invitee per reservation) */,
  metadata: jsonb("metadata").$type<Record<string, unknown>>() /* = {} */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("invitees_event_idx").on(t.scheduledEventId), index("invitees_email_idx").on(t.emailNormalized),
  uniqueIndex("invitees_client_request_uq").on(t.clientRequestId).where(sql`client_request_id is not null`),
  uniqueIndex("invitees_reservation_uq").on(t.reservationId).where(sql`reservation_id is not null`),
  uniqueIndex("invitees_old_invitee_uq").on(t.oldInviteeId).where(sql`old_invitee_id is not null`),   // one new invitee per old invitee
  index("invitees_new_invitee_idx").on(t.newInviteeId),
  index("invitees_org_created_idx").on(t.organizationId, t.createdAt), index("invitees_type_created_idx").on(t.eventTypeId, t.createdAt),
  index("invitees_contact_idx").on(t.contactId), index("invitees_routing_idx").on(t.routingFormSubmissionId)]);

export const inviteeGuests = pgTable("invitee_guests", {
  id: pk(), inviteeId: ref(invitees), scheduledEventId: ref(scheduledEvents), email: text("email"), emailNormalized: text("email_normalized"),
  canceledAt: ts("canceled_at") /* null */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("guests_invitee_idx").on(t.inviteeId), index("guests_event_idx").on(t.scheduledEventId)]);

export const inviteeNoShows = pgTable("invitee_no_shows", {
  id: pk(), inviteeId: ref(invitees), createdByUserId: uuid("created_by_user_id") /* null */, createdAt: createdAt(),
}, (t) => [uniqueIndex("no_shows_invitee_uq").on(t.inviteeId)]);

export const bookingReservations = pgTable("booking_reservations", {   // payment / email verification holds (SCH-19), created under host locks (section 9)
  id: pk(), kind: reservationKind("kind"), status: reservationStatus("status") /* = 'pending' */,
  eventTypeId: ref(eventTypes), targetKind: text("target_kind") /* 'event_type' | 'single_use' | 'one_off' | 'shared' */,
  targetId: uuid("target_id"), startAt: ts("start_at"), endAt: ts("end_at"),
  bufferedStartAt: ts("buffered_start_at"), bufferedEndAt: ts("buffered_end_at"),
  hostUserIds: uuid("host_user_ids").array() /* exactly the hosts the meeting would have: all hosts, or required co-hosts plus the provisional assignee per pool (round robin) */,
  assignment: jsonb("assignment").$type<{ organizerId: string; byPool: Record<string, { userId: string; reason: string }> } | null>() /* null: round robin provisional assignment */,
  isGroupSeat: boolean("is_group_seat") /* = false: counts as one seat of the group slot (event_type_id, start_at) */,
  inviteeEmailNormalized: text("invitee_email_normalized"), payload: jsonb("payload").$type<Record<string, unknown>>() /* validated booking input */,
  expiresAt: ts("expires_at") /* 10 minutes; Checkout path: the Stripe session expiry (30 minutes) */,
  completedInviteeId: uuid("completed_invitee_id") /* null */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("reservations_status_exp_idx").on(t.status, t.expiresAt), index("reservations_type_start_idx").on(t.eventTypeId, t.startAt),
  index("reservations_hosts_gin").using("gin", t.hostUserIds).where(sql`status = 'pending'`)]);   // "pending holds for these hosts": host_user_ids && $ids

export const meetingActivity = pgTable("meeting_activity", {
  id: pk(), scheduledEventId: ref(scheduledEvents), inviteeId: uuid("invitee_id") /* null */, type: meetingActivityType("type"),
  actorType: actorType("actor_type") /* = 'system' */, actorUserId: uuid("actor_user_id") /* null */,
  data: jsonb("data").$type<Record<string, unknown>>() /* = {} */, createdAt: createdAt(),
}, (t) => [index("meeting_activity_event_idx").on(t.scheduledEventId, t.createdAt)]);

export const blockedInvitees = pgTable("blocked_invitees", {
  id: pk(), userId: ref(users) /* blocking host */, email: text("email") /* null */, emailNormalized: text("email_normalized") /* null */,
  domain: text("domain") /* null, lowercase */, reason: text("reason") /* null */, sourceInviteeId: uuid("source_invitee_id") /* null */,
  createdAt: createdAt(),
}, (t) => [check("blocked_one_target", sql`num_nonnulls(email_normalized, domain) = 1`),
  uniqueIndex("blocked_email_uq").on(t.userId, t.emailNormalized).where(sql`email_normalized is not null`),
  uniqueIndex("blocked_domain_uq").on(t.userId, t.domain).where(sql`domain is not null`)]);
```

#### 5.4.9 `src/db/schema/links.ts`

```ts
export const singleUseLinkStatus = pgEnum("single_use_link_status", ["active", "booked", "expired", "deleted"]);
export const oneOffStatus = pgEnum("one_off_status", ["pending", "booked", "expired", "deleted"]);
export const oneOffDateSetting = pgEnum("one_off_date_setting", ["spots", "date_range", "days_in_future"]);
export type DateRangeOverride =
  | { type: "rolling"; days: number; mode: "calendar_days" | "weekdays" | "available_days" }
  | { type: "fixed"; startDate: string; endDate: string } | { type: "unlimited" };

export const singleUseLinks = pgTable("single_use_links", {
  id: pk(), code: text("code") /* 'xxxx-xxxx' */, eventTypeId: ref(eventTypes), ownerUserId: ref(users),
  createdByUserId: uuid("created_by_user_id") /* null */, nameOverride: text("name_override") /* null, <= 55 */,
  durationOverride: integer("duration_override") /* null */, durationOptionsOverride: integer("duration_options_override").array() /* null */,
  locationsOverride: jsonb("locations_override").$type<LocationConfig[] | null>() /* null */,
  scheduleId: uuid("schedule_id") /* null: custom availability (availability_schedules.single_use_link_id) */,
  dateRangeOverride: jsonb("date_range_override").$type<DateRangeOverride | null>() /* null */, hideLocation: boolean("hide_location") /* = false */,
  contactId: uuid("contact_id") /* null, ref(contacts) set null */, prefillName: text("prefill_name") /* null */, prefillEmail: text("prefill_email") /* null */,
  maxEventCount: integer("max_event_count") /* = 1 */, bookedCount: integer("booked_count") /* = 0 */,
  status: singleUseLinkStatus("status") /* = 'active' */, source: text("source") /* = 'ui' | 'api_scheduling_link' | 'api_share' */,
  lastBookedScheduledEventId: uuid("last_booked_scheduled_event_id") /* null */, usedAt: ts("used_at") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("single_use_code_uq").on(t.code), index("single_use_owner_idx").on(t.ownerUserId, t.createdAt)]);

export const oneOffMeetings = pgTable("one_off_meetings", {
  id: pk(), code: text("code"), eventTypeId: ref(eventTypes) /* the adhoc event type holding name, duration, location, hosts, questions */,
  ownerUserId: ref(users), timezone: text("timezone"), dateSetting: oneOffDateSetting("date_setting") /* = 'spots' */,
  dateRangeStart: date("date_range_start", { mode: "string" }) /* null */, dateRangeEnd: date("date_range_end", { mode: "string" }) /* null */,
  daysInFuture: integer("days_in_future") /* null */, onlyWeekdays: boolean("only_weekdays") /* = false */,
  reserveTimes: boolean("reserve_times") /* = false */, status: oneOffStatus("status") /* = 'pending' */,
  bookedScheduledEventId: uuid("booked_scheduled_event_id") /* null */, bookedAt: ts("booked_at") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("one_off_code_uq").on(t.code), index("one_off_owner_status_idx").on(t.ownerUserId, t.status)]);

export const oneOffMeetingSpots = pgTable("one_off_meeting_spots", {
  id: pk(), oneOffMeetingId: ref(oneOffMeetings), startAt: ts("start_at"), endAt: ts("end_at"),
  overlappedExternalIds: text("overlapped_external_ids").array() /* = {}: external events knowingly overlapped at creation (OO-09) */,
  createdAt: createdAt(),
}, (t) => [index("one_off_spots_idx").on(t.oneOffMeetingId, t.startAt)]);

export const availabilityShares = pgTable("availability_shares", {     // OO-11, OO-12
  id: pk(), userId: ref(users), eventTypeId: uuid("event_type_id") /* null, set null */, singleUseLinkId: uuid("single_use_link_id") /* null, set null */,
  recipientEmail: text("recipient_email"), recipientEmailNormalized: text("recipient_email_normalized"), recipientName: text("recipient_name") /* null */,
  contactId: uuid("contact_id") /* null */, subject: text("subject"), message: text("message"),
  reminderDays: integer("reminder_days") /* null: 1 | 3 | 7 */, sentAt: ts("sent_at"), emailOutboxId: uuid("email_outbox_id") /* null */,
  bookedInviteeId: uuid("booked_invitee_id") /* null */, bookedAt: ts("booked_at") /* null */,
  followUpSentAt: ts("follow_up_sent_at") /* null */, followUpDismissedAt: ts("follow_up_dismissed_at") /* null */, createdAt: createdAt(),
}, (t) => [index("shares_user_recipient_idx").on(t.userId, t.recipientEmailNormalized)]);
```

#### 5.4.10 `src/db/schema/polls.ts` (decision C2: polls are backed by an adhoc event type with `booking_method = 'poll'`)

```ts
export const pollStatus = pgEnum("poll_status", ["open", "closed", "booked", "canceled", "expired"]);
export const pollResultsVisibility = pgEnum("poll_results_visibility", ["host_only", "counts_only", "after_vote", "everyone"]);
export const pollTimeZoneMode = pgEnum("poll_time_zone_mode", ["auto", "fixed"]);
export const pollNotifyMode = pgEnum("poll_notify_mode", ["instant", "daily_digest", "off"]);
export const pollReminderMode = pgEnum("poll_reminder_mode", ["off", "smart", "custom"]);
export const pollVoteChoice = pgEnum("poll_vote_choice", ["yes", "if_need_be", "no"]);
export const pollParticipantStatus = pgEnum("poll_participant_status", ["invited", "responded", "declined"]);
export const pollParticipantSource = pgEnum("poll_participant_source", ["link", "invite", "host_added"]);
export const pollActivityType = pgEnum("poll_activity_type", ["created", "edited", "options_added", "options_removed", "invited",
  "voted", "vote_changed", "declined", "participant_removed", "commented", "comment_deleted", "reminder_sent", "voting_closed",
  "voting_reopened", "booked", "reopened", "rebooked", "canceled", "expired"]);

export const meetingPolls = pgTable("meeting_polls", {
  id: pk(), eventTypeId: uuid("event_type_id").references(() => eventTypes.id, { onDelete: "cascade" }) /* unique */,
  organizationId: ref(organizations), ownerUserId: ref(users), slug: text("slug"), title: text("title"),
  descriptionHtml: text("description_html") /* null */, defaultDurationMinutes: integer("default_duration_minutes"),
  location: jsonb("location").$type<LocationConfig | null>() /* null */, locale: text("locale") /* = 'en' */,
  timezone: text("timezone"), timeZoneMode: pollTimeZoneMode("time_zone_mode") /* = 'auto' */,
  status: pollStatus("status") /* = 'open' */, resultsVisibility: pollResultsVisibility("results_visibility") /* = 'host_only' */,
  allowIfNeedBe: boolean("allow_if_need_be") /* = false (Calendly is yes/no) */, requireEmail: boolean("require_email") /* = true */,
  hideInvitees: boolean("hide_invitees") /* = false: MP-20 individual invites, independent of results_visibility */,
  verifyEmail: boolean("verify_email") /* = false */, allowComments: boolean("allow_comments") /* = false */,
  allowSuggestions: boolean("allow_suggestions") /* = false */, maxVotesPerOption: integer("max_votes_per_option") /* null */,
  maxChoicesPerParticipant: integer("max_choices_per_participant") /* null */, deadlineAt: ts("deadline_at") /* null */,
  reserveTimes: boolean("reserve_times") /* = false */, notifyMode: pollNotifyMode("notify_mode") /* = 'instant' */,
  reminderMode: pollReminderMode("reminder_mode") /* = 'smart' */,
  reminderOffsets: jsonb("reminder_offsets").$type<{ kind: "after_invite" | "before_deadline"; minutes: number }[] | null>() /* null */,
  autoBook: boolean("auto_book") /* = false */, countHostPreference: boolean("count_host_preference") /* = false */,
  hostPreferences: jsonb("host_preferences").$type<Record<string, "yes" | "if_need_be" | "no"> | null>() /* null */,
  bookedOptionId: uuid("booked_option_id") /* null */, bookedScheduledEventId: uuid("booked_scheduled_event_id") /* null */,
  bookedAt: ts("booked_at") /* null */, bookedByUserId: uuid("booked_by_user_id") /* null */,
  votingClosedAt: ts("voting_closed_at") /* null */, reopenedAt: ts("reopened_at") /* null */,
  firstInviteSentAt: ts("first_invite_sent_at") /* null */, hostLastViewedAt: ts("host_last_viewed_at") /* null */,
  sendMeetingReminders: boolean("send_meeting_reminders") /* = false */,
  canceledAt: ts("canceled_at") /* null */, deletedAt: deletedAt(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("polls_event_type_uq").on(t.eventTypeId), uniqueIndex("polls_slug_uq").on(t.slug),
  index("polls_owner_status_idx").on(t.ownerUserId, t.status, t.createdAt),
  index("polls_open_deadline_idx").on(t.status, t.deadlineAt).where(sql`status = 'open'`)]);

export const meetingPollOptions = pgTable("meeting_poll_options", {
  id: pk(), pollId: ref(meetingPolls), startsAt: ts("starts_at") /* null for date-only */, endsAt: ts("ends_at") /* null */,
  allDayDate: date("all_day_date", { mode: "string" }) /* null */, durationMinutes: integer("duration_minutes"), position: integer("position"),
  suggestedByParticipantId: uuid("suggested_by_participant_id") /* null */, deletedAt: deletedAt(), createdAt: createdAt(),
}, (t) => [index("poll_options_start_idx").on(t.pollId, t.startsAt),
  uniqueIndex("poll_options_unique_time_uq").on(t.pollId, t.startsAt, t.endsAt).where(sql`deleted_at is null and starts_at is not null`),
  uniqueIndex("poll_options_unique_day_uq").on(t.pollId, t.allDayDate).where(sql`deleted_at is null and all_day_date is not null`),
  check("poll_option_shape_ck", sql`(starts_at is not null and ends_at is not null and all_day_date is null and ends_at > starts_at) or (starts_at is null and ends_at is null and all_day_date is not null)`)]);

export const meetingPollParticipants = pgTable("meeting_poll_participants", {
  id: pk(), pollId: ref(meetingPolls), name: text("name"), email: text("email") /* null */, emailNormalized: text("email_normalized") /* null */,
  userId: uuid("user_id") /* null, ref(users) set null */, timezone: text("timezone") /* null */, locale: text("locale") /* null */,
  status: pollParticipantStatus("status"), source: pollParticipantSource("source"), isRequired: boolean("is_required") /* = false */,
  subscribedToUpdates: boolean("subscribed_to_updates") /* = false */, editTokenHash: text("edit_token_hash"),
  inviteTokenHash: text("invite_token_hash") /* null */, emailVerifiedAt: ts("email_verified_at") /* null */,
  invitedAt: ts("invited_at") /* null */, respondedAt: ts("responded_at") /* null */, lastSubmittedAt: ts("last_submitted_at") /* null */,
  reminderCount: integer("reminder_count") /* = 0 */, lastRemindedAt: ts("last_reminded_at") /* null */, unsubscribedAt: ts("unsubscribed_at") /* null */,
  createdByUserId: uuid("created_by_user_id") /* null */, ipHash: text("ip_hash") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("poll_participant_email_uq").on(t.pollId, t.emailNormalized).where(sql`email_normalized is not null and deleted_at is null`),
  index("poll_participants_status_idx").on(t.pollId, t.status), uniqueIndex("poll_participant_edit_uq").on(t.editTokenHash),
  uniqueIndex("poll_participant_invite_uq").on(t.inviteTokenHash).where(sql`invite_token_hash is not null`)]);

export const meetingPollVotes = pgTable("meeting_poll_votes", {
  participantId: ref(meetingPollParticipants), optionId: ref(meetingPollOptions), pollId: uuid("poll_id") /* denormalized */,
  choice: pollVoteChoice("choice"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.participantId, t.optionId] }), index("poll_votes_count_idx").on(t.pollId, t.optionId, t.choice)]);

export const meetingPollComments = pgTable("meeting_poll_comments", {
  id: pk(), pollId: ref(meetingPolls), participantId: uuid("participant_id") /* null */, authorUserId: uuid("author_user_id") /* null (host) */,
  authorName: text("author_name"), body: text("body"), visibility: text("visibility") /* 'public' | 'host_only' */,
  deletedAt: deletedAt(), deletedBy: text("deleted_by") /* null */, createdAt: createdAt(),
}, (t) => [index("poll_comments_idx").on(t.pollId, t.createdAt)]);

export const meetingPollActivity = pgTable("meeting_poll_activity", {
  id: pk(), pollId: ref(meetingPolls), type: pollActivityType("type"), participantId: uuid("participant_id") /* null */,
  actorUserId: uuid("actor_user_id") /* null */, data: jsonb("data").$type<Record<string, unknown>>() /* = {} */, createdAt: createdAt(),
}, (t) => [index("poll_activity_idx").on(t.pollId, t.createdAt)]);

export const pollSlugRedirects = pgTable("poll_slug_redirects", {
  oldSlug: text("old_slug").primaryKey(), pollId: ref(meetingPolls), expiresAt: ts("expires_at"),
});
```

Poll hosts are the adhoc event type's `event_type_hosts` (owner plus co-hosts, pool null, `pooling_type = 'collective'`
when co-hosts exist); `pollAccess` grants `manage` to all of them (MP-01). Poll holds are `calendar_linked_events` rows
with `purpose = 'poll_hold'`. Voter verification codes use `verification_codes` with `purpose = 'poll_vote'` and
`context_id = poll id`. Vote writes lock the poll's chosen option rows `FOR UPDATE` in ascending id order inside the
vote transaction before counting, so `max_votes_per_option` holds under concurrency; every count joins
`meeting_poll_options` with `deleted_at is null`, so votes on removed options never count.

#### 5.4.11 `src/db/schema/workflows.ts`

```ts
export const workflowTrigger = pgEnum("workflow_trigger", ["booked", "before_start", "starts", "rescheduled", "ends", "canceled", "no_show"]);
export const workflowAction = pgEnum("workflow_action", ["email_invitees", "email_host", "email_other", "sms_invitees", "sms_host", "sms_other"]);
export const workflowScope = pgEnum("workflow_scope", ["user", "team"]);
export const basicNotificationKind = pgEnum("basic_notification_kind", ["email_reminder", "text_reminder", "email_follow_up"]);
export const workflowExecutionStatus = pgEnum("workflow_execution_status", ["scheduled", "sent", "skipped", "failed", "canceled"]);

export const workflows = pgTable("workflows", {
  id: pk(), organizationId: ref(organizations), ownerUserId: ref(users), teamId: uuid("team_id") /* null, ref(teams) cascade */,
  scope: workflowScope("scope") /* = 'user' */, name: text("name"), trigger: workflowTrigger("trigger"),
  offsetMinutes: integer("offset_minutes") /* = 0, 0..525600 (365 days, NT-11) */, active: boolean("active") /* = true */,
  isBasic: boolean("is_basic") /* = false */, basicKind: basicNotificationKind("basic_kind") /* null */,
  basicEventTypeId: uuid("basic_event_type_id") /* null, ref(eventTypes) cascade */, templateKey: text("template_key") /* null */,
  managedTemplateId: uuid("managed_template_id") /* null */, createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [index("workflows_owner_idx").on(t.ownerUserId), index("workflows_team_idx").on(t.teamId),
  uniqueIndex("workflows_basic_uq").on(t.basicEventTypeId, t.basicKind, t.offsetMinutes).where(sql`is_basic and deleted_at is null`)]);
// Basic notifications (NT-09): one workflows row per timing (email reminders allow up to 3 timings per event type).

export const workflowSteps = pgTable("workflow_steps", {
  id: pk(), workflowId: ref(workflows), position: integer("position"), action: workflowAction("action"),
  recipients: text("recipients").array() /* = {}: emails or E.164 for *_other */, subject: text("subject") /* null */,
  bodyHtml: text("body_html") /* null */, bodyText: text("body_text") /* null (SMS) */,
  includeCancelRescheduleLinks: boolean("include_cancel_reschedule_links") /* = true */, includeGuests: boolean("include_guests") /* = false */,
  replyTo: text("reply_to") /* null */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("workflow_steps_idx").on(t.workflowId, t.position)]);

export const workflowEventTypes = pgTable("workflow_event_types", {
  workflowId: ref(workflows), eventTypeId: ref(eventTypes), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workflowId, t.eventTypeId] }), index("workflow_event_types_et_idx").on(t.eventTypeId)]);

export const workflowExecutions = pgTable("workflow_executions", {
  id: pk(), workflowId: uuid("workflow_id") /* null, set null */, stepId: uuid("step_id") /* null, set null */,
  scheduledEventId: ref(scheduledEvents), inviteeId: uuid("invitee_id") /* null for slot-level host/other actions, ref(invitees) cascade */,
  trigger: workflowTrigger("trigger"), runAt: ts("run_at"), status: workflowExecutionStatus("status") /* = 'scheduled' */,
  snapshot: jsonb("snapshot").$type<WorkflowStepSnapshot>(), jobId: uuid("job_id") /* null */,
  skipReason: text("skip_reason") /* null */, error: text("error") /* null */, sentAt: ts("sent_at") /* null */,
  emailOutboxId: uuid("email_outbox_id") /* null */, smsMessageId: uuid("sms_message_id") /* null */,
  idempotencyKey: text("idempotency_key") /* '{stepId}:{inviteeId | "slot:" + scheduledEventId}:{trigger}' (no run time, so backfill and re-enabling never duplicate) */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("wf_exec_idem_uq").on(t.idempotencyKey), index("wf_exec_event_idx").on(t.scheduledEventId, t.status),
  index("wf_exec_workflow_idx").on(t.workflowId, t.status),
  index("wf_exec_invitee_idx").on(t.inviteeId, t.status), index("wf_exec_due_idx").on(t.status, t.runAt)]);
export type WorkflowStepSnapshot = {
  workflowName: string; trigger: string; offsetMinutes: number; action: string; recipients: string[];
  subject: string | null; bodyHtml: string | null; bodyText: string | null; includeCancelRescheduleLinks: boolean;
  includeGuests: boolean; replyTo: string | null; isBasic: boolean;
};

export const smsOptOuts = pgTable("sms_opt_outs", { phone: text("phone").primaryKey(), source: text("source") /* 'stop' | 'manual' */, createdAt: createdAt() });
```

#### 5.4.12 `src/db/schema/messaging.ts`

```ts
export const emailStatus = pgEnum("email_status", ["queued", "sending", "sent", "stored", "failed"]);
export const smsStatus = pgEnum("sms_status", ["queued", "sent", "stored", "failed", "skipped"]);

export const emailOutbox = pgTable("email_outbox", {
  id: pk(), organizationId: uuid("organization_id") /* null */,
  toAddresses: text("to_addresses").array(), ccAddresses: text("cc_addresses").array() /* = {} */, bccAddresses: text("bcc_addresses").array() /* = {} */,
  fromAddress: text("from_address"), fromName: text("from_name") /* null */, replyTo: text("reply_to") /* null */,
  subject: text("subject"), html: text("html"), text: text("text"),
  attachments: jsonb("attachments").$type<{ filename: string; contentType: string; contentBase64: string }[]>() /* = [] */,
  icsMethod: text("ics_method") /* null: 'REQUEST' | 'CANCEL' */, ics: text("ics") /* null */,
  template: text("template"), category: text("category") /* 'transactional' | 'workflow' | 'poll' | 'system' | 'auth' */,
  status: emailStatus("status") /* = 'queued' */, provider: text("provider") /* null: 'resend' | 'smtp' | 'outbox' */,
  providerMessageId: text("provider_message_id") /* null */, attempts: integer("attempts") /* = 0 */, lastError: text("last_error") /* null */,
  idempotencyKey: text("idempotency_key"), relatedUserId: uuid("related_user_id") /* null */,
  scheduledEventId: uuid("scheduled_event_id") /* null */, inviteeId: uuid("invitee_id") /* null */, pollId: uuid("poll_id") /* null */,
  workflowExecutionId: uuid("workflow_execution_id") /* null */,
  bodyPurgedAt: ts("body_purged_at") /* null: html and text set to '' and attachments, ics cleared by system.cleanup after 30 days (GEN-16) */,
  createdAt: createdAt(), updatedAt: updatedAt(), sentAt: ts("sent_at") /* null */,
}, (t) => [uniqueIndex("email_outbox_idem_uq").on(t.idempotencyKey), index("email_outbox_status_idx").on(t.status, t.createdAt),
  index("email_outbox_event_idx").on(t.scheduledEventId), index("email_outbox_invitee_idx").on(t.inviteeId),
  index("email_outbox_user_idx").on(t.relatedUserId, t.createdAt)]);

export const smsMessages = pgTable("sms_messages", {
  id: pk(), organizationId: uuid("organization_id") /* null */, toNumber: text("to_number"), fromNumber: text("from_number") /* null */,
  body: text("body"), status: smsStatus("status") /* = 'queued' */, provider: text("provider") /* null: 'twilio' | 'outbox' */,
  providerSid: text("provider_sid") /* null */, segments: integer("segments") /* null */, attempts: integer("attempts") /* = 0 */,
  lastError: text("last_error") /* null */, idempotencyKey: text("idempotency_key"),
  scheduledEventId: uuid("scheduled_event_id") /* null */, inviteeId: uuid("invitee_id") /* null */, workflowExecutionId: uuid("workflow_execution_id") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), sentAt: ts("sent_at") /* null */,
}, (t) => [uniqueIndex("sms_idem_uq").on(t.idempotencyKey), index("sms_status_idx").on(t.status, t.createdAt)]);
```

#### 5.4.13 `src/db/schema/jobs.ts`

```ts
export const jobStatus = pgEnum("job_status", ["pending", "running", "succeeded", "failed", "canceled", "dead"]);
export const jobs = pgTable("jobs", {
  id: pk(), type: text("type"), payload: jsonb("payload").$type<Record<string, unknown>>() /* = {} */,
  runAt: ts("run_at") /* always set by enqueueJob from now() (fake time aware); never rely on a DB default */, status: jobStatus("status") /* = 'pending' */, priority: smallint("priority") /* = 0 */,
  attempts: integer("attempts") /* = 0 */, maxAttempts: integer("max_attempts") /* = 8 */,
  lockedUntil: ts("locked_until") /* null */, lockedBy: text("locked_by") /* null */, lastError: text("last_error") /* null */,
  result: jsonb("result") /* null */, idempotencyKey: text("idempotency_key") /* null */, groupKey: text("group_key") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), finishedAt: ts("finished_at") /* null */,
}, (t) => [index("jobs_due_idx").on(t.runAt, t.priority).where(sql`status = 'pending'`),
  uniqueIndex("jobs_idem_uq").on(t.idempotencyKey).where(sql`idempotency_key is not null`),
  index("jobs_group_idx").on(t.groupKey).where(sql`status = 'pending'`), index("jobs_type_status_idx").on(t.type, t.status),
  index("jobs_stuck_idx").on(t.lockedUntil).where(sql`status = 'running'`)]);

export const domainEvents = pgTable("domain_events", {             // log of published events (webhook envelope source, debugging)
  id: pk(), type: text("type"), organizationId: uuid("organization_id") /* null */,
  actor: jsonb("actor").$type<{ type: "user" | "system" | "api" | "invitee"; userId?: string; name?: string } | null>() /* null */,
  payload: jsonb("payload").$type<Record<string, unknown>>(), occurredAt: ts("occurred_at").defaultNow(),
}, (t) => [index("domain_events_type_idx").on(t.type, t.occurredAt), index("domain_events_org_idx").on(t.organizationId, t.occurredAt)]);
```

#### 5.4.14 `src/db/schema/routing.ts`

```ts
export const routingFormStatus = pgEnum("routing_form_status", ["draft", "published"]);
export const routingQuestionType = pgEnum("routing_question_type", ["name", "email", "phone", "text", "textarea", "select", "radios", "checkboxes", "number"]);

export const routingForms = pgTable("routing_forms", {
  id: pk(), organizationId: ref(organizations), ownerUserId: ref(users), name: text("name"), slug: text("slug"),
  status: routingFormStatus("status") /* = 'draft' */, headline: text("headline") /* null */, descriptionHtml: text("description_html") /* null */,
  submitLabel: text("submit_label") /* = 'Submit' */, locale: text("locale") /* = 'en' */,
  fallback: jsonb("fallback").$type<RoutingDestination>(), settings: jsonb("settings").$type<Record<string, unknown>>() /* = {} */,
  publishedAt: ts("published_at") /* null */, createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("routing_forms_slug_uq").on(t.slug), index("routing_forms_org_idx").on(t.organizationId)]);

export const routingFormQuestions = pgTable("routing_form_questions", {
  id: pk(), formId: ref(routingForms), position: integer("position"), type: routingQuestionType("type"), label: text("label"),
  required: boolean("required") /* = false */, choices: text("choices").array() /* = {} */, placeholder: text("placeholder") /* null */,
  hidden: boolean("hidden") /* = false */, mapTo: text("map_to") /* null: 'invitee_name' | 'invitee_email' | 'sms_phone' | 'question:{label}' */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("routing_questions_idx").on(t.formId, t.position)]);

export const routingFormRoutes = pgTable("routing_form_routes", {
  id: pk(), formId: ref(routingForms), position: integer("position"), name: text("name") /* null */,
  conditions: jsonb("conditions").$type<RoutingConditions>(), destination: jsonb("destination").$type<RoutingDestination>(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("routing_routes_idx").on(t.formId, t.position)]);

export const routingFormSubmissions = pgTable("routing_form_submissions", {
  id: pk(), formId: ref(routingForms),
  answers: jsonb("answers").$type<{ questionId: string; question: string; answer: string | string[] | null }[]>(),
  tracking: jsonb("tracking").$type<Tracking>() /* = {} */,
  result: jsonb("result").$type<RoutingDestination & { routeId: string | null }>(), matchedRouteId: uuid("matched_route_id") /* null */,
  inviteeId: uuid("invitee_id") /* null, set when booked */, ipHash: text("ip_hash") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("routing_submissions_idx").on(t.formId, t.createdAt)]);

export const routingFormPermissions = pgTable("routing_form_permissions", {
  formId: ref(routingForms), userId: ref(users), level: permissionLevel("level"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.formId, t.userId] })]);
```

#### 5.4.15 `src/db/schema/contacts.ts`

```ts
export const contactSource = pgEnum("contact_source", ["booking", "manual", "import", "api", "poll", "routing_form"]);
export const customFieldType = pgEnum("custom_field_type", ["text", "single_select", "number", "boolean", "currency", "date", "tags"]);

export const contacts = pgTable("contacts", {
  id: pk(), ownerUserId: ref(users), organizationId: uuid("organization_id"), name: text("name"),
  primaryEmail: text("primary_email") /* null, denormalized from contact_emails */, phones: text("phones").array() /* = {} */,
  timezone: text("timezone") /* null */, jobTitle: text("job_title") /* null */, company: text("company") /* null */,
  city: text("city") /* null */, state: text("state") /* null */, country: text("country") /* null */, linkedin: text("linkedin") /* null */,
  creationSource: contactSource("creation_source"), marketingConsent: boolean("marketing_consent") /* = false */,
  lastMeetingAt: ts("last_meeting_at") /* null */, nextMeetingAt: ts("next_meeting_at") /* null */, lastInteractionAt: ts("last_interaction_at") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [index("contacts_owner_name_idx").on(t.ownerUserId, t.name), index("contacts_owner_last_idx").on(t.ownerUserId, t.lastMeetingAt)]);

export const contactEmails = pgTable("contact_emails", {
  id: pk(), contactId: ref(contacts), ownerUserId: uuid("owner_user_id") /* denormalized */, email: text("email"),
  emailNormalized: text("email_normalized"), isPrimary: boolean("is_primary") /* = false */, createdAt: createdAt(),
  deletedAt: deletedAt() /* set together with contacts.deleted_at */,
}, (t) => [uniqueIndex("contact_emails_owner_uq").on(t.ownerUserId, t.emailNormalized).where(sql`deleted_at is null`), index("contact_emails_contact_idx").on(t.contactId)]);

export const contactNotes = pgTable("contact_notes", {
  id: pk(), contactId: ref(contacts), authorUserId: uuid("author_user_id") /* null, set null */, bodyHtml: text("body_html"),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
});
export const contactReminders = pgTable("contact_reminders", {
  id: pk(), contactId: ref(contacts), ownerUserId: uuid("owner_user_id"), dueAt: ts("due_at"), text: text("text"),
  doneAt: ts("done_at") /* null */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("contact_reminders_due_idx").on(t.dueAt).where(sql`done_at is null`)]);
export const contactCustomFieldDefinitions = pgTable("contact_custom_field_definitions", {
  id: pk(), ownerUserId: ref(users), label: text("label"), fieldType: customFieldType("field_type"),
  options: jsonb("options").$type<{ id: string; label: string }[]>() /* = [] */, currency: text("currency") /* null */,
  position: integer("position") /* = 0 */, createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
});
export const contactCustomFieldValues = pgTable("contact_custom_field_values", {
  contactId: ref(contacts), definitionId: ref(contactCustomFieldDefinitions), value: jsonb("value"), updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.contactId, t.definitionId] })]);
export const contactLists = pgTable("contact_lists", { id: pk(), ownerUserId: ref(users), name: text("name"), createdAt: createdAt(), updatedAt: updatedAt() });
export const contactListMembers = pgTable("contact_list_members", {
  listId: ref(contactLists), contactId: ref(contacts), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.listId, t.contactId] })]);
```

#### 5.4.16 `src/db/schema/analytics.ts`

```ts
export const analyticsEventKind = pgEnum("analytics_event_kind", ["profile_page_viewed", "event_type_viewed", "date_and_time_selected",
  "event_scheduled", "routing_form_viewed", "routing_form_submitted", "poll_viewed"]);
export const analyticsEvents = pgTable("analytics_events", {
  id: pk(), kind: analyticsEventKind("kind"), organizationId: uuid("organization_id") /* null */, userId: uuid("user_id") /* null */,
  teamId: uuid("team_id") /* null */, eventTypeId: uuid("event_type_id") /* null */, routingFormId: uuid("routing_form_id") /* null */,
  pollId: uuid("poll_id") /* null */, sessionId: text("session_id") /* null: random per tab, not a cookie */, embed: boolean("embed") /* = false */,
  utmSource: text("utm_source") /* null */, utmMedium: text("utm_medium") /* null */, utmCampaign: text("utm_campaign") /* null */,
  referrerHost: text("referrer_host") /* null */, createdAt: createdAt(),
}, (t) => [index("analytics_org_kind_idx").on(t.organizationId, t.kind, t.createdAt), index("analytics_type_kind_idx").on(t.eventTypeId, t.kind, t.createdAt),
  index("analytics_user_kind_idx").on(t.userId, t.kind, t.createdAt)]);
```

#### 5.4.17 `src/db/schema/developer.ts`

```ts
export const webhookScope = pgEnum("webhook_scope", ["organization", "user", "group"]);
export const webhookState = pgEnum("webhook_state", ["active", "disabled"]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", ["pending", "succeeded", "failed", "giving_up"]);

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: pk(), organizationId: ref(organizations), scope: webhookScope("scope"), userId: uuid("user_id") /* null, ref(users) cascade */,
  groupId: uuid("group_id") /* null, ref(groups) cascade */, callbackUrl: text("callback_url"), events: text("events").array(),
  signingKeyEnc: text("signing_key_enc"), state: webhookState("state") /* = 'active' */, retryStartedAt: ts("retry_started_at") /* null */,
  disabledAt: ts("disabled_at") /* null */, creatorUserId: uuid("creator_user_id") /* null, set null */, description: text("description") /* null */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("webhooks_org_state_idx").on(t.organizationId, t.state)]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: pk(), subscriptionId: ref(webhookSubscriptions), domainEventId: uuid("domain_event_id") /* null */, event: text("event"),
  payload: jsonb("payload"), status: webhookDeliveryStatus("status") /* = 'pending' */, attempt: integer("attempt") /* = 0 */,
  nextAttemptAt: ts("next_attempt_at") /* null */, responseStatus: integer("response_status") /* null */,
  responseBody: text("response_body") /* null, truncated 10 KB */, durationMs: integer("duration_ms") /* null */, error: text("error") /* null */,
  redeliveryOfId: uuid("redelivery_of_id") /* null: manual redelivery (API-11) or test send source */,
  createdAt: createdAt(), updatedAt: updatedAt(), deliveredAt: ts("delivered_at") /* null */,
}, (t) => [index("deliveries_sub_idx").on(t.subscriptionId, t.createdAt), index("deliveries_due_idx").on(t.status, t.nextAttemptAt),
  uniqueIndex("deliveries_fanout_uq").on(t.subscriptionId, t.domainEventId, t.event).where(sql`domain_event_id is not null and redelivery_of_id is null`)]);   // a retried fan-out never duplicates

export const apiTokens = pgTable("api_tokens", {
  id: pk(), userId: ref(users), name: text("name"), tokenHash: text("token_hash"), prefix: text("prefix") /* 'kai_pat_' + 4 chars */,
  scopes: text("scopes").array(), lastUsedAt: ts("last_used_at") /* null */, lastUsedIp: text("last_used_ip") /* null */,
  expiresAt: ts("expires_at") /* null */, revokedAt: ts("revoked_at") /* null */, createdAt: createdAt(),
}, (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.userId)]);

export const calendarFeeds = pgTable("calendar_feeds", {           // API-17
  id: pk(), userId: ref(users), tokenHash: text("token_hash") /* lookup */, tokenEnc: text("token_enc") /* encrypted copy so the URL can be shown again */,
  createdAt: createdAt(), rotatedAt: ts("rotated_at") /* null */,
}, (t) => [uniqueIndex("calendar_feeds_user_uq").on(t.userId), uniqueIndex("calendar_feeds_token_uq").on(t.tokenHash)]);
```

#### 5.4.18 `src/db/schema/payments.ts`

```ts
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded", "partially_refunded", "canceled"]);
export const couponKind = pgEnum("coupon_kind", ["percent", "amount"]);

export const payments = pgTable("payments", {
  id: pk(), organizationId: uuid("organization_id"), inviteeId: uuid("invitee_id") /* null, ref(invitees) set null */,
  scheduledEventId: uuid("scheduled_event_id") /* null, set null */, reservationId: uuid("reservation_id") /* null, ref(bookingReservations) set null */,
  provider: paymentProvider("provider"), externalId: text("external_id") /* PaymentIntent, Checkout Session or PayPal order id */,
  externalChargeId: text("external_charge_id") /* null */, amountMinor: integer("amount_minor"), currency: text("currency"),
  discountMinor: integer("discount_minor") /* = 0 */, couponId: uuid("coupon_id") /* null, ref(coupons) set null */,
  status: paymentStatus("status") /* = 'pending' */, termsSnapshot: text("terms_snapshot") /* null */, receiptUrl: text("receipt_url") /* null */,
  refundedMinor: integer("refunded_minor") /* = 0 */, raw: jsonb("raw") /* = {} */, paidAt: ts("paid_at") /* null */,
  refundedAt: ts("refunded_at") /* null */, createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("payments_external_uq").on(t.provider, t.externalId), index("payments_invitee_idx").on(t.inviteeId)]);

export const coupons = pgTable("coupons", {
  id: pk(), ownerUserId: ref(users), code: text("code"), codeNormalized: text("code_normalized"), name: text("name"),
  kind: couponKind("kind"), percentOff: integer("percent_off") /* null */, amountOffMinor: integer("amount_off_minor") /* null */,
  currency: text("currency") /* null */, firstTimeOnly: boolean("first_time_only") /* = false */, maxRedemptions: integer("max_redemptions") /* null */,
  redeemedCount: integer("redeemed_count") /* = 0 */, expiresAt: ts("expires_at") /* null */, active: boolean("active") /* = true */,
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: deletedAt(),
}, (t) => [uniqueIndex("coupons_code_uq").on(t.ownerUserId, t.codeNormalized).where(sql`deleted_at is null`)]);

export const eventTypeCoupons = pgTable("event_type_coupons", {
  eventTypeId: ref(eventTypes), couponId: ref(coupons), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.eventTypeId, t.couponId] })]);

export const couponRedemptions = pgTable("coupon_redemptions", {
  id: pk(), couponId: ref(coupons), paymentId: uuid("payment_id") /* null */, inviteeEmailNormalized: text("invitee_email_normalized"), createdAt: createdAt(),
}, (t) => [index("coupon_redemptions_idx").on(t.couponId, t.inviteeEmailNormalized)]);
```

#### 5.4.19 `src/db/schema/admin.ts`

```ts
export const dataDeletionType = pgEnum("data_deletion_type", ["emails", "date_range"]);
export const dataDeletionStatus = pgEnum("data_deletion_status", ["pending", "running", "completed", "failed"]);

export const auditLog = pgTable("audit_log", {
  id: pk(), organizationId: uuid("organization_id") /* null */, actorType: actorType("actor_type"), actorUserId: uuid("actor_user_id") /* null */,
  actorLabel: text("actor_label") /* null */, action: text("action") /* e.g. 'user.login', 'role.changed' */, namespace: text("namespace") /* 'auth' | 'org' | 'event_types' | ... */,
  targetType: text("target_type") /* null */, targetId: text("target_id") /* null */, details: jsonb("details") /* = {} */,
  ip: text("ip") /* null */, userAgent: text("user_agent") /* null */, occurredAt: ts("occurred_at").defaultNow(),
}, (t) => [index("audit_org_time_idx").on(t.organizationId, t.occurredAt), index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
  index("audit_ns_action_idx").on(t.namespace, t.action)]);

export const dataDeletionRequests = pgTable("data_deletion_requests", {
  id: pk(), organizationId: ref(organizations), type: dataDeletionType("type"), params: jsonb("params"),
  status: dataDeletionStatus("status") /* = 'pending' */, requestedByUserId: uuid("requested_by_user_id") /* null */,
  result: jsonb("result") /* null */, error: text("error") /* null */, createdAt: createdAt(),
  startedAt: ts("started_at") /* null */, completedAt: ts("completed_at") /* null */,
});
```

#### 5.4.20 `src/db/schema/imports.ts` (BR-17 Calendly import, CAL-22)

```ts
export const importSource = pgEnum("import_source", ["calendly"]);
export const importRunStatus = pgEnum("import_run_status", ["pending", "running", "completed", "failed"]);

export const importRuns = pgTable("import_runs", {
  id: pk(), userId: ref(users), source: importSource("source"), status: importRunStatus("status") /* = 'pending' */,
  options: jsonb("options").$type<{ eventTypes: boolean; schedules: boolean; profile: boolean; meetingsAsBusy: boolean }>(),
  result: jsonb("result").$type<{ created: Record<string, number>; updated: Record<string, number>; skipped: { kind: string; name: string; reason: string }[] } | null>() /* null */,
  error: text("error") /* null */, startedAt: ts("started_at") /* null */, completedAt: ts("completed_at") /* null */, createdAt: createdAt(),
}, (t) => [index("import_runs_user_idx").on(t.userId, t.createdAt)]);

export const importMappings = pgTable("import_mappings", {   // idempotency: one local record per external record
  id: pk(), userId: ref(users), source: importSource("source"),
  entityType: text("entity_type") /* 'event_type' | 'schedule' | 'profile' | 'meeting' */, externalId: text("external_id") /* Calendly URI */,
  entityId: uuid("entity_id") /* local id (event_types, availability_schedules, users, external_events) */,
  importedHash: text("imported_hash") /* hash of the imported values, to detect local edits before overwriting */,
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("import_mappings_uq").on(t.userId, t.source, t.entityType, t.externalId)]);
```

The personal access token is never stored in these tables: it travels encrypted in the `settings.calendly_import` job
payload and the handler clears it from the payload when the run ends.

#### 5.4.21 Schema barrel and first migration

- `src/db/schema/index.ts` re-exports: `auth`, `organizations`, `files`, `availability`, `event-types`, `calendars`,
  `conferencing`, `bookings`, `links`, `polls`, `workflows`, `messaging`, `jobs`, `routing`, `contacts`, `analytics`,
  `developer`, `payments`, `admin`, `imports` (20 files).
- Cross-file foreign keys always use lazy callbacks (`.references(() => other.id)`) so circular imports between schema
  files are safe; never read an imported table at module top level outside a callback.
- Migrations: `drizzle/0000_init.sql` (generated), then `drizzle/0001_extensions.sql` (custom, `drizzle-kit generate
  --custom`): `CREATE EXTENSION IF NOT EXISTS btree_gist;` (reserved for future exclusion constraints; PGlite loads it).
  No exclusion constraint on meetings is used (free/busy rules and one-off overrides intentionally allow overlaps; race
  safety comes from advisory locks, SCH-20).
- A Vitest test asserts that every table in the schema has a migration (generated SQL contains `CREATE TABLE "<name>"`) and
  that `migrateGuarded` is idempotent on PGlite.

---

## 6. Domain model notes (Calendly mapping)

| Calendly object | Our tables |
|---|---|
| event_type (Standard) | `event_types` (`type = 'standard'`) + `event_type_hosts` + `event_type_host_pools` + `event_type_questions` |
| event_type (Adhoc, one-off) | `event_types` (`type = 'adhoc'`) + `one_off_meetings` + `one_off_meeting_spots` |
| event_type (poll) | `event_types` (`type = 'adhoc'`, `booking_method = 'poll'`, `secret = true`) + `meeting_polls` and children |
| user_availability_schedule | `availability_schedules` (`event_type_id is null`) + `availability_date_overrides` |
| scheduled_event | `scheduled_events` + `scheduled_event_hosts` (event_memberships) |
| invitee | `invitees` (+ `invitee_guests` for event_guests, `invitee_no_shows`, `payments`) |
| scheduling_link / share | `single_use_links` (+ optional custom schedule) |
| routing_form(_submission) | `routing_forms` + questions + routes, `routing_form_submissions` |
| webhook_subscription | `webhook_subscriptions` + `webhook_deliveries` |
| contact | `contacts` + `contact_emails` + custom fields |
| activity_log_entry | `audit_log` |

Key behaviors encoded in the model:

- **Group events**: one `scheduled_events` row per (event type, start) with `is_group = true`; many `invitees`. The
  partial unique index enforces one active slot row per start. The slot is canceled when its last active invitee
  cancels.
- **Reschedule chain** (CR-04): old invitee `rescheduled = true`, `new_invitee_id`; new invitee `old_invitee_id` (unique,
  so an invitee is rescheduled at most once; links of old invitees follow `new_invitee_id` to the active one). For
  one-on-one and multi-host meetings the new `scheduled_events` row gets `rescheduled_from_event_id`, inherits `ics_uid`,
  `provider_ical_uid` and `invitation_url` with `ics_sequence + 1`, its `scheduled_event_hosts` rows copy `assigned_at`
  when the host is unchanged, and the `calendar_linked_events` rows are re-pointed to the new scheduled event (provider
  event moved, not recreated). Moving a meeting in place (poll rebook, MP-21) uses `lifecycle.moveScheduledEvent`, which
  updates the same row instead.
- **Reservations** (SCH-19): a `booking_reservations` row is a busy source for exactly its `host_user_ids` and, when
  `is_group_seat`, one seat of its slot; `invitees.reservation_id` (unique) proves which invitee completed it.
- **Busy index**: `scheduled_event_hosts` rows carry denormalized times and buffered times plus `is_active`, so "app
  meetings for these users in this range" is one indexed query.
- **Snapshots**: `scheduled_events.settings_snapshot` freezes notification and confirmation settings at booking time;
  `workflow_executions.snapshot` freezes workflow actions (NT-15).

---

## 7. Slot engine (`src/lib/slots/**`, pure, owner: slot-engine)

### 7.1 Files

```
src/lib/slots/
  types.ts           # all exported types below
  index.ts           # computeSlots, selectHosts, re-exports
  window.ts          # booking window (notice, date range modes) per zone
  schedule.ts        # weekly hours + overrides + blocked dates -> UTC availability intervals per local date
  blocks.ts          # anchor blocks (merged within a local date), containment blocks (merged across midnight),
                     # combined blocks per pooling type (intersection, union per pool)
  candidates.ts      # increments and alignment on combined anchor blocks, plus existing group slots
  busy.ts            # normalize, merge, all-day expansion helpers, free/busy rule filtering
  limits.ts          # period keys (day/week/month in zone), counting
  pooling.ts         # collective intersection, round robin eligibility, multi-pool
  assign.ts          # host selection at booking time
  reasons.ts         # ReasonCode, display labels, fix hints (SPEC Appendix B)
  *.test.ts          # exhaustive unit tests incl. DST and owner observations
src/lib/holidays/
  index.ts           # getHolidays(country, year): { key, date, name, substitute: boolean }[]; SUPPORTED_COUNTRIES;
                     # blockedDatesFor(country, overrides, rangeStart, rangeEnd, zone): string[]
  data.ts            # thin wrapper over date-holidays (public type only, observed/substitute days kept), memoized per (country, year)
```

### 7.2 Interfaces (`src/lib/slots/types.ts`)

```ts
export type Millis = number;                                   // epoch ms, UTC
export interface Interval { start: Millis; end: Millis }       // half-open [start, end)
export type MinuteRange = { start: number; end: number };      // local minutes 0..1440
export type WeeklyHours = [MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[]]; // 0 = Sunday

export interface ScheduleInput {
  timeZone: string;                                            // IANA
  weekly: WeeklyHours;
  overrides: Record<string, MinuteRange[]>;                    // "YYYY-MM-DD" -> intervals (empty array = unavailable that date)
  blockedDates: string[];                                      // holidays observed, "YYYY-MM-DD" in this schedule's zone (beat overrides)
}

export type BusySource = "calendar" | "meeting" | "reserved";
export interface BusyInterval extends Interval {               // start/end are the BLOCKING range (meetings: buffered range)
  source: BusySource;
  core?: Interval;                                             // meetings: the meeting itself without buffers (for BUFFER vs OVERLAP)
  title?: string | null;                                       // free/busy rule matching, troubleshoot detail
  meetingId?: string;                                          // source = meeting
  eventTypeId?: string;                                        // source = meeting
  isFullGroupSlot?: boolean;                                   // free/busy rules never ignore full group slots
  calendarId?: string;                                         // source = calendar
  reservedKind?: "one_off" | "poll" | "reservation";           // source = reserved (never buffered)
  reservationKey?: string;                                     // source = reserved, reservedKind = reservation: booking_reservations.id
}
export interface MeetingStart { start: Millis; meetingId: string }   // counts input; ignored ids are skipped

export interface PeriodLimits { day?: number | null; week?: number | null; month?: number | null }

export interface HostInput {
  userId: string;
  schedule: ScheduleInput | null;                              // null with spots (one-off/poll) = ignore working hours
  busy: BusyInterval[];                                        // all sources, any order, may overlap; all-day already expanded by caller
  calendarStatus: "ok" | "nocal";                              // nocal: caller decided host is unavailable (SCH-11) -> NOCAL
  hostLimits: PeriodLimits;                                    // SCH-09
  hostLimitZone: string;                                       // host default schedule zone
  hostMeetingStarts: MeetingStart[];                           // the host's active meetings (all event types, all sources) covering
                                                               // startOfWeek(startOfMonth(rangeStart)) .. endOfWeek(endOfMonth(rangeEnd)) in hostLimitZone
  priority: 1 | 2 | 3 | 4 | 5;                                 // round robin
  poolId: string | null;                                       // null = required host
  rr: { count: number; lastAssignedAt: Millis | null } | null; // round robin state for this event type + pool (caller excludes
                                                               // query.ignoreMeetingIds; lastAssignedAt = max(assigned_at))
}

export interface PoolInput { id: string; distribution: "availability" | "equal" }

export type DateRangeRule =
  | { type: "rolling"; days: number; mode: "calendar_days" | "weekdays" | "available_days" }
  | { type: "fixed"; startDate: string; endDate: string }      // inclusive local dates
  | { type: "unlimited" };

export interface EventTypeRules {
  eventTypeId: string;
  durationMinutes: number;                                     // chosen duration (SCH-18)
  incrementMinutes: number;
  alignment: "interval_start" | "hour";
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  dateRange: DateRangeRule;
  rangeZone: string;                                           // zone for date range and event-type limit periods (SCH-08)
  weekStart: 0 | 1;
  limits: PeriodLimits;                                        // event type limits
  eventTypeMeetingStarts: MeetingStart[];                      // this event type's active scheduled events (group slot counted once)
                                                               // covering whole weeks and months around the range in rangeZone
  kind: "solo" | "group";
  seats: number;                                               // 1 for solo
  groupSlots: { start: Millis; end: Millis; remaining: number; meetingId: string | null }[];   // remaining = slot limit - active
                                                               // invitees - pending seat holds (caller); one entry per active slot of
                                                               // the event type in range, plus entries with meetingId null for starts
                                                               // that only have pending holds (no meeting yet)
  pooling: null | "collective" | "round_robin" | "multi_pool";
  pools: PoolInput[];
  freeBusyExceptions: { mode: "includes" | "exact"; text: string }[];
  spots?: Interval[] | null;                                   // explicit offered windows (one-off): candidates = spot starts only
}

export interface SlotQuery {
  rangeStart: Millis;                                          // inclusive candidate start lower bound
  rangeEnd: Millis;                                            // exclusive candidate start upper bound
  now: Millis;
  troubleshoot?: boolean;                                      // include diagnostics for every candidate
  ignoreMeetingIds?: string[];                                 // reschedule (SCH-24): skipped in busy, eventTypeMeetingStarts and
                                                               // hostMeetingStarts. Never set for a group invitee (the slot keeps its
                                                               // other invitees): the caller adds 1 to that slot's remaining instead
  ignoreReservationKeys?: string[];                            // own reservation (retrying payment, completing a hold)
  ignoreLimits?: boolean;                                      // one-off spots and poll bookings (SCH-09 enforcement by source)
}

export interface Slot {
  start: Millis;
  end: Millis;
  inviteesRemaining: number;                                   // group: seats left (existing slot) or seats; solo: 1 (RR: number of eligible hosts)
  eligibleHostIds: string[];                                   // hosts that could attend
  eligibleByPool: Record<string, string[]>;                    // poolId -> eligible host ids ("required" key for required hosts)
  existingMeetingId?: string;                                  // group slot already exists
}

export type ReasonCode =
  | "CALENDAR" | "NOCAL" | "DAILY_MAX" | "WEEKLY_MAX" | "MONTHLY_MAX" | "DURATION" | "RANGE" | "TOOSOON" | "EVENT"
  | "GROUP" | "OVERLAP" | "HOLIDAY" | "MEETING_LIMIT" | "HOST" | "ROUNDROBIN" | "UNFAIR" | "BUFFER" | "PAST" | "RESERVED";

export interface Blocker { source: BusySource; start: Millis; end: Millis; title?: string | null; meetingId?: string; calendarId?: string }
export interface CandidateDiagnostic {
  start: Millis; end: Millis; available: boolean; reasons: ReasonCode[];
  hosts: Record<string, { available: boolean; reasons: ReasonCode[]; blockers: Blocker[] }>;
}

export interface SlotEngineInput { rules: EventTypeRules; hosts: HostInput[]; query: SlotQuery }
export interface SlotEngineResult {
  slots: Slot[];                                               // sorted by start
  diagnostics?: CandidateDiagnostic[];                         // only when troubleshoot
  windowEnd: Millis | null;                                    // end of the booking window (null = unlimited)
}

export function computeSlots(input: SlotEngineInput): SlotEngineResult;

export interface AssignmentResult {
  hostIds: string[];                                           // all hosts of the meeting (required + one per pool)
  organizerId: string;
  byPool: Record<string, { userId: string; reason: "priority" | "least_recent" | "random" | "equal" }>;
}
export function selectHosts(input: { rules: EventTypeRules; hosts: HostInput[]; slot: Slot; random?: () => number;
  preferHostIds?: string[] /* reschedule same_hosts */; }): AssignmentResult | null;
export function reasonLabel(code: ReasonCode): string;          // "DAILY MAX", "MEETING LIMIT", ...
export function reasonHint(code: ReasonCode): { meaning: string; fix: string };
```

### 7.3 Algorithm

```
computeSlots({ rules, hosts, query }):
  1. window = bookingWindow(rules, hosts, query.now)            // window.ts, local dates and times in rules.rangeZone
       earliest = now + notice                                  // below now: PAST, below earliest: TOOSOON
       rolling calendar_days:  lastStart = wallClockPlus(now, { days })    // same local time N days later, DST safe (SCH-02,
                               observed); a candidate is in range when s <= lastStart
       rolling weekdays:       lastStart = the local time of now on the Nth Mon..Fri date after today (weekend dates are
                               skipped while counting, SCH-03); in range when s <= lastStart
       rolling available_days: walk local dates from today, counting dates that the COMBINED containment blocks of step 3
                               intersect (pooling rules apply: all required hosts for collective and multi_pool, any member
                               per pool for round robin); today counts only when one of its combined blocks ends after
                               earliest; window end = start of the day after the Nth counted date; cap 3,650 dates. This
                               needs every future override and blocked date in ScheduleInput (the caller loads them all,
                               section 8), so the window end never depends on the requested range
       fixed:     [startOf(startDate), startOf(endDate + 1 day));   unlimited: no end
       result.windowEnd = the exclusive end (rolling modes: lastStart + 1 ms)
  2. Host blocks (schedule.ts, blocks.ts), skipped in spots mode. For each host h and each local date d of
     h.schedule.timeZone covering [rangeStart - 1 day, rangeEnd + 1 day] (available_days: from today to the cap):
       if d in blockedDates -> no intervals (HOLIDAY context when troubleshooting)
       ranges = overrides[d] ?? weekly[weekday(d)]; drop ranges with end <= start (zero length = unavailable)
       start = DateTime.fromObject({ ...d, hour: r.start / 60 | 0, minute: r.start % 60 }, { zone }).toMillis()
       end   = r.end == 1440 ? startOf(d + 1 day) : the same conversion for r.end     // nonexistent local times shift forward
       anchor_h(d)   = merge touching or overlapping intervals of date d               // anchor blocks: never cross h's midnight
     containment_h = merge touching or overlapping anchor blocks of all dates          // containment blocks: cross midnight
  3. Combined blocks (blocks.ts), computed on both levels:
       pooling null (single host): the host's blocks
       collective:  intersection over all hosts                                       // SCH-15
       round_robin: union over the pool's members                                     // SCH-16 (our choice: one grid per pool)
       multi_pool:  intersection(required host 1, ..., union(pool 1 members), union(pool 2 members), ...)   // SCH-17
     Combined anchor blocks are finally split at local midnights of rules.rangeZone, so the grid of a date never depends on
     other dates (unions across zones could otherwise chain across days).
  4. Candidate starts (candidates.ts):
       spots mode: each spot start (duration = spot length)
       otherwise, for each combined anchor block B (sorted):
          interval_start: s = B.start + k * increment
          hour:           first local time >= B.start in rules.rangeZone whose minutes since local midnight % increment == 0,
                          then step by increment in local wall-clock minutes (skip nonexistent times)
          keep s while s < B.end and [s, s + duration) fits inside the combined containment block that contains s
       plus every existing group slot start in range (rules.groupSlots), even off the current grid (SCH-14)
       keep rangeStart <= s < rangeEnd; dedupe; sort
       (troubleshoot: a combined containment block shorter than the duration yields DURATION at its anchor start)
  5. For each candidate c = [s, e = s + duration):
       a. global: s < now -> PAST; s < earliest -> TOOSOON; outside the window -> RANGE
       b. group: slot = groupSlots entry with start == s and end == e. If found: remaining <= 0 -> GROUP; otherwise, when
          slot.meetingId is set, the candidate joins it: that meetingId is ignored in every host's busy and limits are not
          re-applied (a join adds no meeting). An entry without meetingId (holds only) just caps the seats
       c. event type limits, unless query.ignoreLimits or joining a slot: count eventTypeMeetingStarts whose meetingId is
          not in ignoreMeetingIds and whose start shares periodKey(s, rangeZone, weekStart) -> DAILY_MAX, WEEKLY_MAX,
          MONTHLY_MAX when count >= limit
       d. per host h:
            inSchedule = c fits inside one of h's own containment blocks (spots mode: always true); else not available
                         (no code unless troubleshooting shows DURATION or HOLIDAY context)
            if h.calendarStatus == "nocal" -> NOCAL
            window = [s - bufferBefore, e + bufferAfter)
            blockers = busy intervals of h overlapping window, excluding:
               - meetingId in query.ignoreMeetingIds, or == the joined group slot meeting
               - free/busy exceptions matching the title (case-insensitive includes, trimmed exact), unless isFullGroupSlot
               - reservations whose reservationKey is in query.ignoreReservationKeys
            for each blocker b: core = b.core ?? b (calendar and reserved blockers are their own core; reserved are never buffered)
                 if [s, e) does not overlap core            -> BUFFER (only buffers collide, on either side)
                 else calendar -> CALENDAR; reserved -> RESERVED; meeting of rules.eventTypeId -> EVENT; other meeting -> OVERLAP
            host limits, unless query.ignoreLimits: count hostMeetingStarts not in ignoreMeetingIds per period in
                 hostLimitZone >= limit -> MEETING_LIMIT
            hostAvailable = inSchedule and no codes
       e. pooling:
            null (solo/group single host): available = host available
            collective: available = all hosts available; else HOST
            round_robin: eligible = available pool hosts; if distribution == "equal":
                 minCount = min(rr.count over ALL pool hosts); hidden = { h : h.rr.count - minCount >= 3 }
                 eligible = eligible \ hidden; if available non-empty but eligible empty -> UNFAIR
               available = eligible non-empty; else ROUNDROBIN
            multi_pool: all required available (else HOST) and every pool has eligible (else ROUNDROBIN / UNFAIR)
       f. emit Slot when available: inviteesRemaining = group ? (slot ? slot.remaining : seats) :
          (round_robin ? |eligible| : 1); existingMeetingId = slot?.meetingId ?? undefined
  6. Return slots sorted by start; diagnostics when troubleshoot.
```

`selectHosts` (assign.ts): for each pool, among `eligibleByPool[pool]` (or the preferred hosts for "same hosts"
reschedules): `availability` distribution sorts by priority desc, then `lastAssignedAt` asc (null first), then random;
`equal` sorts by `count` asc, then `lastAssignedAt` asc, then random. The organizer is the event type's
`organizer_user_id` if attending, else the first required host, else the first pool's assignee. The same function
assigns the provisional host of a reservation (section 9).

### 7.4 Busy normalization helpers (`busy.ts`, exported for the availability service)

- `expandAllDay(dateStart: string, dateEndExclusive: string, zone: string): Interval` (local midnight to local
  midnight, DST correct).
- `mergeIntervals(intervals: Interval[]): Interval[]` (sort and merge overlapping or touching; used for the fast path
  and by `blocks.ts`); `intersectIntervals(a, b)`, `unionIntervals(lists)`, `splitAtLocalMidnights(intervals, zone)`.
- `matchesFreeBusyException(title, exceptions)`.
- For performance the engine keeps per-host busy sorted by start and uses binary search to find overlaps (O(log n) per
  candidate); merged arrays serve the non-troubleshoot fast path, raw arrays serve diagnostics.

### 7.5 Performance and correctness

- Target: 31 days, 15-minute increments, 3 hosts, 500 busy intervals each: under 150ms (GEN-07). Avoid Luxon in inner
  loops: convert each local date's ranges to millis once; candidates are integer arithmetic (interval_start) or a
  precomputed offset table per date (hour alignment).
- Determinism: `computeSlots` never reads the clock (uses `query.now`) and never uses randomness (`selectHosts` takes an
  injectable `random`).
- Tests (minimum): owner observations (SCH-01 acceptance), buffers stacking and edge-of-hours, increments both
  alignments including 9:05 starts, DST spring-forward and fall-back for America/New_York and Europe/Berlin, all-day
  blocks, zero-length intervals, overrides and holidays precedence, rolling calendar/weekdays/available-days windows,
  fixed and unlimited ranges, notice, day/week/month limits with week start Sunday vs Monday, host limits, group seats,
  collective intersection, round robin priority and tie breaks, equal distribution hide/unhide sequence (Jim/Karen),
  multi-pool, free/busy exceptions (and full group exception), reason codes per blocker type, spots mode, ignore lists,
  property-based test: no returned slot overlaps any non-ignored busy interval of its eligible hosts. Added by the
  review: touching blocks 9-12 + 12-17 offer 11:30 for 60 minutes; 22:00-24:00 + 00:00-02:00 offer 23:30 and anchor the
  next date at 00:00; the grid of a date is identical for range starts on that date and a month earlier (also with 25
  and 45 minute increments on 24-hour schedules); collective A 9:00-12:00 and B 9:15-12:00 with 30 minute increments give
  9:15, 9:45 and no 9:30; round robin union grid; multi-pool combined grid; BUFFER when the candidate falls only in
  another meeting's after-buffer; reschedule exclusion from day, week, month and host limit counts; weekly limits counted
  across a month boundary; rolling calendar days by time of day (7 days: 08:00 on day 7 in, 08:15 out); rolling
  weekdays; available_days with pooling and the "today counts only if" rule and a vacation inside the window giving the
  same end for different month queries; off-grid existing group slots offered; hold-only group entries cap seats;
  `ignoreLimits` for spots.

---

## 8. Availability service (`src/lib/booking/availability.ts`, owner: booking-core)

Assembles engine inputs from the database and external calendars. Used by the booking page, troubleshooter, host
booking, reschedule pages, API `event_type_available_times`, and (through `getBusyForUsers`) the one-off and poll
pickers and mutual availability (BK-33).

```ts
export type BookingTarget = {
  kind: "event_type" | "single_use" | "one_off" | "shared";
  eventType: EventTypeRow;                       // with hosts, pools, questions
  overrides?: {                                  // single-use (OO-02); one-off uses spots
    name?: string; durationMinutes?: number; durationOptions?: number[]; locations?: LocationConfig[];
    scheduleId?: string; dateRange?: DateRangeRule; hideLocation?: boolean;
  };
  spots?: { start: Date; end: Date; overlappedExternalIds: string[] }[];
  linkId?: string; code?: string;
};

export async function resolveTargetBySlugs(handle: string, eventSlug: string): Promise<BookingTarget | null>;
export async function resolveTargetByCode(code: string): Promise<BookingTarget | null>;   // delegates to links.resolveBookingCode
export async function getAvailability(params: {
  target: BookingTarget; start: Date; end: Date; durationMinutes?: number; now?: Date;
  troubleshoot?: boolean;
  ignoreInviteeId?: string;                      // reschedule (SCH-24): solo/multi-host -> ignoreMeetingIds; group -> +1 seat on its slot
  ignoreReservationId?: string;                  // completing or retrying one's own hold
  reservationEmail?: string;                     // ignore pending holds of this email for the same slot (retry payment)
  ignoreLimits?: boolean;                        // one-off spots, poll bookings (SCH-09 enforcement by source)
  freshness?: "page" | "submit";                 // page: cache <= 180s; submit: cache <= 60s (CAL-10, SCH-20)
}): Promise<SlotEngineResult & { hostsById: Record<string, { name: string; avatarUrl: string | null }> }>;
export async function getBusyForUsers(actor: { userId: string; organizationId: string }, userIds: string[], start: Date, end: Date):
  Promise<Record<string, BusyInterval[]>>;       // external + meetings + reserved, for pickers and polls
  // authz (GEN-08): every userId must be the actor or a member of the actor's organization (else AppError forbidden);
  // titles are returned only for the actor's own intervals, null for everyone else
export function groupSlotsByLocalDate(slots: Slot[], zone: string): Record<string, { start: string; remaining: number }[]>;
```

Steps of `getAvailability`:

0. Short circuit (BK-31): compute the booking window from the event rules and `now` (no busy needed for calendar days,
   weekdays, fixed and unlimited; for `available_days` after step 1). When the requested range lies entirely outside the
   window, return no slots without loading busy times or calling providers.
1. Hosts: required and pool hosts from `event_type_hosts` (personal solo: the owner). Schedules: per host `schedule_id`
   or event `schedule_id` when `availability_setting = 'shared'` or the host's default schedule; single-use override
   schedule replaces all. Overrides from `availability_date_overrides` within range plus a one day margin; for
   `available_days` windows, every future override of the schedule (at most 1,000) and holidays from local today up to
   the 3,650 date cap, so the window end does not change between month pages. Holidays: `users.holiday_country` and
   `user_holiday_overrides` to `blockedDates` (via `src/lib/holidays`, substitute days included), evaluated in each
   schedule's zone.
2. External busy: `calendars.getExternalBusy({ userIds, start: rangeStart - maxBuffer - 1 day, end: rangeEnd + maxBuffer +
   1 day, maxAgeSeconds })`; connections in `needs_reauth` or `error` with cache older than 24 hours give `nocal`.
   All-day events expanded in the host's default schedule zone by their calendar dates (SCH-12).
3. App meetings: `scheduled_event_hosts` join `scheduled_events` where `user_id in hosts and is_active and
   buffered_start_at < rangeEnd' and buffered_end_at > rangeStart'`, mapped to `source: "meeting"` with buffered range,
   core range, title (meeting name), event type id, `isFullGroupSlot`.
4. Reserved: `booking_reservations` with `status = 'pending' and expires_at > $now and host_user_ids && $hostIds` (GIN
   index) become `source: "reserved"` busy for exactly the hosts in `host_user_ids` (a round robin hold blocks only its
   provisional host), unbuffered, with `reservationKey = id` (skipped when it equals `ignoreReservationId`, or when the
   email and slot match `reservationEmail`). Group seat holds (`is_group_seat`) of this event type reduce the matching
   slot's `remaining` instead of blocking hosts, and starts with holds but no meeting get a hold-only `groupSlots`
   entry. Plus `links.getReservedIntervals` (one-off holds while pending with reserve times) and
   `polls.getPollReservedIntervals` (open or closed polls with reserve times).
5. Counts, always over whole periods: event type meeting starts of every active scheduled event of this event type from
   `startOfWeek(startOfMonth(rangeStart))` to `endOfWeek(endOfMonth(rangeEnd))` in `rangeZone` with the owner's week
   start; host meeting starts of every active meeting of each host (all event types and sources) over the same span in
   that host's `hostLimitZone`; both as `{ start, meetingId }`. Round robin counts per pool host: `count` of active
   assigned rows since `pool.counts_reset_at`, excluding the meeting being rescheduled, `lastAssignedAt` = max
   `assigned_at`. Group slots: every active slot of this event type in range, `remaining = invitees_limit - active
   invitees - pending seat holds` (+1 on the rescheduling invitee's own slot).
6. Call `computeSlots` with `ignoreMeetingIds` (reschedule of a non-group invitee: its scheduled event),
   `ignoreReservationKeys` and `ignoreLimits`. For one-off spots, external events whose ids are in
   `overlappedExternalIds` are removed from that host's busy (OO-09).

`GET /api/public/slots` (booking-core) applies `rateLimit("slots:ip:{hashIp}", 60, 60)` and `600 per 3600s` before step
0.

---

## 9. Booking creation (`src/lib/booking/create.ts`, owner: booking-core)

```ts
export type CreateBookingInput = {
  target: { kind: BookingTarget["kind"]; eventTypeId?: string; code?: string; handle?: string; eventSlug?: string };
  start: string;                       // ISO UTC
  durationMinutes?: number;
  invitee: { name?: string; firstName?: string; lastName?: string; email: string; timezone: string; detectedTimezone?: string | null;
             timeFormat?: "12h" | "24h" | null; locale?: string; textReminderNumber?: string | null; marketingConsent?: boolean };
  guests?: string[];
  locationAnswer?: { configId: string; value?: string | null };
  answers?: { questionId: string; value: string | string[] }[];
  tracking?: Tracking;
  routingFormSubmissionId?: string | null;
  reschedule?: { inviteeId: string; reason?: string | null } | null;   // set by lifecycle reschedule
  actor?: { type: "invitee" } | { type: "host"; userId: string; overrideAvailability?: boolean; customize?: { name?: string; durationMinutes?: number; location?: LocationConfig } } | { type: "api"; userId: string };
  pollContext?: { pollId: string; optionId: string; bookedByUserId: string;
    participants: { participantId: string | null; name: string; email: string; timezone?: string | null }[] };
  clientRequestId?: string;            // idempotency (BK-19)
  verification?: { reservationId: string; code: string } | null;
};
export type CreateBookingResult =
  | { ok: true; inviteeId: string; scheduledEventId: string; redirectUrl?: string }
  | { ok: false; code: "slot_unavailable" | "validation" | "blocked" | "verification_required" | "payment_required" | "link_used"
      | "not_found" | "already_booked"; message: string; fieldErrors?: Record<string, string[]>; reservationId?: string };
export async function createBooking(input: CreateBookingInput, ctx: { ip?: string; now?: Date }): Promise<CreateBookingResult>;
export async function createReservation(input: CreateBookingInput & { kind: "payment" | "email_verification" }, ctx: { ip?: string; now?: Date }):
  Promise<{ ok: true; reservationId: string; expiresAt: Date } | Extract<CreateBookingResult, { ok: false }>>;
export async function completeReservation(reservationId: string, extra: { paymentId?: string; verifiedEmail?: boolean; now?: Date }): Promise<CreateBookingResult>;
// src/lib/booking/locks.ts (exported through index.ts for lifecycle-core, links-sharing and polls-core)
export async function lockHostsInTx(tx: Tx, userIds: string[]): Promise<void>;          // advisory locks, ascending order
export async function lockInviteeForChangeInTx(tx: Tx, inviteeId: string): Promise<InviteeRow>;   // FOR UPDATE; throws when not active or already rescheduled
```

**Global lock order** (normative for every module that writes bookings, reservations, polls, links or invitee
changes):

1. Per-host transaction advisory locks `pg_advisory_xact_lock(hashtextextended('host:' || user_id, 0))` for every
   candidate host, in ascending `user_id` order (`lockHostsInTx`).
2. Row locks (`SELECT ... FOR UPDATE`), in this order and only after step 1: the invitee being rescheduled or canceled
   (`lockInviteeForChangeInTx`); then at most one booking target row: the single-use link or one-off meeting
   (`links.consumeLinkInTx`), the group slot scheduled event, or the poll (`polls.markPollBookedInTx`).
3. Everything else (inserts, conditional updates such as reservation completion).

A transaction that needs a target row lock without host locks (a poll vote, a link edit) never acquires host locks
afterwards. Flows that replace an active scheduled event guarded by a partial unique index (one per poll, one per
one-off) cancel or update the old row before inserting a new one in the same transaction.

Sequence of `createBooking`:

1. Validate with zod against the resolved target (questions, required fields, guests, location, SMS country). Check
   `blocked_invitees` for every host (BK-28). Fast path: if an invitee with the same `client_request_id` exists, return
   its result.
2. If email verification is required (never for reschedules) and the request has no valid verification, or payment is
   required: call `createReservation` (below) and return `verification_required` or `payment_required` with the
   reservation id; the code email or the payment session is created after that transaction commits.
3. Fresh external busy for candidate hosts (`freshness: "submit"`), fetched before the transaction.
4. Transaction (read committed):
   - Lock order step 1 for every candidate host.
   - Idempotency inside the lock: `select id from invitees where client_request_id = $1`; if found, return that result
     (a double click whose first request is still in flight waits on the lock and then returns the same invitee instead
     of `slot_unavailable`).
   - Reschedule: `lockInviteeForChangeInTx(old)`; require `status = 'active' and new_invitee_id is null`, else return
     `slot_unavailable` with message "This event can no longer be rescheduled."
   - Recompute availability for exactly `[start, start + duration)` with DB state read inside the transaction (meetings,
     reservations, counts) and the pre-fetched external busy (reschedule: `ignoreInviteeId`). Host override bookings
     skip schedule, notice, range and limit checks for the acting host only (OO-14), never busy of other hosts. One-off
     and poll bookings pass `ignoreLimits`.
   - Round robin / multi-pool: `selectHosts`. Group: lock the existing slot row `FOR UPDATE` or insert it (unique index
     guards concurrent first bookings: on `23505` retry the transaction once as a join); reject an email that already
     holds an active seat in the slot with `already_booked` ("You've already booked this time.").
   - Single-use / one-off: `links.consumeLinkInTx(tx, ...)` (locks the link row, throws `link_used`).
   - Insert `scheduled_events` (new or reuse group slot; one-off and poll: buffers 0/0), `scheduled_event_hosts` (with
     buffered times and `assigned_at`, copied from the old row on a same-host reschedule), `invitees` (zone, detected
     zone, time format), `invitee_guests`, `meeting_activity('booked')`, link routing submission; contacts and routing
     submission updates are done by subscribers.
   - Reschedule: cancel and link the old invitee (and its scheduled event when no active invitee remains) in the same
     transaction.
   - Poll: `polls.markPollBookedInTx(tx, { pollId, optionId, scheduledEventId, inviteeIds, bookedByUserId })` (locks the
     poll row after the host locks, re-validates status and sets booked).
   - `publishEvent(tx, reschedule ? "booking.rescheduled" : "booking.created", ...)`.
5. `after(() => runDueJobs({ budgetMs: 8000, types: ["event:booking.created:*", "event:booking.rescheduled:*"] }))` so
   provisioning and emails start immediately.
6. Return `{ ok: true, inviteeId, redirectUrl }` (redirect when `after_booking = 'redirect'`, BK-21).

`createReservation` runs the same transaction as step 4 (host locks, recheck including pending reservations, round
robin `selectHosts` for the provisional assignee, group seat count including holds) but inserts a `booking_reservations`
row instead of the meeting: `host_user_ids` = the hosts the meeting would have, `assignment` = the provisional
assignment, `is_group_seat` for group events, `expires_at = now + 10 minutes` (payments extends it to the Stripe
Checkout session expiry, 30 minutes, when it creates a Checkout session).

`completeReservation(id)` (called by the verification endpoint, the Stripe webhook and the return page, possibly at the
same time):

1. Transaction: lock order step 1 for the reservation's `host_user_ids`.
2. `UPDATE booking_reservations SET status = 'completed', updated_at = $now WHERE id = $1 AND (status = 'pending' OR
   (kind = 'payment' AND status = 'expired')) RETURNING *`. No row: return the result of the invitee whose
   `reservation_id = $1` if it exists (the other caller won), else `not_found`.
3. Recheck availability for the held slot with `ignoreReservationKeys = [id]`; round robin keeps the provisional host
   when still free, else re-runs `selectHosts`.
4. Unavailable: set the reservation `canceled`; for payments enqueue `payments.refund` (PAY-04) in the same
   transaction and return `slot_unavailable`.
5. Available: insert the meeting rows as in `createBooking` step 4 with `invitees.reservation_id = id` (a unique index,
   so a second insert can never succeed) and publish `booking.created`.

Reschedules (lifecycle) call `createBooking` with `reschedule` set: inside the same transaction the old invitee is
canceled and linked, and `booking.rescheduled` is published instead of `booking.created` plus `booking.canceled`
(subscribers for webhooks emit `invitee.canceled` then `invitee.created`). Cancels (lifecycle `cancelInvitee`) take
the meeting's host locks and then `lockInviteeForChangeInTx`, so a cancel racing a reschedule serializes and the loser
sees the invitee already canceled or rescheduled. Race tests (10 concurrent bookings, double click, concurrent
reschedules, webhook plus return page) run on real Postgres only (section 24.1).

---

## 10. Calendar integrations (`src/lib/calendars/**`, owner: calendar-integrations)

### 10.1 Provider interface

```ts
// src/lib/calendars/providers/types.ts
export type CalendarProviderId = "google" | "microsoft" | "caldav" | "ics" | "calendly_import";
export interface ConnectionContext {           // decrypted, refreshed credentials for one connection
  connectionId: string; userId: string; provider: CalendarProviderId;
  accessToken?: string; caldav?: { serverUrl: string; username: string; password: string; principalUrl?: string };
  icsUrl?: string; unavailableStatuses: string[];
}
export interface RemoteCalendar { externalId: string; name: string; color?: string | null; timeZone?: string | null;
  isPrimary: boolean; canWrite: boolean; allowedOnlineMeetingProviders?: string[] }
export interface RemoteEvent {                 // one expanded instance
  externalId: string; icalUid?: string | null; recurringEventId?: string | null;
  start: Date; end: Date; allDay: boolean; allDayStartDate?: string; allDayEndDate?: string;   // all-day dates in calendar terms
  title: string | null; busy: boolean; showAs?: string | null; status?: "confirmed" | "tentative" | "cancelled" | null;
  selfDeclined?: boolean; extendedPrivate?: Record<string, string>; updatedAt?: Date | null; etag?: string | null;
}
export interface WriteEventInput {
  title: string; descriptionText: string; descriptionHtml?: string; location?: string | null;
  start: Date; end: Date; allDay?: boolean; allDayDate?: string;
  attendees: { email: string; name?: string | null; optional?: boolean }[];
  sendInvitations: boolean;                    // Google sendUpdates=all|none; Graph: attendees only when true
  conference?: "google_meet" | "microsoft_teams" | null;
  transparency: "busy" | "free"; visibility?: "default" | "private";
  icalUid: string;                             // our UID (CalDAV object name, Google iCalUID best effort)
  idempotencyKey: string;                      // Google event id (base32hex), Graph transactionId
  privateProperties: Record<string, string>;   // kairosEventId, kairosPurpose
}
export interface WriteEventResult { externalId: string; etag?: string | null;
  icalUid?: string | null;                     // provider iCal UID (Google iCalUID, Graph iCalUId): stored as scheduled_events.provider_ical_uid
  htmlLink?: string | null;                    // Google htmlLink, Graph webLink: scheduled_events.invitation_url ("Open Invitation")
  conference?: { joinUrl: string | null; status: "pushed" | "processing" | "failed"; data?: Record<string, unknown> } }
export interface CalendarProvider {
  id: CalendarProviderId;
  capabilities: { write: boolean; invitations: boolean; conferences: ("google_meet" | "microsoft_teams")[]; changeSync: boolean };
  listCalendars(ctx: ConnectionContext): Promise<RemoteCalendar[]>;
  listEvents(ctx: ConnectionContext, calendarExternalIds: string[], range: { start: Date; end: Date }): Promise<Record<string, RemoteEvent[]>>;
  getEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string): Promise<RemoteEvent | null>;   // null = deleted
  createEvent(ctx: ConnectionContext, calendarExternalId: string, input: WriteEventInput): Promise<WriteEventResult>;
  updateEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, input: WriteEventInput, etag?: string | null): Promise<WriteEventResult>;
  deleteEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, opts: { notifyAttendees: boolean; comment?: string }): Promise<void>;
}
export class ProviderAuthError extends Error {}    // -> connection needs_reauth
export class ProviderTransientError extends Error {} // -> retry with backoff
```

Implementations:

- `providers/google.ts` (tech-reference 6): `events.list` with `singleEvents=true` and repeated
  `eventTypes=default&eventTypes=focusTime&eventTypes=outOfOffice&eventTypes=fromGmail&eventTypes=birthday` (working
  locations are not requested); busy mapping per SCH-12 (`outOfOffice` always busy, `focusTime` busy unless
  transparent, others follow transparency, declined and cancelled free; a `workingLocation` item that still arrives is
  free); writes return `iCalUID` and `htmlLink`.
- `providers/microsoft.ts` (7): `calendarView` with `Prefer: outlook.timezone="UTC"` and `$select=subject,start,end,
  isAllDay,showAs,isCancelled,iCalUId,responseStatus,type,seriesMasterId,lastModifiedDateTime`; `showAs` in the
  connection's unavailable statuses or `unknown` is busy; `isAllDay` events are returned with UTC-midnight bounds and are
  converted to `allDay: true` with `allDayStartDate`/`allDayEndDate` taken from the UTC date strings, so the busy layer
  expands them as whole local days in the host's zone; writes return `iCalUId` and `webLink`.
- `providers/caldav.ts` (8.1): tsdav with `urlFilter: () => true`, local expansion with node-ical, and tsdav's `fetch`
  override set to `safeFetch` (section 18.9) so principal discovery, its redirects (iCloud `pNN-caldav.icloud.com`) and
  every request are SSRF-checked.
- `providers/ics.ts` (8.3): read-only, fetched only through `safeFetch` (the tech-reference sample's `redirect:
  "follow"` is replaced by `safeFetch`'s validated manual redirects).
- `providers/calendly-import.ts` (CAL-22): read-only; `listEvents` returns the rows the BR-17 importer wrote and never
  calls the network; its windows are always fresh.

Token refresh in `credentials.ts` (Google keeps the old refresh token when none returned; Microsoft and Zoom rotate;
refresh under a per-connection advisory lock to avoid races; `invalid_grant` -> `needs_reauth`).

### 10.2 Module public API (`src/lib/calendars/index.ts`, stub created by foundation)

```ts
export type ExternalBusy = { start: Date; end: Date; allDay: boolean; allDayStartDate?: string; allDayEndDate?: string;
  title: string | null; calendarId: string; externalId: string };
export async function getExternalBusy(p: { userIds: string[]; start: Date; end: Date; maxAgeSeconds?: number; timeoutMs?: number }):
  Promise<Record<string, { ok: boolean; stale: boolean; nocal: boolean; busy: ExternalBusy[] }>>;
export async function listExternalEvents(p: { userId: string; start: Date; end: Date }):   // the caller's own events only (titles included)
  Promise<{ id: string; calendarName: string; color: string | null; title: string | null; start: Date; end: Date; allDay: boolean; busy: boolean }[]>;
export async function getDestinationCalendar(userId: string, eventTypeId?: string): Promise<{
  calendarId: string; connectionId: string; provider: CalendarProviderId; name: string;
  supports: { invitations: boolean; googleMeet: boolean; teams: boolean } } | null>;
export type LinkedEventInput = {
  userId: string; purpose: "meeting" | "buffer_before" | "buffer_after" | "one_off_hold" | "poll_hold";
  scheduledEventId?: string; oneOffMeetingId?: string; oneOffSpotId?: string; pollId?: string; pollOptionId?: string;
  calendarId?: string;                         // default: user's destination (or event type override)
  event: Omit<WriteEventInput, "idempotencyKey" | "privateProperties">;
  existingLinkedEventId?: string;              // update instead of create
};
export async function upsertLinkedEvent(input: LinkedEventInput): Promise<{ linkedEventId: string; externalId: string | null;
  icalUid?: string | null; htmlLink?: string | null;
  conference?: WriteEventResult["conference"]; status: "synced" | "pending" | "failed" | "skipped_no_calendar" }>;
// Group slots (CAL-11): lifecycle-core calls upsertLinkedEvent once per slot (attendees [], sendInvitations false) with
// existingLinkedEventId on every join, invitee cancellation and limit change, and deleteLinkedEvent when the slot is canceled.
export async function deleteLinkedEvent(p: { linkedEventId: string; notifyAttendees: boolean; comment?: string }): Promise<void>;
export async function repointLinkedEvents(p: { fromScheduledEventId: string; toScheduledEventId: string }): Promise<void>;   // reschedule continuity
export async function linkCalendarFromOAuth(p: { userId: string; provider: "google" | "microsoft"; providerAccountId: string;
  accountEmail: string; oauthAccountId: string; tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes: string[] } }): Promise<void>;
export async function getCalendarHealth(userId: string): Promise<{ ok: boolean; brokenConnections: { id: string; email: string | null; status: string }[] }>;
export async function replaceImportedBusy(p: { userId: string; source: "calendly";
  events: { externalId: string; start: Date; end: Date; title: string | null }[] }): Promise<{ connectionId: string }>;
  // CAL-22: creates or reuses the user's "Imported from Calendly" connection (provider calendly_import, one calendar,
  // check_conflicts true, never a destination), replaces its external_events with these rows and marks its sync windows
  // fresh; called by the BR-17 importer (settings-onboarding)
```

The foundation stub implements these as: busy `{}` per user with `ok: true`, events `[]`, destination `null`, upsert
returns `{ status: "skipped_no_calendar", linkedEventId: "", externalId: null }`, others no-ops. `getExternalBusy` and
`listExternalEvents` are called with user ids that the caller already authorized (section 18.7); they never decide
access themselves. Consumers must behave
correctly with the stub (no calendar connected).

### 10.3 Busy cache and change sync

- `getExternalBusy` loads checked calendars for the users, finds missing or stale windows in `calendar_sync_windows`
  (windows aligned to UTC days, 31-day chunks), fetches them in parallel per connection with `timeoutMs` (default 4000),
  replaces `external_events` for the fetched window in one transaction, marks `is_own` by matching `calendar_linked_events`
  external ids, `kairosEventId` private property or iCal UID, and returns busy events (`busy = true and is_own = false`).
- **Single-flight fetching**: before fetching a stale window, a request claims it with `UPDATE calendar_sync_windows SET
  fetch_lease_until = $now + interval '15 seconds', fetch_lease_holder = $id WHERE id = $w AND (fetch_lease_until is null
  OR fetch_lease_until < $now) RETURNING id` (missing windows are inserted with `ON CONFLICT DO NOTHING` first). Only the
  lease holder calls the provider and replaces the window's rows; concurrent requests use the cached rows (stale is fine
  for page freshness) or, for `freshness: "submit"`, wait up to the timeout for the holder (poll every 200 ms) and then
  fall back to stale data. This prevents parallel page loads from all calling Google and racing on the delete and
  insert of `external_events` (23505).
- Periodic job `calendars.sync_booked_events` (every 10 minutes per connection, registered in `src/lib/calendars/jobs.ts`):
  for each `calendar_linked_events` row with `purpose in ('meeting','buffer_before','buffer_after')` of active upcoming
  meetings (next 90 days) on calendars with `sync_changes = true`: `getEvent`; deleted or declined ->
  `lifecycle.applyExternalCalendarChange({ type: "deleted" })`; start or end differs from `synced_start_at/end_at` ->
  `{ type: "moved", start, end }` (buffer events adjust buffers). Batched, rate-limited, skipped for ICS.
- Optional push (P3): Google `events.watch` channels and Graph subscriptions hitting `/api/webhooks/calendars/*` that
  enqueue an immediate sync for that calendar.

### 10.4 OAuth connect intents

Google and Microsoft share the sign-in OAuth clients and callback routes (one redirect URI per provider). The start
route accepts `intent`: `login` (default), `signup`, `connect_calendar`, `poll_freebusy`, `link_login_method`,
`accept_invitation` (carries the invitation token in the state cookie). Intent,
PKCE verifier, state and `returnTo` live in a 10-minute httpOnly cookie. The foundation callback exchanges the code,
decodes the id token, then dispatches through `src/lib/auth/oauth/intents.ts`:
`login/signup/link_login_method` (foundation-auth) always followed by `calendars.linkCalendarFromOAuth` (CAL-17);
`accept_invitation` (foundation-auth): `teams.getPendingInvitation(token)`, require the provider email to equal the
invitation email (else "Use {invited email} to accept this invitation."), then in one transaction
`createUserAccount(tx, { email, name, organizationId, role, createdViaInvitationId })` (or link an existing user) and
`teams.acceptInvitationInTx(tx, { invitationId, userId })`, bypassing the signup policy (AU-11), then
`calendars.linkCalendarFromOAuth`;
`connect_calendar` -> `calendars.handleConnectCallback` (stub file `src/lib/calendars/oauth-connect.ts`);
`poll_freebusy` -> `polls.handleVoterFreeBusyCallback` (stub file `src/lib/polls/voter-oauth.ts`, tokens never persisted).
Zoom uses its own routes `/api/integrations/zoom/{start,callback}` (conferencing module).

---

## 11. Conferencing (`src/lib/conferencing/**`, owner: conferencing)

```ts
// src/lib/conferencing/index.ts (stub created by foundation)
export type ConferenceKind = "google_conference" | "microsoft_teams_conference" | "zoom_conference" | "jitsi_conference" | "webex_conference" | "gotomeeting_conference";
export function conferenceMode(kind: LocationKind): "standalone" | "calendar_native" | "none";
  // standalone: zoom, jitsi (webex, gotomeeting later); calendar_native: google_conference, microsoft_teams_conference
export async function getConferencingOptions(userId: string): Promise<Record<ConferenceKind, { available: boolean; reason?: string; connectUrl?: string }>>;
export async function createConference(p: { kind: ConferenceKind; organizerUserId: string; scheduledEventId: string; title: string;
  agenda?: string | null; start: Date; end: Date; timeZone: string; inviteeEmails: string[] }): Promise<ResolvedLocation>;
export async function updateConference(p: { location: ResolvedLocation; organizerUserId: string; title: string; start: Date; end: Date; timeZone: string }): Promise<ResolvedLocation>;
export async function deleteConference(p: { location: ResolvedLocation; organizerUserId: string }): Promise<void>;
```

Adapters: `zoom.ts` (OAuth PKCE, `POST /users/me/meetings`, PATCH, DELETE with `cancel_meeting_reminder=true`, token
rotation under advisory lock), `jitsi.ts` (`${JITSI_BASE_URL ?? "https://meet.jit.si"}/${slug(appName)}-${random20}`),
`native.ts` (Meet and Teams return `status: "processing"`; the provisioning job passes `conference: "google_meet" |
"microsoft_teams"` to `calendars.upsertLinkedEvent` and copies the returned join URL). Stub behavior until implemented:
`createConference` returns Jitsi links for `jitsi_conference` (foundation implements this one trivially) and
`status: "failed", error: "not_configured"` for others.

The stable join route `/events/[id]/join` (conferencing module) reads `scheduled_events.location` and redirects (VID-11).

---

## 12. Domain events and jobs (`src/lib/events/**`, `src/lib/jobs/**`, owner: foundation-platform; stubs by foundation)

### 12.1 Domain events

```ts
// src/lib/events/types.ts (complete list; modules may not add types without a schema-style request)
export type DomainEventMap = {
  "booking.created": { scheduledEventId: string; inviteeId: string; source: string };
  "booking.canceled": { scheduledEventId: string; inviteeId: string; cancelerType: "host" | "invitee" | "system"; reason: string | null; meetingCanceled: boolean };
  "booking.rescheduled": { oldInviteeId: string; newInviteeId: string; oldScheduledEventId: string; newScheduledEventId: string; reason: string | null };
  "booking.no_show_created": { inviteeId: string; noShowId: string };
  "booking.no_show_deleted": { inviteeId: string; noShowId: string };
  "booking.reconfirmed": { inviteeId: string };
  "booking.host_reassigned": { scheduledEventId: string; fromUserId: string; toUserId: string };
  "meeting.updated": { scheduledEventId: string; fields: ("notes" | "location" | "invitee_limit" | "buffers")[] };
  "event_type.created": { eventTypeId: string }; "event_type.updated": { eventTypeId: string }; "event_type.deleted": { eventTypeId: string };
  "routing_form.submitted": { submissionId: string };
  "contact.created": { contactId: string }; "contact.updated": { contactId: string }; "contact.deleted": { contactId: string; ownerUserId: string };
  "poll.created": { pollId: string }; "poll.vote_created": { pollId: string; participantId: string }; "poll.vote_updated": { pollId: string; participantId: string };
  "poll.booked": { pollId: string; scheduledEventId: string }; "poll.reopened": { pollId: string }; "poll.canceled": { pollId: string };
  "payment.succeeded": { paymentId: string }; "payment.refunded": { paymentId: string };
  "user.created": { userId: string }; "user.deleted": { userId: string; organizationId: string };
  "calendar.connection_broken": { connectionId: string; userId: string };
};
export type DomainEventType = keyof DomainEventMap;
export type Actor = { type: "user" | "system" | "api" | "invitee"; userId?: string; name?: string };

// src/lib/events/publish.ts
export async function publishEvent<T extends DomainEventType>(tx: Tx, type: T, payload: DomainEventMap[T],
  meta: { organizationId: string | null; actor?: Actor }): Promise<string /* domain event id */>;
```

`publishEvent` inserts a `domain_events` row and one `jobs` row per subscriber of that type: job type
`event:{type}:{subscriberKey}`, payload `{ domainEventId, type, payload, meta }`, idempotency key
`{domainEventId}:{subscriberKey}`, priority 10. Subscribers are registered statically in `src/lib/events/registry.ts`
(foundation-platform) which imports subscriber maps from module-owned stub files (created by the foundation):

| Subscriber key | File (owner) | Handles |
|---|---|---|
| `lifecycle` | `src/lib/lifecycle/subscribers.ts` (lifecycle-core) | booking.created (provision + notify; group slots update the one provider event), booking.canceled, booking.rescheduled, booking.host_reassigned, meeting.updated |
| `workflows` | `src/lib/workflows/subscribers.ts` (workflows) | booking.created, booking.canceled, booking.rescheduled, booking.no_show_created, booking.reconfirmed |
| `webhooks` | `src/lib/webhooks/subscribers.ts` (webhooks-embed) | all types that map to webhook events (API-08) |
| `contacts` | `src/lib/contacts/subscribers.ts` (contacts) | booking.created, booking.canceled, booking.rescheduled, user.deleted |
| `links` | `src/lib/links/subscribers.ts` (links-sharing) | booking.created (clear one-off holds, mark shares booked), booking.canceled |
| `polls` | `src/lib/polls/subscribers.ts` (polls-core) | booking.canceled (poll meeting canceled state) |
| `analytics` | `src/lib/analytics/subscribers.ts` (analytics) | booking.created (record `event_scheduled` analytics row) |
| `payments` | `src/lib/payments/subscribers.ts` (payments) | booking.rescheduled (move the payment to the new invitee, PAY-07), booking.canceled (refund reminder data for the host email) |
| `routing` | `src/lib/routing/subscribers.ts` (routing-forms) | booking.created (set `routing_form_submissions.invitee_id` when the invitee has `routing_form_submission_id`, RF-11) |

```ts
// shape of each module subscriber file
export const subscribers: Partial<{ [T in DomainEventType]: (event: { id: string; type: T; payload: DomainEventMap[T];
  meta: { organizationId: string | null; actor?: Actor } }, ctx: JobContext) => Promise<void> }> = {};
```

### 12.2 Jobs

```ts
// src/lib/jobs/index.ts
export type JobContext = { db: DB; jobId: string; attempt: number; now: Date; log: Logger };
export type JobHandler = (payload: any, ctx: JobContext) => Promise<void | { result?: unknown }>;
export async function enqueueJob(dbOrTx: DB | Tx, job: { type: string; payload?: object; runAt?: Date; priority?: number;
  idempotencyKey?: string; groupKey?: string; maxAttempts?: number }): Promise<string | null /* null when deduplicated */>;
export async function cancelJobs(dbOrTx: DB | Tx, filter: { groupKey?: string; type?: string; ids?: string[] }): Promise<number>;
export async function runDueJobs(opts: { budgetMs: number; maxJobs?: number; types?: string[]; workerId?: string }):
  Promise<{ ran: number; succeeded: number; failed: number; remaining: number }>;
export async function maybeRunDueJobs(): Promise<void>;     // throttled opportunistic run (60s per instance + DB lease)
export class RetryLaterError extends Error { constructor(public delayMs: number, message?: string) { super(message) } }
export class PermanentJobError extends Error {}             // mark dead without retry
```

- Claim (`$now` is the app clock from `now()`, never the SQL `now()`, so the E2E fake time reaches the runner):
  `UPDATE jobs SET status='running', locked_until=$now + interval '2 minutes', locked_by=$worker, attempts=attempts+1
  WHERE id IN (SELECT id FROM jobs WHERE status='pending' AND run_at <= $now [AND type filter] ORDER BY priority DESC,
  run_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING *`. Stuck `running` rows with `locked_until < $now` return to
  `pending` at the start of each run. `enqueueJob` always writes `run_at` (`job.runAt ?? now()`).
- Success: `succeeded`, `finished_at`. Failure: `pending` with `run_at = $now + min(30s * 2^(attempts-1), 6h) +- 10%
  jitter`, `last_error`; after `max_attempts`: `dead`. `RetryLaterError` reschedules without counting toward
  `max_attempts` more than once per hour (our choice). `PermanentJobError` marks `dead`. A job whose type has no
  registered handler (a module not built yet) is rescheduled one hour later with `last_error = 'no_handler'` instead of
  failing, so jobs enqueued against a contract (for example `lifecycle.cancel_user_meetings`) run once the owner ships.
- The error classes use plain fields (`class RetryLaterError extends Error { delayMs: number; constructor(delayMs:
  number, message?: string) { super(message); this.delayMs = delayMs; } }`), not parameter properties, because the
  project enables `erasableSyntaxOnly`.
- Registry `src/lib/jobs/registry.ts` (foundation-platform) merges `handlers` and `periodic` exports from module-owned stub files:
  `src/lib/{calendars,lifecycle,workflows,webhooks,links,polls,payments,admin,contacts,meetings,booking}/jobs.ts` plus
  foundation's own (`email.retry`, `sms.retry`, `system.cleanup`) and the event dispatcher (`event:*`).
  ```ts
  // shape of each module jobs file
  export const handlers: Record<string, JobHandler> = {};   // keys prefixed with the module domain, e.g. "workflows.execute"
  export const periodic: { type: string; everyMinutes: number }[] = [];
  ```
  Registered stub files also include `src/lib/settings/jobs.ts` (settings-onboarding: `settings.calendly_import`,
  `settings.account_deletion`) and `src/lib/teams/jobs.ts` (teams-org: `teams.disband_org`).
- Periodic scheduling: on each `runDueJobs` call the runner ensures one pending job per periodic type and time bucket
  (`idempotencyKey = periodic:{type}:{floor(now/everyMinutes)}`).
- Known job types (handlers live in the owning module): `email.retry`, `sms.retry`, `system.cleanup` (daily, GEN-16
  retention: succeeded and canceled jobs older than 14 days, dead jobs older than 90 days, `domain_events` and
  `webhook_deliveries` older than 30 days, `external_events` and `calendar_sync_windows` whose `fetched_at` is older than
  7 days, expired sessions, rate limit buckets older than 2 days, expired files, outbox bodies older than 30 days
  (`body_purged_at`), outbox rows older than 90 days), `booking.reservation_expire`, `lifecycle.provision_retry`,
  `lifecycle.request_reschedule_reminder`, `lifecycle.cancel_user_meetings` (payload `{ userId, scope: "sole_host" |
  "all_hosted", reason }`, enqueued by settings-onboarding account deletion and teams-org member removal),
  `calendars.sync_booked_events`, `calendars.refresh_ics`, `calendars.linked_event_retry`, `workflows.execute`,
  `workflows.backfill` (payload `{ workflowId, eventTypeIds }`, section 14), `webhooks.deliver`,
  `links.holds_sync`, `links.share_reminder`, `links.expire`, `polls.deadline`, `polls.deadline_warning`, `polls.expire`,
  `polls.reminder`, `polls.digest`, `polls.holds_sync`, `polls.notify`, `polls.purge`, `payments.expire_reservation`,
  `payments.refund`, `admin.data_deletion`, `admin.purge`, `contacts.reminder_due`, `meetings.export`,
  `settings.calendly_import`, `settings.account_deletion`, `teams.disband_org`.

### 12.3 Triggers

- `GET /api/cron`: if `CRON_SECRET` is set, require `Authorization: Bearer {CRON_SECRET}` (Vercel Cron sends it; GitHub
  Actions sends it). If not set, run with a 20-second budget at most once per minute globally (DB lease) and log a
  warning (our choice, harmless because jobs are idempotent). Writes `instance_settings.last_cron_at`. `maxDuration =
  300`, budget 250 seconds.
- `vercel.json` cron: `{ "path": "/api/cron", "schedule": "17 13 * * *" }` (Hobby allows daily only).
- `.github/workflows/cron.yml` (DECISIONS: about every 10 minutes): `schedule: "*/10 * * * *"`, `curl -fsS -m 60 -H
  "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"`, skipped when the `APP_URL` variable or `CRON_SECRET`
  secret is missing. Documented caveats (README and docs/DEPLOY.md): GitHub runs scheduled jobs late (often 10 to 60
  minutes) and disables schedules on public repositories after 60 days without activity; on a private repository on
  the free plan every run bills at least one minute, about 4,320 minutes a month against 2,000 included, so private
  repositories should change the line to `*/30` or rely on the pinger below.
- Recommended extra trigger on Hobby (documented in README and docs/DEPLOY.md): a free external pinger (cron-job.org,
  or Upstash QStash schedules) calling `GET {APP_URL}/api/cron` every 5 minutes with the `Authorization: Bearer
  {CRON_SECRET}` header, for reminders that arrive on time.
- Freshness warning: `/api/cron` writes `instance_settings.last_cron_at`; the admin overview and the dashboard banner
  for admins (GEN-20) warn when it is older than 15 minutes.
- `after()` in booking submissions, lifecycle actions and poll votes runs the jobs just enqueued (filtered by type or
  group key) with an 8-second budget; dashboard layouts and public pages call `maybeRunDueJobs()`.
- `src/instrumentation.ts`: when `process.env.VERCEL !== "1"`, `NEXT_RUNTIME === "nodejs"`, `NODE_ENV !== "test"` and
  `E2E_TEST_MODE !== "1"` (background runs would make e2e results nondeterministic; e2e calls `/api/test/run-jobs`),
  start a `setInterval` (every `JOBS_POLL_INTERVAL_SECONDS`, default 30) calling `runDueJobs({ budgetMs: 20000 })`.

### 12.4 Rules for handlers

Re-read state at run time and no-op when no longer applicable; never assume payload freshness. Use idempotency keys
for every external write (`email_outbox.idempotency_key`, `calendar_linked_events.idempotency_key`, Google event id,
Graph `transactionId`, Stripe idempotency keys). Keep each handler under 20 seconds; split work into more jobs otherwise.

---

## 13. Notifications: email, ICS, SMS

### 13.1 Email core (`src/lib/email/**`, foundation-platform)

```ts
export type EmailMessage = {
  to: string[]; cc?: string[]; bcc?: string[]; replyTo?: string | null; fromName?: string | null;
  subject: string; html: string; text: string;
  ics?: { method: "REQUEST" | "CANCEL" | "PUBLISH"; content: string; filename?: string } | null;
  attachments?: { filename: string; contentType: string; content: Buffer | string }[];
  template: string; category: "transactional" | "workflow" | "poll" | "system" | "auth";
  idempotencyKey: string;
  listUnsubscribe?: { url: string; mailto?: string } | null;   // adds List-Unsubscribe and List-Unsubscribe-Post: List-Unsubscribe=One-Click (GEN-08)
  related?: { organizationId?: string; userId?: string; scheduledEventId?: string; inviteeId?: string; pollId?: string; workflowExecutionId?: string };
};
export async function sendEmail(msg: EmailMessage): Promise<{ id: string; status: "sent" | "stored" | "queued" | "failed"; deduplicated: boolean }>;
export function emailTransportName(): "resend" | "smtp" | "outbox";
export function renderEmailLayout(p: { preheader?: string; heading?: string; bodyHtml: string; footerHtml?: string;
  brand: { logoUrl?: string | null; avatarUrl?: string | null; showPoweredBy: boolean; primaryColor?: string }; locale?: string }): { html: string };
export function htmlToText(html: string): string;
export function escapeHtml(s: string): string;
```

`sendEmail` upserts the outbox row by idempotency key (returns early if already `sent` or `stored`), then delivers
synchronously: Resend (attachment `invite.ics`, `text/calendar; charset=utf-8; method=...`, Resend idempotency key) or
SMTP via nodemailer (`icalEvent` alternative plus attachment) or marks `stored`. Failures mark `failed` and enqueue
`email.retry` with backoff (max 8 attempts). `EMAIL_FROM` default `"{AppName}" <notifications@{APP_URL host}>`; dev
logs a one-line summary with the outbox URL. Reply-To: callers pass the host email for invitee-facing meeting emails
unless the organizer's `notification_prefs.noReplyInviteeEmails` is true (NT-20); `replyTo: null` omits the header. The
one-click unsubscribe POST endpoint for polls is `POST /api/public/polls/unsubscribe` (polls-core); its GET page only
renders a button.

### 13.2 Templates

Each module owns its templates as pure functions returning `{ subject, html, text }` and calling
`renderEmailLayout`: lifecycle-core (`src/lib/lifecycle/emails/*`: invitee confirmation, host new event, invitee and
host cancellation, invitee and host reschedule, request reschedule, conference failure, calendar fallback notice; in
calendar invitation mode no invitee or guest confirmation or update is sent and no invitee email carries an ICS,
CAL-12), workflows (renders user-authored bodies with the template engine; localized defaults), polls-core
(`src/lib/polls/emails/*`), links-sharing (share availability, reminder), teams-org (invitation, host added, disband),
calendar-integrations (connection problem), foundation-auth (`src/lib/auth/emails/*`: verify email, reset password, login
method code, welcome), admin-compliance (data deletion complete, export ready), payments (refund notice),
settings-onboarding (import complete, account deleted). Invitee-facing strings come from i18n catalogs (section 19).

Template variables (NT-07) are rendered by foundation `src/lib/template.ts`:

```ts
export type TemplateContext = Record<string, string | number | null | undefined>;
export function renderTemplate(template: string, ctx: TemplateContext, opts?: { escape?: "html" | "none" }): string;  // {{var}} tokens, unknown -> ""
export function listTemplateVariables(): { key: string; label: string; smsOnly?: boolean }[];   // NT-07 list with UI labels
```

foundation-platform also implements `buildMeetingTemplateContext({ scheduledEventId, inviteeId, recipient, locale,
timeZone, timeFormat })` (recipient is "invitee", "host" or "other"; invitee recipients default to the invitee's stored
`timezone` and `time_format`, GEN-06) in `src/lib/template-context.ts` (complete, not a stub: it only reads schema
tables; the foundation F0 creates the signature), used by lifecycle-core (emails, calendar descriptions), workflows and
polls-core, so none of them depends on another for variables.

### 13.3 ICS (`src/lib/email/ics.ts`, owner: foundation-platform; used by lifecycle-core, booking-pages, polls-core and links-sharing)

```ts
export function buildIcs(p: { method: "REQUEST" | "CANCEL" | "PUBLISH"; uid: string; sequence: number; start: Date; end: Date;
  allDayDate?: string; summary: string; description: string; location?: string | null; url?: string | null;
  organizer: { name: string; email: string }; attendees: { name?: string | null; email: string; role?: "REQ" | "OPT" }[];
  status: "CONFIRMED" | "CANCELLED"; prodIdProduct?: string }): string;
```

UTC dates only (tech-reference 10.3 gotcha). UID rules in NT-06: callers pass `uid = scheduled_events.provider_ical_uid`
when the meeting's snapshot `notificationMode` is `calendar_invitation` (only the confirmation page download produces
such files), otherwise `ics_uid` (group invitees and hidden poll invites: `{inviteeId}@{host}`).

### 13.4 SMS (`src/lib/sms/**`, foundation-platform)

```ts
export async function sendSms(p: { to: string; body: string; idempotencyKey: string; related?: {...} }):
  Promise<{ id: string; status: "sent" | "stored" | "failed" | "skipped"; reason?: "opted_out" | "unsupported_country" | "rate_limited" }>;
export function smsTransportName(): "twilio" | "outbox";
```

Twilio REST `POST /2010-04-01/Accounts/{sid}/Messages.json` with Basic auth (`From` or `MessagingServiceSid`, `To`,
`Body`, `StatusCallback` optional). Skips numbers in `sms_opt_outs` and unsupported country codes (+7 Russia, +65
Singapore, +98 Iran). Anti pumping (NT-16): `sendSms` skips with reason `rate_limited` beyond 10 texts per destination
number per 24 hours (rate limit key `sms:to:{hash}`) and pauses a number for 24 hours after 3 failed deliveries;
booking-core limits bookings that carry a text reminder number to 3 per IP per hour. `verifyTwilioSignature({ url,
params, signature })` in `src/lib/sms/twilio-signature.ts` (HMAC-SHA1 of the full URL followed by each POST parameter
name and value sorted by name, base64, keyed with `TWILIO_AUTH_TOKEN`, timing-safe compare) is used by the workflows
inbound webhook, which answers 403 on mismatch.

---

## 14. Workflows engine (`src/lib/workflows/**`, owner: workflows)

- `computeExecutions(workflow, steps, meeting, invitees, trigger)` (pure): returns `{ stepId, inviteeId|null, runAt,
  status: "scheduled" | "skipped", skipReason }[]` per NT-15 rules.
- Subscribers insert `workflow_executions` (idempotency key `{stepId}:{inviteeId ?? "slot:" + scheduledEventId}:{trigger}`,
  without the run time) and `workflows.execute` jobs (`group_key = wf:{inviteeId ?? scheduledEventId}` so cancellations
  call `cancelJobs({ groupKey })`).
- Backfill (NT-15): saving a workflow (create, turn on, add event types, basic notification enabled or retimed in ET-25)
  enqueues `workflows.backfill { workflowId, eventTypeIds }` with idempotency key `backfill:{workflowId}:{updatedAt}`.
  The handler pages through active invitees of active scheduled events of those event types with `start_at > $now`
  (500 per batch, re-enqueueing itself for the next page to stay under 20 seconds), runs `computeExecutions` for the
  `before_start`, `starts` and `ends` steps only, drops results whose `runAt <= $now`, and upserts by idempotency key:
  `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET status = 'scheduled', run_at = excluded.run_at, snapshot =
  excluded.snapshot, skip_reason = null WHERE workflow_executions.status = 'canceled' AND workflow_executions.skip_reason
  in ('unassigned', 'deactivated')`, enqueueing the job only for inserted or revived rows. Unassigning an event type or
  deleting a workflow cancels pending executions with `skip_reason = 'unassigned'`; turning a workflow off leaves them
  scheduled (they skip at send time while off).
- Offsets up to 525,600 minutes (365 days). Default subjects and bodies for basic notifications and gallery templates
  come from the `workflows` i18n namespace in the event type's language (GEN-10); the appended link block ("Need to
  make changes to this event?") is rendered in the invitee's language at send time.
- Cross-tenant checks (section 18.7): `workflow_event_types.event_type_id` must be an event type the actor can edit.
- `seedDemo(tx, { ownerUserId, eventTypeIds })` in `src/lib/workflows/seed.ts` creates the ADM-10 demo workflow.
- `workflows.execute` re-checks eligibility, renders with `buildMeetingTemplateContext` + `renderTemplate`, appends
  cancel and reschedule links when configured, sends via `sendEmail` or `sendSms`, records `meeting_activity`.
- Basic notifications are workflows with `is_basic = true` edited from the event type editor section
  (`EventTypeWorkflowsSection`).
- Templates gallery data in `src/lib/workflows/templates.ts`.

---

## 15. Webhooks (`src/lib/webhooks/**`, owner: webhooks-embed)

- Subscriber maps domain events to webhook events (`booking.created` -> `invitee.created`; `booking.canceled` ->
  `invitee.canceled`; `booking.rescheduled` -> `invitee.canceled` (old, `rescheduled: true`, `new_invitee`) then
  `invitee.created` (new); `booking.no_show_*` -> `invitee_no_show.*`; `routing_form.submitted` ->
  `routing_form_submission.created`; `event_type.*`; `contact.*`; `poll.*` and `payment.succeeded` (extensions)), finds
  matching active subscriptions (organization scope: same org; user scope: the subscription user is a host or owner of the
  object; group scope: user in group), serializes the payload with the REST serializers (`src/lib/api/serializers`,
  api-v1), and inserts `webhook_deliveries` with `ON CONFLICT (subscription_id, domain_event_id, event) DO NOTHING` plus
  a `webhooks.deliver` job only for inserted rows (a retried fan-out never duplicates). Redeliveries and test sends are
  new rows with `redelivery_of_id`.
- Delivery: `POST` JSON envelope `{ event, created_at, created_by, payload }`, headers `Content-Type: application/json`,
  `User-Agent: {AppName}-Webhooks/1.0`, `Calendly-Webhook-Signature` and `X-Webhook-Signature`: `t={unix},v1={hex}` with
  `v1 = HMAC_SHA256(signingKey, t + "." + body)`, `X-Webhook-Id`, `X-Webhook-Event`. Timeouts 10s connect, 15s read
  (`AbortSignal.timeout(25000)` overall). Sent only through `safeFetch` (section 18.9) with `redirect` handling disabled
  (a 3xx counts as a failure), so the URL is validated at create time and on every delivery at connect time.
  `webhook_subscriptions.group_id` must be a group of the actor's organization (section 18.7).
- Retries: 1, 2, 4, 8, 16, 32 minutes then hourly while `now - retry_started_at < 24h`; then the subscription becomes
  `disabled`, pending deliveries `giving_up`, creator emailed. Any success clears `retry_started_at`.

---

## 16. Public REST API (`/api/v1/**`, `src/lib/api/**`, owner: api-v1)

- Route handlers under `src/app/api/v1/<resource>/route.ts` delegate to `src/lib/api/handlers/<resource>.ts`.
- Auth: `Authorization: Bearer kai_pat_...` -> `api_tokens` (hash lookup, not revoked, not expired) -> actor with scopes.
  Session cookies are NOT accepted on `/api/v1` (avoids CSRF). Scope check helper `requireScope("scheduled_events:read")`
  (`:write` implies `:read`).
- URIs: `uri(resource, id) = ${APP_URL}/api/v1/${resource}/${id}`; inputs accept full URIs or bare UUIDs.
- Pagination: keyset on `(sort column, id)`, `page_token` = base64url JSON `{ v: lastSortValue, id, dir }`.
- Serializers produce Calendly field names (SPEC API-02/03; research `calendly-advanced-features.md` section 9) plus
  extension fields under the same objects where Calendly has no equivalent (documented). Busy times type values
  `calendly | reserved | external`.
- Errors via `apiError(status, title, message, details?)`. Rate limit 500 per minute per token (`rate-limit.ts`, headers
  per API-06).
- OpenAPI 3.1 document at `/api/v1/openapi.json` (P3) generated from zod schemas where practical.
- Services used (all through module `index.ts` contracts): booking-core `createBooking` (api actor, limits enforced) and
  `getAvailability`; lifecycle-core cancel and no-show services; links-sharing scheduling link, share and one-off
  services; contacts CRUD; routing-forms read queries; polls-core read queries (MP-33); availability schedules. The
  serializers in `src/lib/api/serializers/**` are also the webhook payload source.
- Calendar feed (API-17): `/api/feeds/[token].ics` and `src/components/developer/calendar-feed-card.tsx`
  (`CalendarFeedCard()`), which calendar-integrations embeds on the Calendar settings page; the token is stored as
  `token_hash` for lookup and `token_enc` so the card can show the URL again.

---

## 17. Embed (`public/embed.js`, owner: webhooks-embed)

- Plain ES2018 IIFE, no build step, no dependencies, under 15KB. Defines `window.Kairos` (a fixed global name, because a
  static file cannot read env vars) and `window.Calendly` as an alias when it is undefined. Visible badge branding text
  ("Powered by {AppName}") comes from the `branding` option or a `data-app-name` attribute, default "Kairos".
- Methods per API-13, including the legacy `showPopupWidget(url)` alias. Builds iframe URLs: original URL +
  `embed_domain={location.host}&embed_type={Inline|PopupWidget|PopupText}` + prefill (`name`, `first_name`, `last_name`,
  `email`, `guests`, `location`, `a1..a10`, `date`) + UTM params (from options or the parent URL) + display params passed
  through + `pageSettings` mapped to BK-26 params (`backgroundColor` -> `background_color`, `textColor` -> `text_color`,
  `primaryColor` -> `primary_color` without `#`, `hideEventTypeDetails` -> `hide_event_type_details=1`,
  `hideLandingPageDetails` -> `hide_landing_page_details=1`, `hideGdprBanner` -> `hide_gdpr_banner=1`).
- Auto-init on DOMContentLoaded for `.calendly-inline-widget[data-url]` and `.kairos-inline-widget[data-url]` except
  elements with `data-auto-load="false"`.
- `public/widget.css`: the same rules the script injects (inline wrapper, popup overlay, close button, spinner, badge),
  served for snippets that link `widget.css`; the script skips injecting a rule set when the stylesheet is already
  present (checks for a marker custom property).
- Listens for `message` events from the iframe origin: `calendly.page_height` resizes inline frames when
  `data-resize="true"`; re-dispatches nothing (parents listen themselves).
- Styles injected once (`<style id="kairos-embed-styles">`): inline wrapper, popup overlay (scrim `rgba(10,37,64,0.5)`),
  close button, spinner, badge button (bottom-right, pill, `#0069FF`).
- Public pages detect embed mode from `embed_type` (BK-25) and post events via `src/lib/embed-events.ts` (foundation
  tiny helper `postEmbedEvent(name, payload)` used by booking-pages, routing-forms and polls-ui).
- Cookies in embed mode: `setEmbedSafeCookie` from `src/lib/cookies.ts` (section 21) sets `SameSite=None; Secure;
  Partitioned` when the request is in embed mode (the page passes `embed=1` to its server action or route handler) and
  `SameSite=Lax` otherwise; the client mirrors the value in localStorage and sends it back in a header when the cookie
  is blocked (booking "Remember this device", poll edit token).
- Payments in embed mode: Stripe Checkout cannot be framed, so without the publishable key `BookingPaymentStep` opens
  the Checkout URL with `window.open` (new tab fallback), listens for `kairos:payment_complete` from the return page
  (`/payments/return?...&embed=1` posts it to `window.opener` and closes), and polls `GET
  /api/public/bookings/{reservationId}/status` every 3 seconds as a fallback (PAY-03).

### 17.1 Event type editor preview contract (event-types-editor and booking-pages)

The editor (ET-29) renders an iframe of `/{handle}/{eventSlug}?preview=1` (unsaved new types:
`/{handle}/__preview__?preview=1`) and posts the unsaved draft with `iframe.contentWindow.postMessage({ type:
"kairos:preview", draft }, origin)` on every change (debounced 150ms). The booking page, when `preview=1` and the viewer
is an editor of that event type (or the owner, for `__preview__`), listens for that message (same origin only), renders
the draft fields (name, color, duration and duration options, locations, description, price, host display) over the
saved data, shows the preview banner, disables booking, and replies `{ type: "kairos:preview_ready" }` once mounted.
The draft type lives in `src/db/types.ts` (foundation):

```ts
export type EventTypePreviewDraft = { name: string; color: string; durationMinutes: number; durationOptions: number[] | null;
  locations: LocationConfig[]; descriptionHtml: string | null; priceMinor: number | null; currency: string | null;
  kind: "solo" | "group"; maxInvitees: number; showRemainingSpots: boolean; timeZoneDisplay: "auto" | "locked"; lockedTimeZone: string | null };
```

---

## 18. Auth, sessions, CSRF, rate limiting, encryption, secrets, safe fetch (foundation F0; OAuth and auth flows: foundation-auth)

### 18.1 Secrets bootstrap (`src/lib/secrets.ts`)

```ts
export async function getSecret(name: "session_secret" | "encryption_key"): Promise<Buffer>;   // 32 bytes
```

Order: env (`SESSION_SECRET`, `ENCRYPTION_KEY`; any string, key = SHA-256 of the string) else `app_secrets` row else
generate 32 random bytes, `INSERT ... ON CONFLICT DO NOTHING`, re-read (race safe). Cached in memory. Documented
trade-off: a DB-stored key protects against token leaks in backups only when `ENCRYPTION_KEY` is set in env; the setup
page and Admin recommend setting it. Changing `ENCRYPTION_KEY` later makes stored tokens unreadable: connections then
show "Action required" (reconnect), never crash.

### 18.2 Crypto (`src/lib/crypto.ts`)

`encrypt(plain): Promise<string>` and `decrypt(blob): Promise<string>` (AES-256-GCM, format `v1.{iv}.{ct}.{tag}`
base64url, key from `getSecret("encryption_key")`), `hashToken(token): string` (SHA-256 hex), `randomToken(bytes = 32):
string` (base64url), `randomCode(len, alphabet)`, `hmacSha256Hex(key, data)`, `timingSafeEqualStr(a, b)`,
`hashPassword`, `verifyPassword` (scrypt N=16384, r=8, p=1, 64-byte key, NFKC), `hashIp(ip)` (HMAC with session
secret, for abuse checks without storing raw IPs), `hashCode(purpose, contextId, code)` (HMAC-SHA256 with the session
secret for 6-digit verification codes, GEN-08; plain SHA-256 of a 6 digit code is brute-forced offline in
milliseconds).

### 18.3 Sessions (`src/lib/auth/session.ts`)

```ts
export const SESSION_COOKIE = "sid";
export async function createSession(userId: string, opts?: { twoFactorPending?: boolean }): Promise<void>; // sets cookie (actions/route handlers only)
export async function getSession(): Promise<{ session: SessionRow; user: UserRow } | null>;   // React cache() per request
export async function requireUser(): Promise<UserRow>;               // redirect("/login?next=...") in RSC; throws AppError(401) in handlers
export async function revokeSession(id: string, opts?: { userId?: string }): Promise<void>; // userId: only that user's session
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<void>;
```

Sliding expiry: 30 days, extended when `last_seen_at` is older than 24 hours (update and cookie refresh happen in a
route handler or server action, never during RSC render; RSC only reads). `two_factor_pending` sessions can only access
`/login/two-factor`.

### 18.4 OAuth (`src/lib/auth/oauth/**`, foundation-auth)

`clients.ts` builds arctic `Google`, `MicrosoftEntraId` (tenant from `MICROSOFT_TENANT`, default `common`) and `Zoom`
clients; `pkce.ts` holds the tech-reference 5.2 fallback (same function names) so `clients.ts` can switch
implementations; `google.ts` and `microsoft.ts` (authorize URL with scopes and extra params, code exchange, refresh
(Microsoft requires scopes and rotates refresh tokens), revoke, id token decode); `intents.ts` (dispatch, section 10.4);
`state.ts` (signed state cookie with intent, verifier, returnTo, invitation token for `accept_invitation`, 10
minutes). Redirect URIs are built from `appUrl()` (never `VERCEL_URL`). `src/lib/auth/signup.ts` exports
`createUserAccount(tx, { email, name, passwordHash?, organizationId?, role?, timezone?, createdViaInvitationId?,
avatarUrl? }): Promise<UserRow>` (creates the user, the handle, a new organization with owner membership unless
`organizationId` is given (then a membership with `role`), the default schedule and the default event type, AU-13);
email signup, OAuth signup, invitation acceptance (teams-org) and the seed all call it.

### 18.5 CSRF

- Server Actions: Next.js origin check (built in); keep `experimental.serverActions.allowedOrigins` empty unless
  `APP_URL` host differs from the request host (then include it).
- Cookie-authenticated route handlers that mutate (POST, PUT, PATCH, DELETE): `assertSameOrigin(request)` from
  `src/lib/http.ts` (accepts when `Origin` matches `APP_URL` or the request host, or when `Sec-Fetch-Site` is
  `same-origin`; rejects otherwise with 403).
- Public JSON endpoints (`/api/public/*`) do not use session auth for writes; they are protected by honeypot, timing,
  rate limits and capability tokens.
- `/api/v1/*` uses bearer tokens only.
- Cookies: `SameSite=Lax` by default (session, OAuth state cookies, required for the top-level redirect back). The two
  cookies that must work inside third-party iframes (booking "Remember this device", poll edit token) use
  `setEmbedSafeCookie` (section 17): `SameSite=None; Secure; Partitioned` in embed mode with a localStorage fallback.
- State-changing links in emails are GET-safe (GEN-08): the GET renders a page with a button that POSTs (server action
  or route handler); single-use tokens are consumed only by the POST. Applies to verify email, email change, poll
  unsubscribe, invitation accept or decline, and any future link.

### 18.6 Rate limiting (`src/lib/rate-limit.ts`)

```ts
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number; resetSeconds: number }>;
export async function assertRateLimit(key: string, limit: number, windowSeconds: number): Promise<void>;  // throws AppError("rate_limited", 429)
```

Fixed window in `rate_limit_buckets` (`INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
RETURNING count`). Keys are namespaced (`login:email:{hash}`, `login:ip:{hashIp}`, `booking:ip:{hashIp}:{eventTypeId}`,
`poll-vote:{pollId}:{hashIp}`, `api:{tokenId}`). Limits in SPEC AU-14, BK-18, MP-30, API-06. `system.cleanup` deletes
buckets older than 2 days.

### 18.7 Authorization (`src/lib/authz.ts`)

```ts
export type ActorCtx = { user: UserRow; orgId: string; orgRole: "owner" | "admin" | "user"; isInstanceAdmin: boolean;
  teamRoles: Map<string, "manager" | "member">; groupAdminOf: Set<string> };
export async function getActorCtx(): Promise<ActorCtx>;                                   // cached per request
export function isOrgAdmin(a: ActorCtx): boolean;                                          // owner or admin
export async function eventTypeAccess(a: ActorCtx, eventTypeId: string): Promise<"owner" | "edit" | "view" | null>;
export async function meetingAccess(a: ActorCtx, scheduledEventId: string): Promise<"manage" | "view" | null>;
export async function teamAccess(a: ActorCtx, teamId: string): Promise<"manage" | "member" | null>;
export async function routingFormAccess(a: ActorCtx, formId: string): Promise<"edit" | "view" | null>;
export async function pollAccess(a: ActorCtx, pollId: string): Promise<"manage" | "owner" | null>;   // creator: owner; co-hosts and org admins: manage
export function assertAccess<T>(value: T | null | false, message?: string): asserts value;   // throws AppError("forbidden", 403)

// Cross-tenant reference checks (GEN-08). Each throws AppError("forbidden") unless the referenced row belongs to the
// expected owner or organization; all accept a Tx so services call them inside their write transaction.
export async function assertScheduleUsableBy(tx: Tx, scheduleId: string, userIds: string[]): Promise<void>;   // schedule owned by one of userIds (or a custom schedule of this event type / link)
export async function assertSameOrgUsers(tx: Tx, orgId: string, userIds: string[]): Promise<void>;
export async function assertCalendarOwnedBy(tx: Tx, calendarId: string, userId: string): Promise<void>;     // writable calendars only when used as destination
export async function assertConferencingConnectionOwnedBy(tx: Tx, connectionId: string, userId: string): Promise<void>;
export async function assertContactOwnedBy(tx: Tx, contactId: string, userId: string): Promise<void>;
export async function assertCouponOwnedBy(tx: Tx, couponId: string, userId: string): Promise<void>;
export async function assertGroupInOrg(tx: Tx, groupId: string, orgId: string): Promise<void>;
export async function assertEventTypesEditable(tx: Tx, a: ActorCtx, eventTypeIds: string[]): Promise<void>;
```

Where they are required (module acceptance tests prove a foreign id returns 403): `event_types.schedule_id`,
`event_types.destination_calendar_id`, `event_types.organizer_user_id` and every `LocationConfig.connectionId`
(event-types-editor); `event_type_hosts.user_id` (same org) and `event_type_hosts.schedule_id` (that host's schedules)
(event-types-editor); `users.destination_calendar_id` (calendar-integrations); `single_use_links.schedule_id` and
`contact_id`, one-off co-hosts (links-sharing); `workflow_event_types.event_type_id` (workflows);
`event_type_coupons.coupon_id` (payments); `webhook_subscriptions.group_id` (webhooks-embed); poll co-hosts (polls-core);
`getBusyForUsers(actor, userIds)` and `/api/polls/busy?hostIds=` (same org only, titles only for the actor, booking-core
and polls-core); API inputs that carry URIs (api-v1).

Rules (TM-01, ET-31): org owners and admins: everything in their org. Event types: personal owner; `event_type_hosts` of
shared and team types get edit; team managers edit their team's types; `event_type_permissions` grant view or edit.
Meetings: hosts manage; event type editors manage; viewers view; org admins manage. Instance admins see admin pages but
not other orgs' meetings unless also org admins (our choice).

### 18.8 Server Action wrapper (`src/lib/actions.ts`)

```ts
export type ActionError = { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError };
export async function runAction<I, O>(schema: z.ZodType<I>, raw: unknown, fn: (input: I, ctx: { actor: ActorCtx; db: DB }) => Promise<O>,
  opts?: { auth?: "user" | "none"; rateLimit?: { key: (input: I) => string; limit: number; windowSeconds: number } }): Promise<ActionResult<O>>;
export function formDataToObject(fd: FormData): Record<string, unknown>;
```

`runAction` parses (zod `safeParse`; `fieldErrors` from `z.flattenError`), authenticates, rate limits, runs, maps
`AppError` to `{ ok: false }`, logs unexpected errors with a request id and returns `{ code: "internal", message:
"Something went wrong. Try again." }`. `redirect()` and `notFound()` are rethrown. Error codes (`src/lib/errors.ts`):
`unauthorized`, `forbidden`, `not_found`, `validation`, `conflict`, `rate_limited`, `slot_unavailable`,
`payment_required`, `verification_required`, `setup_required`, `not_configured`, `internal`.

### 18.9 Safe outbound fetch (`src/lib/net/safe-fetch.ts`, foundation)

```ts
export type SafeFetchOptions = RequestInit & { maxBytes?: number /* 5 MB */; timeoutMs?: number /* 15000 */;
  maxRedirects?: number /* 5; 0 disables following */; allowHttpLocalhost?: boolean /* dev only */ };
export async function safeFetch(url: string | URL, opts?: SafeFetchOptions): Promise<Response>;   // throws SafeFetchError
export class SafeFetchError extends Error { code: "invalid_url" | "blocked_address" | "too_many_redirects" | "too_large" | "timeout"; }
export function isBlockedAddress(ip: string): boolean;   // exported for tests
```

- Only `https:` (plus `http://localhost` when `allowHttpLocalhost` and not on Vercel); `webcal:` is rewritten by
  callers.
- Every hop: resolve the host with `dns.lookup(host, { all: true })` and reject when any address is private (10/8,
  172.16/12, 192.168/16), loopback (127/8, ::1), link-local (169.254/16, fe80::/10), CGNAT (100.64/10), unique local
  (fc00::/7), multicast, unspecified, the cloud metadata addresses (169.254.169.254, fd00:ec2::254) or an IPv4-mapped
  IPv6 form of any of them (`::ffff:a.b.c.d`). The request then uses an `undici` `Agent` whose `connect.lookup` returns
  only the validated addresses, so DNS rebinding between check and connect is impossible.
- `redirect: "manual"`; 3xx responses are followed by `safeFetch` itself (relative `Location` resolved against the
  current URL), each hop re-validated, at most `maxRedirects`.
- The body is streamed and aborted beyond `maxBytes`; the whole call is bounded by `timeoutMs`.
- `SAFE_FETCH_ALLOW_HOSTS` (comma separated host names, ignored when `VERCEL` is set) lets self-hosted instances reach a
  LAN CalDAV server.
- Callers: ICS feeds, CalDAV (tsdav `fetch` override), webhook deliveries (`maxRedirects: 0`), and any future
  user-supplied URL. Never call global `fetch` with a user-supplied URL.

---

## 19. Internationalization (`src/lib/i18n/**`, core: foundation-platform)

- Locales: `en` (complete), `fr`, `es`, `de`, `nl`, `pt` (pt-BR), `it`, `uk` (invitee-facing only, GEN-10).
- Catalog files: `src/lib/i18n/messages/{locale}/{namespace}.ts` exporting a nested object of strings with `{name}`
  placeholders. English files define the key type; other locales are `DeepPartial` of it and fall back to English per
  key.
- Namespaces and owners (English files; each is a stub created by the foundation F0 and then owned by):
  `common` (foundation-platform: time zone picker, cookie banner, footer links incl. "Report abuse", generic errors, date
  words), `zones` (foundation-platform: friendly time zone names keyed by IANA id, matching `src/lib/time/zones.ts`),
  `booking` (booking-pages: every booking page, confirmation and booking error string; booking-core returns error codes
  only), `lifecycle` (lifecycle-core: booking emails and ICS descriptions), `lifecycle-pages` (lifecycle-ui: cancel and
  reschedule pages), `polls` (polls-ui: voter page), `poll-emails` (polls-core: poll emails), `routing` (routing-forms),
  `workflows` (workflows: default basic notification and gallery templates, appended link labels, reconfirm page),
  `payments` (payments: "Continue to payment", hold countdown, "Pay {amount} and schedule", refund messages). The
  dashboard UI is English only.
- `src/lib/i18n/catalog.ts` imports the English namespace files and, for each other locale, only
  `src/lib/i18n/messages/{locale}/index.ts` (owned by localization; the foundation creates each as `export default {}`
  typed `DeepPartial<Catalog>`), so the catalog compiles before any translation exists.
- API: `getT(locale: string, namespace: Namespace): (key: string, vars?: Record<string, string | number>) => string`
  (server and client safe; catalogs are plain objects; client components receive the needed namespace object as props
  from the server to keep bundles small). Dates and times via `Intl.DateTimeFormat(locale, { timeZone, ... })` helpers in
  `src/lib/time/format.ts` (`formatTime(date, zone, locale, hour12)`, `formatDateLong`, `formatTimeRange`,
  `formatZoneLabel(zone, locale)` which reads the `zones` namespace). Landing pages use the owner's locale when
  supported, else `en` (BK-01).

---

## 20. UI kit and design tokens (props stubs: foundation F0; implementation: foundation-ui)

### 20.1 Tokens (`src/app/globals.css`)

CSS variables on `:root` (Classic theme, `calendly-ux-walkthrough.md` 1.1 to 1.4) exposed to Tailwind with `@theme
inline` so runtime overrides work:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
:root {
  --ink: #0a2540; --ink-2: #476788; --ink-3: #a6bbd1; --navy: #0b3558;
  --line: #d4e0ed; --line-medium: #a6bbd1; --canvas: #fafafa; --cloud: #f8f9fb; --pebble: #f0f3f8; --mist: #e7edf6; --white: #ffffff;
  --primary: #006bff; --primary-hover: #004eba; --primary-active: #004796; --primary-text: #004eba;
  --primary-soft: #f4f8ff; --primary-soft-2: #e6f0ff;
  --danger: #d53c00; --danger-text: #b03200; --danger-soft: #ffe2d9;
  --success: #0d804b; --success-text: #0a6439; --success-soft: #cdf9e5;
  --warning: #ffa600; --warning-text: #894800; --warning-soft: #ffe7ba; --info-soft: #e6f0ff;
  --overlay: rgba(10, 37, 64, 0.5); --ribbon: #505960; --ribbon-hover: #40474c;
  --radius-card: 8px; --radius-input: 8px; --radius-pill: 9999px; --radius-slot: 4px;
  --shadow-card: 0 1px 8px 0 rgb(0 0 0 / 0.08); --shadow-pop: 0 2px 15px rgba(0, 0, 0, 0.1);
  --shadow-next: 0 1px 6px 0 rgba(10, 37, 64, 0.1);
  --shadow-embed: 0 16px 48px 0 rgb(25 72 112 / 6%), 0 0 24px 0 rgb(25 72 112 / 6%);
  --primary-color: var(--primary);                   /* public pages: overridden by branding / embed params */
  --public-bg: var(--white); --public-text: var(--ink);
}
@theme inline {
  --font-sans: "Figtree Variable", "Proxima Nova", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --color-ink: var(--ink); --color-ink-2: var(--ink-2); --color-ink-3: var(--ink-3); --color-navy: var(--navy);
  --color-line: var(--line); --color-canvas: var(--canvas); --color-pebble: var(--pebble); --color-mist: var(--mist);
  --color-primary: var(--primary); --color-primary-hover: var(--primary-hover); --color-primary-active: var(--primary-active);
  --color-primary-text: var(--primary-text); --color-primary-soft: var(--primary-soft); --color-primary-soft-2: var(--primary-soft-2);
  --color-brand: var(--primary-color);
  --color-danger: var(--danger); --color-danger-text: var(--danger-text); --color-success: var(--success); --color-warning: var(--warning);
  --radius-card: var(--radius-card); --radius-input: var(--radius-input);
  --shadow-card: var(--shadow-card); --shadow-pop: var(--shadow-pop);
}
```

Typography scale utilities: `text-headline-2` (28/36, 700), `text-headline-3` (24/32), `text-title-lg` (22/28),
`text-title-md` (18/26), `text-title-sm` (16/24), `text-body` (16/1.4), `text-body-md` (14/1.4), `text-body-sm`
(12/1.4), `text-label` (14/20 600), `text-eyebrow` (12px, 700, uppercase, 0.72px tracking). Spacing on the 4px grid.
Motion: `transition-[width] duration-[220ms] ease-out` for the booking card; Next button slide-in keyframes
`translateX(40px)` to 0. Dark mode (GEN-22, P3) redefines the same variables under `:root[data-theme="dark"]` (and
`@media (prefers-color-scheme: dark)` for `system`), applied to the dashboard only; an inline script in the root
layout sets `data-theme` from the user preference before paint. Public pages always render the light classic tokens.

### 20.2 Components (`src/components/ui/*`)

Every component is accessible, typed, client-safe unless stated, and showcased on `/app/dev/ui`. The foundation F0
creates every file below with its final props interface and a minimal unstyled working implementation (so
foundation-auth and every module compile against the real props from day one); foundation-ui then implements the
styling and behavior without changing the props (adding optional props is allowed).

| Component | Notes |
|---|---|
| `Button` | variants `primary`, `secondary`, `tertiary` (link style), `destructive`, `ghost`; sizes `sm`, `md`, `lg`; pill radius; `loading` (spinner, disabled); `asChild` |
| `IconButton` | 32 to 40px circle, `aria-label` required |
| `Input`, `Textarea`, `Label`, `FormField` (label, hint, error, required asterisk, `aria-describedby`), `FieldError` | 40px (app) and 46px (`size="lg"`, booking form) heights |
| `Select` (Radix), `Combobox` (searchable listbox), `NativeSelect` | |
| `Checkbox`, `RadioGroup`, `Switch` (36x20, labels On/Off), `SegmentedControl` (List/Calendar, am/pm 24h) | |
| `Tabs` (underline style), `RouteTabs` (tabs as links for section layouts) | |
| `Dialog`, `Sheet` (side panel, mobile drawer), `AlertDialog` / `ConfirmDialog` (destructive variant) | focus trap, scrim `--overlay` |
| `Popover`, `DropdownMenu` (with `DropdownMenuSwitchItem` for the On/Off row), `Tooltip`, `HoverCard` | |
| `Toast` / `toast()` / `<Toaster />` | bottom-center, success, error, info |
| `Avatar` (image or initials on `--mist`), `AvatarGroup` | |
| `Badge` (`neutral`, `info`, `success`, `warning`, `danger`, `outline`), `Chip` (removable) | |
| `Card`, `SectionCard` (collapsible section row with icon, title, summary, chevron) | |
| `Accordion`, `Collapsible`, `Separator`, `ScrollArea`, `VisuallyHidden`, `Kbd` | |
| `Spinner`, `Skeleton`, `ProgressBar`, `Stepper` (segmented onboarding bar) | |
| `EmptyState` (illustration slot, heading, body, action), `PageHeader` (title, actions, help link), `Banner` (info, success, warning, error, dismissible) | |
| `Table`, `DataTable` (sortable headers, selection, empty, pagination footer), `Pagination` | |
| `SearchInput` (debounced), `CopyButton` (copied state + toast) | |
| `ColorPicker` (10 Calendly swatches + custom hex) | |
| `TimeZoneSelect` (friendly names, current local time, groups, search) and `TimeZoneButton` (booking page style) | uses `src/lib/time/zones.ts` |
| `TimeInput` (typeable 15-minute combobox, parses "9", "930", "9:30 pm", "21:30") | |
| `DurationSelect` (presets + custom min/hrs) | |
| `MonthCalendar` (44px circle days, available/selected/today states, single or multi-select, `--primary-color`, aria labels per GEN-05) | used by booking page, date overrides, polls month view |
| `DateRangePicker`, `DatePicker` | |
| `PhoneInput` (country select with flags, E.164 output, validation) | |
| `RichTextEditor` (contentEditable based: bold, italic, underline, lists, link, variable chips; outputs sanitized HTML and plain text) | used by descriptions, workflows, notes |
| `ChipsInput` (emails, comma/space/Enter separated, validation) | |
| `FileUpload` (image with crop dialog to square or free) | |
| `StickyFooterBar`, `BulkActionBar` | |
| `ProviderLogo` (google, microsoft, outlook, apple, caldav, ics, zoom, meet, teams, jitsi, webex, gotomeeting, stripe, paypal, twilio, webhook) as inline SVG | |
| `PoweredByRibbon` (exact geometry from SPEC BK section intro), `PublicCard`, `PublicPageShell`, `PublicFooterLinks` ("Cookie settings", "Privacy Policy", "Report abuse" mailto per GEN-21), `CookieBanner`, `CookieSettingsDialog` (in `src/components/public/`) | |
| `Logo` (app mark + wordmark from `NEXT_PUBLIC_APP_NAME`) | |
| Shell (`src/components/shell/`): `AppSidebar` (GEN-20: all nav entries, active state, collapse to 72px rail persisted in `users.preferences.sidebarCollapsed`, mobile drawer), `AppHeader` ("Invite user" for admins), `AccountMenu`, `CreateMenu`, `HelpMenu`, `CalendarProblemBanner`, `VerifyEmailBanner`, `TimeZoneMismatchBanner` (GEN-23), `CronWarningBanner` (admins, GEN-16) | |
| `cn()` (`src/lib/cn.ts`), `useDebounced`, `useCopy`, `useMediaQuery`, `useJson` (tiny fetch hook) in `src/lib/client/*` | |

Sidebar entries (foundation-ui, final, GEN-20): Scheduling (`/app/scheduling`, Link icon), Meetings (`/app/meetings`, Calendar),
Availability (`/app/availability`, Clock), Contacts (`/app/contacts`, Users), Workflows (`/app/workflows`, Zap),
Integrations & apps (`/app/integrations`, LayoutGrid), Routing (`/app/routing`, Split); bottom: Analytics
(`/app/analytics`, BarChart3), Admin center (`/app/admin`, ShieldCheck; owners, admins, instance admins), Help (flyout).

---

## 21. Shared helpers (foundation, `src/lib/*.ts`)

| File | Exports |
|---|---|
| `env.ts` | `env` (zod-parsed optional vars, section 22), `features` (`googleOAuth`, `microsoftOAuth`, `zoom`, `email` (resend, smtp or outbox), `sms`, `stripe`, `stripeInline`, `turnstile`, `blob`), `isVercel`, `isProd` |
| `url.ts` | `appUrl()`, `requestOrigin()`, `absoluteUrl(path)`, `publicBookingUrl(...)`, `inviteeUrls(inviteeId)` -> `{ confirmation, cancel, reschedule, reconfirm, ics }`, `joinUrl(scheduledEventId)` |
| `brand.ts` | `APP_NAME`, `appNameSlug` |
| `ids.ts` | `newId()` (uuid), `shortCode()` (`xxxx-xxxx`, alphabet without ambiguous chars), `pollSlug()` (10 chars), `routingSlug()` (`xxx-xxx-xxx`), `jitsiRoom()` |
| `slugs.ts` | `slugify`, `RESERVED_SLUGS`, `isValidHandle`, `isValidEventSlug`, `isHandleAvailable(db, slug)`, `claimHandle(tx, slug, owner)`, `releaseHandle` |
| `errors.ts` | `AppError`, `ErrorCode`, `isAppError`, `notFound()` helpers |
| `http.ts` | `assertSameOrigin`, `json(data, init)`, `apiError`, `getClientIp(request)`, `noStore()` headers |
| `cookies.ts` | `setEmbedSafeCookie(name, value, { maxAgeSeconds, path, embed })`, `readEmbedSafeCookie(request, name)` (cookie or the `x-kairos-fallback-{name}` header from localStorage) |
| `net/safe-fetch.ts` | `safeFetch`, `SafeFetchError`, `isBlockedAddress` (section 18.9) |
| `template.ts` | `renderTemplate`, `listTemplateVariables` (foundation-platform) |
| `template-context.ts` | `buildMeetingTemplateContext` (section 13.2, foundation-platform) |
| `time/now.ts` | `now()` honoring the E2E fake time offset (section 24.2) |
| `html.ts` | `sanitizeRichText(html)`, `richTextToPlain(html)`, `autolink(text)` |
| `pagination.ts` | keyset cursor encode/decode, `paginate(query, opts)` |
| `files.ts` | `saveImageUpload(file, purpose, opts)` (size and type checks, resize via `sharp` is NOT allowed (native): use client-side canvas resize before upload and server-side dimension check), `fileUrl(id)` |
| `audit.ts` | `audit({ action, namespace, targetType, targetId, details, actor? })` |
| `logger.ts` | `log.info/warn/error(event, fields)` structured JSON (redacts tokens and emails) |
| `validation.ts` | zod helpers: `zTimeZone`, `zEmail`, `zHexColor`, `zSlug`, `zHandle`, `zE164`, `zMinuteRange`, `zWeeklyHours`, `zLocationConfig`, `zUrlHttps` |
| `embed-events.ts` | `postEmbedEvent(name, payload)` (client), `isEmbedRequest(searchParams)` |
| `time/zones.ts` | curated zone catalog with friendly names and groups, `friendlyZoneName(zone, locale)`, `currentLocalTime(zone)` |
| `time/luxon.ts` | Luxon setup (`Settings.defaultZone = "utc"`), `localDateOf(ms, zone)`, `startOfLocalDay(date, zone)`, `wallClockToUtc(date, minutes, zone)` |
| `time/format.ts` | locale-aware formatting helpers (section 19) |

---

## 22. Environment variables (all optional)

| Variable | Purpose | Default when unset |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | Postgres (pooled ok) | PGlite locally; setup page on Vercel |
| `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` | direct URL for migrations | falls back to the pooled URL |
| `APP_URL` | canonical origin (OAuth redirects, emails) | Vercel production URL vars, else `http://localhost:3000` |
| `NEXT_PUBLIC_APP_NAME` | product name | `Kairos` |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | crypto keys | generated and stored in `app_secrets` |
| `CRON_SECRET` | protects `/api/cron` | open but throttled (section 12.3) |
| `ADMIN_EMAILS` | extra instance admins | first user only |
| `SIGNUP_POLICY` | `invite_only` / `open` / `domains` override | instance setting |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in, Calendar, Meet, voter free/busy | Google hidden |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` | Microsoft sign-in, Outlook, Teams | hidden; tenant `common` |
| `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom | hidden |
| `JITSI_BASE_URL` | Jitsi server | `https://meet.jit.si` |
| `RESEND_API_KEY` | email via Resend | next option |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | email via SMTP | outbox |
| `EMAIL_FROM` | sender address | `"{AppName}" <notifications@{APP_URL host}>` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` | SMS | SMS stored in log |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | payments; inline Payment Element when the publishable key exists | payments hidden; Checkout redirect without publishable key |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` | PayPal (P3) | hidden |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | bot protection | honeypot and timing only |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for uploads | bytes stored in `files.data` |
| `CALENDAR_CACHE_TTL_SECONDS` | booking page busy cache TTL | 180 |
| `JOBS_POLL_INTERVAL_SECONDS` | self-hosted poller | 30 |
| `PGLITE_DIR` | local DB dir | `.data/pglite` |
| `LOG_LEVEL` | logging | `info` |
| `E2E_TEST_MODE` | enables `/api/test/*` (refused whenever `VERCEL` is set) and disables the in-process poller | off |
| `E2E_SECRET` | required header `x-e2e-secret` for `/api/test/*` (Playwright generates one per run) | unset: `/api/test/*` answers 404 |
| `MIGRATE_ON_PREVIEW` | allow migrations on Vercel preview deployments (Neon preview branching) | off: previews never migrate |
| `TEST_DATABASE_URL` | real Postgres for race tests (`npm run test:pg` sets it from embedded-postgres) | unset: those tests are skipped |
| `SAFE_FETCH_ALLOW_HOSTS` | self-hosted only: private hosts `safeFetch` may reach (LAN CalDAV) | none; ignored on Vercel |
| `NEXT_DIST_DIR` | build output dir (parallel local dev and e2e) | `.next` |

`.env.example` lists all of them with comments. `src/lib/env.ts` parses with zod and never throws for missing optional
values; invalid values log a warning and are treated as unset.

---

## 23. Deployment

- **Vercel**: import the GitHub repo (framework Next.js, build `npm run build`). Attach Neon from the Storage tab (sets
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_*`). Optional vars per section 22. Redeploy. Previews do not
  migrate unless `MIGRATE_ON_PREVIEW=1` (section 5.1); with Neon preview branching enabled, set it for the Preview
  environment only.
- `package.json` scripts: `dev: next dev`, `build: node scripts/migrate.ts && next build`, `start: next start`, `lint:
  eslint`, `typecheck: scripts/heavy.sh tsc npm run typecheck:raw` (`typecheck:raw: next typegen && tsc --noEmit`),
  `typecheck:owned: node scripts/typecheck-owned.mjs` (section 26), `test: vitest run`, `test:pg: node scripts/with-embedded-pg.mjs vitest run
  --project pg`, `test:watch: vitest`, `e2e: playwright test`, `db:generate: drizzle-kit generate`, `db:seed: NODE_OPTIONS=--conditions=react-server tsx scripts/seed.ts`,
  `check:dashes: node scripts/check-dashes.mjs`, `check:bundle: node scripts/check-bundle-size.mjs` (GEN-07: fails when
  the gzipped client JS of `/[handle]/[eventSlug]` exceeds 250KB, read from the build manifest). `"engines": { "node":
  "22.x" }`.
- `next.config.ts`: tech-reference 1.2 config (`typedRoutes`, `agentRules: false`, `serverExternalPackages:
  ["@electric-sql/pglite"]`, `outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] }`, which ships the SQL migrations
  and belongs here, not in `vercel.json`) plus `outputFileTracingExcludes: process.env.VERCEL ? { "/**":
  ["node_modules/@electric-sql/pglite/**"] } : undefined` (keeps PGlite's wasm and data files out of every function;
  `getDb()` never loads it on Vercel), `distDir: process.env.NEXT_DIST_DIR || ".next"`, `headers()` for GEN-08 (framing
  allowed only on embeddable pages, section 4), `images.remotePatterns` for Google and Microsoft avatars.
- `vercel.json`: only the daily cron (section 12.3); it accepts no other keys we need.
- `src/app/sitemap.ts` and `robots.ts` export `dynamic = "force-dynamic"`: nothing that reads the database is prerendered
  at build time (a build without a database URL on Vercel must still succeed).
- `.github/workflows/ci.yml`: install, lint, `check:dashes`, typecheck, vitest, `npm run test:pg` (embedded-postgres, or a
  `services: postgres:17` container with `TEST_DATABASE_URL`), `next build` (with PGlite, no DB URL), `check:bundle`,
  `npm run db:seed` against PGlite (proves the seed and every `seedDemo()` run outside Next), Playwright golden paths
  (`E2E_TEST_MODE=1`, generated `E2E_SECRET`). `.github/workflows/cron.yml`: section 12.3 (every 10 minutes).
- `scripts/migrate.ts` uses relative `.ts` imports and only `src/db/migrate.ts` (section 5.1) and honors `shouldMigrate()`.
  `scripts/seed.ts` runs through `tsx` and may import any module (keep the owner data in `scripts/seed-data.ts`); with
  `--demo` it calls `seedDemo()` from `src/lib/workflows/seed.ts`, `src/lib/routing/seed.ts` and `src/lib/polls/seed.ts`
  when those modules have replaced their stubs (the stubs are no-ops).
- Hobby cron expectations are documented in README and docs/DEPLOY.md: add an external pinger every 5 minutes for
  timely reminders (section 12.3).

---

## 24. Testing strategy

### 24.1 Vitest

- `vitest.config.ts` (tech-reference 12.1): `process.env.TZ = "UTC"`, `resolve.tsconfigPaths`, include
  `src/**/*.test.ts` and `tests/**/*.test.ts`, `testTimeout 30000`, `hookTimeout 60000`, `setupFiles: ["tests/setup.ts"]`
  (sets `NODE_ENV=test`, deterministic `APP_URL=http://localhost:3000`, mocks `server-only`).
- `tests/helpers/db.ts`: `createTestDb()` returns `{ db, close, kind: "pglite" | "postgres" }`: by default a fresh
  in-memory PGlite with `btree_gist`, migrations applied (per test file, about 1 to 6 seconds); when `TEST_DATABASE_URL`
  is set, a fresh database `test_{random}` created on that server (`CREATE DATABASE`, migrations applied, dropped by
  `close`) with a postgres.js pool of 10 connections. `withTestDb(fn)`. The module-level `getDb()` is pointed at the
  test DB via `setDbForTests(db)` exported from `src/db/index.ts`.
- **Race tests need real Postgres**: PGlite is a single backend, so transactions serialize and advisory locks are
  re-entrant within its one session; "10 concurrent bookings produce 1" passes there even with no locking. Every
  concurrency test (bookings, reservations, double click, reschedule races, single-use links, one-offs, polls, payments)
  lives in `*.pg.test.ts` files wrapped in `describe.runIf(process.env.TEST_DATABASE_URL)` and fires the requests through
  separate pool connections with `Promise.all`. `npm run test:pg` (`scripts/with-embedded-pg.mjs`) starts
  `embedded-postgres` on a random port in `.data/embedded-pg`, sets `TEST_DATABASE_URL`, runs the `pg` Vitest project
  (`**/*.pg.test.ts`) and stops the server; CI runs it on every push.
- **Contracts in integration tests**: a module's integration tests `vi.mock` other modules' contract files (for example
  `vi.mock("@/lib/calendars")`) instead of importing live stubs that their owners may be rewriting at the same time;
  only the module's own code and foundation libraries run for real.
- `tests/factories/*.ts` (foundation): `createUser`, `createOrg`, `createTeam`, `createSchedule`, `createEventType`
  (any kind, with hosts and pools), `createBooking` (direct inserts, bypassing the booking service), `createCalendarConnection`
  (fake provider), `createPoll`, `createRoutingForm`, `createContact`, `createWorkflow`; all accept overrides.
- `tests/helpers/fake-providers.ts`: in-memory calendar provider (records calls, returns configured events), fake Zoom,
  fake Stripe, fake Twilio, `mockFetch` router for Google/Graph/Zoom/Stripe REST endpoints; `freezeTime(iso)`.
- Each module writes unit tests next to pure code (`src/lib/<domain>/**/*.test.ts`) and integration tests under
  `tests/<module-id>/**`. Pages and Server Components are covered by Playwright (Vitest cannot render async RSC).

### 24.2 Playwright

- `playwright.config.ts` (tech-reference 12.2) parameterized by env: `E2E_PORT` (default 3313), `E2E_SERVER`
  (`dev` default for module work, `start` for CI), `PGLITE_DIR` (default `.data/pglite-e2e`), `NEXT_DIST_DIR`
  (default `.next-e2e`), `E2E_TEST_MODE=1`, generated `E2E_SECRET`, `timezoneId: "America/New_York"`, `locale: "en-US"`,
  Chromium executable override. `testDir: e2e`, `workers: 1`, `webServer.reuseExistingServer: false` (the dev server
  lives only for the test run, so idle dev servers never recompile on other agents' writes). Module agents run
  Playwright through `scripts/heavy.sh server` (section 26).
- **Parallel module isolation**: each module runs its e2e with its own port, PGlite dir and dist dir:
  `E2E_PORT={port from WORKPLAN} PGLITE_DIR=.data/pglite-e2e-{module} NEXT_DIST_DIR=.next-e2e-{module} npx playwright
  test e2e/{module}`. Never share a PGlite dir between processes. Never run `playwright install`.
- Test API (`/api/test/*`): answers 404 unless `E2E_TEST_MODE=1`, `process.env.VERCEL` is not set (any Vercel deployment,
  production or preview, refuses it, because a preview may point at the production database), and the request carries
  `x-e2e-secret` equal to `E2E_SECRET` (the Playwright config generates a random secret per run and passes it to the
  web server and to the fixtures). Routes: `POST /api/test/reset` (truncate all
  tables), `POST /api/test/seed` (`{ scenario: "owner" | "team" | "empty" }`), `POST /api/test/login` (`{ email }` sets a
  session cookie), `POST /api/test/run-jobs`, `GET /api/test/outbox?to=` (latest emails with links extracted), `POST
  /api/test/fake-calendar` (inject external busy events for a user via the fake provider registry), `POST
  /api/test/time` (sets a fake `now` offset honored by `src/lib/time/now.ts`, foundation; every module must use `now()`
  from there instead of `new Date()` for business logic, and pass it as `$now` into SQL instead of the database `now()`,
  section 5.2, so the jobs runner, reservation expiry, rate limit windows and session expiry all see the fake time). The
  in-process poller is off in E2E mode (section 12.3); tests run jobs explicitly with `/api/test/run-jobs`.
- `e2e/fixtures/index.ts`: `test` extended with `api` (test API client), `loginAs(page, email)`, `seed(scenario)`,
  `outbox`, `axe` check helper.
- Golden paths (golden-path-qa module): owner signs up and onboards; visitor books the seeded 30-minute event and gets
  the confirmation email; invitee reschedules and cancels from email links; host sees and cancels in Meetings; Google
  sign-in with mocked OAuth connects a calendar and blocks a busy slot; poll create, vote, book; routing form to booking;
  embed page receives `calendly.event_scheduled`; mobile booking at 390x844; axe checks.

### 24.3 Static checks

`npm run lint`, `npm run typecheck` (whole project) and `npm run typecheck:owned -- <paths...>` (runs `tsc --noEmit
--incremental --tsBuildInfoFile .cache/tsc-<module>.tsbuildinfo` under `scripts/heavy.sh tsc` and prints only
diagnostics in the given paths; module agents use it to ignore other modules' in-progress errors), `npm run
check:dashes` (GEN-11), `npm run check:bundle` (GEN-07, after a build).

---

## 25. Module contracts (stubs created by the foundation)

The foundation core (F0) creates every file below with the exact exported signatures, a header comment `// OWNER:
<module-id>. Stub created by foundation; the owner replaces the implementation and must keep these signatures.`, and
stub behavior that keeps the app working (empty results, no-ops, or a clear `AppError("not_configured")`). Consumers
code against these signatures from day one. Owners may add exports but must not remove or change listed ones (if a
change is unavoidable, keep a compatible overload and note it in the module report). A contract file must compile at
every moment (section 26 rule 17).

**Foundation split handovers** (F0 creates, then hands to F1, F2 or F3):

| File | Owner | Exports (summary) | Stub behavior |
|---|---|---|---|
| `src/components/ui/*.tsx`, `src/components/shell/*.tsx`, `src/components/public/*.tsx` | foundation-ui | every component of section 20.2 with its final props interface | minimal unstyled but working markup (accessible names, native inputs) |
| `src/app/layout.tsx`, `globals.css` (tokens verbatim from 20.1), `not-found.tsx`, `error.tsx`, `global-error.tsx`, `icon.svg`, dashboard `layout.tsx`/`page.tsx`/`loading.tsx`/`error.tsx`/`not-found.tsx`, section layouts (scheduling, availability, integrations, admin, settings), integrations hub page, `/app/dev/ui` | foundation-ui | pages and layouts | minimal shell with every sidebar link (requireUser from `src/lib/auth/session.ts`) |
| `src/lib/auth/signup.ts`, `src/lib/auth/oauth/**`, `src/lib/auth/{login,password-reset,verify-email,policy,guards,totp}.ts`, `src/lib/auth/emails/**`, `(auth)/**`, `setup/page.tsx`, `/api/auth/**` | foundation-auth | `createUserAccount(tx, input)` (section 18.4), OAuth start and callback with intents, `verifyTotp`, `signupPolicyAllows(email)`, pages | `createUserAccount` fully implemented by F0 (the seed and factories need it); pages are placeholders; OAuth routes answer "not configured" |
| `src/lib/email/**` (`sendEmail`, `renderEmailLayout`, `htmlToText`, `escapeHtml`, `buildIcs`), `src/lib/sms/**` (`sendSms`, `verifyTwilioSignature`) | foundation-platform | section 13 | `sendEmail` stores the message in `email_outbox` with status `stored`; plain layout; `buildIcs` minimal valid VEVENT in UTC; `sendSms` stores in `sms_messages` |
| `src/lib/jobs/**`, `src/lib/events/**` (types verbatim from 12.1, `publishEvent`, `registry.ts`) | foundation-platform | section 12 | `enqueueJob`, `cancelJobs` and `publishEvent` real (inserts); `runDueJobs` runs due jobs sequentially without backoff; registry imports every module stub below |
| `src/lib/template.ts`, `src/lib/template-context.ts` | foundation-platform | section 13.2 | `renderTemplate` real (simple `{{var}}` replace); context builder returns names, dates and URLs only |
| `src/lib/i18n/{index,locales,catalog}.ts`, `messages/en/{common,zones}.ts` | foundation-platform | section 19 | `getT` with English fallback; minimal keys |
| `src/app/api/cron/route.ts`, `src/instrumentation.ts` | foundation-platform | section 12.3 | cron calls `runDueJobs`; poller off |

**Module contracts:**

| File | Owner | Exports (summary) | Stub behavior |
|---|---|---|---|
| `src/lib/slots/types.ts` | slot-engine | section 7.2 verbatim | types only |
| `src/lib/holidays/index.ts` | slot-engine | `getHolidays(country, year)`, `blockedDatesFor(country, overrides, rangeStart, rangeEnd, zone)`, `SUPPORTED_COUNTRIES` | `[]`, `[]`, the 10 country codes (availability and F0's `loadScheduleInput` import it while slot-engine builds it) |
| `src/lib/availability/index.ts` | availability | `getDefaultSchedule(userId)`, `loadScheduleInput(scheduleId, range)`, `ensureDefaultSchedule(tx, userId, opts)` | foundation implements minimal versions (used by signup) |
| `src/lib/calendars/index.ts` | calendar-integrations | section 10.2 (incl. `replaceImportedBusy`) | no calendars; `replaceImportedBusy` returns `{ connectionId: "" }` |
| `src/lib/calendars/oauth-connect.ts` | calendar-integrations | `handleConnectCallback(ctx: OAuthCallbackContext): Promise<Response>` | redirect to calendar settings with "not available" |
| `src/lib/calendars/jobs.ts` | calendar-integrations | `handlers`, `periodic` | empty |
| `src/lib/conferencing/index.ts` | conferencing | section 11, plus `resolveConferenceOrganizer(meeting)` | Jitsi works, others `failed/not_configured` |
| `src/components/event-types/location-editor.tsx` | event-types-editor | `LocationEditor({ value: LocationConfig[]; onChange(v: LocationConfig[]): void; mode: "multiple" \| "single"; allowedKinds?: LocationKind[]; userId: string; disabled?: boolean })` | text inputs for physical, custom and phone kinds (used by settings-onboarding VID-15, links-sharing, polls-ui) |
| `src/lib/booking/index.ts` | booking-core | sections 8 and 9 (`getAvailability`, `getBusyForUsers`, `createBooking`, `createReservation`, `completeReservation`, `resolveTargetBySlugs`, `resolveTargetByCode`, `lockHostsInTx`, `lockInviteeForChangeInTx`) | throw `not_configured` (locks: real, they are two SQL statements) |
| `src/lib/booking/jobs.ts` | booking-core | `handlers` (`booking.reservation_expire`) | empty |
| `src/lib/lifecycle/index.ts` | lifecycle-core | `cancelInvitee`, `cancelScheduledEvent`, `rescheduleInvitee`, `moveScheduledEvent({ scheduledEventId, start, end, actor })` (in-place move: same row, SEQUENCE + 1, calendar and conference update, update emails; poll rebook MP-21), `requestReschedule`, `markNoShow`, `unmarkNoShow`, `updateMeetingNotes`, `setInviteeLimit`, `removeInvitee`, `blockInvitee`, `unblockInvitee`, `reassignHost`, `retryProvisioning`, `applyExternalCalendarChange`, `resolveActiveInviteeChain(inviteeId)` | throw `not_configured` (`resolveActiveInviteeChain` real: follows `new_invitee_id`) |
| `src/lib/lifecycle/subscribers.ts`, `src/lib/lifecycle/jobs.ts` | lifecycle-core | `subscribers`, `handlers` (incl. `lifecycle.cancel_user_meetings`), `periodic` | empty |
| `src/lib/workflows/subscribers.ts`, `src/lib/workflows/jobs.ts`, `src/lib/workflows/seed.ts` | workflows | `subscribers`, `handlers` (incl. `workflows.backfill`), `periodic`, `seedDemo(tx, ctx)` | empty, no-op |
| `src/components/workflows/event-type-workflows-section.tsx` | workflows | `EventTypeWorkflowsSection(props: { eventTypeId: string \| null; canEdit: boolean })` | "Save the event type to add workflows." placeholder |
| `src/components/workflows/host-phone-verification.tsx` | workflows | `HostPhoneVerification(props: { userId: string })` (NT-17 card embedded by settings-onboarding) | "Phone verification is not available yet." |
| `src/lib/webhooks/subscribers.ts`, `src/lib/webhooks/jobs.ts` | webhooks-embed | `subscribers`, `handlers` | empty |
| `src/components/embed/add-to-website-dialog.tsx` | webhooks-embed | `AddToWebsiteDialog(props: { open: boolean; onOpenChange(v: boolean): void; target: { kind: "event_type" \| "landing_page" \| "team_page" \| "routing_form"; url: string; name: string } })` | dialog with the plain link |
| `src/components/developer/calendar-feed-card.tsx` | api-v1 | `CalendarFeedCard()` (API-17 card for the Calendar settings page) | renders nothing |
| `src/lib/contacts/index.ts` | contacts | `searchContacts(ownerUserId, q, limit)`, `upsertContactForInvitee(inviteeId)` | `[]`, no-op |
| `src/lib/contacts/subscribers.ts`, `src/lib/contacts/jobs.ts` | contacts | `subscribers`, `handlers` | empty |
| `src/components/contacts/contact-picker.tsx`, `contact-hover-card.tsx` | contacts | `ContactPicker({ value, onChange, placeholder? })` (value `{ name, email, contactId? }`), `ContactHoverCard({ email, name, children })` | plain inputs / passthrough |
| `src/lib/links/index.ts` | links-sharing | `resolveBookingCode(code)`, `consumeLinkInTx(tx, { kind, id, scheduledEventId })` (locks the link or one-off row `FOR UPDATE`, lock order step 2), `getReservedIntervals(userIds, start, end)` | null, no-op, `{}` |
| `src/lib/links/subscribers.ts`, `src/lib/links/jobs.ts` | links-sharing | `subscribers`, `handlers`, `periodic` | empty |
| `src/components/links/{book-meeting-dialog,single-use-link-dialog,share-event-type-dialog,offer-times-dialog,share-availability-dialog}.tsx` | links-sharing | `BookMeetingDialog({ open, onOpenChange, eventTypeId?, contact? })`, `SingleUseLinkDialog({ open, onOpenChange, eventTypeId })`, `ShareEventTypeDialog({ open, onOpenChange, eventTypeId })`, `OfferTimesDialog({ open, onOpenChange, eventTypeId })`, `ShareAvailabilityDialog({ open, onOpenChange, eventTypeId?, singleUseLinkId?, contact? })` | "Coming soon" dialogs |
| `src/lib/polls/index.ts` | polls-core | `getPollReservedIntervals(userIds, start, end)`, `markPollBookedInTx(tx, { pollId, optionId, scheduledEventId, inviteeIds, bookedByUserId })` (locks the poll row after host locks, validates open or closed and not booked, sets booked) | `{}`, throw `not_configured` |
| `src/lib/polls/voter-oauth.ts` | polls-core | `handleVoterFreeBusyCallback(ctx: OAuthCallbackContext): Promise<Response>` | 404 |
| `src/lib/polls/subscribers.ts`, `src/lib/polls/jobs.ts`, `src/lib/polls/seed.ts` | polls-core | `subscribers`, `handlers`, `periodic`, `seedDemo(tx, ctx)` | empty, no-op |
| `src/lib/payments/index.ts` | payments | `isPaymentsConfigured()`, `beginPayment({ reservationId, returnUrl, embed })`: `Promise<{ type: "redirect"; url; expiresAt } \| { type: "popup"; url; expiresAt } \| { type: "inline"; clientSecret; publishableKey } \| { type: "free" }>`, `getPaymentForInvitee(inviteeId)` | `false`, throw `not_configured`, `null` |
| `src/lib/payments/jobs.ts`, `src/lib/payments/subscribers.ts` | payments | `handlers`, `subscribers` (booking.rescheduled, booking.canceled) | empty |
| `src/components/payments/{event-type-payment-section,booking-payment-step,payment-summary}.tsx` | payments | `EventTypePaymentSection({ value: PaymentSettings; onChange; eventTypeId; disabled? })`, `BookingPaymentStep({ reservationId; amountMinor; currency; terms; embed: boolean; onComplete(inviteeId) })`, `PaymentSummary({ inviteeId })` | "Connect Stripe to collect payments" / renders nothing |
| `src/lib/routing/subscribers.ts`, `src/lib/routing/seed.ts` | routing-forms | `subscribers` (booking.created), `seedDemo(tx, ctx)` | empty, no-op |
| `src/lib/analytics/track.ts`, `src/lib/analytics/subscribers.ts` | analytics | `trackPublicEvent(input)`, `subscribers` | no-op |
| `src/components/analytics/trackers.tsx` | analytics | `PublicTrackers({ hostUserId: string; consent: "granted" \| "denied" \| "unknown" })` (GA4 and Meta Pixel loader for public pages) | renders nothing |
| `src/lib/teams/index.ts` | teams-org | `listTeamsForUser(userId)`, `getTeamBySlug(slug)`, `listOrgMembers(orgId)`, `getTeamPublicProfile(slug)` (name, avatar, welcome message, public event types for BK-02), `getPendingInvitation(token)`, `acceptInvitationInTx(tx, { invitationId, userId })` | minimal DB queries (accept: creates the membership and marks accepted) |
| `src/lib/teams/jobs.ts` | teams-org | `handlers` (`teams.disband_org`) | empty |
| `src/lib/settings/jobs.ts` | settings-onboarding | `handlers` (`settings.calendly_import`, `settings.account_deletion`) | empty |
| `src/lib/admin/jobs.ts` | admin-compliance | `handlers`, `periodic` | empty |
| `src/components/admin/my-sent-emails.tsx` | admin-compliance | `MySentEmails({ userId: string })` (ADM-04 per-user outbox list embedded in Settings > Notifications) | "No emails yet." |
| `src/lib/meetings/jobs.ts` | meetings-dashboard | `handlers` (`meetings.export`) | empty |
| `src/lib/i18n/messages/en/{booking,lifecycle,lifecycle-pages,polls,poll-emails,routing,workflows,payments}.ts` | booking-pages, lifecycle-core, lifecycle-ui, polls-ui, polls-core, routing-forms, workflows, payments | catalog objects | minimal keys |
| `src/lib/i18n/messages/{fr,es,de,nl,pt,it,uk}/index.ts` | localization | `export default {} satisfies DeepPartial<Catalog>` | empty (English fallback) |
| `public/embed.js`, `public/widget.js`, `public/widget.css` | webhooks-embed | embed script and stylesheet | comment-only stubs |

Shared types used by these signatures live in foundation files (`src/db/types.ts`, `src/lib/events/types.ts`,
`src/lib/slots/types.ts` is owned by slot-engine but the foundation creates it from section 7.2 verbatim so other modules
can import types before the engine exists; the slot-engine module owns it afterwards).

---

## 26. Conventions for module agents

1. **Ownership**: edit only files under your `ownedPaths`. Import freely from `readOnlyDeps` and any foundation file.
   Never edit `src/db/**`, `drizzle/**`, foundation shared libs, other modules' files, `package.json` (ask in your report
   for new dependencies), or the sidebar. If you need something changed elsewhere, write
   `docs/schema-requests/<your-module-id>.md` (schema) or note it in your final report (other code).
2. **Server/client boundaries**: server-only modules import `"server-only"`. Client components start with `"use
   client"` and receive serializable props. No DB access in client code.
3. **Reads** in Server Components via `src/lib/<domain>` query functions. **Mutations**: route-local actions in
   `src/app/.../<route>/actions.ts` (thin: parse, call domain service, `revalidatePath`) or shared actions in
   `src/lib/<domain>/actions.ts`. Both files start with `"use server"` and export only async functions defined with
   `export async function name(...)`, each calling `runAction(schema, input, fn)`. Domain services take validated input
   and an actor and contain all business logic (testable without Next).
4. **Validation**: zod schemas for every input (actions, route handlers, API), shared ones in
   `src/lib/<domain>/schemas.ts`. Return field errors for forms.
5. **Authorization**: every action and route handler calls `requireUser()` / `getActorCtx()` and an access helper from
   `src/lib/authz.ts`. Proxy checks are never sufficient.
6. **Errors**: throw `AppError` with a code; never leak internals; log with `log.error`. User-facing copy follows the
   spec strings and GEN-11 (no em or en dashes).
7. **UI**: use `src/components/ui` primitives and tokens only (no ad hoc colors; `text-ink`, `border-line`,
   `bg-primary`, `text-brand` on public pages). Loading states (`loading.tsx` skeletons, button `loading`), empty states,
   success toasts ("Changes saved", "Link copied"), confirmation dialogs for destructive actions. Keyboard and screen
   reader support per GEN-05. Mobile layouts per GEN-04.
8. **Time**: use `now()` from `src/lib/time/now.ts` for business logic, Luxon via `src/lib/time/*`, store UTC, compute in
   schedule zones, display with `src/lib/time/format.ts`.
9. **Side effects**: never call providers (email, SMS, calendars, conferencing, webhooks) directly from request code;
   publish a domain event or enqueue a job in the same transaction, then `after()` to run it. Exceptions: synchronous
   provider calls needed to answer the request (OAuth exchange, CalDAV validation, Stripe session creation).
10. **Typed routes**: use concrete string paths with template literals; cast DB-sourced paths `as Route`. Type page
    props explicitly (`{ params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] |
    undefined>> }`) rather than relying on generated `PageProps`.
11. **Public pages** read branding and embed params, honor `--primary-color`, post embed events, set `noindex` where
    required, and render the public shell components.
12. **Tests**: unit tests for pure logic, PGlite integration tests for services (with other modules' contracts
    `vi.mock`ed), race tests in `*.pg.test.ts` on real Postgres (section 24.1), Playwright for pages (your own port,
    PGlite dir and dist dir). Run `npm run typecheck:owned -- <your paths>`, `npx vitest run <your test paths>`, `npm run
    lint -- <your paths>` and your e2e (through `scripts/heavy.sh server`) before finishing.
13. **Performance**: avoid N+1 queries (use joins or `inArray`), paginate lists, keep client bundles lean (no heavy
    libraries on public pages).
14. **Accessibility and copy**: labels for every input, `aria-live` for async results, visible focus, no color-only
    signals; exact Calendly strings where the spec quotes them; "(our choice)" copy can be refined but keep meaning.
15. **Git**: do not commit; the orchestrator commits. Do not modify `.gitignore`, CI or config files you do not own.
16. **Reporting**: finish with a summary of what was built (spec IDs), what is stubbed or deferred, schema requests,
    dependency requests, and any contract changes.
17. **Contract churn**: other agents import your contract files (`index.ts`, stub components, `subscribers.ts`,
    `jobs.ts`) while you work. Implement in new files and switch the contract file's re-exports only when your tests are
    green; never leave a contract file failing to compile or with a changed signature, even for a minute.
18. **Machine budget** (4 vCPU, 15 GB RAM, no swap): the orchestrator runs at most 4 agents at a time. Every heavy
    command goes through `scripts/heavy.sh <slot> <command...>`, which takes `flock -n` on one of two lock files per slot
    (`/tmp/kairos-heavy-server.{1,2}.lock` for `next dev`, `next start`, `next build` and Playwright;
    `/tmp/kairos-heavy-tsc.{1,2}.lock` for `tsc` and `next typegen`), retrying every 10 seconds, so at most two of each
    run at once. `npm run typecheck:owned -- <paths>` runs `tsc --noEmit --incremental --tsBuildInfoFile
    .cache/tsc-<module-id>.tsbuildinfo` under the tsc slot and prints only diagnostics in the given paths. Never leave a
    dev server running after tests.
19. **Typed routes and typegen**: `next typegen` writes the shared route types read by every `tsc`; run it only through
    `scripts/heavy.sh tsc npx next typegen`, and run it again after you add a route that did not exist as a placeholder
    (otherwise typed links to it fail for everyone).
20. **Clock in SQL**: pass `$now` from `now()` into every business-time comparison (due jobs, leases, expiry, rate
    windows, session expiry); never compare with the database `now()` (section 5.2).
21. **User-supplied URLs** are fetched only with `safeFetch` (section 18.9); cross-tenant ids are checked with the
    section 18.7 helpers inside the write transaction.
22. **TypeScript**: erasable syntax only (`erasableSyntaxOnly`): no enums, parameter properties or namespaces; use
    string unions and plain fields.
23. **Email links** never change state on GET (GEN-08); cookies used inside embeds go through `setEmbedSafeCookie`.
