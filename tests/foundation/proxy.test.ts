// src/proxy.ts decisions (ARCHITECTURE section 4, SPEC GEN-08 framing, GEN-09 setup gating).
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSetupMode, legacyHostRedirect, proxy, proxyDecision } from "@/proxy";

const env = process.env as Record<string, string | undefined>;
const SETUP = { VERCEL: "1" };

afterEach(() => {
  delete env.VERCEL;
  delete env.DATABASE_URL;
  vi.unstubAllGlobals();
});

describe("proxyDecision", () => {
  it("setup gating on Vercel without a database URL (GEN-09)", () => {
    expect(isSetupMode(SETUP)).toBe(true);
    expect(isSetupMode({ VERCEL: "1", DATABASE_URL: "postgres://x" })).toBe(false);
    expect(isSetupMode({ VERCEL: "1", POSTGRES_URL: "postgres://x" })).toBe(false);
    expect(isSetupMode({})).toBe(false); // local: PGlite

    const d = (pathname: string, hasSession = false) => proxyDecision({ pathname, hasSession, env: SETUP }).kind;
    expect(d("/")).toBe("setup_page");
    expect(d("/julianjoseph")).toBe("setup_page");
    expect(d("/julianjoseph/30min")).toBe("setup_page");
    expect(d("/app/scheduling", true)).toBe("setup_page");
    expect(d("/login")).toBe("setup_page");
    expect(d("/setup")).toBe("next");
    expect(d("/api/health")).toBe("next");
    expect(d("/api/v1/users/me")).toBe("setup_api");
    expect(d("/api/cron")).toBe("setup_api");
    expect(d("/api")).toBe("setup_api");
    expect(d("/_next/static/chunks/main.js")).toBe("next");
    expect(d("/embed.js")).toBe("next");
    expect(d("/widget.css")).toBe("next");
    expect(d("/logos/google.svg")).toBe("next");
    expect(d("/robots.txt")).toBe("next");
    expect(d("/sitemap.xml")).toBe("next");
  });

  it("redirects /app without a sid cookie to /login?next=... (path and query kept)", () => {
    expect(proxyDecision({ pathname: "/app/meetings", search: "?tab=past", hasSession: false, env: {} })).toEqual({
      kind: "login_redirect",
      location: `/login?next=${encodeURIComponent("/app/meetings?tab=past")}`,
    });
    expect(proxyDecision({ pathname: "/app", hasSession: false, env: {} }).kind).toBe("login_redirect");
    expect(proxyDecision({ pathname: "/app/meetings", hasSession: true, env: {} }).kind).toBe("next");
    expect(proxyDecision({ pathname: "/apple", hasSession: false, env: {} }).kind).toBe("next"); // a handle, not /app
    expect(proxyDecision({ pathname: "/julianjoseph", hasSession: false, env: {} }).kind).toBe("next");
    expect(proxyDecision({ pathname: "/api/v1/x", hasSession: false, env: {} }).kind).toBe("next");
  });
});

describe("proxy()", () => {
  const req = (url: string, cookie?: string) =>
    new NextRequest(url, { headers: cookie ? { cookie } : {} });

  it("login redirect carries next and the deny-framing headers", async () => {
    const res = await proxy(req("http://localhost:3000/app/workflows/new?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent("/app/workflows/new?x=1")}`,
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("passes requests through with the x-kairos-url request header", async () => {
    const res = await proxy(req("http://localhost:3000/app/meetings?tab=past", "sid=abc"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-middleware-request-x-kairos-url")).toBe("/app/meetings?tab=past");
  });

  it("answers API requests with 503 setup_required JSON in setup mode", async () => {
    env.VERCEL = "1";
    const res = await proxy(req("http://localhost:3000/api/v1/users/me"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "setup_required" });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("renders the setup page with status 503 in setup mode (static fallback when /setup is unreachable)", async () => {
    env.VERCEL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await proxy(req("http://localhost:3000/julianjoseph"));
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("Finish setting up Kairos");
    expect(html).toContain("Go to the Storage tab");
    expect(res.headers.get("x-frame-options")).toBe("DENY");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Setup page from /setup</body></html>", { headers: { "content-type": "text/html" } })),
    );
    const res2 = await proxy(req("http://localhost:3000/"));
    expect(res2.status).toBe(503);
    expect(await res2.text()).toContain("Setup page from /setup");
  });
});

describe("retired address redirect", () => {
  const ENV = { APP_URL: "https://julendly.vercel.app" };
  const OLD = "calendar-scheduler-smoky.vercel.app";

  it("forwards page requests on the old address to the same path on APP_URL", () => {
    expect(legacyHostRedirect({ host: OLD, pathname: "/julianjoseph/30min", search: "?month=2026-11", env: ENV })).toBe(
      "https://julendly.vercel.app/julianjoseph/30min?month=2026-11",
    );
    expect(legacyHostRedirect({ host: OLD.toUpperCase(), pathname: "/", env: ENV })).toBe("https://julendly.vercel.app/");
    expect(proxyDecision({ pathname: "/app/scheduling", hasSession: false, host: OLD, env: ENV })).toEqual({
      kind: "host_redirect",
      location: "https://julendly.vercel.app/app/scheduling",
    });
  });

  it("leaves API routes, other hosts and a missing APP_URL alone", () => {
    expect(legacyHostRedirect({ host: OLD, pathname: "/api/webhooks/calendars/google", env: ENV })).toBeNull();
    expect(legacyHostRedirect({ host: OLD, pathname: "/api", env: ENV })).toBeNull();
    expect(legacyHostRedirect({ host: "julendly.vercel.app", pathname: "/", env: ENV })).toBeNull();
    expect(legacyHostRedirect({ host: "calendar-scheduler-git-x-julian88texs-projects.vercel.app", pathname: "/", env: ENV })).toBeNull();
    expect(legacyHostRedirect({ host: OLD, pathname: "/", env: {} })).toBeNull();
    expect(legacyHostRedirect({ host: OLD, pathname: "/", env: { APP_URL: `https://${OLD}` } })).toBeNull();
    expect(legacyHostRedirect({ host: null, pathname: "/", env: ENV })).toBeNull();
  });

  it("proxy answers 308 on the old address and passes webhooks through", async () => {
    env.APP_URL = "https://julendly.vercel.app";
    try {
      const page = await proxy(new NextRequest(`https://${OLD}/julianjoseph?x=1`, { headers: { host: OLD } }));
      expect(page.status).toBe(308);
      expect(page.headers.get("location")).toBe("https://julendly.vercel.app/julianjoseph?x=1");
      const hook = await proxy(new NextRequest(`https://${OLD}/api/webhooks/calendars/google`, { method: "POST", headers: { host: OLD } }));
      expect(hook.status).not.toBe(308);
      expect(hook.headers.get("location")).toBeNull();
    } finally {
      delete env.APP_URL;
    }
  });
});
