// Owner bootstrap (owner decision: production starts fully configured like the owner's Calendly, and nobody else can
// claim the fresh instance). Used by POST /api/setup/bootstrap and scripts/bootstrap-owner.ts.
//
// bootstrapOwner({ email, name?, avatarUrl? }) runs in ONE transaction, serialized with every signup (the signup
// advisory lock, src/lib/auth/signup.ts), so no account can be created between its checks and its writes:
// 1. Refuses an email other than OWNER_EMAIL when that is set (403), and refuses with 409 when any OTHER live account
//    exists: the bootstrap only ever configures the owner of a fresh instance.
// 2. Creates the account when missing: email verified, no password, instance admin, the owner's link and time zone.
//    "Continue with Google" with the same verified email then links to it (resolveOAuthLogin step 2, which also adopts
//    the Google profile picture when the account has none) and connects the calendar.
//    An existing account with a verified email (for example a Google sign-in before the bootstrap) becomes instance
//    admin. One whose email was never verified is refused with 409: an email signup needs no proof of the address, so
//    it may be a squatter's who, as the first account, was instance admin (see secureExistingAccount).
// 3. Applies the snapshot (src/lib/setup/owner-snapshot.ts) only when the account has no event types of its own yet,
//    so later edits are never overwritten. "None yet" means no event type row at all (live or deleted) or only the
//    untouched default that account creation adds (created in the same transaction as the account, never edited,
//    never booked, no reminders or workflows), and no availability changes (only the untouched default schedule, no
//    date-specific hours). The snapshot then replaces that default and is applied through the domain services
//    (profile, link, schedules, event types through the editor's create path, reminders through the reminders
//    service), so it gets the same validation as the UI. Applying stores a marker on the account; later runs never
//    apply it again.
// The result says what was done (`changes`, human readable) and why the snapshot was skipped when it was.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, withTx, type DB, type DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import {
  availabilityDateOverrides,
  availabilitySchedules,
  eventTypes,
  scheduledEvents,
  users,
  workflowEventTypes,
  workflows,
} from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { audit } from "@/lib/audit";
import { auditAuth, primaryOrganizationId } from "@/lib/auth/flows/audit";
import { createUserAccount, DEFAULT_EVENT_TYPE, findUserByEmail, SIGNUP_LOCK_KEY, type UserRow } from "@/lib/auth/signup";
import { loadActorCtx } from "@/lib/authz";
import { createSchedule, ensureDefaultSchedule, renameSchedule, setMeetingLimits, updateScheduleTimezone, updateWeeklyHours } from "@/lib/availability";
import { AppError, isAppError, type FieldErrors } from "@/lib/errors";
import { saveEventType } from "@/lib/event-types";
import { defaultDraft } from "@/lib/event-types/draft";
import type { EventTypeDraft } from "@/lib/event-types/types";
import { newId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { asDateFormat, changeHandle, ProfileInput, updateProfile } from "@/lib/settings";
import { now } from "@/lib/time/now";
import { absoluteUrl, publicBookingUrl } from "@/lib/url";
import { saveEventTypeReminders } from "@/lib/workflows";
import { SaveRemindersSchema } from "@/lib/workflows/schemas";
import { splitOffset } from "@/lib/workflows/timing";
import { hasLiveAccount } from "./accounts";
import { assertOwnerEmailAllowed } from "./config";
import { OWNER_SNAPSHOT, type OwnerScheduleKey, type OwnerSnapshot, type OwnerSnapshotEventType, type OwnerSnapshotLocation } from "./owner-snapshot";
import { BootstrapOwnerInputSchema, type BootstrapOwnerInput, type BootstrapOwnerParsedInput } from "./schemas";

export const OTHER_ACCOUNT_MESSAGE =
  "This instance already has another account, so the owner bootstrap cannot run. It only configures the owner of a fresh instance.";

export const UNVERIFIED_ACCOUNT_MESSAGE =
  'An account with this email already exists, but its address was never verified, so someone else may have created it. If it is yours, sign in with "Continue with Google" using this address (that verifies it), then run the bootstrap again. If it is not, reset the database (docs/DEPLOY.md).';

export type SnapshotSkipReason = "already_applied" | "has_event_types" | "has_schedules";

export const SKIP_MESSAGES: Record<SnapshotSkipReason, string> = {
  already_applied: "the Calendly setup was already applied to this account.",
  has_event_types: "the account already has its own event types, and the bootstrap never overwrites later edits.",
  has_schedules: "the account already has its own availability, and the bootstrap never overwrites later edits.",
};

export type AppliedSnapshot = {
  status: "applied";
  version: number;
  scheduleIds: Record<OwnerScheduleKey, string>;
  eventTypes: { id: string; name: string; slug: string; url: string }[];
  /** Email reminder timings created (one per event type and timing). */
  reminders: number;
};

export type SkippedSnapshot = { status: "skipped"; reason: SnapshotSkipReason; message: string };

export type BootstrapOwnerResult = {
  account: "created" | "existing";
  user: {
    id: string;
    email: string;
    name: string;
    slug: string | null;
    timezone: string;
    isInstanceAdmin: boolean;
    emailVerified: boolean;
    hasPassword: boolean;
    avatarUrl: string | null;
  };
  snapshot: AppliedSnapshot | SkippedSnapshot;
  /** What the bootstrap did, one sentence each. */
  changes: string[];
  links: { profile: string | null; login: string; scheduling: string };
};

/** users.metadata key of the applied marker. */
export const SNAPSHOT_MARKER_KEY = "ownerBootstrap";

type Marker = { snapshotAppliedAt: string; snapshotVersion: number };

function markerOf(user: Pick<UserRow, "metadata">): Marker | null {
  const value = (user.metadata ?? {})[SNAPSHOT_MARKER_KEY] as Partial<Marker> | undefined;
  return value && typeof value.snapshotAppliedAt === "string" ? (value as Marker) : null;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parses the input like the route does (AppError("validation") with field errors). */
export function parseBootstrapInput(raw: unknown): BootstrapOwnerParsedInput {
  const parsed = BootstrapOwnerInputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", { fieldErrors: fieldErrorsOf(parsed.error.issues) });
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------------------- Account

async function lockUser(tx: DbOrTx, userId: string): Promise<UserRow> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
    .for("update");
  if (!user) throw new AppError("conflict", "The owner account changed while the bootstrap ran. Try again.");
  return user;
}

/**
 * Brings an existing owner account to the bootstrap's guarantees (instance admin). Refuses (409) an account whose email
 * was never verified: an email signup needs no proof of the address, so it may be a squatter's, and as the first
 * account of the instance it was instance admin and could have left ways back in that no reset of the password or
 * sessions removes (a linked sign-in method, a pending invitation, a connected calendar, an API token).
 */
async function secureExistingAccount(tx: DbOrTx, stale: UserRow, input: BootstrapOwnerParsedInput, changes: string[]): Promise<UserRow> {
  const user = await lockUser(tx, stale.id);
  if (!user.emailVerifiedAt) throw new AppError("conflict", UNVERIFIED_ACCOUNT_MESSAGE);
  const at = now();
  const set: Partial<typeof users.$inferInsert> = {};
  if (!user.isInstanceAdmin) {
    set.isInstanceAdmin = true;
    changes.push("Made the existing account an instance admin.");
  }
  if (input.avatarUrl && !user.avatarUrl && !user.avatarFileId) {
    set.avatarUrl = input.avatarUrl;
    changes.push("Set the profile picture.");
  }
  if (!Object.keys(set).length) {
    changes.push("The account already exists with a verified email and instance admin rights.");
    return user;
  }
  const [updated] = await tx
    .update(users)
    .set({ ...set, updatedAt: at })
    .where(eq(users.id, user.id))
    .returning();
  if (!updated) throw new AppError("conflict", "The owner account changed while the bootstrap ran. Try again.");
  return updated;
}

// ---------------------------------------------------------------------------------------------------- Eligibility

type Eligibility = { eligible: true; signupDefaultId: string | null } | { eligible: false; reason: SnapshotSkipReason };

/** The untouched default event type that account creation adds (same transaction as the account, never edited). */
function isUntouchedSignupDefault(
  t: { name: string; slug: string; type: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null },
  user: Pick<UserRow, "createdAt">,
): boolean {
  return (
    t.deletedAt === null &&
    t.type === "standard" &&
    t.name === DEFAULT_EVENT_TYPE.name &&
    t.slug === DEFAULT_EVENT_TYPE.slug &&
    t.createdAt.getTime() === user.createdAt.getTime() &&
    t.updatedAt.getTime() === t.createdAt.getTime()
  );
}

/** Whether the snapshot may be applied (see the file header). */
async function snapshotEligibility(tx: DbOrTx, user: UserRow): Promise<Eligibility> {
  if (markerOf(user)) return { eligible: false, reason: "already_applied" };

  const types = await tx
    .select({
      id: eventTypes.id,
      name: eventTypes.name,
      slug: eventTypes.slug,
      type: eventTypes.type,
      createdAt: eventTypes.createdAt,
      updatedAt: eventTypes.updatedAt,
      deletedAt: eventTypes.deletedAt,
    })
    .from(eventTypes)
    .where(eq(eventTypes.ownerUserId, user.id))
    .limit(2);
  let signupDefaultId: string | null = null;
  if (types.length > 1) return { eligible: false, reason: "has_event_types" };
  const only = types[0];
  if (only) {
    if (!isUntouchedSignupDefault(only, user)) return { eligible: false, reason: "has_event_types" };
    const [booked] = await tx.select({ id: scheduledEvents.id }).from(scheduledEvents).where(eq(scheduledEvents.eventTypeId, only.id)).limit(1);
    if (booked) return { eligible: false, reason: "has_event_types" };
    // Reminders and workflows save on their own (the editor's Notifications section) without touching the event type
    // row, and deleting the default would take them along: they count as the owner's own setup.
    const [reminder] = await tx.select({ id: workflows.id }).from(workflows).where(eq(workflows.basicEventTypeId, only.id)).limit(1);
    if (reminder) return { eligible: false, reason: "has_event_types" };
    const [assigned] = await tx
      .select({ id: workflowEventTypes.workflowId })
      .from(workflowEventTypes)
      .where(eq(workflowEventTypes.eventTypeId, only.id))
      .limit(1);
    if (assigned) return { eligible: false, reason: "has_event_types" };
    signupDefaultId = only.id;
  }

  // Every schedule row of the user (named, custom, deleted): only the untouched default may exist.
  const schedules = await tx
    .select({ id: availabilitySchedules.id, isDefault: availabilitySchedules.isDefault, createdAt: availabilitySchedules.createdAt, updatedAt: availabilitySchedules.updatedAt })
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.userId, user.id))
    .limit(2);
  if (schedules.length > 1) return { eligible: false, reason: "has_schedules" };
  const schedule = schedules[0];
  if (schedule) {
    if (!schedule.isDefault || schedule.updatedAt.getTime() !== schedule.createdAt.getTime()) return { eligible: false, reason: "has_schedules" };
    const [override] = await tx
      .select({ id: availabilityDateOverrides.id })
      .from(availabilityDateOverrides)
      .where(eq(availabilityDateOverrides.scheduleId, schedule.id))
      .limit(1);
    if (override) return { eligible: false, reason: "has_schedules" };
  }
  return { eligible: true, signupDefaultId };
}

// ------------------------------------------------------------------------------------------------------- Snapshot

function locationConfigOf(l: OwnerSnapshotLocation, position: number): LocationConfig {
  const id = newId();
  switch (l.kind) {
    case "google_conference":
      return { id, kind: "google_conference", position };
    case "physical":
      return { id, kind: "physical", position, location: l.location, additionalInfo: l.address, displayBeforeBooking: true };
    case "ask_invitee":
      return { id, kind: "ask_invitee", position };
  }
}

/** The editor draft of a snapshot event type (the editor's ET-33 defaults plus the snapshot's values). */
export function snapshotDraft(et: OwnerSnapshotEventType, scheduleId: string): EventTypeDraft {
  const base = defaultDraft({ name: et.name, color: et.color, scheduleId, questionId: newId() });
  return {
    ...base,
    slug: et.slug,
    durations: [et.durationMinutes],
    locations: et.locations.map(locationConfigOf),
    schedule: { kind: "schedule", scheduleId },
    dateRange: { type: et.dateRange.type, days: et.dateRange.days, mode: et.dateRange.mode, start: null, end: null },
    minimumNoticeMinutes: et.minimumNoticeMinutes,
    bufferBeforeMinutes: et.bufferBeforeMinutes,
    bufferAfterMinutes: et.bufferAfterMinutes,
    slotIncrementMinutes: et.slotIncrementMinutes,
    limitPerDay: et.limitPerDay,
    limitPerWeek: et.limitPerWeek,
    limitPerMonth: et.limitPerMonth,
    allowGuests: et.allowGuests,
    questions: et.questions.map((q) => ({
      id: newId(),
      label: q.label,
      type: q.type,
      required: q.required,
      enabled: true,
      answerChoices: [],
      includeOther: false,
    })),
  };
}

function hoursText(offsets: number[]): string {
  return offsets
    .map((m) => {
      const t = splitOffset(m);
      return `${t.amount} ${t.amount === 1 ? t.unit.replace(/s$/, "") : t.unit}`;
    })
    .join(", ");
}

async function applySnapshot(
  tx: DbOrTx,
  stale: UserRow,
  input: BootstrapOwnerParsedInput,
  signupDefaultId: string | null,
  changes: string[],
  snap: OwnerSnapshot,
): Promise<AppliedSnapshot> {
  const at = now();
  let user = await lockUser(tx, stale.id);

  // Profile (Settings > Profile service): name, welcome message, time zone, 12h time.
  const profile = ProfileInput.parse({
    name: input.name ?? snap.profile.name,
    welcomeMessage: snap.profile.welcomeMessage,
    timezone: snap.profile.timezone,
    timeFormat: snap.profile.timeFormat,
    dateFormat: asDateFormat(user.dateFormat),
  });
  await updateProfile(tx, user.id, profile);
  await tx
    .update(users)
    .set({ locale: snap.profile.locale, onboardingCompletedAt: user.onboardingCompletedAt ?? at, updatedAt: at })
    .where(eq(users.id, user.id));
  user = await lockUser(tx, user.id);
  const actor = await loadActorCtx(tx, user);

  // Link (Settings > My Link service). A fresh instance always has it free; otherwise keep the current link.
  if (user.slug !== snap.profile.slug) {
    try {
      await changeHandle(tx, actor, snap.profile.slug);
    } catch (e) {
      if (!isAppError(e) || (e.code !== "conflict" && e.code !== "validation")) throw e;
      changes.push(`The link /${snap.profile.slug} is not available, so the account keeps /${user.slug ?? ""}.`);
    }
    user = await lockUser(tx, user.id);
  }
  changes.push(
    `Profile: name ${profile.name}, time zone ${profile.timezone}, ${profile.timeFormat === "12h" ? "12h (am/pm)" : "24h"} time and the welcome message "${profile.welcomeMessage}"`,
  );

  // Schedules (Availability services, with their validation): the default one is "Working hours".
  const scheduleIds = {} as Record<OwnerScheduleKey, string>;
  for (const s of snap.schedules) {
    let id: string;
    if (s.isDefault) {
      const row = await ensureDefaultSchedule(tx, user.id, { timezone: s.timezone, name: s.name, weeklyHours: s.weeklyHours });
      if (row.name !== s.name) await renameSchedule(tx, user.id, row.id, s.name);
      id = row.id;
    } else {
      id = (await createSchedule(tx, user.id, { name: s.name, timezone: s.timezone })).id;
    }
    await updateScheduleTimezone(tx, user.id, id, s.timezone);
    await updateWeeklyHours(tx, user.id, id, s.weeklyHours);
    scheduleIds[s.key] = id;
  }
  changes.push(`Schedules: ${snap.schedules.map((s) => `${s.name}${s.isDefault ? " (default)" : ""}`).join(", ")}, all in ${snap.schedules[0]?.timezone ?? profile.timezone}.`);

  if (snap.meetingLimits.perDay !== null || snap.meetingLimits.perWeek !== null) {
    await setMeetingLimits(tx, user.id, { day: snap.meetingLimits.perDay, week: snap.meetingLimits.perWeek, month: null });
    changes.push(`Meeting limits: ${snap.meetingLimits.perDay ?? "no"} per day, ${snap.meetingLimits.perWeek ?? "no"} per week.`);
  }

  // Event types: the untouched signup default goes, then the snapshot's types in order (the editor's create path).
  if (signupDefaultId) await tx.delete(eventTypes).where(eq(eventTypes.id, signupDefaultId));
  const created: AppliedSnapshot["eventTypes"] = [];
  let reminders = 0;
  for (const et of snap.eventTypes) {
    const scheduleId = scheduleIds[et.schedule];
    if (!scheduleId) throw new Error(`owner snapshot: event type ${et.slug} uses an unknown schedule ${et.schedule}`);
    const saved = await saveEventType(tx, actor, { id: null, version: null, kind: "one_on_one", draft: snapshotDraft(et, scheduleId) });
    if (et.autofillInvitee) await tx.update(eventTypes).set({ autofillInvitee: true }).where(eq(eventTypes.id, saved.id));
    if (et.inviteeReminderOffsetsMinutes.length) {
      await saveEventTypeReminders(
        actor,
        SaveRemindersSchema.parse({
          eventTypeId: saved.id,
          kind: "invitee",
          enabled: true,
          timings: et.inviteeReminderOffsetsMinutes.map(splitOffset),
          subject: null,
          bodyHtml: null,
          includeCancelRescheduleLinks: true,
        }),
        tx as DB,
      );
      reminders += et.inviteeReminderOffsetsMinutes.length;
    }
    created.push({ id: saved.id, name: et.name, slug: saved.slug, url: user.slug ? publicBookingUrl({ handle: user.slug, eventSlug: saved.slug }) : "" });
  }
  changes.push(`Event types: ${created.map((e) => `${e.name} (${e.slug})`).join(", ")}.`);
  const withReminders = snap.eventTypes.filter((e) => e.inviteeReminderOffsetsMinutes.length);
  if (withReminders.length) {
    const timings = [...new Set(withReminders.map((e) => hoursText(e.inviteeReminderOffsetsMinutes)))].join("; ");
    changes.push(`Email reminders to invitees ${timings} before the event on ${withReminders.length} event types.`);
  }

  const marker: Marker = { snapshotAppliedAt: at.toISOString(), snapshotVersion: snap.version };
  await tx
    .update(users)
    .set({ metadata: { ...(user.metadata ?? {}), [SNAPSHOT_MARKER_KEY]: marker } })
    .where(eq(users.id, user.id));

  return { status: "applied", version: snap.version, scheduleIds, eventTypes: created, reminders };
}

// ---------------------------------------------------------------------------------------------------------- Entry

/**
 * Creates or secures the owner account and applies the Calendly snapshot when the account has none of its own yet
 * (see the file header). Throws AppError: validation (400), forbidden (403, not OWNER_EMAIL), conflict (409, another
 * account exists, or the owner's existing account has an unverified email), not_configured (501, malformed
 * OWNER_EMAIL).
 */
export async function bootstrapOwner(
  raw: BootstrapOwnerInput,
  opts: { db?: DbOrTx; snapshot?: OwnerSnapshot } = {},
): Promise<BootstrapOwnerResult> {
  const input = parseBootstrapInput(raw);
  assertOwnerEmailAllowed(input.email);
  const snap = opts.snapshot ?? OWNER_SNAPSHOT;
  const db = opts.db ?? (await getDb());

  const result = await withTx(db, async (tx) => {
    // Serializes with every signup (createAccountUnderPolicy takes the same lock): no account can appear between the
    // check below and the writes of this transaction.
    await advisoryXactLock(tx, SIGNUP_LOCK_KEY);
    if (await hasLiveAccount({ db: tx, exceptEmail: input.email })) throw new AppError("conflict", OTHER_ACCOUNT_MESSAGE);

    const changes: string[] = [];
    const existing = await findUserByEmail(tx, input.email);
    let user: UserRow;
    let account: BootstrapOwnerResult["account"];
    if (existing) {
      account = "existing";
      user = await secureExistingAccount(tx, existing, input, changes);
    } else {
      account = "created";
      user = await createUserAccount(tx, {
        email: input.email,
        name: input.name ?? snap.profile.name,
        passwordHash: null,
        timezone: snap.profile.timezone,
        avatarUrl: input.avatarUrl ?? null,
        slug: snap.profile.slug,
        emailVerifiedAt: now(),
        locale: snap.profile.locale,
        isInstanceAdmin: true,
        defaultEventLocationKind: "google_conference",
      });
      await auditAuth("user.signup", { user, details: { method: "owner_bootstrap" }, tx });
      changes.push(`Created the account ${user.email}: email verified, no password (sign in with Google), instance admin.`);
      if (user.avatarUrl) changes.push("Set the profile picture.");
    }

    const eligibility = await snapshotEligibility(tx, user);
    let snapshot: BootstrapOwnerResult["snapshot"];
    if (eligibility.eligible) {
      snapshot = await applySnapshot(tx, user, input, eligibility.signupDefaultId, changes, snap);
    } else {
      snapshot = { status: "skipped", reason: eligibility.reason, message: `Skipped the Calendly setup: ${SKIP_MESSAGES[eligibility.reason]}` };
      changes.push(snapshot.message);
    }

    const [final] = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!final) throw new AppError("conflict", "The owner account changed while the bootstrap ran. Try again.");
    await audit(
      {
        action: "instance.owner_bootstrap",
        namespace: "admin",
        targetType: "user",
        targetId: final.id,
        details: {
          account,
          snapshot: snapshot.status,
          ...(snapshot.status === "skipped" ? { reason: snapshot.reason } : { version: snapshot.version }),
        },
        actor: { type: "system", userId: final.id, label: "Owner bootstrap" },
        organizationId: await primaryOrganizationId(final.id, tx),
      },
      tx,
    );

    const out: BootstrapOwnerResult = {
      account,
      user: {
        id: final.id,
        email: final.email,
        name: final.name,
        slug: final.slug,
        timezone: final.timezone,
        isInstanceAdmin: final.isInstanceAdmin,
        emailVerified: final.emailVerifiedAt !== null,
        hasPassword: final.passwordHash !== null,
        avatarUrl: final.avatarUrl,
      },
      snapshot,
      changes,
      links: {
        profile: final.slug ? publicBookingUrl({ handle: final.slug }) : null,
        login: absoluteUrl("/login"),
        scheduling: absoluteUrl("/app/scheduling"),
      },
    };
    return out;
  });

  log.info("setup.bootstrap", {
    userId: result.user.id,
    account: result.account,
    snapshot: result.snapshot.status,
    ...(result.snapshot.status === "skipped" ? { reason: result.snapshot.reason } : {}),
  });
  return result;
}
