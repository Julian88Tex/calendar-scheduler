// Route handler helpers (CSRF, error mapping) and the Server Action wrapper (ARCHITECTURE 18.5 and 18.8).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const sessionState: { data: unknown } = { data: null };
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionState.data,
  touchSession: async () => {},
  requireUser: async () => {
    throw new Error("not used");
  },
}));

const { AppError, ERROR_CODES, ERROR_STATUS, isAppError, orNotFound, toAppError } = await import("@/lib/errors");
const http = await import("@/lib/http");
const { formDataToObject, runAction } = await import("@/lib/actions");
const { SetupRequiredError } = await import("@/db");
const { users } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { redirect } = await import("next/navigation");
type Route = import("next").Route;
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");

const t = useTestDb();
afterEach(() => {
  sessionState.data = null;
  resetFakeTime();
});

describe("errors", () => {
  it("AppError carries code, status, message and field errors", () => {
    const e = new AppError("forbidden");
    expect(e).toMatchObject({ code: "forbidden", status: 403, message: "You don't have permission to do that." });
    expect(new AppError("rate_limited", 429).status).toBe(429);
    const v = new AppError("validation", "Fix it", { fieldErrors: { name: ["Required"] } });
    expect(v.toJSON()).toEqual({ code: "validation", message: "Fix it", fieldErrors: { name: ["Required"] } });
    expect(isAppError(v)).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(toAppError(new Error("db exploded"))).toMatchObject({ code: "internal", message: "Something went wrong. Try again." });
    expect(toAppError(new SetupRequiredError())).toMatchObject({ code: "setup_required", status: 503 });
    expect(() => orNotFound(null)).toThrow(AppError);
    expect(orNotFound(0)).toBe(0);
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});

describe("http helpers", () => {
  const post = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

  it("assertSameOrigin accepts the app origin, the request host or Sec-Fetch-Site same-origin, and rejects the rest", () => {
    expect(() => http.assertSameOrigin(post({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
    expect(() => http.assertSameOrigin(post({ origin: "https://preview.example.com", host: "preview.example.com" }))).not.toThrow();
    expect(() =>
      http.assertSameOrigin(post({ origin: "https://preview.example.com", "x-forwarded-host": "preview.example.com" })),
    ).not.toThrow();
    expect(() => http.assertSameOrigin(post({ "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => http.assertSameOrigin(post({ origin: "https://evil.example", host: "localhost:3000" }))).toThrow(AppError);
    expect(() => http.assertSameOrigin(post({ origin: "null" }))).toThrow(AppError);
    expect(() => http.assertSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toThrow(AppError);
    expect(() => http.assertSameOrigin(post({}))).toThrow(AppError);
    expect(() => http.assertSameOrigin(new Request("http://localhost:3000/api/x", { headers: { origin: "https://evil.example" } }))).not.toThrow(); // GET is safe
    try {
      http.assertSameOrigin(post({ origin: "https://evil.example" }));
    } catch (e) {
      expect(e).toMatchObject({ code: "forbidden", status: 403 });
    }
  });

  it("route() maps AppError, ZodError, SetupRequiredError and unknown errors to JSON", async () => {
    const h = http.route(async (req: Request) => {
      const kind = new URL(req.url).searchParams.get("k");
      if (kind === "app") throw new AppError("not_found", "No such event");
      if (kind === "zod") z.object({ email: z.email() }).parse({ email: "x" });
      if (kind === "setup") throw new SetupRequiredError();
      if (kind === "rate") throw new AppError("rate_limited", { details: { retryAfterSeconds: 61 } });
      if (kind === "boom") throw new Error("secret internals");
      if (kind === "redirect") redirect("/login" as Route);
      return http.json({ ok: true });
    });
    const call = async (k: string) => h(new Request(`http://localhost:3000/api/x?k=${k}`), undefined);
    const ok = await call("none");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(await (await call("app")).json()).toEqual({ error: "not_found", message: "No such event" });
    const zodRes = await call("zod");
    expect(zodRes.status).toBe(400);
    expect((await zodRes.json()).fieldErrors.email).toHaveLength(1);
    expect((await call("setup")).status).toBe(503);
    const rate = await call("rate");
    expect(rate.status).toBe(429);
    expect(rate.headers.get("retry-after")).toBe("61");
    const boom = await call("boom");
    expect(boom.status).toBe(500);
    const body = await boom.json();
    expect(body).toEqual({ error: "internal", message: "Something went wrong. Try again." });
    expect(boom.headers.get("x-request-id")).toMatch(/^[0-9a-f]{16}$/);
    await expect(call("redirect")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("readJsonBody validates; getClientIp reads forwarding headers", async () => {
    const S = z.object({ n: z.number() });
    const ok = await http.readJsonBody(new Request("http://x/", { method: "POST", body: '{"n":1}' }), S);
    expect(ok).toEqual({ n: 1 });
    await expect(http.readJsonBody(new Request("http://x/", { method: "POST", body: "{bad" }), S)).rejects.toMatchObject({ code: "validation" });
    await expect(http.readJsonBody(new Request("http://x/", { method: "POST", body: '{"n":"x"}' }), S)).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { n: [expect.any(String)] },
    });
    expect(http.getClientIp(new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" } }))).toBe("203.0.113.1");
    expect(http.getClientIp(new Headers({ "x-real-ip": "::ffff:198.51.100.2" }))).toBe("198.51.100.2");
    expect(http.getClientIp(new Headers())).toBeNull();
    expect(http.apiError("conflict").status).toBe(409);
  });
});

describe("runAction", () => {
  const Input = z.object({ name: z.string().min(2, "Too short"), tags: z.array(z.string()).optional() });

  async function signIn() {
    const u = await createUser(t.db);
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    sessionState.data = { session: { id: "s", twoFactorPending: false }, user: row };
    return u;
  }

  it("returns field errors for invalid input (dotted paths) before authenticating", async () => {
    const res = await runAction(Input, { name: "x" }, async () => "never");
    expect(res).toEqual({ ok: false, error: { code: "validation", message: expect.any(String), fieldErrors: { name: ["Too short"] } } });
    const nested = await runAction(z.object({ a: z.object({ b: z.number() }) }), { a: { b: "x" } }, async () => 1);
    expect(!nested.ok && nested.error.fieldErrors?.["a.b"]).toBeTruthy();
  });

  it("requires a session by default and passes the actor and db", async () => {
    expect(await runAction(Input, { name: "ok" }, async () => 1)).toEqual({
      ok: false,
      error: { code: "unauthorized", message: "Please log in to continue." },
    });
    const u = await signIn();
    const res = await runAction(Input, { name: "ok" }, async (input, ctx) => ({ input, orgId: ctx.actor.orgId, hasDb: Boolean(ctx.db) }));
    expect(res).toEqual({ ok: true, data: { input: { name: "ok" }, orgId: u.organizationId, hasDb: true } });
  });

  it("auth none runs without a session (actor null)", async () => {
    const res = await runAction(Input, { name: "ok" }, async (_i, ctx) => ctx.actor, { auth: "none" });
    expect(res).toEqual({ ok: true, data: null });
  });

  it("maps AppError, hides unexpected errors, and rethrows redirect()", async () => {
    await signIn();
    expect(await runAction(Input, { name: "ok" }, async () => {
      throw new AppError("conflict", "Slot taken", { fieldErrors: { start: ["Pick another time"] } });
    })).toEqual({ ok: false, error: { code: "conflict", message: "Slot taken", fieldErrors: { start: ["Pick another time"] } } });
    expect(await runAction(Input, { name: "ok" }, async () => {
      throw new Error("password=hunter2 leaked");
    })).toEqual({ ok: false, error: { code: "internal", message: "Something went wrong. Try again." } });
    await expect(runAction(Input, { name: "ok" }, async () => redirect("/app/scheduling" as Route))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("rate limits by key", async () => {
    await signIn();
    setFakeNow("2030-01-01T00:00:00Z");
    const opts = { rateLimit: { key: (i: { name: string }) => `test-action:${i.name}`, limit: 2, windowSeconds: 60 } };
    expect((await runAction(Input, { name: "rl" }, async () => 1, opts)).ok).toBe(true);
    expect((await runAction(Input, { name: "rl" }, async () => 1, opts)).ok).toBe(true);
    const third = await runAction(Input, { name: "rl" }, async () => 1, opts);
    expect(third).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });

  it("accepts FormData", async () => {
    await signIn();
    const fd = new FormData();
    fd.append("name", "From form");
    fd.append("tags[]", "a");
    fd.append("tags[]", "b");
    fd.append("$ACTION_ID_123", "");
    expect(await runAction(Input, fd, async (i) => i)).toEqual({ ok: true, data: { name: "From form", tags: ["a", "b"] } });
  });
});

describe("formDataToObject", () => {
  it("groups repeated keys and [] keys, keeps files, drops $ACTION_ fields", () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("a", "2");
    fd.append("b[]", "x");
    fd.append("single", "s");
    fd.append("$ACTION_KEY", "k");
    const file = new File(["hi"], "hi.txt", { type: "text/plain" });
    fd.append("file", file);
    const o = formDataToObject(fd);
    expect(o.a).toEqual(["1", "2"]);
    expect(o.b).toEqual(["x"]);
    expect(o.single).toBe("s");
    expect(o.file).toBeInstanceOf(File);
    expect("$ACTION_KEY" in o).toBe(false);
  });

  it("ignores field names that would reach Object.prototype", () => {
    const fd = new FormData();
    fd.append("__proto__[]", "x");
    fd.append("__proto__", "y");
    fd.append("constructor", "z");
    fd.append("toString[]", "w");
    fd.append("ok", "1");
    const o = formDataToObject(fd);
    expect(o).toEqual({ ok: "1" });
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

beforeEach(() => {
  sessionState.data = null;
});
