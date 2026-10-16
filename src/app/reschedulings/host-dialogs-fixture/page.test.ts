// The host dialogs fixture ships with the app but is a test page (golden-path-qa): outside E2E test mode (always on
// Vercel) it answers the 404 page before touching the session or the database, and its metadata does not name it.
import { afterEach, describe, expect, it, vi } from "vitest";

const e2e = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), isE2eMode: () => e2e.on }));
// Stands in for the session read (the first thing the page does in E2E mode).
const getActorCtx = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("session read");
  }),
);
vi.mock("@/lib/authz", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/authz")>()), getActorCtx }));

const { default: Page, generateMetadata, dynamic } = await import("./page");

afterEach(() => {
  e2e.on = false;
  getActorCtx.mockClear();
});

describe("/reschedulings/host-dialogs-fixture", () => {
  it("is the 404 page outside E2E test mode", async () => {
    await expect(Page()).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404/) });
    expect(getActorCtx).not.toHaveBeenCalled();
    expect(generateMetadata()).toMatchObject({ title: "Page not found", robots: { index: false, follow: false } });
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads the signed-in user in E2E test mode", async () => {
    e2e.on = true;
    expect(generateMetadata()).toMatchObject({ title: "Host dialogs fixture" });
    await expect(Page()).rejects.toThrow("session read");
    expect(getActorCtx).toHaveBeenCalledTimes(1);
  });
});
