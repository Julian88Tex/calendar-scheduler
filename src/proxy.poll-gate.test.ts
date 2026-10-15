// The meeting poll voter page HTTP 410 in src/proxy.ts (golden-path-qa; SPEC MP-22 "a deleted poll returns 410"): a
// full page load of /p/{slug} asks GET /api/public/polls/{slug}/state; a gone poll's page is answered with status 410
// (GET with the page HTML, HEAD without a body), everything else renders as usual. The proxy's own requests carry the
// gate header (no recursion), client navigations, prefetches, actions and other methods are never checked, any error
// falls back to the normal page, and every response body the proxy does not read is released (the check runs on every
// voter page view, and an unread body holds its pooled connection).
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_GATE_HEADER, proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
const GONE_HTML = "<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>This poll is no longer available.</body></html>";

type Tracked = { response: Response; canceled: () => boolean };

/** A response whose body stream records whether it was canceled. */
function tracked(body: string, init: ResponseInit): Tracked {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
    cancel() {
      canceled = true;
    },
  });
  return { response: new Response(stream, init), canceled: () => canceled };
}

/** Stubs fetch: the state route answers `stateStatus`, the page answers `page` (or the call throws). */
function stubFetch(p: { stateStatus?: number; stateThrows?: boolean; page?: { status: number; type: string } }) {
  const calls: { url: string; headers: Headers }[] = [];
  const bodies: Tracked[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("/api/public/polls/")) {
        if (p.stateThrows) throw new Error("timeout");
        const status = p.stateStatus ?? 200;
        const t = tracked(JSON.stringify({ state: status === 410 ? "gone" : "live" }), { status, headers: { "content-type": "application/json" } });
        bodies.push(t);
        return t.response;
      }
      const t = tracked(GONE_HTML, { status: p.page?.status ?? 200, headers: { "content-type": p.page?.type ?? "text/html; charset=utf-8" } });
      bodies.push(t);
      return t.response;
    }),
  );
  return { calls, bodies };
}

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => new NextRequest(`${ORIGIN}${path}`, init);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy: voter page of a gone poll", () => {
  it("answers GET with 410 and the page's 'no longer available' HTML (query kept, gate header on both requests)", async () => {
    const { calls, bodies } = stubFetch({ stateStatus: 410 });
    const res = await proxy(req("/p/abc123def0?i=tok"));
    expect(res.status).toBe(410);
    expect(await res.text()).toBe(GONE_HTML);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBeNull(); // voter pages stay embeddable
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/api/public/polls/abc123def0/state`, `${ORIGIN}/p/abc123def0?i=tok`]);
    expect(calls.every((c) => c.headers.get(POLL_GATE_HEADER) === "1")).toBe(true);
    expect(bodies[0]!.canceled()).toBe(true); // the state body is never read
  });

  it("answers HEAD with 410 and no body, releasing the page body", async () => {
    const { bodies } = stubFetch({ stateStatus: 410 });
    const res = await proxy(req("/p/abc123def0", { method: "HEAD" }));
    expect(res.status).toBe(410);
    expect(res.body).toBeNull();
    expect(bodies).toHaveLength(2);
    expect(bodies.every((b) => b.canceled())).toBe(true);
  });

  it("renders a live (or unknown) poll as usual and releases the state body", async () => {
    for (const stateStatus of [200, 404, 400, 500]) {
      const { calls, bodies } = stubFetch({ stateStatus });
      const res = await proxy(req("/p/abc123def0"));
      expect(res.headers.get("x-middleware-next"), String(stateStatus)).toBe("1");
      expect(res.headers.get("x-middleware-request-x-kairos-url")).toBe("/p/abc123def0");
      expect(calls).toHaveLength(1);
      expect(bodies[0]!.canceled(), String(stateStatus)).toBe(true);
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the normal page when the state check fails or the page is not HTML", async () => {
    stubFetch({ stateThrows: true });
    expect((await proxy(req("/p/abc123def0"))).headers.get("x-middleware-next")).toBe("1");
    vi.unstubAllGlobals();
    for (const page of [{ status: 500, type: "text/html" }, { status: 200, type: "application/json" }]) {
      const { bodies } = stubFetch({ stateStatus: 410, page });
      const res = await proxy(req("/p/abc123def0"));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(bodies.every((b) => b.canceled())).toBe(true);
      vi.unstubAllGlobals();
    }
  });

  it("never checks the proxy's own requests, client navigations, prefetches, actions, other methods or other paths", async () => {
    const { calls } = stubFetch({ stateStatus: 410 });
    const skipped = [
      req("/p/abc123def0", { headers: { [POLL_GATE_HEADER]: "1" } }),
      req("/p/abc123def0", { headers: { rsc: "1" } }),
      req("/p/abc123def0", { headers: { "next-router-prefetch": "1" } }),
      req("/p/abc123def0", { method: "POST", headers: { "next-action": "abc" } }),
      req("/p/abc123def0", { method: "POST" }),
      req("/p/abc123def0/unsubscribe"),
      req("/p/"),
      req("/p/has.dot"),
      req("/polls/abc123def0"),
    ];
    for (const r of skipped) expect((await proxy(r)).headers.get("x-middleware-next"), r.url).toBe("1");
    expect(calls).toHaveLength(0);
  });
});
