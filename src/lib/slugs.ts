// Slugs and handles (SPEC GEN-02, AU-01, AU-15; ARCHITECTURE sections 5.4.2 and 21).
//
// User and team slugs share one namespace, the `handles` table (primary key slug). users.slug and teams.slug mirror
// it. Handles match ^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$ and never take a reserved word; event type slugs match
// ^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$ and are unique per profile among non-deleted event types (unique indexes).
//
// Client safe: the pure helpers (slugify, patterns, RESERVED_SLUGS) have no dependencies; the database helpers load
// drizzle and the schema lazily, so importing slugify into a client component stays cheap.
import type { DbOrTx } from "@/db";
import { AppError } from "./errors";

async function deps() {
  const [orm, schema, helpers] = await Promise.all([
    import("drizzle-orm"),
    import("@/db/schema"),
    import("@/db/helpers"),
  ]);
  return { ...orm, handles: schema.handles, users: schema.users, teams: schema.teams, isUniqueViolation: helpers.isUniqueViolation };
}

/** GEN-02 reserved user and team slugs (case-insensitive), plus app routes that are not GEN-02 words. */
export const RESERVED_SLUGS: readonly string[] = [
  "app", "api", "admin", "auth", "login", "logout", "signup", "register", "onboarding", "setup", "settings", "invite",
  "oauth", "d", "p", "r", "poll", "polls", "booking", "bookings", "events", "event", "cancellations", "reschedulings",
  "reconfirm", "embed", "embed.js", "widget.js", "widget", "team", "teams", "u", "s", "i", "help", "docs", "privacy",
  "terms", "cookie-policy", "payments", "cookies", "pricing", "features", "blog", "about", "contact", "support",
  "status", "health", "cron", "static", "public", "assets", "files", "_next", "favicon.ico", "robots.txt",
  "sitemap.xml", "manifest.json", "apple-touch-icon.png", "verify-email", "reset-password", "forgot-password", "me",
  "new", "null", "undefined", "www", "mail", "root", "system",
  // Real routes that are not in the GEN-02 list (a handle would be shadowed by them).
  "confirm-email", "friends",
];

const RESERVED = new Set(RESERVED_SLUGS);

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
export const EVENT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
export const HANDLE_MAX_LENGTH = 50;
export const EVENT_SLUG_MAX_LENGTH = 100;

/** The GEN-02 acceptance copy for an invalid, reserved or taken handle. */
export const HANDLE_UNAVAILABLE_MESSAGE = "This URL is not available.";
export const HANDLE_TAKEN_MESSAGE = "This URL is taken";

/**
 * GEN-02 slugify: lowercase, accents stripped, spaces and underscores become hyphens, other characters removed,
 * repeated hyphens collapsed, no leading or trailing hyphen, cut to `maxLength` (default 100).
 *   slugify("Student Office Hours!") === "student-office-hours"
 */
export function slugify(input: string, opts: { maxLength?: number } = {}): string {
  const max = opts.maxLength ?? EVENT_SLUG_MAX_LENGTH;
  return (input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** True for reserved words (case-insensitive). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}

/** True when the slug may be a user or team handle (pattern and not reserved). Expects the lowercase form. */
export function isValidHandle(slug: string): boolean {
  return HANDLE_PATTERN.test(slug) && !RESERVED.has(slug);
}

/** True when the slug is a valid event type slug. */
export function isValidEventSlug(slug: string): boolean {
  return EVENT_SLUG_PATTERN.test(slug);
}

/** Normalizes user input for a handle ("Login" -> "login", "Julian Joseph" -> "julian-joseph"). */
export function normalizeHandle(input: string): string {
  return slugify(input, { maxLength: HANDLE_MAX_LENGTH });
}

export type HandleOwner = { userId: string } | { teamId: string };

type Deps = Awaited<ReturnType<typeof deps>>;
const ownerCondition = (d: Deps, owner: HandleOwner) =>
  "userId" in owner ? d.eq(d.handles.userId, owner.userId) : d.eq(d.handles.teamId, owner.teamId);

/**
 * True when `slug` is a valid, non-reserved handle that nobody holds (a handle held by `except` counts as available,
 * so a user can keep or re-save their own slug).
 */
export async function isHandleAvailable(db: DbOrTx, slug: string, except?: HandleOwner): Promise<boolean> {
  if (!isValidHandle(slug)) return false;
  const d = await deps();
  const rows = await db
    .select({ userId: d.handles.userId, teamId: d.handles.teamId })
    .from(d.handles)
    .where(d.eq(d.handles.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return true;
  if (!except) return false;
  return "userId" in except ? row.userId === except.userId : row.teamId === except.teamId;
}

/**
 * Claims `slug` for a user or team inside the caller's transaction: validates it, releases the owner's previous
 * handle (a slug change), inserts the handles row and updates the users.slug / teams.slug mirror. Idempotent when the
 * owner already holds the slug. Throws AppError("conflict", "This URL is not available.") with fieldErrors.slug when
 * it is invalid, reserved or held by someone else (including a concurrent claim, via the primary key).
 */
export async function claimHandle(
  tx: DbOrTx,
  slug: string,
  owner: HandleOwner,
  opts: { updateMirror?: boolean } = {},
): Promise<string> {
  const unavailable = () =>
    new AppError("conflict", HANDLE_UNAVAILABLE_MESSAGE, { fieldErrors: { slug: [HANDLE_UNAVAILABLE_MESSAGE] } });
  if (!isValidHandle(slug)) throw unavailable();
  const d = await deps();
  const { handles, users, teams } = d;

  const current = await tx
    .select({ slug: handles.slug })
    .from(handles)
    .where(ownerCondition(d, owner))
    .limit(1);
  if (current[0]?.slug !== slug) {
    if (current[0]) await tx.delete(handles).where(d.and(ownerCondition(d, owner), d.ne(handles.slug, slug)));
    let inserted: { slug: string }[];
    try {
      inserted = await tx
        .insert(handles)
        .values("userId" in owner ? { slug, userId: owner.userId } : { slug, teamId: owner.teamId })
        .onConflictDoNothing({ target: handles.slug })
        .returning({ slug: handles.slug });
    } catch (e) {
      if (d.isUniqueViolation(e)) throw unavailable();
      throw e;
    }
    if (!inserted.length) throw unavailable();
  }

  if (opts.updateMirror !== false) {
    try {
      if ("userId" in owner) {
        await tx
          .update(users)
          .set({ slug })
          .where(d.and(d.eq(users.id, owner.userId), d.or(d.isNull(users.slug), d.ne(users.slug, slug))));
      } else {
        await tx
          .update(teams)
          .set({ slug })
          .where(d.and(d.eq(teams.id, owner.teamId), d.ne(teams.slug, slug)));
      }
    } catch (e) {
      // users_slug_uq / teams_slug_uq: a live row still carries the slug without a handle (data drift).
      if (d.isUniqueViolation(e)) throw unavailable();
      throw e;
    }
  }
  return slug;
}

/**
 * Releases handles: by owner (account or team deletion, AU-15) or by slug. The mirror column is left to the caller
 * (account deletion nulls users.slug itself).
 */
export async function releaseHandle(tx: DbOrTx, target: HandleOwner | { slug: string }): Promise<void> {
  const d = await deps();
  if ("slug" in target) await tx.delete(d.handles).where(d.eq(d.handles.slug, target.slug));
  else await tx.delete(d.handles).where(ownerCondition(d, target));
}

/**
 * The first available handle derived from a name or email (AU-01: "slug derived from the name, de-duplicated with
 * numeric suffixes"): "julian-joseph", "julian-joseph2", "julian-joseph3", ... Reserved words get a suffix too.
 */
export async function suggestHandle(db: DbOrTx, nameOrEmail: string): Promise<string> {
  const source = nameOrEmail.includes("@") ? (nameOrEmail.split("@")[0] ?? "") : nameOrEmail;
  let base = normalizeHandle(source);
  if (!base) base = "user";
  const d = await deps();
  // Every candidate starts with the first 44 characters of base (suffixes have at most 4 digits); base only holds
  // [a-z0-9-], so it needs no LIKE escaping.
  const prefix = base.slice(0, 44);
  const taken = new Set(
    (await db.select({ slug: d.handles.slug }).from(d.handles).where(d.like(d.handles.slug, `${prefix}%`))).map(
      (r) => r.slug,
    ),
  );
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? "" : String(n);
    const candidate = `${base.slice(0, HANDLE_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (isValidHandle(candidate) && !taken.has(candidate)) return candidate;
  }
  // Practically unreachable: fall back to a random suffix.
  return `${base.slice(0, 40).replace(/-+$/, "")}${Math.floor(Math.random() * 1e9)}`.slice(0, HANDLE_MAX_LENGTH);
}
