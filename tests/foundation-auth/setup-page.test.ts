// The /setup page in setup mode (SPEC GEN-09, ADM-11): with VERCEL=1 and no database URL it renders the title, the four
// steps, the checklist and the exact redirect URIs without touching the database (the proxy serves this HTML with
// status 503 for every page; e2e/foundation/setup.spec.ts checks the status end to end).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);

const env = process.env as Record<string, string | undefined>;
afterEach(() => {
  delete env.VERCEL;
  env.APP_URL = "http://localhost:3000";
});

describe("setup page", () => {
  it("renders the setup content in setup mode without any database access", async () => {
    env.VERCEL = "1";
    env.APP_URL = "https://cal.example.com";
    const db = await import("@/db");
    const getDb = vi.spyOn(db, "getDb");
    const { default: SetupPage } = await import("@/app/setup/page");
    const html = renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve({}) }));
    expect(getDb).not.toHaveBeenCalled();
    expect(html).toContain("Finish setting up Kairos");
    expect(html).toContain("needs a Postgres database before it can run");
    for (const step of [
      "Open your project in Vercel",
      "Go to the Storage tab",
      "Create a Neon Postgres database and connect it to this project (all environments)",
      "Redeploy",
    ]) {
      expect(html).toContain(step);
    }
    expect(html).toContain("Required: connect a Postgres database");
    expect(html).toContain("Not configured");
    expect(html).toContain("Outbox only");
    expect(html).toContain("https://cal.example.com/api/auth/google/callback");
    expect(html).toContain("https://cal.example.com/api/auth/microsoft/callback");
    expect(html).not.toContain("zoom");
    expect(html).toContain("Available once a database is connected.");
    expect(html).toContain("#optional-environment-variables");
    getDb.mockRestore();
  });
});
