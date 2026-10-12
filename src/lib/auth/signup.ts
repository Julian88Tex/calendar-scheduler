// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// createUserAccount (ARCHITECTURE section 18.4, SPEC AU-01, AU-13): the single way to create an account. Email signup,
// OAuth signup, invitation acceptance (teams-org) and the seed all call it inside their own transaction. It creates:
// - the user (email normalized for uniqueness; display keeps the original),
// - the handle (slug derived from the preferred slug, the name or the email, de-duplicated with numeric suffixes),
// - a new organization "{Name}'s workspace" with an owner membership, unless organizationId is given (then a membership
//   with `role`, default "user"),
// - the default schedule "Working hours" (Mon to Fri 09:00 to 17:00 in the detected zone, UTC when unknown),
// - the default event type "30 Minute Meeting" (slug 30min, 30 minutes, color #8247F5, location empty or Google Meet /
//   Microsoft Teams per AU-13, the ET-33 defaults, the default schedule, its host row and the default question),
// - a user.created domain event.
// FULLY IMPLEMENTED by the foundation core (the seed and factories need it); foundation-auth keeps the signature and
// may extend it. It never sets cookies, sends email or checks the signup policy: callers do.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { eventTypeHosts, eventTypeQuestions, eventTypes, organizationMemberships, organizations, users } from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { ensureDefaultSchedule } from "@/lib/availability";
import { AppError, isAppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { isSupportedLocale } from "@/lib/i18n/locales";
import { newId } from "@/lib/ids";
import { claimHandle, suggestHandle } from "@/lib/slugs";
import { zoneOrUtc } from "@/lib/time/zones";
import { normalizeEmail } from "@/lib/validation";

export type UserRow = typeof users.$inferSelect;

export type CreateUserAccountInput = {
  email: string;
  name: string;
  /** scrypt hash from hashPassword(); omit for OAuth-only accounts. */
  passwordHash?: string | null;
  /** Join this organization (invitation acceptance) instead of creating a new one. */
  organizationId?: string | null;
  /** Role in `organizationId` (default "user"); ignored for a new organization (always "owner"). */
  role?: "owner" | "admin" | "user";
  /** Detected IANA zone (browser or provider); UTC when unknown or invalid. */
  timezone?: string | null;
  createdViaInvitationId?: string | null;
  /** Provider avatar URL (Google, Microsoft). */
  avatarUrl?: string | null;
  // Extensions (optional, foundation core):
  /** Preferred handle (normalized; a numeric suffix is added when taken). Default: derived from the name, else email. */
  slug?: string | null;
  /** Set for verified provider emails (OAuth signups). */
  emailVerifiedAt?: Date | null;
  /** Profile locale (default "en"); the default event type uses it when supported. */
  locale?: string | null;
  /** AU-11: the first account of an instance becomes instance admin (decided by the caller's signup policy). */
  isInstanceAdmin?: boolean;
  /** Name of a new organization (default "{Name}'s workspace"). */
  organizationName?: string | null;
  /** AU-13: Google Meet for Google signups, Microsoft Teams for work Microsoft accounts, else no location. */
  defaultEventLocationKind?: "google_conference" | "microsoft_teams_conference" | null;
};

export const DEFAULT_EVENT_TYPE = {
  name: "30 Minute Meeting",
  slug: "30min",
  durationMinutes: 30,
  color: "#8247f5",
} as const;

export const DEFAULT_QUESTION_LABEL = "Please share anything that will help prepare for our meeting.";

export const EMAIL_TAKEN_MESSAGE = "An account with this email already exists. Log in instead.";

/** Display name fallback: the trimmed name, else the email's local part. */
function displayName(name: string, email: string): string {
  const trimmed = name.trim();
  return trimmed || email.split("@")[0] || email;
}

async function claimFreshHandle(tx: DbOrTx, userId: string, base: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await suggestHandle(tx, attempt === 0 ? base : `${base}-${Math.floor(Math.random() * 9000) + 1000}`);
    try {
      return await claimHandle(tx, candidate, { userId });
    } catch (e) {
      // A concurrent signup claimed the same candidate between our check and insert: try the next one.
      if (!isAppError(e) || e.code !== "conflict") throw e;
      lastError = e;
    }
  }
  throw lastError ?? new AppError("conflict", "This URL is not available.");
}

/** Creates a complete account (AU-13 defaults). Throws AppError("conflict") when the email is taken. */
export async function createUserAccount(tx: DbOrTx, input: CreateUserAccountInput): Promise<UserRow> {
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  const name = displayName(input.name, email);
  const timezone = zoneOrUtc(input.timezone);
  const locale = input.locale && isSupportedLocale(input.locale) ? input.locale : "en";

  const inserted = await tx
    .insert(users)
    .values({
      email,
      emailNormalized,
      name,
      passwordHash: input.passwordHash ?? null,
      timezone,
      locale,
      avatarUrl: input.avatarUrl ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      isInstanceAdmin: input.isInstanceAdmin ?? false,
      createdViaInvitationId: input.createdViaInvitationId ?? null,
    })
    .onConflictDoNothing({ target: users.emailNormalized, where: sql`deleted_at is null` })
    .returning({ id: users.id });
  const userId = inserted[0]?.id;
  if (!userId) throw new AppError("conflict", EMAIL_TAKEN_MESSAGE, { fieldErrors: { email: [EMAIL_TAKEN_MESSAGE] } });

  await claimFreshHandle(tx, userId, input.slug?.trim() || name || email);

  let organizationId = input.organizationId ?? null;
  if (organizationId) {
    await tx.insert(organizationMemberships).values({ organizationId, userId, role: input.role ?? "user" });
  } else {
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.organizationName?.trim() || `${name}'s workspace` })
      .returning({ id: organizations.id });
    if (!org) throw new Error("createUserAccount: organization insert returned no row");
    organizationId = org.id;
    await tx.insert(organizationMemberships).values({ organizationId, userId, role: "owner" });
  }

  const schedule = await ensureDefaultSchedule(tx, userId, { timezone });

  const locations: LocationConfig[] = input.defaultEventLocationKind
    ? [{ id: newId(), kind: input.defaultEventLocationKind, position: 0 }]
    : [];
  const [eventType] = await tx
    .insert(eventTypes)
    .values({
      organizationId,
      ownerUserId: userId,
      scope: "personal",
      type: "standard",
      kind: "solo",
      name: DEFAULT_EVENT_TYPE.name,
      slug: DEFAULT_EVENT_TYPE.slug,
      color: DEFAULT_EVENT_TYPE.color,
      durationMinutes: DEFAULT_EVENT_TYPE.durationMinutes,
      locale,
      locations,
      scheduleId: schedule.id,
      position: 0,
      createdByUserId: userId,
    })
    .returning({ id: eventTypes.id });
  if (!eventType) throw new Error("createUserAccount: event type insert returned no row");
  await tx.insert(eventTypeHosts).values({ eventTypeId: eventType.id, userId, poolId: null, priority: 3, position: 0 });
  await tx.insert(eventTypeQuestions).values({
    eventTypeId: eventType.id,
    position: 0,
    label: DEFAULT_QUESTION_LABEL,
    type: "text",
    required: false,
    enabled: true,
    answerChoices: [],
  });

  await publishEvent(tx, "user.created", { userId }, { organizationId, actor: { type: "system" } });

  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new Error("createUserAccount: user vanished");
  return user;
}
