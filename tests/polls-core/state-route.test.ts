// GET /api/public/polls/{slug}/state (src/app/api/public/polls/[slug]/state/route.ts, asked by src/proxy.ts before
// every voter page view, SPEC MP-22): 200 live, 410 gone (deleted or canceled, old link endings too), 404 unknown,
// each cacheable at the CDN for a short time (at most 30 seconds in all, so a deletion reaches the voter page's status
// within 30 seconds), and errors never cached.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { deletePoll } = await import("@/lib/polls/manage");
const { updatePoll } = await import("@/lib/polls/update");
const stateRoute = await import("@/app/api/public/polls/[slug]/state/route");
const { useTestDb } = await import("../helpers/db");
const { NOW, newPoll, setupHost } = await import("./helpers");

const t = useTestDb();
const ORIGIN = "http://localhost:3000";
beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

const get = (slug: string) => stateRoute.GET(new Request(`${ORIGIN}/api/public/polls/${slug}/state`), { params: Promise.resolve({ slug }) });

/** s-maxage plus stale-while-revalidate: the longest a cached answer can be served (seconds). */
function cdnSeconds(cacheControl: string | null): number {
  const n = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(cacheControl ?? "")?.[1] ?? Number.NaN);
  return n("s-maxage") + n("stale-while-revalidate");
}

describe("GET /api/public/polls/{slug}/state", () => {
  it("answers live, then gone after a deletion (old link ending too), each cacheable at the CDN for at most 30 seconds", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);

    const live = await get(slug);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ state: "live" });
    const cc = live.headers.get("cache-control");
    expect(cc).toMatch(/^public, /);
    expect(cc).toContain("max-age=0");
    expect(cc).toMatch(/s-maxage=\d+/);
    expect(cdnSeconds(cc)).toBeGreaterThan(0);
    expect(cdnSeconds(cc)).toBeLessThanOrEqual(30);
    expect(cc).not.toContain("no-store");

    await updatePoll(host.actor, { pollId, slug: "renamed-state-poll" });
    await deletePoll(host.actor, { pollId, notify: false });
    for (const s of ["renamed-state-poll", slug]) {
      const gone = await get(s);
      expect(gone.status, s).toBe(410);
      expect(await gone.json()).toEqual({ state: "gone" });
      expect(gone.headers.get("cache-control")).toBe(cc);
    }
  });

  it("answers an unknown slug with a cacheable 404, and a malformed one with an uncached 404", async () => {
    const unknown = await get("no-such-poll");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "not_found" });
    expect(cdnSeconds(unknown.headers.get("cache-control"))).toBeLessThanOrEqual(30);
    expect(unknown.headers.get("cache-control")).toMatch(/^public, /);

    const malformed = await get("bad%ZZslug");
    expect(malformed.status).toBe(404);
    expect(malformed.headers.get("cache-control")).toContain("no-store");
  });
});
