// The root URL (src/app/(marketing)/page.tsx): a signed-in visitor goes to the app; everyone else (no cookie, a stale
// or revoked session, a session still waiting for its second factor) gets the app's home page, the page Google's OAuth
// verification needs: what the app is, a "Sign in" button, how it uses Google with links to /privacy and /terms. It
// names no account holder (people book through a host's own link). Indexable, and it renders without a database.
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../foundation-auth/_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("../foundation-auth/_request")).nextCacheMock);

const { default: RootPage, generateMetadata } = await import("@/app/(marketing)/page");
const { organizations, users } = await import("@/db/schema");
const { setDbForTests } = await import("@/db");
const { SESSION_COOKIE, createSessionRecord } = await import("@/lib/auth/session");
const { useTestDb } = await import("../helpers/db");
const { createUser } = await import("../factories");
const { expectRedirect, jar, resetRequest } = await import("../foundation-auth/_request");

const t = useTestDb();
const root = path.resolve(__dirname, "../..");
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const PHOTO = "https://lh3.googleusercontent.com/a/julian-photo";

beforeEach(async () => {
  resetRequest();
  await t.db.delete(users);
  await t.db.delete(organizations);
});

const page = () => RootPage({ searchParams: Promise.resolve({}) });

async function html(): Promise<string> {
  return renderToStaticMarkup(await page());
}

/** Visible text: markup and entities removed, whitespace collapsed. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const owner = (over: Parameters<typeof createUser>[1] = {}) =>
  createUser(t.db, { name: "Julian Joseph", email: "julian@example.com", slug: "julianjoseph", isInstanceAdmin: true, ...over });

describe("signed in", () => {
  it("sends the owner to the app", async () => {
    const u = await owner();
    jar.set(SESSION_COOKIE, (await createSessionRecord(t.db, u.id)).token);
    expect(await expectRedirect(page())).toBe("/app/scheduling");
  });
});

describe("signed out: the public home page", () => {
  it("shows the product, what it is, Sign in, how it uses Google and the policy links", async () => {
    await owner({ overrides: { avatarUrl: PHOTO } });
    const markup = await html();
    const visible = text(markup);
    expect(markup).toMatch(/<h1[^>]*>Kairos<\/h1>/);
    expect(visible).toContain("Kairos is a scheduling app.");
    expect(visible).toContain("Booking a meeting? Use the link your host sent you.");
    expect(markup).toMatch(/<h2[^>]*>How it uses Google<\/h2>/);
    for (const s of [
      "connects to the host's Google account to check their Google Calendar for busy times",
      "add booked meetings to that calendar with a Google Meet link",
      "from their Gmail address, a permission that can only send messages and never read mail",
      "check your own Google Calendar's free and busy times; that access is used once and not stored",
      "Google data is used only for scheduling",
    ]) {
      expect(visible, s).toContain(s);
    }
    expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms of Service<\/a>/);
    expect(markup).not.toMatch(DASHES);
    // The public shell: the classic light canvas and its footer (Cookie settings, Privacy Policy).
    expect(markup).toContain("data-public-shell");
    expect(visible).toContain("Cookie settings");
  });

  it("names no account holder: no owner name, photo, handle link or booking button", async () => {
    await createUser(t.db, { name: "Someone Else", slug: "someone", isInstanceAdmin: false });
    await owner({ overrides: { avatarUrl: PHOTO } });
    const markup = await html();
    expect(markup).not.toContain("Julian Joseph");
    expect(markup).not.toContain("Someone Else");
    expect(markup).not.toContain(PHOTO);
    expect(markup).not.toContain('href="/julianjoseph"');
    expect(markup).not.toContain("Book a meeting");
  });

  it("is indexable, titled with the product, and described", async () => {
    await owner();
    const meta = await generateMetadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.title).toEqual({ absolute: "Kairos" });
    expect(meta.description).toBe("Kairos is a scheduling app: people book meetings on your booking page and answer your meeting polls.");
    const src = fs.readFileSync(path.join(root, "src/app/(marketing)/page.tsx"), "utf8");
    expect(src).not.toMatch(/robots|noindex/i);
  });

  it("counts a stale session cookie and a session waiting for its second factor as signed out", async () => {
    const u = await owner();
    jar.set(SESSION_COOKIE, "not-a-real-session");
    expect(text(await html())).toContain("How it uses Google");
    jar.set(SESSION_COOKIE, (await createSessionRecord(t.db, u.id, { twoFactorPending: true })).token);
    expect(await html()).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
  });

  it("renders the same page without any account yet", async () => {
    const markup = await html();
    expect(markup).toMatch(/<h1[^>]*>Kairos<\/h1>/);
    expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(text(markup)).toContain("How it uses Google");
  });

  it("still renders when the database is unavailable", async () => {
    setDbForTests({ select: () => { throw new Error("no database"); } } as never);
    try {
      const markup = await html();
      expect(markup).toMatch(/<h1[^>]*>Kairos<\/h1>/);
      expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
    } finally {
      setDbForTests(t.db);
    }
  });
});
