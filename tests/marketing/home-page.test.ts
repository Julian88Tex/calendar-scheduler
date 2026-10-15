// The root URL (src/app/(marketing)/page.tsx): a signed-in visitor goes to the app; everyone else (no cookie, a stale
// or revoked session, a session still waiting for its second factor) gets the public home page Google's OAuth
// verification needs: the owner's name and photo, what the site is for, how it uses Google with links to /privacy and
// /terms, a button to the owner's booking page and a "Sign in" link. Indexable, and it still renders without an owner
// or without a database.
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
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
  it("shows the owner's name and photo, what the site is, how it uses Google, the booking button and Sign in", async () => {
    await owner({ overrides: { avatarUrl: PHOTO } });
    const markup = await html();
    const visible = text(markup);
    expect(markup).toMatch(/<h1[^>]*>Julian Joseph<\/h1>/);
    expect(markup).toContain(`src="${PHOTO}"`);
    expect(visible).toContain("This is Julian Joseph's personal scheduling site, built with Kairos, where people book meetings and answer meeting polls.");
    expect(markup).toMatch(/<h2[^>]*>How it uses Google<\/h2>/);
    for (const s of [
      "connects to Julian Joseph's Google account to check their Google Calendar for busy times",
      "add booked meetings to that calendar with a Google Meet link",
      "from their Gmail address, a permission that can only send messages and never read mail",
      "check your own Google Calendar's free and busy times; that access is used once and not stored",
      "Google data is used only for scheduling",
    ]) {
      expect(visible, s).toContain(s);
    }
    expect(markup).toMatch(/<a [^>]*href="\/julianjoseph"[^>]*>Book a meeting<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms of Service<\/a>/);
    expect(markup).not.toMatch(DASHES);
    // The public shell: the classic light canvas and its footer (Cookie settings, Privacy Policy).
    expect(markup).toContain("data-public-shell");
    expect(visible).toContain("Cookie settings");
  });

  it("is indexable, titled with the owner and the product, and described", async () => {
    await owner();
    const meta = await generateMetadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.title).toEqual({ absolute: "Julian Joseph | Kairos" });
    expect(meta.description).toBe("Julian Joseph's personal scheduling site. Book a meeting or answer a meeting poll.");
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

  it("shows the first instance admin, never another account, and initials without a photo", async () => {
    await createUser(t.db, { name: "Someone Else", slug: "someone", isInstanceAdmin: false });
    const first = await owner();
    await createUser(t.db, { name: "Later Admin", slug: "later", isInstanceAdmin: true });
    await t.db.update(users).set({ createdAt: new Date(Date.now() - 86_400_000) }).where(eq(users.id, first.id));
    const markup = await html();
    expect(markup).toMatch(/<h1[^>]*>Julian Joseph<\/h1>/);
    expect(markup).toContain('href="/julianjoseph"');
    expect(markup).not.toContain("Someone Else");
    expect(markup).not.toContain("Later Admin");
    expect(markup).toContain(">JJ<");
  });

  it("without an owner yet: the product name, no booking button, still Sign in and the Google paragraph", async () => {
    const markup = await html();
    const visible = text(markup);
    expect(markup).toMatch(/<h1[^>]*>Kairos<\/h1>/);
    expect(visible).toContain("This is a personal scheduling site, built with Kairos");
    expect(visible).toContain("connects to the owner's Google account to check their Google Calendar for busy times");
    expect(markup).not.toContain("Book a meeting");
    expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(await generateMetadata()).toMatchObject({ title: { absolute: "Kairos" } });
  });

  it("an owner without a link gets no booking button", async () => {
    await owner({ withoutHandle: true, overrides: { slug: null } });
    const markup = await html();
    expect(markup).toMatch(/<h1[^>]*>Julian Joseph<\/h1>/);
    expect(markup).not.toContain("Book a meeting");
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
