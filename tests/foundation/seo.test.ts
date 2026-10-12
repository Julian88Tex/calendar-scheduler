// robots.ts and sitemap.ts (SPEC GEN-13).
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { setDbForTests } from "@/db";
import { useTestDb } from "../helpers/db";
import { createEventType, createTeam, createUser } from "../factories";

describe("robots.txt", () => {
  it("allows / and disallows private and capability paths", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(["/app", "/api", "/d/", "/p/", "/r/", "/booking", "/cancellations", "/reschedulings", "/reconfirm"]);
    expect(r.sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  const t = useTestDb();

  it("lists marketing pages, landing pages and public event types only", async () => {
    const owner = await createUser(t.db, { slug: "sitemap-owner" });
    await createEventType(t.db, { owner, slug: "public-30" });
    await createEventType(t.db, { owner, slug: "secret-30", overrides: { secret: true } });
    await createEventType(t.db, { owner, slug: "off-30", overrides: { active: false } });
    await createEventType(t.db, { owner, slug: "gone-30", overrides: { deletedAt: new Date() } });
    await createEventType(t.db, { owner, slug: "adhoc-30", type: "adhoc" });
    await createEventType(t.db, { owner, slug: "shared-30", scope: "shared", poolingType: "collective" });
    const { team } = await createTeam(t.db, { organizationId: owner.organizationId, slug: "sitemap-team" });
    await createEventType(t.db, { team, slug: "team-60", hosts: [{ userId: owner.id }] });

    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining([
      "http://localhost:3000",
      "http://localhost:3000/privacy",
      "http://localhost:3000/sitemap-owner",
      "http://localhost:3000/sitemap-owner/public-30",
      "http://localhost:3000/sitemap-team",
      "http://localhost:3000/sitemap-team/team-60",
    ]));
    for (const hidden of ["secret-30", "off-30", "gone-30", "adhoc-30", "shared-30"]) {
      expect(urls.some((u) => u.endsWith(`/${hidden}`)), hidden).toBe(false);
    }
  });

  it("falls back to the marketing pages when the database is unavailable", async () => {
    setDbForTests({ select: () => { throw new Error("no database"); } } as never);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual([
      "http://localhost:3000",
      "http://localhost:3000/privacy",
      "http://localhost:3000/terms",
      "http://localhost:3000/cookie-policy",
      "http://localhost:3000/help",
    ]);
    setDbForTests(t.db);
  });
});
