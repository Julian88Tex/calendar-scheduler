// Foundation harness: the Playwright web server is up on its own PGlite dir, the test API is guarded by the per-run
// secret, the fake clock round-trips, the outbox and fake calendar endpoints answer, and GEN-08 framing headers differ
// between embeddable and non-embeddable pages.
import { expect, test } from "../fixtures";

test.describe("foundation harness", () => {
  test("health reports a working database", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, setupRequired: false, db: "pglite", version: expect.any(String) });
  });

  test("the test API is invisible without the secret", async ({ request }) => {
    for (const path of ["/api/test/reset", "/api/test/time", "/api/test/login", "/api/test/run-jobs", "/api/test/seed"]) {
      expect((await request.post(path, { data: {} })).status(), path).toBe(404);
      expect((await request.post(path, { data: {}, headers: { "x-e2e-secret": "wrong" } })).status(), path).toBe(404);
    }
    expect((await request.get("/api/test/outbox")).status()).toBe(404);
  });

  test("reset, fake time and outbox work with the secret", async ({ api }) => {
    await api.reset();
    const set = await api.setTime("2031-05-04T10:00:00Z");
    expect(Math.abs(Date.parse(set.now) - Date.parse("2031-05-04T10:00:00Z"))).toBeLessThan(5_000);
    const later = await api.advanceTime(3_600_000);
    expect(Date.parse(later.now)).toBeGreaterThan(Date.parse("2031-05-04T10:59:00Z"));
    expect((await api.setTime(null)).offsetMs).toBe(0);
    expect(await api.outbox({ to: "nobody@example.com" })).toEqual([]);
    expect((await api.call("POST", "/api/test/fake-calendar", { email: "nobody@example.com", events: [] })).status()).toBe(404);
  });

  test("framing headers follow the page type (GEN-08)", async ({ request }) => {
    const embeddable = await request.get("/julianjoseph/30min");
    expect(embeddable.headers()["content-security-policy"]).toBe("frame-ancestors *");
    expect(embeddable.headers()["x-frame-options"]).toBeUndefined();
    for (const path of ["/", "/app/scheduling", "/reschedulings/abc", "/login"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(res.headers()["x-frame-options"], path).toBe("DENY");
      expect(res.headers()["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers()["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
  });
});
