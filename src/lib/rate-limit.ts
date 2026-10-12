// Fixed-window rate limiting in Postgres (ARCHITECTURE section 18.6; SPEC AU-14, BK-18, MP-30, API-06).
//
//   await assertRateLimit(`login:email:${hashToken(email)}`, 10, 15 * 60);     // throws AppError("rate_limited", 429)
//   const r = await rateLimit(`booking:ip:${await hashIp(ip)}:${eventTypeId}`, 20, 3600);
//
// INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count, atomic under
// concurrency. Windows are aligned to the business clock now() (fake time aware), never the database clock.
// system.cleanup deletes buckets older than 2 days. Keys are namespaced ("login:ip:{hashIp}", "api:{tokenId}", ...);
// never put raw emails or IPs in keys (hash them).
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { rateLimitBuckets } from "@/db/schema";
import { AppError } from "./errors";
import { nowMs } from "./time/now";

export type RateLimitResult = { ok: boolean; remaining: number; resetSeconds: number; count: number; limit: number };

export type RateLimitOptions = {
  db?: DbOrTx;
  /** Business time override in epoch ms (defaults to now()). */
  nowMs?: number;
  /** Units to add (default 1). */
  cost?: number;
};

function windowOf(windowSeconds: number, at: number): { start: Date; resetSeconds: number } {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) throw new Error("rateLimit: windowSeconds must be > 0");
  const size = windowSeconds * 1000;
  const startMs = Math.floor(at / size) * size;
  return { start: new Date(startMs), resetSeconds: Math.max(1, Math.ceil((startMs + size - at) / 1000)) };
}

function result(count: number, limit: number, resetSeconds: number): RateLimitResult {
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetSeconds, count, limit };
}

/** Counts one hit and reports whether it is within `limit` per `windowSeconds`. */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const db = opts.db ?? (await getDb());
  const { start, resetSeconds } = windowOf(windowSeconds, opts.nowMs ?? nowMs());
  const cost = Math.max(1, Math.trunc(opts.cost ?? 1));
  const rows = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart: start, count: cost })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + ${cost}` },
    })
    .returning({ count: rateLimitBuckets.count });
  return result(rows[0]?.count ?? cost, limit, resetSeconds);
}

/** Reads the current window without counting (check before expensive work; count failures with rateLimit()). */
export async function peekRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: Omit<RateLimitOptions, "cost"> = {},
): Promise<RateLimitResult> {
  const db = opts.db ?? (await getDb());
  const { start, resetSeconds } = windowOf(windowSeconds, opts.nowMs ?? nowMs());
  const rows = await db
    .select({ count: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.key, key), eq(rateLimitBuckets.windowStart, start)))
    .limit(1);
  const count = rows[0]?.count ?? 0;
  // A peek is "ok" while another hit would still be allowed.
  return { ok: count < limit, remaining: Math.max(0, limit - count), resetSeconds, count, limit };
}

/** "Too many attempts. Try again in {minutes} minutes." (AU-14). */
export function rateLimitMessage(resetSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(resetSeconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** The AppError assertRateLimit() throws. */
export function rateLimitedError(r: Pick<RateLimitResult, "resetSeconds">, message?: string): AppError {
  return new AppError("rate_limited", message ?? rateLimitMessage(r.resetSeconds), {
    details: { retryAfterSeconds: r.resetSeconds },
  });
}

/** Counts one hit; throws AppError("rate_limited") (429, details.retryAfterSeconds) beyond the limit. */
export async function assertRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: RateLimitOptions & { message?: string } = {},
): Promise<void> {
  const r = await rateLimit(key, limit, windowSeconds, opts);
  if (!r.ok) throw rateLimitedError(r, opts.message);
}

/** Throws when the window is already full, without counting (AU-14: reject the 11th login before checking it). */
export async function assertNotRateLimited(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: Omit<RateLimitOptions, "cost"> & { message?: string } = {},
): Promise<void> {
  const r = await peekRateLimit(key, limit, windowSeconds, opts);
  if (!r.ok) throw rateLimitedError(r, opts.message);
}

/** Clears every window of a key (for example after a successful login). */
export async function resetRateLimit(key: string, opts: { db?: DbOrTx } = {}): Promise<void> {
  const db = opts.db ?? (await getDb());
  await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
}

/** Deletes buckets whose window started before `before` (system.cleanup uses now() minus 2 days). */
export async function purgeRateLimitBuckets(before: Date, opts: { db?: DbOrTx } = {}): Promise<number> {
  const db = opts.db ?? (await getDb());
  const rows = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStart, before))
    .returning({ key: rateLimitBuckets.key });
  return rows.length;
}

/** Builds a namespaced key ("login", "ip", hash) -> "login:ip:hash". */
export function rateLimitKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/:/g, "_")).join(":");
}
