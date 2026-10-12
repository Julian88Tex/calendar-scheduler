// Embed-safe cookies (ARCHITECTURE 17 and 18.5, SPEC GEN-08).
import { afterEach, describe, expect, it, vi } from "vitest";

const jar = { set: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: async () => jar,
  headers: async () => new Headers({ cookie: "remember=from-cookie" }),
}));

const {
  appendEmbedSafeCookie,
  deleteEmbedSafeCookie,
  embedSafeCookieAttributes,
  parseCookieHeader,
  readEmbedSafeCookie,
  readEmbedSafeCookieFromHeaders,
  serializeEmbedSafeCookie,
  setEmbedSafeCookie,
} = await import("@/lib/cookies");
const { FALLBACK_HEADER_PREFIX, fallbackHeaderName } = await import("@/lib/client/embed-cookie");

const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  jar.set.mockReset();
  env.APP_URL = "http://localhost:3000";
});

describe("embed-safe cookies", () => {
  it("uses SameSite=None; Secure; Partitioned in embed mode and SameSite=Lax otherwise", () => {
    expect(embedSafeCookieAttributes({ maxAgeSeconds: 60, embed: true })).toEqual({
      httpOnly: true,
      sameSite: "none",
      secure: true,
      partitioned: true,
      path: "/",
      maxAge: 60,
    });
    expect(embedSafeCookieAttributes({ maxAgeSeconds: 60, path: "/p/abc" })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false, // http://localhost in tests
      partitioned: false,
      path: "/p/abc",
      maxAge: 60,
    });
    env.APP_URL = "https://kairos.example.com";
    expect(embedSafeCookieAttributes({ maxAgeSeconds: 60 }).secure).toBe(true);
  });

  it("serializes Set-Cookie headers", () => {
    const embed = serializeEmbedSafeCookie("remember", "tok en", { maxAgeSeconds: 365 * 86400, embed: true });
    expect(embed).toBe("remember=tok%20en; Path=/; Max-Age=31536000; HttpOnly; SameSite=None; Secure; Partitioned");
    const lax = serializeEmbedSafeCookie("poll_edit", "abc", { maxAgeSeconds: 0, path: "/p/x" });
    expect(lax).toContain("SameSite=Lax");
    expect(lax).not.toContain("Partitioned");
    expect(lax).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    const res = appendEmbedSafeCookie(new Response("ok"), "a", "b", { maxAgeSeconds: 10, embed: true });
    expect(res.headers.get("set-cookie")).toContain("Partitioned");
  });

  it("sets and deletes through next/headers cookies()", async () => {
    await setEmbedSafeCookie("remember", "v1", { maxAgeSeconds: 100, embed: true });
    expect(jar.set).toHaveBeenCalledWith("remember", "v1", expect.objectContaining({ sameSite: "none", partitioned: true, secure: true, httpOnly: true }));
    await deleteEmbedSafeCookie("remember", { embed: true });
    expect(jar.set).toHaveBeenLastCalledWith("remember", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("reads the cookie, falling back to the x-kairos-fallback-{name} header", async () => {
    expect(fallbackHeaderName("Remember")).toBe(`${FALLBACK_HEADER_PREFIX}remember`);
    const withCookie = new Request("http://localhost/x", { headers: { cookie: "a=1; remember=abc%3D; b=2" } });
    expect(readEmbedSafeCookie(withCookie, "remember")).toBe("abc=");
    const fallback = new Request("http://localhost/x", { headers: { "x-kairos-fallback-remember": "from-storage" } });
    expect(readEmbedSafeCookie(fallback, "remember")).toBe("from-storage");
    const both = new Request("http://localhost/x", { headers: { cookie: "remember=c", "x-kairos-fallback-remember": "s" } });
    expect(readEmbedSafeCookie(both, "remember")).toBe("c");
    expect(readEmbedSafeCookie(new Request("http://localhost/x"), "remember")).toBeNull();
    expect(await readEmbedSafeCookieFromHeaders("remember")).toBe("from-cookie");
  });

  it("parseCookieHeader keeps the first occurrence and tolerates junk", () => {
    const m = parseCookieHeader('a=1; a=2; b="quoted"; junk; c=%E0%A4%A');
    expect(m.get("a")).toBe("1");
    expect(m.get("b")).toBe("quoted");
    expect(m.get("c")).toBe("%E0%A4%A");
    expect(m.has("junk")).toBe(false);
  });
});
