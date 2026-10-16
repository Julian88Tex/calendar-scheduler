# Technical Reference (verified)

Audience: every implementer agent working in `/home/user/calendar-scheduler`.
Date verified: 2026-10-11/12. Everything below was checked against the installed packages (type definitions, source, bundled docs) in a scratch project, and most of it was executed (builds, unit tests, e2e) against PGlite, a real PostgreSQL 16 server and a real CalDAV server (Radicale). Where something could not be executed (third party OAuth providers, Vercel itself) it was checked against the vendor's own machine readable spec or official docs, and is marked.

Legend used in this document:

- **[RUN]** executed locally and passed (Next build + `next start`, Vitest, Playwright, Node scripts).
- **[TYPES]** read from the installed package's `.d.ts` / source.
- **[DOCS]** read from official docs (Next.js docs bundled in `node_modules/next/dist/docs/`, Google discovery document, Microsoft Learn, Vercel docs, Neon docs).
- **[NOT LIVE]** could not be called from this sandbox (egress policy); based on docs/SDK types only.

---

## 0. Exact versions (npm `latest` on 2026-10-11)

| Package | Version | Notes |
| --- | --- | --- |
| next | **16.4.0** | Turbopack is the default bundler for dev and build |
| react / react-dom | **19.3.0** | |
| typescript | **5.9.3** (pin `^5.9`) | npm `latest` is 7.0.2 (Go native, no JS API). `typescript-eslint` peer range is `>=4.8.4 <6.1.0`, so stay on 5.x. create-next-app also writes `typescript: ^5`. |
| @types/react, @types/react-dom | 19.3.0 | |
| @types/node | 22.x (pin `^22`) | Vitest 5 peer: `^22.0.0 \|\| >=24.0.0` |
| tailwindcss / @tailwindcss/postcss | **4.3.3** | |
| drizzle-orm | **0.45.4** | (1.0 is only on `beta`/`rc` tags) |
| drizzle-kit | **0.31.11** | |
| postgres (postgres.js) | **3.4.9** | |
| @electric-sql/pglite | **0.5.8** | Embeds PostgreSQL **18.3** (wasm32) |
| arctic | **3.7.0** | **Deprecated on npm (July 2026)**, see section 5 |
| luxon / @types/luxon | **3.7.2** / 3.7.6 | |
| zod | **4.6.6** | |
| tsdav | **2.4.0** | |
| node-ical | **0.27.3** | ESM, ships types, has `expandRecurringEvent` |
| ical-generator | **11.1.2** | |
| resend | **6.32.1** | |
| nodemailer / @types/nodemailer | **10.1.0** / 8.0.2 | nodemailer ships no types; @types 8.0.2 type-checks fine with 10.x [RUN] |
| vitest | **5.0.3** | uses vite 8.3.4; engines: node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| @playwright/test | **1.64.0** | expects Chromium revision 1248; sandbox has 1194 (see section 12) |
| rrule | 2.8.1 | CommonJS for Node ESM, see section 8.4 |
| eslint / eslint-config-next | 9.39.5 / 16.4.0 | stay on ESLint 9: `eslint-plugin-react` peer is `^9.7` max |

Runtime here: Node **22.22.0** (ICU 77.1, tzdata 2025b). Recommend `"engines": { "node": "22.x" }` in package.json so Vercel matches the sandbox (Vercel accepts `24.x`, `22.x`, `20.x`).

Node 22.22 runs `.ts` files natively (type stripping is on by default) [RUN]: `node scripts/migrate.ts` works. Imports inside such scripts must use relative paths with the `.ts` extension (no `@/` aliases), which requires `"allowImportingTsExtensions": true` in tsconfig (allowed because `noEmit: true`) [RUN].

---

## 1. Next.js 16.4

The authoritative docs for the installed version live in `node_modules/next/dist/docs/` (472 markdown files). Read them instead of relying on memory.

### 1.1 What `create-next-app@16.4.0 --ts --tailwind --eslint --app --src-dir` generates [RUN]

```
.gitignore  AGENTS.md  README.md  eslint.config.mjs  next-env.d.ts  next.config.ts
package.json  package-lock.json  tsconfig.json
public/{file,globe,next,vercel,window}.svg
src/app/{favicon.ico,globals.css,layout.tsx,page.tsx}
```

- ESLint is still offered (`--eslint`, or `--biome`, or `--no-linter`). It generates a flat config:
  ```js
  // eslint.config.mjs (generated)
  import { defineConfig, globalIgnores } from "eslint/config";
  import nextVitals from "eslint-config-next/core-web-vitals";
  import nextTs from "eslint-config-next/typescript";
  export default defineConfig([...nextVitals, ...nextTs, globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"])]);
  ```
  `next lint` was removed in v16 and `next build` no longer lints. The script is `"lint": "eslint"`.
- **Defaults changed:** the generated `next.config.ts` enables `cacheComponents: true` and `partialPrefetching: true`, and wires Tailwind through a Turbopack loader (`@tailwindcss/turbopack`) instead of PostCSS. There is no `postcss.config.mjs`. We deliberately deviate from both (see 1.2, 1.3, 2).
- Generated `package.json` scripts: `dev: next dev`, `build: next build`, `start: next start`, `lint: eslint` (no `--turbopack` flags needed, Turbopack is default; `--webpack` opts out).
- `tsconfig.json` (generated): target ES2017, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `paths: {"@/*": ["./src/*"]}`, includes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`.
- `layout.tsx` uses the global `LayoutProps<"/">` helper type.
- `next dev` writes into `.next/dev` (separate from `next build` output), so dev and build can run concurrently.
- `next dev` **creates/updates `AGENTS.md`** with a managed block when it detects an AI agent. Set `agentRules: false` in next.config to stop it (the generated text also contains em dashes, which violate our style rule) [DOCS][RUN].

### 1.2 Recommended `next.config.ts` (verified build + start) [RUN]

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,                                  // stable top-level option in 16.x
  agentRules: false,                                  // do not let `next dev` write AGENTS.md
  serverExternalPackages: ["@electric-sql/pglite"],   // load PGlite (wasm + data files) with native require
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] }, // ship SQL migrations with every function
  // cacheComponents: intentionally NOT enabled (see 1.3)
};
export default nextConfig;
```

Notes:
- Turbopack already traced `path.join(process.cwd(), "drizzle")` automatically (the `.nft.json` of every route listed `drizzle/0000_init.sql` and `meta/_journal.json` even without the include). Keep `outputFileTracingIncludes` anyway as a belt and braces measure; verified both ways [RUN].
- PGlite also worked when bundled (without `serverExternalPackages`) [RUN]; externalizing is still recommended.
- Removed in 16: `eslint` key, `serverRuntimeConfig`/`publicRuntimeConfig`, `experimental.ppr`, `experimental.dynamicIO`, `experimental.turbopack` (now top-level `turbopack`), `skipMiddlewareUrlNormalize` (now `skipProxyUrlNormalize`).
- Server Actions options live under `experimental.serverActions` (`bodySizeLimit` default 1MB, `allowedOrigins`) [DOCS].

### 1.3 Rendering and caching: DO NOT enable Cache Components

Verified behavior with `cacheComponents: true` (the new create-next-app default): a page that reads `cookies()` or queries the DB outside `<Suspense>` **fails `next build`** [RUN]:

```
Error: Route "/": Next.js encountered uncached or runtime data during prerendering.
`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of `<Suspense>` ...
  - [stream] Provide a placeholder with `<Suspense fallback={...}>` around the data access
  - [cache] ... cache the access with "use cache"
  - [block] Set `export const instant = false` to allow a blocking route
```

With Cache Components, `Date.now()`, `new Date()`, `Math.random()` and `crypto.randomUUID()` in server components also require `await connection()` + `<Suspense>` or `"use cache"`. Even with `instant = false` on the root layout, the build prerender still executed `getDb()` (it created the PGlite directory during `next build`) [RUN]. For an app where nearly every page is per-user, time-dependent and DB-driven, and that many agents build in parallel, this is too fragile.

**Decision for this repo:** leave `cacheComponents` unset (it defaults to off) and put this in the root layout [RUN]:

```tsx
// src/app/layout.tsx
export const dynamic = "force-dynamic"; // every route renders at request time; no DB access during `next build`
```

Verified: without it, a page that queries the DB but reads no cookies (`/static-db`) was prerendered at build time (`○` in the build table) and the build itself opened the database. With it, every route is `ƒ (Dynamic)` and the build touched no DB [RUN]. In this (previous) model, `fetch` is not cached by default and `unstable_cache` exists, but we do not need caching. `revalidatePath("/x")` still works to refresh client router data after a Server Action [RUN].

The `instant` and `"use cache"` APIs only exist with Cache Components; do not use them.

### 1.4 Async request APIs (sync access fully removed in 16) [DOCS][RUN]

```tsx
// src/app/u/[slug]/page.tsx
export default async function Page({ params, searchParams }: PageProps<"/u/[slug]">) {
  const { slug } = await params;                       // Promise<{ slug: string }>
  const sp = await searchParams;                        // Record<string, string | string[] | undefined>
  ...
}
// layout: export default function L({ children, params }: LayoutProps<"/x/[id]">) { const { id } = await params ... }
// route:  export async function GET(req: NextRequest, ctx: RouteContext<"/api/x/[id]">) { const { id } = await ctx.params }

import { cookies, headers } from "next/headers";
const jar = await cookies();            // get/getAll/has in Server Components; set/delete ONLY in Server Actions or Route Handlers
const h = await headers();              // read-only
```

`PageProps`, `LayoutProps`, `RouteContext` are **global types generated into `.next/types`** by `next dev`, `next build` or `npx next typegen`. A bare `tsc --noEmit` on a clean checkout fails with `Cannot find name 'PageProps'` until `next typegen` has run [RUN]. Scripts: `"typecheck": "next typegen && tsc --noEmit"`.

Cookies cannot be set during Server Component rendering (streaming already started). Set them in Server Actions, Route Handlers or `proxy.ts`.

### 1.5 `middleware.ts` is renamed to `proxy.ts` [DOCS][RUN]

- File: `src/proxy.ts` (same level as `src/app`). Export a function named `proxy` (or default). `middleware.ts` still works but is deprecated.
- **Runtime is always Node.js** and cannot be configured; setting `runtime` in proxy throws. (Edge requires keeping the deprecated `middleware.ts`.)
- Without a `matcher` it runs on every request including `_next/static`. Server Actions are POSTs to the page route, so a matcher that excludes a path also skips its actions: **always re-check auth inside every Server Action and Route Handler**.

```ts
// src/proxy.ts  (verified: redirected /app/* to /login when no cookie, added header elsewhere)
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/app") && !request.cookies.has("sid")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
```

Keep proxy cheap (cookie presence check only). Do the real session lookup in server code (`getSession()` reading the DB). Proxy can set response cookies (e.g. sliding session refresh) via `res.cookies.set(...)`. The second argument `event: NextFetchEvent` exposes `event.waitUntil(promise)`.

### 1.6 Route Handlers [DOCS][RUN]

```ts
// src/app/api/health/route.ts
import { after, type NextRequest } from "next/server";
export const maxDuration = 60;             // seconds (Vercel limit: Hobby 300, Pro 800)

export async function GET(request: NextRequest, ctx: RouteContext<"/api/health">) {
  after(() => console.log("ran after response", request.nextUrl.pathname));
  return Response.json({ ok: true });
}
```

- GET handlers are not cached by default; with `dynamic = "force-dynamic"` in the root layout everything is dynamic anyway. Route handlers under `app/api/**` are not affected by layouts, but GET handlers that read `request` are dynamic.
- OAuth callback pattern: `const res = NextResponse.redirect(new URL("/app", req.url)); res.cookies.set("sid", token, {...}); return res;` or `(await cookies()).set(...)` then `redirect("/app")` (from `next/navigation`).

### 1.7 Server Actions [DOCS][RUN]

```ts
// src/app/(app)/event-types/actions.ts
"use server";                     // a "use server" file may only export async functions
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

const Input = z.object({ email: z.email() });

export async function createUser(formData: FormData) {
  const session = await requireSession();                     // ALWAYS re-check auth here
  const parsed = Input.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, errors: z.flattenError(parsed.error).fieldErrors };
  await db.insert(...);
  (await cookies()).set("theme", "dark", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  after(async () => { /* email, webhooks, calendar sync */ });
  revalidatePath("/");
  redirect("/");                                              // throws; call last, outside try/catch
}
```

Verified end to end in Chromium: form submit -> action -> DB insert -> cookie set (httpOnly) -> redirect -> fresh data [RUN]. Client side, use React 19 `useActionState(action, initialState)` which returns `[state, formAction, pending]`; the action signature becomes `(prevState, formData)`. New v16 cache helpers `updateTag`, `refresh` (from `next/cache`) exist; `revalidateTag(tag)` now needs a second argument (`revalidateTag(tag, "max")`). CSRF: actions compare `Origin` with host; behind a proxy that rewrites host add `experimental.serverActions.allowedOrigins`.

### 1.8 `after()` from `next/server` [DOCS][RUN]

- Runs after the response is sent; works in Server Components, Server Actions, Route Handlers and proxy. Runs even when the response errored, or `redirect()`/`notFound()` was called.
- Bounded by the route's `maxDuration`. On Vercel it is implemented with `waitUntil`.
- In Server Components you cannot call `cookies()`/`headers()` inside the callback; read them before and capture the values. In Route Handlers and Server Actions you can.
- Verified: log line `health after /api/health` appeared after the response, in both `next start` and `next dev` [RUN].

Pattern for opportunistic job processing: `after(() => runDueJobs({ budgetMs: 5000 }))` in the booking action and in authenticated layouts.

### 1.9 typedRoutes [RUN]

With `typedRoutes: true`, `next typegen`/`next build` type-checks `<Link href>`, `redirect()`, `router.push()`:

```tsx
<Link href="/nope">                         // TS2322 error: not a route
<Link href={`/u/${slug}`}>                  // OK (template literal matching a dynamic segment)
<Link href={`/u/${slug}?month=2026-03`}>    // OK (query string allowed)
<Link href={fromDb as Route}>               // OK: import type { Route } from "next"
redirect("/nope-redirect")                  // TS2345 error
```

Gotcha: `<Link href={{ pathname: "/u/[slug]", query: { slug } }}>` **type-checks but throws at runtime** in the App Router ("Dynamic href `/u/[slug]` found in <Link> ... not supported") [RUN]. Always use concrete string paths.

### 1.10 Build pipeline gotchas [RUN]

- `next build` = Turbopack compile, then **type-check of the entire tsconfig project** (Next 16.4 runs the project-local `tsc` CLI by default, `experimental.useTypeScriptCli`). Type errors in `tests/**` or `e2e/**` or `scripts/**` **fail the production build** (observed). Keep tests type-clean or point `typescript.tsconfigPath` at a narrower tsconfig.
- No lint during build.
- `next start` requires a prior `next build` in the same `.next`.
- Build output no longer prints size / First Load JS.

### 1.11 Reading the deployment URL on Vercel [DOCS]

All of these are exposed at build and runtime when "Automatically expose System Environment Variables" is on (default). None include the `https://` scheme:

| Var | Value |
| --- | --- |
| `VERCEL` | `1` |
| `VERCEL_ENV` | `production` \| `preview` \| `development` |
| `VERCEL_TARGET_ENV` | same, or custom environment name |
| `VERCEL_URL` | unique deployment host `*.vercel.app` (protected by Deployment Protection on previews) |
| `VERCEL_BRANCH_URL` | `<project>-git-<branch>-<team>.vercel.app` |
| `VERCEL_PROJECT_PRODUCTION_URL` | shortest production custom domain, else the production `vercel.app` domain. **Set even in preview deployments.** |
| `VERCEL_REGION` | runtime only |
| `VERCEL_DEPLOYMENT_ID`, `VERCEL_PROJECT_ID`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF` | |

```ts
// src/lib/url.ts
import { headers } from "next/headers";
export function appUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
/** Origin of the current request (best for links shown back to the same user). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : appUrl();
}
```

OAuth redirect URIs must be stable: build them from `appUrl()` (production domain), never from `VERCEL_URL`.

---

## 2. Tailwind CSS v4.3 with PostCSS [RUN]

```bash
npm i -D tailwindcss@4 @tailwindcss/postcss@4
```

```js
// postcss.config.mjs (ESLint warns import/no-anonymous-default-export; assign to a const to silence)
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

```css
/* src/app/globals.css */
@import "tailwindcss";

/* class-based dark mode: put class="dark" on <html> (default v4 dark: uses prefers-color-scheme) */
@custom-variant dark (&:where(.dark, .dark *));

/* design tokens -> utilities: bg-brand-500, text-brand-600, rounded-card, font-sans ... */
@theme {
  --color-brand-50: oklch(0.97 0.02 255);
  --color-brand-500: oklch(0.55 0.2 255);
  --color-brand-600: oklch(0.49 0.2 255);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --radius-card: 0.75rem;
}

/* runtime-switchable tokens: `inline` makes utilities reference the var directly */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
:root { --background: #ffffff; --foreground: #0a2540; }
.dark { --background: #0b1220; --foreground: #e6edf6; }

@layer base { body { @apply bg-background text-foreground; } }
```

Verified in the compiled CSS: `.bg-brand-50{background-color:var(--color-brand-50)}`, `.rounded-card{border-radius:var(--radius-card)}`, `.dark\:bg-black:where(.dark,.dark *){...}`, and `body{background-color:var(--background);...}` (the `inline` effect). Only theme variables that are used are emitted (unused `--color-brand-500` was absent); use `@theme static { ... }` if every variable must always exist (e.g. for user-chosen brand colors set via inline style). Other v4 directives available: `@utility`, `@variant`, `@source`, `@plugin`, `@config`.

No `tailwind.config.js` is needed. Content detection is automatic. For dark mode without flash, set the `dark` class from a cookie in the root layout (server side) rather than a client effect.

---

## 3. Drizzle ORM 0.45.4 + drizzle-kit 0.31.11

### 3.1 Schema split across files [RUN]

```ts
// src/db/schema/users.ts
import { relations, sql } from "drizzle-orm";
import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";              // cross-file import is fine (relations use callbacks)

export const userRole = pgEnum("user_role", ["owner", "admin", "member"]);
export type UserPrefs = { weekStart: 0 | 1; timeFormat: "12h" | "24h" };

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),                 // gen_random_uuid()
  email: text("email").notNull(),
  slug: text("slug").notNull(),
  role: userRole("role").notNull().default("member"),
  timezone: text("timezone").notNull().default("UTC"),
  prefs: jsonb("prefs").$type<UserPrefs>().notNull().default({ weekStart: 0, timeFormat: "12h" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [                                                    // third arg returns an ARRAY in 0.45
  uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`), // expression index
  uniqueIndex("users_slug_uq").on(t.slug),
]);

export const usersRelations = relations(users, ({ many }) => ({ bookings: many(bookings) }));
```

```ts
// src/db/schema/bookings.ts
import { relations } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const bookingStatus = pgEnum("booking_status", ["pending", "confirmed", "cancelled"]);
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: bookingStatus("status").notNull().default("confirmed"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),   // JS Date in/out
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  inviteeEmail: text("invitee_email").notNull(),
  sequence: integer("sequence").notNull().default(0),
  uid: text("uid").notNull(),
}, (t) => [
  index("bookings_host_start_idx").on(t.hostId, t.startsAt),
  unique("bookings_host_start_uq").on(t.hostId, t.startsAt),          // table-level UNIQUE constraint
]);
export const bookingsRelations = relations(bookings, ({ one }) => ({
  host: one(users, { fields: [bookings.hostId], references: [users.id] }),
}));
```

```ts
// src/db/schema/index.ts  (barrel; pass `* as schema` to drizzle() for db.query)
export * from "./users";
export * from "./bookings";
```

Other pg-core column builders available: `bigint, bigserial, boolean, char, cidr, date, doublePrecision, inet, integer, interval, json, jsonb, numeric, real, serial, smallint, text, time, timestamp, uuid, varchar, vector`. `timestamp(..., { mode: "string" })` returns strings instead of Dates. The relational query builder in 0.45 is **RQB v1** (`relations()` helpers); `defineRelations` (RQB v2) only exists in the 1.0 betas, do not use it.

Drizzle has no builder for `EXCLUDE` constraints or extensions; use a custom migration (3.3).

### 3.2 drizzle-kit config and generation [RUN]

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",     // glob or array; barrel file being matched is harmless
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/unused" }, // not needed for `generate`
  strict: true,
  verbose: true,
});
// For drizzle-kit studio/push against a local PGlite dir: { dialect: "postgresql", driver: "pglite", dbCredentials: { url: "./.data/pglite" } }
```

```bash
npx drizzle-kit generate --name init            # -> drizzle/0000_init.sql + drizzle/meta/{_journal.json,0000_snapshot.json}
npx drizzle-kit generate --custom --name btree_gist   # empty SQL file + journal entry for hand-written SQL
```

Generated SQL uses `--> statement-breakpoint` separators. Commit the whole `drizzle/` folder (including `meta/`). Because many agents work concurrently, only ONE agent (the schema owner) should run `drizzle-kit generate`; two concurrent generations produce conflicting journal entries.

### 3.3 Custom migration example (no double booking at DB level) [RUN on PGlite and PG16]

```sql
-- drizzle/0001_btree_gist.sql
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("host_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" <> 'cancelled');
```

Overlap insert fails with SQLSTATE `23P01` (exclusion_violation); back-to-back slots (`[)` ranges) are allowed [RUN]. **PGlite must be constructed with the extension** or the migration fails with `extension "btree_gist" is not available` (see 4). Neon and Supabase support `btree_gist`.

### 3.4 Runtime migrations, guarded and pooler-safe [RUN]

Drizzle's own `migrate()` (`drizzle-orm/postgres-js/migrator`, `drizzle-orm/pglite/migrator`) reads `<folder>/meta/_journal.json` with `fs`, and applies pending files inside one transaction, tracking them in `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)`, comparing the last `created_at` with each journal `when`. It has no lock. A session-level `pg_advisory_lock` is NOT safe behind PgBouncer transaction pooling (Neon `-pooler` host) because lock and unlock can land on different server connections. Use this drop-in, table-compatible migrator instead (verified: 5 concurrent "cold starts" against PG16 applied each migration exactly once; idempotent on PGlite):

```ts
// src/db/migrate.ts
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";   // public export
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export async function migrateGuarded(
  db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
  opts: { migrationsFolder?: string; migrations?: MigrationMeta[]; lockKey?: number } = {},
) {
  const migrations = opts.migrations ?? readMigrationFiles({ migrationsFolder: opts.migrationsFolder ?? "./drizzle" });
  const lockKey = opts.lockKey ?? 727001;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);       // released at COMMIT/ROLLBACK
    await tx.execute(sql`create schema if not exists "drizzle"`);
    await tx.execute(sql`create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`);
    const res = await tx.execute(sql`select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`);
    const rows = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as { created_at: string | number }[];
    const last = rows[0] ? Number(rows[0].created_at) : -1;
    let applied = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const stmt of m.sql) if (stmt.trim()) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${m.hash}, ${m.folderMillis})`);
      applied++;
    }
    return applied;
  });
}
```

Caveat: everything runs in one transaction, so `ALTER TYPE ... ADD VALUE` works (PG 12+) but the new enum value cannot be used later in the same migration batch; put such usage in a later deploy.

Making the migrations available at runtime on Vercel: the folder is traced automatically by Turbopack when referenced as `path.join(process.cwd(), "drizzle")` and also forced via `outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] }` [RUN, checked `.next/server/app/**/*.nft.json`]. `process.cwd()` is the project root in `next start` and on Vercel. Fallback if tracing ever fails: generate a module at build time (`JSON.stringify(readMigrationFiles({migrationsFolder:"./drizzle"}))` into `src/db/migrations.generated.json`) and call `migrateGuarded(db, { migrations })`.

Build-time migration script (run in `"build": "node scripts/migrate.ts && next build"`) [RUN]:

```ts
// scripts/migrate.ts   (plain Node 22 runs it; relative .ts imports, no "@/" aliases)
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrateGuarded } from "../src/db/migrate.ts";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log("[migrate] no database URL, skipping"); process.exit(0); }
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try { console.log(`[migrate] applied ${await migrateGuarded(drizzle(client), { migrationsFolder: "./drizzle" })} migration(s)`); }
finally { await client.end({ timeout: 5 }); }
```

### 3.5 The DB client (driver selection, singleton, zero-config) [RUN on PGlite, PG16, next start, next dev, Playwright]

```ts
// src/db/index.ts
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { migrateGuarded } from "./migrate";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;   // satisfied by both drivers; db.query.* fully typed
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const g = globalThis as typeof globalThis & { __db?: Promise<DB> };   // survives HMR and module duplication

export const dbUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
const directUrl = () => process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || dbUrl();

async function createPostgres(url: string): Promise<DB> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const mig = postgres(normalizePgUrl(directUrl()!), { max: 1, prepare: false, onnotice: () => {} });
  try { await migrateGuarded(drizzle(mig), { migrationsFolder: MIGRATIONS_FOLDER }); } finally { await mig.end({ timeout: 5 }); }
  const client = postgres(normalizePgUrl(url), { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(client, { schema }) as unknown as DB;
}

async function createPglite(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = process.env.PGLITE_DIR ?? (process.env.NODE_ENV === "test" ? undefined : path.join(process.cwd(), ".data", "pglite"));
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });    // PGlite does NOT mkdir -p
  const client = new PGlite({ dataDir, extensions: { btree_gist } });              // options-object form ONLY
  const db = drizzle(client, { schema });
  await migrateGuarded(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!g.__db) g.__db = (dbUrl() ? createPostgres(dbUrl()!) : createPglite()).catch((e) => { g.__db = undefined; throw e; });
  return g.__db;
}

/** db.execute() returns an array (RowList) on postgres-js but { rows, fields, ... } on pglite. */
export const rowsOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

/** postgres.js forwards unknown URL params to the server as GUCs. Neon URLs may contain
 *  `channel_binding=require`, which vanilla Postgres rejects: 42704 unrecognized configuration parameter. */
export function normalizePgUrl(raw: string) {
  const u = new URL(raw);
  for (const k of ["channel_binding", "gssencmode", "sslcompression"]) u.searchParams.delete(k);
  return u.toString();
}
export { schema };
```

postgres.js facts [TYPES/RUN]: `?sslmode=require` in the URL is understood (mapped to `ssl`); `prepare: false` is required for PgBouncer transaction mode (Neon pooled `DATABASE_URL`, Supabase port 6543); default `max` is 10; `idle_timeout` default is none (set 20s on serverless). On Vercel `NODE_ENV` is `production`, and the writable FS is only `/tmp`, so **PGlite must never be used on Vercel**: detect `process.env.VERCEL === "1" && !dbUrl()` and render the setup page instead of calling `getDb()`.

### 3.6 Queries, transactions, row locks, advisory locks, errors [RUN]

```ts
import { and, asc, eq, gte, lt, sql, inArray } from "drizzle-orm";

// relational query (needs schema passed to drizzle())
const u = await db.query.users.findFirst({
  where: (t, { eq }) => eq(t.slug, "a"),
  with: { bookings: { orderBy: (b, { asc }) => [asc(b.startsAt)] } },
});

// insert ... returning, upsert
const [row] = await db.insert(users).values({ email, slug }).returning();
await db.insert(users).values({ email, slug }).onConflictDoNothing({ target: users.slug });
await db.insert(users).values(v).onConflictDoUpdate({ target: users.slug, set: { email: v.email } });

// booking critical section: serialize per host, then lock rows
const created = await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hostId}, 0))`); // per-host mutex, auto-released
  const clash = await tx.select().from(bookings)
    .where(and(eq(bookings.hostId, hostId), lt(bookings.startsAt, end), gte(bookings.endsAt, start)))
    .for("update");                                   // 'update' | 'no key update' | 'share' | 'key share'; { skipLocked: true } / { noWait: true }
  if (clash.length) throw new SlotTakenError();
  return tx.insert(bookings).values({...}).returning();
}, { isolationLevel: "read committed" });            // options: isolationLevel, accessMode, deferrable
// job queue claim:  .for("update", { skipLocked: true })
```

Errors: drizzle 0.45 wraps driver errors in **`DrizzleQueryError`**; the original error is on `.cause` [RUN]:

| | postgres.js | PGlite |
| --- | --- | --- |
| SQLSTATE | `err.cause.code` (e.g. `"23505"`) | `err.cause.code` |
| constraint name | `err.cause.constraint_name` | `err.cause.constraint` |

```ts
export function pgCode(e: unknown) { const c = (e as { cause?: { code?: string } })?.cause; return c?.code ?? (e as { code?: string })?.code; }
export function pgConstraint(e: unknown) { const c = (e as { cause?: Record<string, string> })?.cause; return c?.constraint_name ?? c?.constraint; }
// 23505 unique_violation, 23P01 exclusion_violation, 23503 foreign_key_violation, 40001 serialization_failure, 40P01 deadlock
```

Raw `db.execute(sql\`...\`)` results on BOTH drivers return `timestamptz` as **strings** (e.g. `"2026-10-11 23:36:06.543172+00"`) and `bigint` as strings; typed select builders return `Date`s. Use `new Date(str)` for raw rows [RUN].

---

## 4. PGlite 0.5.8 (local dev and tests)

- In-memory: `new PGlite()` or `new PGlite({ extensions })` or `new PGlite("memory://", opts)`. File persistence (Node): `new PGlite({ dataDir: ".data/pglite", extensions })`.
- **Gotcha [RUN]:** `new PGlite(undefined, { extensions })` silently ignores the options (extension then "not available"). Always use the single options-object form.
- **Gotcha [RUN]:** the data directory's parent must exist; PGlite does a non-recursive `mkdir` (`ENOENT ... mkdir '.../.data/pglite'`). `fs.mkdirSync(dir, { recursive: true })` first.
- Extensions are opt-in imports: `import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"`. Available contrib: amcheck, auto_explain, bloom, btree_gin, btree_gist, citext, cube, dict_int, dict_xsyn, earthdistance, file_fdw, fuzzystrmatch, hstore, intarray, isn, lo, ltree, moddatetime, pageinspect, pg_buffercache, pg_stat_statements, pg_surgery, pg_trgm, pg_visibility, pg_walinspect, pgcrypto, seg, tablefunc, tcn, tsm_system_rows, tsm_system_time, unaccent, uuid_ossp. `gen_random_uuid()` is core (no extension needed).
- PGlite is single-connection and single-process: never open the same `dataDir` from two processes (e.g. `next dev` and `drizzle-kit studio`, or dev and Playwright). Use `PGLITE_DIR=.data/pglite-e2e` for e2e.
- Next.js: `serverExternalPackages: ["@electric-sql/pglite"]` (bundled also worked). Keep the client in a `globalThis` singleton (HMR re-evaluates modules).
- Vitest: in-memory instance per test file is fast (about 1 to 6 s cold for migrations). Pattern:
  ```ts
  const client = new PGlite({ extensions: { btree_gist } });
  const db = drizzle(client, { schema });
  beforeAll(async () => { await migrateGuarded(db); });
  afterAll(async () => { await client.close(); });
  ```
  Under Vitest `NODE_ENV === "test"`, so `getDb()` above falls back to in-memory PGlite automatically [RUN].
- Supports `pg_advisory_xact_lock`, `hashtextextended`, `FOR UPDATE`, exclusion constraints, `tstzrange` [RUN].

---

## 5. OAuth with arctic 3.7.0

**Status:** `npm view arctic deprecated` -> "Package no longer supported." The arctic docs site says Arctic was deprecated in July 2026 and points to replacement example code in the repo's `/code` directory. Its deps `@oslojs/crypto`, `@oslojs/encoding`, `@oslojs/jwt` carry the same notice. The package still installs and works (pure `fetch`, verified URL generation and id-token decoding) [RUN]. It is tiny, so the risk is mostly the npm deprecation warning. Two acceptable options:

1. Use arctic as decided (API below).
2. Use the verified in-repo helper `src/lib/oauth/pkce.ts` (below), whose authorize URL is byte-identical to arctic's Google output [RUN].

### 5.1 arctic API [TYPES/RUN]

```ts
import { Google, MicrosoftEntraId, Zoom, generateState, generateCodeVerifier, decodeIdToken, OAuth2RequestError, ArcticFetchError } from "arctic";

const google = new Google(clientId, clientSecret, `${appUrl()}/api/auth/google/callback`);
const state = generateState(), codeVerifier = generateCodeVerifier();   // 43-char base64url each
const url = google.createAuthorizationURL(state, codeVerifier, [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/calendar.events",        // create/edit/delete events
  "https://www.googleapis.com/auth/calendar.readonly",      // calendarList + events.list for conflict checks
]);
url.searchParams.set("access_type", "offline");             // get a refresh token
url.searchParams.set("prompt", "consent");                  // force refresh token on re-consent
url.searchParams.set("include_granted_scopes", "true");     // incremental auth
// store state + codeVerifier in short-lived httpOnly cookies (10 min, sameSite lax), redirect to url

// callback
const tokens = await google.validateAuthorizationCode(code, codeVerifier);   // throws OAuth2RequestError (.code) / ArcticFetchError
tokens.accessToken(); tokens.accessTokenExpiresAt(); tokens.hasRefreshToken() && tokens.refreshToken();
tokens.idToken(); tokens.scopes(); tokens.data;                              // raw JSON
const claims = decodeIdToken(tokens.idToken()) as { sub: string; email: string; email_verified: boolean; name?: string; picture?: string };
const refreshed = await google.refreshAccessToken(refreshToken);            // Google usually returns NO new refresh token: keep the old one
await google.revokeToken(token);

const ms = new MicrosoftEntraId("common", clientId, clientSecret, `${appUrl()}/api/auth/microsoft/callback`);
ms.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite", "OnlineMeetings.ReadWrite"]);
await ms.validateAuthorizationCode(code, codeVerifier);
await ms.refreshAccessToken(refreshToken, scopes);          // scopes REQUIRED here; Microsoft rotates refresh tokens: always persist the new one

const zoom = new Zoom(clientId, clientSecret, `${appUrl()}/api/integrations/zoom/callback`);
zoom.createAuthorizationURL(state, codeVerifier, []);       // Zoom scopes are configured on the Marketplace app
await zoom.validateAuthorizationCode(code, codeVerifier);
await zoom.refreshAccessToken(refreshToken);                // Zoom rotates refresh tokens: persist the new one
```

All three use PKCE S256 and send the client secret with HTTP Basic auth (`client_secret_basic`; Google and Microsoft discovery docs list it as supported [DOCS]). Endpoints (from arctic source and OIDC discovery docs [DOCS]):

| | authorize | token | userinfo |
| --- | --- | --- | --- |
| Google | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | `https://openidconnect.googleapis.com/v1/userinfo` |
| Microsoft (tenant `common`) | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` | `.../common/oauth2/v2.0/token` | `https://graph.microsoft.com/oidc/userinfo` |
| Zoom | `https://zoom.us/oauth/authorize` | `https://zoom.us/oauth/token` | `GET https://api.zoom.us/v2/users/me` |

Google revoke: `https://oauth2.googleapis.com/revoke`. The Microsoft `common` issuer is `https://login.microsoftonline.com/{tenantid}/v2.0` (templated), so do not validate `iss` against a fixed string; the id token came straight from the token endpoint over TLS, so decoding without signature verification is acceptable.

Provider console notes [NOT LIVE]: Google apps in "Testing" publishing status get refresh tokens that expire after 7 days and are limited to test users; calendar scopes are "sensitive" and need verification for public use. Microsoft app registration must allow "Accounts in any organizational directory and personal Microsoft accounts" for tenant `common`.

### 5.2 Drop-in replacement (no dependency) [RUN]

```ts
// src/lib/oauth/pkce.ts
import { createHash, randomBytes } from "node:crypto";
export const generateState = () => randomBytes(32).toString("base64url");
export const generateCodeVerifier = () => randomBytes(32).toString("base64url");
export const codeChallengeS256 = (v: string) => createHash("sha256").update(v).digest("base64url");
export type TokenResponse = { access_token: string; token_type: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string };

export function buildAuthorizeUrl(endpoint: string, p: { clientId: string; redirectUri: string; state: string; codeVerifier: string; scopes: string[]; extra?: Record<string, string> }) {
  const u = new URL(endpoint);
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri); u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("code_challenge", codeChallengeS256(p.codeVerifier));
  if (p.scopes.length) u.searchParams.set("scope", p.scopes.join(" "));
  for (const [k, v] of Object.entries(p.extra ?? {})) u.searchParams.set(k, v);
  return u;
}
export async function tokenRequest(endpoint: string, clientId: string, clientSecret: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(endpoint, { method: "POST", body: new URLSearchParams(body), headers: {
    "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
    Authorization: "Basic " + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64") } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") throw new Error(`oauth_token_error ${res.status} ${String(json.error ?? "")}`);
  return json as unknown as TokenResponse;
}
// code exchange: tokenRequest(TOKEN_URL, id, secret, { grant_type: "authorization_code", code, redirect_uri, code_verifier })
// refresh:       tokenRequest(TOKEN_URL, id, secret, { grant_type: "refresh_token", refresh_token, scope? })   (Microsoft needs scope)
export const decodeJwtPayload = <T = Record<string, unknown>>(jwt: string): T => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as T;
```

---

## 6. Google Calendar API v3 (REST via fetch) [DOCS: discovery doc revision 20261005]

Base: `https://www.googleapis.com/calendar/v3/`. Header `Authorization: Bearer <access_token>`.

Scopes (exact strings) and what we need:

| Scope | Use |
| --- | --- |
| `https://www.googleapis.com/auth/calendar.events` | events.insert / patch / delete (and events.list) on all calendars |
| `https://www.googleapis.com/auth/calendar.readonly` | calendarList.list, events.list, freebusy.query |
| `https://www.googleapis.com/auth/calendar.freebusy` | freebusy.query only (narrower alternative) |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | calendarList.list only (narrower alternative) |
| `openid email profile` | identity |

Minimal set that covers everything: `openid email profile calendar.events calendar.readonly`. (`calendar.events` alone does NOT allow calendarList.list.)

```ts
const G = "https://www.googleapis.com/calendar/v3";
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

// calendarList.list  GET users/me/calendarList  (maxResults <= 250, pageToken, minAccessRole=reader|writer|owner|freeBusyReader)
const cl = await fetch(`${G}/users/me/calendarList?maxResults=250&minAccessRole=reader`, { headers: auth(t) }).then(r => r.json());
// items[]: { id, summary, summaryOverride, primary, accessRole, timeZone, backgroundColor, selected, hidden }  -> nextPageToken

// freebusy.query  POST freeBusy  (calendarExpansionMax <= 50)
const fb = await fetch(`${G}/freeBusy`, { method: "POST", headers: auth(t), body: JSON.stringify({
  timeMin: "2026-03-01T00:00:00Z", timeMax: "2026-04-01T00:00:00Z", timeZone: "UTC",
  items: [{ id: "primary" }, { id: "abc@group.calendar.google.com" }],
}) }).then(r => r.json());
// fb.calendars["primary"].busy: [{ start, end }]  (start inclusive, end exclusive); .errors[] per calendar

// events.list  GET calendars/{calendarId}/events  (needed when you must honor transparency / show titles)
const qs = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "2500", showDeleted: "false" });
// timeMin = lower bound on END (exclusive), timeMax = upper bound on START (exclusive); RFC3339 WITH offset required
// skip events with transparency === "transparent", status === "cancelled", or attendee self responseStatus === "declined"
// all-day events have start.date / end.date (end exclusive) instead of dateTime

// events.insert  POST calendars/{calendarId}/events?conferenceDataVersion=1&sendUpdates=all
const ev = await fetch(`${G}/calendars/${encodeURIComponent(calId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
  method: "POST", headers: auth(t), body: JSON.stringify({
    id: booking.id.replace(/-/g, ""),           // optional custom id: base32hex chars [a-v0-9], 5..1024 long; a hyphen-less UUID qualifies -> idempotent retries (409 if exists)
    summary, description, location,
    start: { dateTime: "2026-03-10T09:00:00-05:00", timeZone: "America/New_York" },
    end:   { dateTime: "2026-03-10T09:30:00-05:00", timeZone: "America/New_York" },
    attendees: [{ email: "guest@example.com", displayName: "Guest" }],
    reminders: { useDefault: true },            // or { useDefault:false, overrides:[{ method:"email"|"popup", minutes: 0..40320 }] } (max 5)
    extendedProperties: { private: { bookingId: booking.id } },
    transparency: "opaque",
    conferenceData: { createRequest: { requestId: booking.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  }) }).then(r => r.json());
// Meet link: ev.hangoutLink or ev.conferenceData.entryPoints.find(e => e.entryPointType === "video").uri
// ev.conferenceData.createRequest.status.statusCode: "pending" | "success" | "failure" (usually success synchronously; if pending, GET the event again)

// events.patch  PATCH calendars/{calendarId}/events/{eventId}?sendUpdates=all&conferenceDataVersion=1   (partial body)
// events.delete DELETE calendars/{calendarId}/events/{eventId}?sendUpdates=all   -> 204 (410 if already deleted)
```

Facts: `sendUpdates` enum is `all | externalOnly | none` (`sendNotifications` is deprecated). Default for insert is no notifications. `conferenceDataVersion` default 0 ignores `conferenceData`; set `1` on every insert/patch that touches conferences. Conference types: `hangoutsMeet` (Meet), `addOn`; `eventHangout`/`eventNamedHangout` are deprecated. Google sends its own invitation emails when `sendUpdates=all`; if the app also emails ICS invites, use `sendUpdates=none` to avoid duplicates (Calendly lets the host's calendar send invites, so `all` with no ICS from us is the Calendly-like choice for Google hosts). `events.watch` (push notifications) and `syncToken` incremental sync exist but are optional.

Error handling: 401 -> refresh token and retry once; `invalid_grant` on refresh -> connection needs re-auth (mark connection broken, email host). 403 `rateLimitExceeded`/`userRateLimitExceeded` and 429 -> exponential backoff.

---

## 7. Microsoft Graph (Outlook / Microsoft 365) [DOCS: Microsoft Learn]

Base `https://graph.microsoft.com/v1.0`. Scopes (delegated): `openid profile email offline_access User.Read Calendars.ReadWrite` plus `OnlineMeetings.ReadWrite` only if creating standalone Teams meetings (not needed for `isOnlineMeeting`). Tenant: `common`.

```ts
const MG = "https://graph.microsoft.com/v1.0";
// me
GET  `${MG}/me?$select=id,displayName,mail,userPrincipalName,mailboxSettings`   // mailboxSettings.timeZone is a Windows zone name; prefer IANA from browser
// calendars
GET  `${MG}/me/calendars?$select=id,name,color,isDefaultCalendar,canEdit,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider`
// busy times: use calendarView per calendar (works for work/school AND personal accounts)
GET  `${MG}/me/calendars/${id}/calendarView?startDateTime=2026-03-01T00:00:00Z&endDateTime=2026-04-01T00:00:00Z&$select=start,end,showAs,isAllDay,isCancelled,subject&$top=1000`
     headers: { Prefer: 'outlook.timezone="UTC"' }   // without it times come back in UTC anyway; follow @odata.nextLink
     // busy if showAs in ("busy","oof","tentative","workingElsewhere"?) and !isCancelled ; "free" is not busy
     // start/end are { dateTime: "2026-03-10T14:00:00.0000000", timeZone: "UTC" } (no offset: append "Z" when timeZone is UTC)
// create event with Teams link
POST `${MG}/me/calendars/${id}/events`  (or /me/events for the default calendar)
{
  "subject": "Intro call", "body": { "contentType": "HTML", "content": "..." },
  "start": { "dateTime": "2026-03-10T14:00:00", "timeZone": "UTC" },   // send UTC wall time (no offset) + "UTC"
  "end":   { "dateTime": "2026-03-10T14:30:00", "timeZone": "UTC" },
  "location": { "displayName": "Microsoft Teams Meeting" },
  "attendees": [{ "emailAddress": { "address": "guest@example.com", "name": "Guest" }, "type": "required" }],
  "isOnlineMeeting": true, "onlineMeetingProvider": "teamsForBusiness",
  "transactionId": "<booking uuid>",          // idempotency for retries
  "allowNewTimeProposals": false
}
// join link: response.onlineMeeting.joinUrl   (do NOT use onlineMeetingUrl, being deprecated)
PATCH  `${MG}/me/events/${eventId}`   // reschedule (attendees get updates automatically)
POST   `${MG}/me/events/${eventId}/cancel`  body { "comment": "Cancelled via scheduler" }   // organizer only; sends cancellation
DELETE `${MG}/me/events/${eventId}`   // 204; deletes without a custom message
```

Facts:
- `POST /me/calendar/getSchedule` (free/busy for SMTP addresses, `availabilityViewInterval` 5..1440, default 30) is **not supported for personal Microsoft accounts** (delegated personal: "Not supported"). Use calendarView.
- `onlineMeetingProvider` values: `unknown`, `teamsForBusiness`, `skypeForBusiness`, `skypeForConsumer`. Check the calendar's `allowedOnlineMeetingProviders` first. For personal outlook.com accounts, `isOnlineMeeting` is silently ignored (Microsoft Q&A, known limitation): fall back to another location type and tell the host.
- Once an event is online, `isOnlineMeeting` cannot be set back to false.
- `dateTimeTimeZone.timeZone` accepts Windows zone names plus a fixed list of "additional" IANA names, and create/update "might not support all" of them [DOCS]. Always send UTC (`dateTime` without offset, `timeZone: "UTC"`) and let Outlook render in the user's zone. `transactionId` (set once at create) makes POST retries idempotent [DOCS].
- Microsoft rotates refresh tokens; persist the new one on every refresh.

---

## 8. CalDAV (tsdav 2.4.0) and ICS feeds

### 8.1 tsdav client [TYPES; RUN against Radicale 3.8.3]

```ts
import { createDAVClient, DAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";

const client = await createDAVClient({          // or: const c = new DAVClient({...}); await c.login();
  serverUrl: "https://caldav.icloud.com",        // iCloud. Fastmail: https://caldav.fastmail.com ; Nextcloud: https://host/remote.php/dav
  credentials: { username: "appleid@example.com", password: "abcd-efgh-ijkl-mnop" },   // iCloud REQUIRES an app-specific password
  authMethod: "Basic",                           // 'Basic' | 'Oauth' | 'Digest' | 'Custom' | 'Bearer'
  defaultAccountType: "caldav",
});
const calendars: DAVCalendar[] = await client.fetchCalendars();
// each: { url, displayName, components: ['VEVENT', 'VTODO', ...], ctag, syncToken, calendarColor?, timezone? }
const eventCals = calendars.filter((c) => c.components?.includes("VEVENT"));

// time-range query (RFC 4791 calendar-query). Returns MASTER objects of recurring series that overlap.
const objs: DAVCalendarObject[] = await client.fetchCalendarObjects({
  calendar: cal,
  timeRange: { start: "2026-03-11T00:00:00Z", end: "2026-03-12T00:00:00Z" },   // ISO 8601; start < end or it throws
  urlFilter: () => true,     // DEFAULT filter keeps only URLs containing ".ics": override, some servers use other names
  // expand: true            // asks the SERVER to expand recurrences (needs timeRange); support varies, expand locally instead
});
// objs[i] = { url, etag, data: "<raw iCalendar text>" }

await client.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString: ics }); // Response; 201 Created, ETag header
await client.updateCalendarObject({ calendarObject: { url, etag, data: newIcs } });
await client.deleteCalendarObject({ calendarObject: { url, etag } });                      // Response; check res.ok
```

Verified flow [RUN]: list calendars -> create a `RRULE:FREQ=DAILY;COUNT=3` event -> time-range query for day 2 returned the master object (1 result) -> local expansion produced exactly the day-2 instance -> a non-overlapping range returned 0 -> delete OK. Use `ETag`s for optimistic concurrency. Store `{serverUrl, username, encrypted password, calendar url, ctag}`. iCloud live access was not possible from the sandbox [NOT LIVE]; tsdav's README documents iCloud with Apple ID + app-specific password and Basic auth. The iCloud principal discovery redirects to a `pNN-caldav.icloud.com` host, which tsdav follows during `login()`.

Writing events to CalDAV: generate the ICS with ical-generator (section 10.3) using **UTC dates** and no `METHOD` property (a calendar object stored on a server must not contain `METHOD`; ical-generator omits it unless `method` is set).

### 8.2 Parsing and recurrence expansion with node-ical 0.27.3 [RUN]

```ts
import ical, { expandRecurringEvent, type VEvent } from "node-ical";

const parsed = ical.sync.parseICS(icsText);                              // also ical.async.parseICS, ical.async.fromURL(url, fetchOptions)
const vevents = Object.values(parsed).filter((c): c is VEvent => c?.type === "VEVENT"); // values may be undefined in the types
for (const ev of vevents) {
  if (ev.transparency === "TRANSPARENT" || ev.status === "CANCELLED") continue;      // free / cancelled do not block
  const instances = expandRecurringEvent(ev, { from: rangeStart, to: rangeEnd, expandOngoing: true });
  // options: includeOverrides (default true, applies RECURRENCE-ID), excludeExdates (default true), expandOngoing (default false)
  for (const i of instances) busy.push({ start: i.start, end: i.end, allDay: i.isFullDay });
}
```

Verified [RUN]: weekly `DTSTART;TZID=America/New_York:...T090000`, `COUNT=6`, one `EXDATE`, one `RECURRENCE-ID` override: 5 instances, `14:00Z` before the 2026-03-08 DST switch and `13:00Z` after, override moved to `15:00Z`, correct also when the process TZ is America/Los_Angeles. All-day events: `datetype === "date"`, `start` is a Date with `dateOnly: true` set to UTC midnight of that date; interpret all-day blocks in the host's zone (`DateTime.fromObject({year,month,day},{zone: hostTz})`). Events without `DTEND` have `end` undefined: use `DURATION` or treat as zero length (all-day: one day).

### 8.3 Read-only ICS feed subscriptions

```ts
const url = feedUrl.replace(/^webcal:\/\//i, "https://");
const res = await fetch(url, { headers: { Accept: "text/calendar" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
if (!res.ok) throw new Error(`ics_http_${res.status}`);
const text = await res.text();                    // guard size (e.g. reject > 5 MB)
const busy = /* section 8.2 over the needed window */;
```

Validate user-supplied URLs (https only after webcal rewrite, reject private/loopback IPs) to avoid SSRF. Cache the parsed result per feed for a few minutes in the DB; respect `ETag`/`Last-Modified`.

### 8.4 rrule 2.8.1 gotchas [RUN]

- In plain Node ESM `import { RRule } from "rrule"` fails ("Named export 'RRule' not found ... CommonJS module"). Use `import rrulePkg from "rrule"; const { RRule, rrulestr } = rrulePkg;` (bundlers resolve its `module` field and named imports work there).
- With `tzid`, rrule's output is only correct when the **process** time zone is UTC (under `TZ=America/Los_Angeles` the same rule produced `06:00Z` instead of `14:00Z`). Prefer node-ical's `expandRecurringEvent`. If rrule is used, the process must run with `TZ=UTC` (Vercel functions do).

---

## 9. Zoom API [TYPES from Zoom's official SDK @zoom/rivet 0.4.0; NOT LIVE]

- Base: `https://api.zoom.us/v2`. OAuth: user-managed "General app" with authorize `https://zoom.us/oauth/authorize`, token `https://zoom.us/oauth/token` (Basic client auth), PKCE supported. Scopes are selected on the Marketplace app (granular scopes such as `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting`, `user:read:user`; confirm names in the Marketplace UI).
- Create: `POST /users/me/meetings`

```ts
const r = await fetch("https://api.zoom.us/v2/users/me/meetings", { method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    topic: "Intro call", type: 2,                       // 1 instant, 2 scheduled, 3 recurring no fixed time, 8 recurring fixed time
    start_time: "2026-03-10T14:00:00Z",                 // UTC "Z" form; or local "yyyy-MM-ddTHH:mm:ss" plus timezone
    duration: 30, timezone: "America/New_York", agenda: "...",
    settings: { join_before_host: true, waiting_room: false, meeting_invitees: [{ email: "guest@example.com" }] },
  }) });
const m = await r.json();   // { id: number, join_url, start_url, password, encrypted_password, ... }
```

- Update: `PATCH /meetings/{meetingId}`. Delete: `DELETE /meetings/{meetingId}` with optional query `occurrence_id`, `schedule_for_reminder`, `cancel_meeting_reminder` (both booleans; `cancel_meeting_reminder=true` emails the cancellation to registrants/alternative hosts). Store the numeric `id` as text in our DB.
- Refresh tokens rotate on every refresh: persist atomically.

Jitsi needs no API: `https://meet.jit.si/<random-room-name>` (use a long unguessable slug).

---

## 10. Email: Resend 6.32.1, nodemailer 10.1.0, ical-generator 11.1.2

### 10.1 Resend [TYPES; type-checked]

```ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: "Scheduler <noreply@yourdomain.com>",            // must be a verified domain (onboarding@resend.dev for testing)
  to: ["guest@example.com"], replyTo: "host@example.com",
  subject: "Confirmed: Intro call", html, text,
  attachments: [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64"), contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
  headers: { "X-Entity-Ref-ID": booking.id }, tags: [{ name: "type", value: "booking_confirmed" }],
}, { idempotencyKey: `booking/${booking.id}/confirmed` });   // sent as Idempotency-Key header
if (error) throw new Error(`${error.name}: ${error.message}`);  // the SDK returns errors, it does not throw
```

`Attachment = { content?: string | Buffer; filename?: string; path?: string; contentType?: string; contentId?: string }`. Resend has no way to add a `text/calendar` multipart/alternative part, so invites arrive as an `.ics` attachment (clients show an "add to calendar" card; native RSVP buttons need the SMTP path below).

### 10.2 nodemailer (SMTP) [RUN with streamTransport]

```ts
import nodemailer from "nodemailer";
const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
await transport.sendMail({ from, to, subject, text, html,
  icalEvent: { method: "REQUEST", filename: "invite.ics", content: ics } });   // "CANCEL" for cancellations
```

Verified MIME structure: `multipart/mixed` > `multipart/alternative` (text/plain, text/html, `text/calendar; charset=utf-8; method=REQUEST`) + `application/ics` attachment named invite.ics. That is what Gmail/Outlook need for native invite rendering. Always `await` sendMail inside the function (serverless freezes after the response; or run it inside `after()`).

### 10.3 Building invites with ical-generator [RUN]

```ts
import icalGen, { ICalCalendarMethod, ICalAttendeeStatus, ICalAttendeeRole, ICalEventStatus } from "ical-generator";

const cal = icalGen({ prodId: { company: "acme", product: "scheduler", language: "EN" }, method: ICalCalendarMethod.REQUEST });
cal.createEvent({
  id: `${booking.id}@scheduler`,          // UID: stable for the life of the booking (reschedules keep it)
  sequence: booking.sequence,             // increment on every reschedule / cancel
  start: booking.startsAt, end: booking.endsAt,   // JS Dates -> emitted as UTC "Z" (recommended)
  summary, description, location: joinUrl, url: manageUrl,
  organizer: { name: host.name, email: host.email },
  attendees: [{ name, email, rsvp: true, status: ICalAttendeeStatus.NEEDSACTION, role: ICalAttendeeRole.REQ }],
  status: ICalEventStatus.CONFIRMED,
});
const ics = cal.toString();
// output includes: METHOD:REQUEST, UID, SEQUENCE:0, DTSTART:20260310T140000Z, ORGANIZER;CN="Host":mailto:..., ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Guest":MAILTO:...

// cancellation: same UID, SEQUENCE+1, METHOD:CANCEL, STATUS:CANCELLED
cal.method(ICalCalendarMethod.CANCEL);
const ev = cal.events()[0]; ev.sequence(booking.sequence + 1); ev.status(ICalEventStatus.CANCELLED);
```

**Gotcha [RUN]:** passing a native `Date` together with `timezone: "America/New_York"` emits `DTSTART;TZID=America/New_York:20260310T130000`, i.e. the UTC wall clock labeled as New York (wrong by 4 to 5 hours). Either omit `timezone` (UTC output, correct) or pass Luxon `DateTime` objects with `timezone` (emits `TZID=America/New_York:...T090000`, correct, but no VTIMEZONE block is generated). Use UTC.

Rules: reschedule = same UID + higher SEQUENCE + METHOD:REQUEST; cancel = same UID + higher SEQUENCE + METHOD:CANCEL + STATUS:CANCELLED. Attendee replies would use METHOD:REPLY with the attendee's PARTSTAT (ACCEPTED/DECLINED/TENTATIVE), which we do not need to generate.

---

## 11. Vercel

### 11.1 Cron jobs [DOCS]

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron", "schedule": "0 5 * * *" }]
}
```

| Plan | Cron jobs per project | Minimum interval | Precision |
| --- | --- | --- | --- |
| Hobby | 100 | once per day | per hour (fires anywhere within the hour, +/- 59 min) |
| Pro / Enterprise | 100 | once per minute | per minute |

On Hobby, an expression that runs more than once a day **fails the deployment** ("Hobby accounts are limited to daily cron jobs..."). Cron jobs are invoked **only for production deployments**, as HTTP `GET` to the path. If the project has a `CRON_SECRET` env var, Vercel sends `Authorization: Bearer <CRON_SECRET>`:

```ts
// src/app/api/cron/route.ts
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const result = await runDueJobs({ budgetMs: 250_000 });
  return Response.json(result);
}
```

GitHub Actions supplement (every 10 min; GitHub's minimum is 5 min and schedules can be delayed or skipped under load, and are disabled after 60 days without repo activity) [NOT LIVE]:

```yaml
# .github/workflows/cron.yml
name: cron
on:
  schedule: [{ cron: "*/10 * * * *" }]
  workflow_dispatch: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS -m 60 -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ vars.APP_URL }}/api/cron"
```

Point it at the production domain: preview deployments are behind Vercel Deployment Protection by default (and `VERCEL_URL` cannot be used with Standard Protection).

### 11.2 Function duration and Fluid compute [DOCS]

| Plan | Default | Maximum |
| --- | --- | --- |
| Hobby | 300 s | 300 s |
| Pro / Enterprise | 300 s | 800 s (1800 s beta, per function) |

Set per route with `export const maxDuration = N` (App Router). Fluid compute is enabled by default for new projects (since 2025-04-23): instances are reused and serve concurrent invocations, so module-level singletons (DB pool) are shared across requests; keep postgres.js `max` small (5) and `idle_timeout` set. `after()` work counts against `maxDuration`.

### 11.3 Neon marketplace integration env vars [DOCS: Neon "Vercel-Managed Integration"]

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | **pooled** connection string (PgBouncer, host contains `-pooler`) |
| `DATABASE_URL_UNPOOLED` | direct connection string |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` | parts |
| `POSTGRES_*` (legacy names, e.g. `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`) | compatibility with old Vercel Postgres templates |

An optional prefix can be configured (e.g. `PRIMARY_DATABASE_URL`). With Preview Branching enabled, each preview deployment gets a branch database whose variables are injected at deploy time only (not visible in project settings). Our app: app pool on `DATABASE_URL` (or `POSTGRES_URL`) with `prepare: false`; migrations prefer `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`. Strip `channel_binding` from URLs (section 3.5). The Storage tab flow: Project > Storage > Create Database > Neon > Connect Project (choose environments) > redeploy.

### 11.4 Deploying a git-connected project [DOCS]

Dashboard: Add New > Project > Import the GitHub repo > framework auto-detected as Next.js (build `npm run build`, output `.next`) > set env vars > Deploy. Every push to the production branch deploys to production; other branches get preview URLs. Optionally `"engines": {"node": "22.x"}`. The shell here cannot reach api.vercel.com; use the Vercel MCP tools (e.g. `create_git_project`, `create_project_env`, `get_deployment`, `get_runtime_logs`) or the dashboard. `vercel crons run /api/cron` triggers a production cron manually.

---

## 12. Testing

### 12.1 Vitest 5.0.3 [RUN]

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

// Pin process time zone so Date/rrule/luxon defaults match Vercel (UTC) on every machine.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: { tsconfigPaths: true },   // Vite 8 native "@/..." alias support; no vite-tsconfig-paths plugin needed
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

```bash
npx vitest run                         # all
npx vitest run tests/luxon.test.ts     # single file
npx vitest run -t "DST"                # by test name
npx vitest                             # watch
```

Verified: setting `process.env.TZ` in the config makes the suite pass even when launched with `TZ=America/Los_Angeles` (workers inherit it) [RUN]. Use `describe.skipIf(!process.env.TEST_PG_URL)` for optional real-Postgres tests. Vitest cannot render async Server Components; test logic as plain functions and cover pages with Playwright. Remember test files are type-checked by `next build` (1.10).

### 12.2 Playwright 1.64.0 with the preinstalled Chromium [RUN]

Playwright 1.64 wants Chromium revision 1248 (Chrome 156) but the sandbox only has `/opt/pw-browsers/chromium-1194` (Chromium 141.0.7390.37). `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` are set in the environment. **Never run `playwright install`.** Override `executablePath` (verified working with 1.64):

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const LOCAL_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(LOCAL_CHROME) ? LOCAL_CHROME : undefined);
const PORT = Number(process.env.E2E_PORT ?? 3313);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", timezoneId: "America/New_York", locale: "en-US" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} } }],
  webServer: {
    command: `npx next start -p ${PORT}`,          // requires `next build` first; use `next dev -p` while iterating
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PGLITE_DIR: ".data/pglite-e2e" },        // separate PGlite dir from `next dev`
  },
});
```

`use.timezoneId` makes the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` return the given zone (verified `America/New_York`), useful for invitee time zone tests. A headless shell also exists at `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` (wrapper script).

---

## 13. Luxon 3.7.2 and time zones [RUN]

```ts
import { DateTime, Duration, Interval, Info, Settings } from "luxon";
Settings.defaultZone = "utc";    // recommended in server code: luxon otherwise uses the process zone
Settings.throwOnInvalid = true;  // optional: invalid DateTimes throw instead of returning isValid === false
```

Verified behaviors (America/New_York, 2026; DST starts 2026-03-08, ends 2026-11-01):

| Case | Result |
| --- | --- |
| `fromObject({2026-03-08 02:30}, {zone})` (spring-forward gap) | shifts forward to `03:30-04:00` |
| `fromObject({2026-11-01 01:30}, {zone})` (fall-back overlap) | picks the EARLIER instant (`-04:00`); `.plus({hours:1})` is the second `01:30-05:00` |
| `sat0900.plus({ days: 1 })` across DST | `09:00` next day (wall clock kept) |
| `sat0900.plus({ hours: 24 })` across DST | `10:00` next day (absolute) |
| DST day length | `Interval(startOf("day"), endOf("day")).length("hours")` is about 23 |
| `Interval.splitBy({ minutes: 30 })` on 09:00 to 11:00 | 4 pieces; a 50 min interval gives `[30, 20]` (filter the short tail) |
| `.weekday` | 1 = Monday ... 7 = Sunday; `startOf("week")` is Monday |
| `DateTime.fromISO("...Z")` | converted to `Settings.defaultZone` (process zone if unset!) unless `{ zone }` or `{ setZone: true }` |
| `setZone(z, { keepLocalTime: true })` | same wall clock, different instant (depends on the source zone, so pin defaultZone) |
| `Interval.fromISO(...).toISO()` | uses `+00:00`, not `Z` |
| `Info.isValidIANAZone("Asia/Calcutta")` | true (legacy aliases are valid) |
| `Interval.merge`, `.difference`, `.overlaps`, `.abutsStart` | behave as expected for busy-time math |

Slot generation rule of thumb: iterate **days in the schedule's zone** (`d = start.setZone(tz).startOf("day"); d = d.plus({ days: 1 })`), build each availability window with `d.set({ hour, minute })` (wall clock), convert to UTC instants, then step slots by `plus({ minutes: increment })` from the window start (absolute). Never step days with `plus({ hours: 24 })`.

Time zone list gotchas (Node 22.22, ICU 77) [RUN]:
- `Intl.supportedValuesOf("timeZone")` returns **418** zones, **does not include `"UTC"`**, and uses legacy canonical names: `Asia/Calcutta` (not `Asia/Kolkata`), `Europe/Kiev` (not `Europe/Kyiv`). Browsers may return different names.
- `new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata" }).resolvedOptions().timeZone` returns `"Asia/Calcutta"` in Node.
- Therefore: accept any zone that luxon/Intl accepts, store exactly what the user picked (or what the browser reported), compare zones by offset behavior (or normalize through `resolvedOptions()`), and build the picker from a curated list plus `"UTC"`. Display names: `new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "long" })` gives e.g. "India Standard Time".

---

## 14. Zod 4.6.6 and node:crypto (auth helpers) [RUN]

```ts
import { z } from "zod";
const S = z.object({
  email: z.email(), url: z.url().optional(),
  start: z.iso.datetime({ offset: true }), date: z.iso.date(),
  minutes: z.coerce.number().int().min(5).max(720),
  kind: z.enum(["one_on_one", "group", "round_robin", "collective"]),
  tz: z.string().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Invalid time zone"),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});
const r = S.safeParse(input);
if (!r.success) { z.flattenError(r.error).fieldErrors; /* { email: ["Invalid email address"], ... } */ z.prettifyError(r.error); }
```

Zod 4 notes: top-level format schemas (`z.email()`, `z.url()`, `z.uuid()`, `z.iso.datetime()`); `z.string().email()` still works but is deprecated; `z.record` needs two arguments; error helpers are `z.flattenError`, `z.treeifyError`, `z.prettifyError`.

```ts
import { scrypt, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { promisify } from "node:util";
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const P = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };   // ~65 ms per hash here
export async function hashPassword(pw: string) {
  const salt = randomBytes(16); const dk = await scryptAsync(pw.normalize("NFKC"), salt, 64, P);
  return `scrypt$${P.N}$${P.r}$${P.p}$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, n, r, p, s, h] = stored.split("$"); if (alg !== "scrypt") return false;
  const exp = Buffer.from(h, "base64url");
  const dk = await scryptAsync(pw.normalize("NFKC"), Buffer.from(s, "base64url"), exp.length, { N: +n, r: +r, p: +p, maxmem: P.maxmem });
  return timingSafeEqual(dk, exp);
}
// AES-256-GCM for OAuth tokens / CalDAV passwords; key = 32 bytes (e.g. sha256 of ENCRYPTION_KEY)
export function encrypt(plain: string, key: Buffer) {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}
export function decrypt(blob: string, key: Buffer) {
  const [, iv, ct, tag] = blob.split("."); const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
// sessions: token = randomBytes(32).toString("base64url") in the cookie; store sha256(token) hex in the DB
```

---

## 15. Gotcha checklist (all observed in this verification)

1. `cacheComponents` (create-next-app default) breaks builds for DB/cookie pages: keep it off and set `dynamic = "force-dynamic"` in the root layout, otherwise DB-only pages are prerendered (and query the DB) during `next build`.
2. `next build` type-checks tests, e2e and scripts; any TS error fails the deploy. Run `next typegen` before standalone `tsc` (global `PageProps`/`LayoutProps`/`RouteContext`).
3. `middleware.ts` is now `src/proxy.ts`, Node runtime only, export `proxy`. Re-check auth in every Server Action.
4. `next dev` writes `AGENTS.md` unless `agentRules: false`.
5. typedRoutes: object `href` with `[slug]` pathname compiles but crashes at runtime; use template strings.
6. `new PGlite(undefined, opts)` drops opts; parent dir must exist; load `btree_gist` explicitly; one process per data dir; never on Vercel.
7. Drizzle errors are `DrizzleQueryError` with the PG error in `.cause` (`constraint_name` on postgres.js, `constraint` on PGlite). `db.execute` returns an array (postgres.js) vs `{ rows }` (PGlite); raw timestamps are strings.
8. Session advisory locks are unsafe behind PgBouncer; use `pg_advisory_xact_lock` inside a transaction (migrations and per-host booking mutex).
9. postgres.js forwards unknown URL params; strip `channel_binding` from Neon URLs. Use `prepare: false` on pooled URLs.
10. ical-generator: native Date + `timezone` string produces wrong times; emit UTC.
11. tsdav `fetchCalendarObjects` keeps only `.ics` URLs by default; pass `urlFilter: () => true`. Expand recurrences locally with node-ical.
12. rrule: default-import in Node ESM; correct `tzid` output only when process TZ is UTC (pin `TZ=UTC` in Vitest).
13. Luxon `fromISO` with `Z` converts to the process zone; set `Settings.defaultZone = "utc"` on the server.
14. `Intl.supportedValuesOf("timeZone")` lacks `UTC` and uses legacy names (`Asia/Calcutta`, `Europe/Kiev`).
15. Microsoft: `getSchedule` unsupported for personal accounts; Teams links silently not created for personal accounts; refresh tokens rotate (also Zoom).
16. Google: `calendar.events` does not cover `calendarList.list`; set `conferenceDataVersion=1`; refresh responses usually omit `refresh_token`.
17. Vercel Hobby crons: once per day max (deploy fails otherwise), production only, `Authorization: Bearer $CRON_SECRET`.
18. Playwright: override `executablePath` to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; never `playwright install`.
19. arctic is deprecated on npm; the in-repo PKCE helper is a verified drop-in.
20. TypeScript 7 is npm `latest` but breaks typescript-eslint; pin `typescript@^5.9`. Stay on ESLint 9.
