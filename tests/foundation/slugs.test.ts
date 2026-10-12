// Slugs and handles (SPEC GEN-02, AU-01, AU-15).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { handles, teams, users } from "@/db/schema";
import { isAppError } from "@/lib/errors";
import { EMBEDDABLE_SEGMENTS, NON_EMBEDDABLE_SEGMENTS } from "@/lib/net/frame-policy";
import {
  HANDLE_UNAVAILABLE_MESSAGE,
  RESERVED_SLUGS,
  claimHandle,
  isHandleAvailable,
  isReservedSlug,
  isValidEventSlug,
  isValidHandle,
  normalizeHandle,
  releaseHandle,
  slugify,
  suggestHandle,
} from "@/lib/slugs";
import { useTestDb } from "../helpers/db";
import { createTeam, createUser } from "../factories";

describe("slugify (GEN-02)", () => {
  it.each([
    ["Student Office Hours!", "student-office-hours"],
    ["30 Minute Meeting", "30-minute-meeting"],
    ["  Hello   World  ", "hello-world"],
    ["snake_case_name", "snake-case-name"],
    ["Crème Brûlée Café", "creme-brulee-cafe"],
    ["--Leading and trailing--", "leading-and-trailing"],
    ["a---b___c", "a-b-c"],
    ["Ünïcode & symbols @#$%", "unicode-symbols"],
    ["日本語", ""],
    ["UPPER", "upper"],
  ])("%s -> %s", (input, out) => {
    expect(slugify(input)).toBe(out);
  });

  it("cuts to the max length without a trailing hyphen", () => {
    const s = slugify(`${"a".repeat(49)} bcd`, { maxLength: 50 });
    expect(s).toBe("a".repeat(49));
    expect(slugify("x".repeat(300))).toHaveLength(100);
    expect(normalizeHandle("Julian Joseph")).toBe("julian-joseph");
    expect(normalizeHandle("x".repeat(80))).toHaveLength(50);
  });
});

describe("handle and event slug rules", () => {
  it("validates the GEN-02 patterns", () => {
    for (const ok of ["a", "julianjoseph", "julian-joseph", "a1", "1a", "x".repeat(50)]) expect(isValidHandle(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "A", "a b", "a_b", "x".repeat(51), "é"]) expect(isValidHandle(bad)).toBe(false);
    for (const ok of ["30min", "a", "meal", "x".repeat(100)]) expect(isValidEventSlug(ok)).toBe(true);
    for (const bad of ["", "-x", "x-", "X", "x".repeat(101)]) expect(isValidEventSlug(bad)).toBe(false);
  });

  it("rejects reserved words case-insensitively", () => {
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("Login")).toBe(true);
    expect(isReservedSlug("LOGIN ")).toBe(true);
    expect(isReservedSlug("julian")).toBe(false);
    expect(isValidHandle("api")).toBe(false);
    expect(isValidHandle(normalizeHandle("Login"))).toBe(false);
    for (const w of ["app", "admin", "d", "p", "r", "booking", "reconfirm", "embed", "cookie-policy", "verify-email", "setup", "www", "system"]) {
      expect(RESERVED_SLUGS).toContain(w);
    }
  });

  it("every reserved word is non-embeddable in the frame policy (except the embeddable prefixes)", () => {
    for (const w of RESERVED_SLUGS) {
      if (EMBEDDABLE_SEGMENTS.includes(w)) continue;
      expect(NON_EMBEDDABLE_SEGMENTS, w).toContain(w);
    }
  });
});

describe("handles in the database", () => {
  const t = useTestDb();

  it("claims, re-claims idempotently, and changes a user's handle (old slug released, mirror updated)", async () => {
    const u = await createUser(t.db, { slug: "first-handle" });
    await t.db.transaction(async (tx) => {
      await claimHandle(tx, "first-handle", { userId: u.id }); // already held: idempotent
      await claimHandle(tx, "second-handle", { userId: u.id });
    });
    const rows = await t.db.select().from(handles).where(eq(handles.userId, u.id));
    expect(rows.map((r) => r.slug)).toEqual(["second-handle"]);
    const [row] = await t.db.select({ slug: users.slug }).from(users).where(eq(users.id, u.id));
    expect(row?.slug).toBe("second-handle");
    expect(await isHandleAvailable(t.db, "first-handle")).toBe(true);
    expect(await isHandleAvailable(t.db, "second-handle")).toBe(false);
    expect(await isHandleAvailable(t.db, "second-handle", { userId: u.id })).toBe(true);
  });

  it("fails with 'This URL is not available.' for reserved, invalid and taken slugs (users and teams share one namespace)", async () => {
    const a = await createUser(t.db, { slug: "taken-by-user" });
    const b = await createUser(t.db);
    const { team } = await createTeam(t.db, { organizationId: a.organizationId, slug: "taken-by-team" });
    for (const slug of ["api", "login", "Bad Slug", "-x", "taken-by-user", "taken-by-team"]) {
      const err = await claimHandle(t.db, slug, { userId: b.id }).catch((e: unknown) => e);
      expect(isAppError(err), slug).toBe(true);
      expect((err as Error).message).toBe(HANDLE_UNAVAILABLE_MESSAGE);
      expect((err as { code: string }).code).toBe("conflict");
      expect((err as { fieldErrors: Record<string, string[]> }).fieldErrors.slug).toEqual([HANDLE_UNAVAILABLE_MESSAGE]);
    }
    // A team cannot take a user's slug either.
    await expect(claimHandle(t.db, "taken-by-user", { teamId: team.id })).rejects.toThrow(HANDLE_UNAVAILABLE_MESSAGE);
    await claimHandle(t.db, "team-renamed", { teamId: team.id });
    const [teamRow] = await t.db.select({ slug: teams.slug }).from(teams).where(eq(teams.id, team.id));
    expect(teamRow?.slug).toBe("team-renamed");
    expect(await isHandleAvailable(t.db, "taken-by-team")).toBe(true);
  });

  it("releaseHandle frees a slug by owner or by slug (AU-15)", async () => {
    const u = await createUser(t.db, { slug: "leaving-user" });
    await releaseHandle(t.db, { userId: u.id });
    expect(await isHandleAvailable(t.db, "leaving-user")).toBe(true);
    const v = await createUser(t.db, { slug: "other-leaving" });
    await releaseHandle(t.db, { slug: "other-leaving" });
    expect(await t.db.select().from(handles).where(eq(handles.userId, v.id))).toHaveLength(0);
  });

  it("suggestHandle de-duplicates with numeric suffixes and avoids reserved words", async () => {
    await createUser(t.db, { slug: "sam-smith" });
    await createUser(t.db, { slug: "sam-smith2" });
    expect(await suggestHandle(t.db, "Sam Smith")).toBe("sam-smith3");
    expect(await suggestHandle(t.db, "brand-new-person")).toBe("brand-new-person");
    expect(await suggestHandle(t.db, "jane.doe+x@example.com")).toBe("janedoex");
    expect(await suggestHandle(t.db, "Admin")).toBe("admin2");
    expect(await suggestHandle(t.db, "!!!")).toBe("user");
    const long = await suggestHandle(t.db, "y".repeat(80));
    expect(long).toHaveLength(50);
  });
});
