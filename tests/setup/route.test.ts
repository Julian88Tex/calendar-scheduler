// POST /api/setup/bootstrap (src/app/api/setup/bootstrap/route.ts) on PGlite: disabled without secrets, bearer
// authorization with SETUP_TOKEN or CRON_SECRET (constant-time compare), validation, OWNER_EMAIL, the 409 refusal,
// idempotent reruns and rate limiting.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { eventTypes, handles, instanceSettings, organizations, rateLimitBuckets, users } = await import("@/db/schema");
const { POST } = await import("@/app/api/setup/bootstrap/route");
const { bearerMatches, bootstrapSecrets, SETUP_TOKEN_MIN_LENGTH } = await import("@/lib/setup/config");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const SETUP_TOKEN = "setup-token-0123456789-abcdefghij";
const CRON_SECRET = "cron-secret-9876543210";
const OWNER = "julian@example.com";
let ipCounter = 0;

function resetEnv() {
  delete env.SETUP_TOKEN;
  delete env.CRON_SECRET;
  delete env.OWNER_EMAIL;
}

beforeEach(async () => {
  resetEnv();
  env.SETUP_TOKEN = SETUP_TOKEN;
  await t.db.delete(users);
  await t.db.delete(organizations);
  await t.db.delete(handles);
  await t.db.delete(instanceSettings);
  await t.db.delete(rateLimitBuckets);
});
afterAll(resetEnv);

/** A POST from its own IP (rate limits are per IP) unless one is given. */
function call(body: unknown, opts: { auth?: string | null; ip?: string; raw?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": opts.ip ?? `198.51.100.${++ipCounter % 250}` });
  const auth = opts.auth === undefined ? `Bearer ${SETUP_TOKEN}` : opts.auth;
  if (auth !== null) headers.set("authorization", auth);
  return POST(new Request("http://localhost:3000/api/setup/bootstrap", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }), undefined);
}

describe("authorization", () => {
  it("is disabled (501) while neither SETUP_TOKEN nor CRON_SECRET is set", async () => {
    resetEnv();
    const res = await call({ email: OWNER });
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("ignores a SETUP_TOKEN that is too short to be safe", async () => {
    resetEnv();
    env.SETUP_TOKEN = "short";
    expect(bootstrapSecrets()).toEqual([]);
    expect((await call({ email: OWNER }, { auth: "Bearer short" })).status).toBe(501);
    expect(SETUP_TOKEN_MIN_LENGTH).toBeGreaterThanOrEqual(24);
  });

  it("answers 401 without the header, with a wrong token or another scheme, and creates nothing", async () => {
    for (const auth of [null, "Bearer wrong-token", `Basic ${SETUP_TOKEN}`, SETUP_TOKEN, `Bearer ${SETUP_TOKEN}x`, "Bearer "]) {
      const res = await call({ email: OWNER }, { auth });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("accepts SETUP_TOKEN, and CRON_SECRET as well", async () => {
    env.CRON_SECRET = CRON_SECRET;
    const first = await call({ email: OWNER });
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const body = (await first.json()) as { ok: boolean; account: string; snapshot: { status: string }; user: { email: string } };
    expect(body).toMatchObject({ ok: true, account: "created", snapshot: { status: "applied" }, user: { email: OWNER } });

    const second = await call({ email: OWNER }, { auth: `Bearer ${CRON_SECRET}` });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, account: "existing", snapshot: { status: "skipped", reason: "already_applied" } });

    const [u] = await t.db.select().from(users).where(eq(users.emailNormalized, OWNER));
    expect(await t.db.select().from(eventTypes).where(eq(eventTypes.ownerUserId, u!.id))).toHaveLength(3);
  });

  it("compares every configured secret", () => {
    expect(bearerMatches(`Bearer ${CRON_SECRET}`, [SETUP_TOKEN, CRON_SECRET])).toBe(true);
    expect(bearerMatches(`Bearer ${SETUP_TOKEN}`, [SETUP_TOKEN, CRON_SECRET])).toBe(true);
    expect(bearerMatches(`  Bearer ${SETUP_TOKEN}  `, [SETUP_TOKEN])).toBe(true);
    expect(bearerMatches(`bearer ${SETUP_TOKEN}`, [SETUP_TOKEN])).toBe(false);
    expect(bearerMatches(null, [SETUP_TOKEN])).toBe(false);
    expect(bearerMatches("Bearer x", [])).toBe(false);
  });
});

describe("input and refusals", () => {
  it("validates the body (400 with field errors)", async () => {
    const bad = await call({ email: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "validation", fieldErrors: { email: expect.any(Array) } });
    const extra = await call({ email: OWNER, password: "x" });
    expect(extra.status).toBe(400);
    const notJson = await call(null, { raw: "{" });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "validation", message: "The request body must be valid JSON." });
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("refuses an email other than OWNER_EMAIL (403)", async () => {
    env.OWNER_EMAIL = OWNER;
    const res = await call({ email: "someone.else@example.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", fieldErrors: { email: expect.any(Array) } });
    expect((await call({ email: "Julian@Example.com", name: "Julian Joseph" })).status).toBe(201);
  });

  it("refuses with 409 when another account already exists", async () => {
    await createUser(t.db, { email: "first@example.com" });
    const res = await call({ email: OWNER });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict" });
    expect(await t.db.select().from(users).where(eq(users.emailNormalized, OWNER))).toHaveLength(0);
  });
});

describe("rate limiting", () => {
  // Mid-window instants, so a fixed window never rolls over during a test.
  afterEach(() => resetFakeTime());

  it("allows 10 attempts per IP in 15 minutes, counted before the token check", async () => {
    setFakeNow("2035-03-01T10:05:00Z");
    const ip = "203.0.113.7";
    for (let i = 0; i < 10; i++) expect((await call({ email: OWNER }, { ip, auth: "Bearer guess" })).status).toBe(401);
    const blocked = await call({ email: OWNER }, { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
    // Another IP is not affected.
    expect((await call({ email: OWNER }, { ip: "203.0.113.8" })).status).toBe(201);
  });

  it("caps all attempts at 30 per hour", async () => {
    setFakeNow("2035-03-01T11:20:00Z");
    for (let i = 0; i < 30; i++) expect((await call({ email: OWNER }, { ip: `192.0.2.${i}`, auth: "Bearer guess" })).status).toBe(401);
    expect((await call({ email: OWNER }, { ip: "192.0.2.200" })).status).toBe(429);
  });
});
