// Foundation shared libraries against the running server: the proxy's /app login redirect, robots.txt and
// sitemap.xml (dynamic), the files route, and the test login route wired to the sessions core.
import { expect, test } from "../fixtures";

test.describe("foundation shared libs", () => {
  test("the proxy sends signed-out /app requests to /login with next", async ({ request }) => {
    const res = await request.get("/app/meetings?tab=past", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers()["location"]!, "http://localhost");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/app/meetings?tab=past");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });

  test("robots.txt and sitemap.xml are served dynamically", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain("Disallow: /app");
    expect(text).toContain("Disallow: /reschedulings");
    expect(text).toMatch(/Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });

  test("files route answers 404 JSON for unknown or invalid ids", async ({ request }) => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await request.get(`/api/files/${id}`);
      expect(res.status(), id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
  });

  test("test login answers 404 for an unknown email (route wired to the sessions core)", async ({ api }) => {
    await api.reset();
    const res = await api.call("POST", "/api/test/login", { email: "nobody@example.com" });
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
