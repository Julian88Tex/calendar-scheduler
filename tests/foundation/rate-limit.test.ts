// Fixed-window rate limiting with the business clock (ARCHITECTURE 18.6, SPEC AU-14).
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { rateLimitBuckets } from "@/db/schema";
import { isAppError } from "@/lib/errors";
import {
  assertNotRateLimited,
  assertRateLimit,
  peekRateLimit,
  purgeRateLimitBuckets,
  rateLimit,
  rateLimitKey,
  rateLimitMessage,
  resetRateLimit,
} from "@/lib/rate-limit";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
afterEach(() => resetFakeTime());

describe("rateLimit", () => {
  it("allows `limit` hits per window and rejects the next one (the 11th login, AU-14)", async () => {
    setFakeNow("2030-01-01T10:00:00Z");
    const key = "login:email:abc";
    for (let i = 1; i <= 10; i++) {
      const r = await rateLimit(key, 10, 15 * 60);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(10 - i);
    }
    const eleventh = await rateLimit(key, 10, 15 * 60);
    expect(eleventh).toMatchObject({ ok: false, remaining: 0, count: 11, limit: 10 });
    expect(eleventh.resetSeconds).toBe(15 * 60);
  });

  it("windows follow the fake clock: a new window starts after the window size", async () => {
    setFakeNow("2030-01-01T10:00:00Z");
    const key = "booking:ip:x:et";
    expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    setFakeNow("2030-01-01T10:00:45Z");
    const blocked = await rateLimit(key, 2, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.resetSeconds).toBe(15);
    setFakeNow("2030-01-01T10:01:00Z");
    expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    const rows = await t.db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
    expect(rows.map((r) => r.windowStart.toISOString()).sort()).toEqual(["2030-01-01T10:00:00.000Z", "2030-01-01T10:01:00.000Z"]);
  });

  it("keys are independent; cost counts several units", async () => {
    setFakeNow("2030-02-01T00:00:00Z");
    expect((await rateLimit("a:1", 1, 60)).ok).toBe(true);
    expect((await rateLimit("a:2", 1, 60)).ok).toBe(true);
    expect((await rateLimit("a:3", 5, 60, { cost: 5 })).ok).toBe(true);
    expect((await rateLimit("a:3", 5, 60)).ok).toBe(false);
    expect(rateLimitKey("login", "ip", "x:y")).toBe("login:ip:x_y");
  });

  it("peek does not count; assertNotRateLimited rejects a full window without counting", async () => {
    setFakeNow("2030-03-01T00:00:00Z");
    const key = "peek:test";
    expect(await peekRateLimit(key, 2, 60)).toMatchObject({ ok: true, count: 0, remaining: 2 });
    await rateLimit(key, 2, 60);
    await rateLimit(key, 2, 60);
    expect(await peekRateLimit(key, 2, 60)).toMatchObject({ ok: false, count: 2 });
    await expect(assertNotRateLimited(key, 2, 60)).rejects.toMatchObject({ code: "rate_limited" });
    expect((await peekRateLimit(key, 2, 60)).count).toBe(2);
    await resetRateLimit(key);
    expect((await peekRateLimit(key, 2, 60)).count).toBe(0);
  });

  it("assertRateLimit throws AppError rate_limited (429) with retryAfterSeconds and the AU-14 message", async () => {
    setFakeNow("2030-04-01T00:00:00Z");
    await assertRateLimit("assert:test", 1, 15 * 60);
    const err = await assertRateLimit("assert:test", 1, 15 * 60).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(err).toMatchObject({ code: "rate_limited", status: 429, details: { retryAfterSeconds: 900 } });
    expect((err as Error).message).toBe("Too many attempts. Try again in 15 minutes.");
    expect(rateLimitMessage(30)).toBe("Too many attempts. Try again in 1 minute.");
    await expect(assertRateLimit("assert:test", 1, 60, { message: "Slow down." })).rejects.toThrow("Slow down.");
  });

  it("concurrent hits are counted atomically", async () => {
    setFakeNow("2030-05-01T00:00:00Z");
    const results = await Promise.all(Array.from({ length: 8 }, () => rateLimit("concurrent", 5, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(Math.max(...results.map((r) => r.count))).toBe(8);
  });

  it("purges old buckets (system.cleanup keeps 2 days)", async () => {
    setFakeNow("2030-06-01T00:00:00Z");
    await rateLimit("old:bucket", 5, 60);
    setFakeNow("2030-06-04T00:00:00Z");
    await rateLimit("new:bucket", 5, 60);
    const removed = await purgeRateLimitBuckets(new Date("2030-06-02T00:00:00Z"));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await t.db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, "old:bucket"))).toHaveLength(0);
    expect(await t.db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, "new:bucket"))).toHaveLength(1);
  });
});
