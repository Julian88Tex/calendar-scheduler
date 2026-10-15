// The public /setup page with a database (SPEC GEN-09): the owner bootstrap row (POST /api/setup/bootstrap,
// OWNER_EMAIL) is listed only while the instance has no account yet. Once an account exists the page no longer
// advertises the endpoint and never shows the owner's address; when the account check fails the row stays hidden.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);

const { users } = await import("@/db/schema");
const { resetRequest } = await import("./_request");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const { default: SetupPage } = await import("@/app/setup/page");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const OWNER = "julian.owner@example.com";

beforeEach(async () => {
  resetRequest();
  env.SETUP_TOKEN = "setup-token-0123456789-abcdefghij";
  env.OWNER_EMAIL = OWNER;
  await t.db.delete(users);
});
afterAll(() => {
  delete env.SETUP_TOKEN;
  delete env.OWNER_EMAIL;
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve({}) }));
}

describe("setup page: owner bootstrap row", () => {
  it("is listed on a fresh instance (no account yet)", async () => {
    const html = await render();
    expect(html).toContain("Owner bootstrap");
    expect(html).toContain("Enabled for OWNER_EMAIL");
    expect(html).not.toContain(OWNER);
  });

  it("is gone once an account exists: no endpoint, no OWNER_EMAIL, never the owner's address", async () => {
    await createUser(t.db, { email: OWNER });
    const html = await render();
    expect(html).toContain("Finish setting up");
    expect(html).toContain("Cron secret");
    for (const hidden of ["Owner bootstrap", "OWNER_EMAIL", "SETUP_TOKEN", "/api/setup/bootstrap", OWNER]) expect(html).not.toContain(hidden);
  });

  it("stays hidden when the account check fails", async () => {
    const db = await import("@/db");
    const getDb = vi.spyOn(db, "getDb").mockRejectedValue(new Error("database down"));
    const html = await render();
    expect(getDb).toHaveBeenCalled();
    expect(html).not.toContain("Owner bootstrap");
    getDb.mockRestore();
  });
});
