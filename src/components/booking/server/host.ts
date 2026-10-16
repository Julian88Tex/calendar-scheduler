// Host profile, branding and legal links of the public pages (SPEC BK-01, BK-03, BR-05 to BR-07, GEN-14). Server only.
//
// - avatar: the uploaded avatar file, else the provider avatar URL
// - logo (BR-05) and colors (BR-07, empty means the classic tokens), "Powered by" ribbon unless branding hides it (BR-06)
// - privacy policy and terms links: only when configured (instance settings `privacy_policy_url` / `terms_url`, or the
//   host's users.metadata.privacyPolicyUrl), so no public page links to a page that does not exist
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { instanceSettings, users } from "@/db/schema";
import { fileUrl } from "@/lib/files";
import { log } from "@/lib/logger";
import { isValidTimeZone } from "@/lib/time/zones";

export type HostProfile = {
  id: string;
  name: string;
  email: string | null;
  slug: string | null;
  avatarUrl: string | null;
  logoUrl: string | null;
  timezone: string;
  locale: string;
  weekStart: 0 | 1;
  welcomeMessage: string | null;
  showBranding: boolean;
  brandColors: { primary: string | null; background: string | null; text: string | null };
  privacyUrl: string | null;
};

const DEFAULT_WELCOME = "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.";

/** An http(s) URL or a same-site path, else null (javascript:, data: and protocol-relative values are dropped). */
export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 2000) return null;
  if (/^\/(?![/\\])[^\s]*$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "#rrggbb" when valid, else null. */
function hex(value: unknown): string | null {
  return typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value.trim()) ? `#${value.trim().replace(/^#/, "").toLowerCase()}` : null;
}

export function avatarOf(u: { avatarFileId: string | null; avatarUrl: string | null }): string | null {
  return u.avatarFileId ? fileUrl(u.avatarFileId) : (safeLink(u.avatarUrl) ?? null);
}

/** Instance-level legal links (cached per request). */
export const getLegalLinks = cache(async (): Promise<{ privacyUrl: string | null; termsUrl: string | null }> => {
  try {
    const db = await getDb();
    const rows = await db
      .select({ key: instanceSettings.key, value: instanceSettings.value })
      .from(instanceSettings)
      .where(inArray(instanceSettings.key, ["privacy_policy_url", "terms_url"]));
    const get = (k: string) => safeLink(rows.find((r) => r.key === k)?.value);
    return { privacyUrl: get("privacy_policy_url"), termsUrl: get("terms_url") };
  } catch (e) {
    log.warn("booking.legal_links_failed", { error: e });
    return { privacyUrl: null, termsUrl: null };
  }
});

type UserRow = typeof users.$inferSelect;

export function profileOf(u: UserRow, instancePrivacyUrl: string | null): HostProfile {
  const metadata = (u.metadata ?? {}) as Record<string, unknown>;
  const colors = (u.brandColors ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    name: u.name?.trim() || u.email || "",
    email: u.email,
    slug: u.slug,
    avatarUrl: avatarOf(u),
    logoUrl: u.logoFileId ? fileUrl(u.logoFileId) : null,
    timezone: isValidTimeZone(u.timezone) ? u.timezone : "UTC",
    locale: u.locale || "en",
    weekStart: u.weekStart === 1 ? 1 : 0,
    welcomeMessage: u.welcomeMessage === null || u.welcomeMessage === undefined ? DEFAULT_WELCOME : u.welcomeMessage.trim() || null,
    showBranding: u.showBranding !== false,
    brandColors: { primary: hex(colors.primary), background: hex(colors.background), text: hex(colors.text) },
    privacyUrl: safeLink(metadata.privacyPolicyUrl) ?? instancePrivacyUrl,
  };
}

/** A live (not deleted) user's public profile, or null. */
export async function loadHostProfile(userId: string): Promise<HostProfile | null> {
  const db = await getDb();
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return null;
  const legal = await getLegalLinks();
  return profileOf(u, legal.privacyUrl);
}

/** Name and avatar of several users, in the given order (missing and deleted users are skipped). */
export async function loadPeople(userIds: string[]): Promise<{ id: string; name: string; avatarUrl: string | null }[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarFileId: users.avatarFileId, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ id: r.id, name: r.name?.trim() || r.email || "", avatarUrl: avatarOf(r) }));
}
