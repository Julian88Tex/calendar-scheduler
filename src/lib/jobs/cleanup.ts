// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// system.cleanup retention rules (SPEC GEN-16, ADM-04; ARCHITECTURE section 12.2), run daily. Keeps a Neon Free
// database (0.5 GB) small. Every comparison uses the app clock ($now), so tests and E2E runs with a fake clock see the
// same behavior as production. Deletes run in chunks inside a time budget; when the budget runs out the handler
// enqueues a continuation job.
//
// | Data                                              | Rule                                                     |
// | jobs succeeded or canceled                        | deleted 14 days after they finished                      |
// | jobs dead                                         | deleted after 90 days                                    |
// | domain_events                                     | deleted after 30 days                                    |
// | webhook_deliveries                                | deleted 30 days after delivery (or creation)             |
// | external_events, calendar_sync_windows            | deleted when not refreshed for 7 days                    |
// | sessions                                          | expired ones deleted; revoked ones after 7 days          |
// | rate_limit_buckets                                | windows older than 2 days                                |
// | files with expires_at (exports, imports)          | deleted once expired (blobs too)                         |
// | email_outbox html, text, attachments, ics         | emptied after 30 days (body_purged_at set, row kept)     |
// | email_outbox rows                                 | deleted after 90 days                                    |
// | sms_messages                                      | deleted after 90 days (same as the email outbox)         |
// | verification_codes, trusted_devices, auth_tokens  | expired codes after 1 day, devices once expired, tokens 30 days after expiry |
import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import {
  authTokens,
  calendarSyncWindows,
  domainEvents,
  emailOutbox,
  externalEvents,
  files,
  jobs,
  rateLimitBuckets,
  sessions,
  smsMessages,
  trustedDevices,
  verificationCodes,
  webhookDeliveries,
} from "@/db/schema";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { deleteFile } from "../files";

const DAY = 24 * 60 * 60 * 1000;

export const RETENTION = {
  finishedJobsDays: 14,
  deadJobsDays: 90,
  domainEventsDays: 30,
  webhookDeliveriesDays: 30,
  externalCacheDays: 7,
  revokedSessionsDays: 7,
  rateLimitDays: 2,
  outboxBodyDays: 30,
  outboxRowDays: 90,
  smsRowDays: 90,
  verificationCodeDays: 1,
  authTokenDays: 30,
} as const;

export type CleanupCounts = Record<string, number>;

export type CleanupResult = { counts: CleanupCounts; complete: boolean };

const CHUNK = 2_000;

/** Deletes rows matching `where` in chunks of CHUNK ids until none are left or the deadline passes. */
async function chunkedDelete(
  db: DB,
  table: PgTable,
  id: PgColumn,
  where: SQL,
  deadline: number,
): Promise<{ deleted: number; done: boolean }> {
  let deleted = 0;
  while (performance.now() < deadline) {
    const ids = db.select({ id }).from(table).where(where).limit(CHUNK);
    const rows = (await db.delete(table).where(inArray(id, ids)).returning({ id })) as unknown[];
    deleted += rows.length;
    if (rows.length < CHUNK) return { deleted, done: true };
  }
  return { deleted, done: false };
}

/** Applies every retention rule (see the file header) at business time `at`, within `budgetMs`. */
export async function runRetentionCleanup(db: DB, at: Date, opts: { budgetMs?: number } = {}): Promise<CleanupResult> {
  const deadline = performance.now() + (opts.budgetMs ?? 20_000);
  const ago = (days: number) => new Date(at.getTime() - days * DAY);
  const counts: CleanupCounts = {};
  let complete = true;
  const step = async (name: string, fn: () => Promise<{ deleted: number; done: boolean }>) => {
    if (performance.now() >= deadline) {
      complete = false;
      return;
    }
    const r = await fn();
    counts[name] = (counts[name] ?? 0) + r.deleted;
    if (!r.done) complete = false;
  };

  await step("jobs_finished", () =>
    chunkedDelete(db, jobs, jobs.id,
      and(
        inArray(jobs.status, ["succeeded", "canceled"]),
        lt(sql`coalesce(${jobs.finishedAt}, ${jobs.createdAt})`, ago(RETENTION.finishedJobsDays)),
      )!,
      deadline,
    ),
  );
  await step("jobs_dead", () =>
    chunkedDelete(db, jobs, jobs.id,
      and(eq(jobs.status, "dead"), lt(sql`coalesce(${jobs.finishedAt}, ${jobs.createdAt})`, ago(RETENTION.deadJobsDays)))!,
      deadline,
    ),
  );
  await step("domain_events", () =>
    chunkedDelete(db, domainEvents, domainEvents.id, lt(domainEvents.occurredAt, ago(RETENTION.domainEventsDays)), deadline),
  );
  await step("webhook_deliveries", () =>
    chunkedDelete(db, webhookDeliveries, webhookDeliveries.id,
      lt(sql`coalesce(${webhookDeliveries.deliveredAt}, ${webhookDeliveries.createdAt})`, ago(RETENTION.webhookDeliveriesDays)),
      deadline,
    ),
  );
  await step("external_events", () =>
    chunkedDelete(db, externalEvents, externalEvents.id, lt(externalEvents.fetchedAt, ago(RETENTION.externalCacheDays)), deadline),
  );
  await step("calendar_sync_windows", () =>
    chunkedDelete(db, calendarSyncWindows, calendarSyncWindows.id, lt(calendarSyncWindows.fetchedAt, ago(RETENTION.externalCacheDays)), deadline),
  );
  await step("sessions", () =>
    chunkedDelete(db, sessions, sessions.id,
      or(lt(sessions.expiresAt, at), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, ago(RETENTION.revokedSessionsDays))))!,
      deadline,
    ),
  );
  await step("rate_limit_buckets", async () => {
    const rows = await db
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, ago(RETENTION.rateLimitDays)))
      .returning({ key: rateLimitBuckets.key });
    return { deleted: rows.length, done: true };
  });
  await step("files_expired", async () => {
    const expired = and(isNotNull(files.expiresAt), lt(files.expiresAt, at))!;
    const blobs = await db.select({ id: files.id }).from(files).where(and(expired, isNotNull(files.blobUrl))).limit(200);
    for (const b of blobs) await deleteFile(b.id, db);
    const rows = await db.delete(files).where(and(expired, isNull(files.blobUrl))).returning({ id: files.id });
    return { deleted: rows.length + blobs.length, done: blobs.length < 200 };
  });
  await step("outbox_rows", () =>
    chunkedDelete(db, emailOutbox, emailOutbox.id, lt(emailOutbox.createdAt, ago(RETENTION.outboxRowDays)), deadline),
  );
  await step("outbox_bodies_purged", async () => {
    let purged = 0;
    while (performance.now() < deadline) {
      const ids = db
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(and(isNull(emailOutbox.bodyPurgedAt), lt(emailOutbox.createdAt, ago(RETENTION.outboxBodyDays))))
        .limit(CHUNK);
      const rows = await db
        .update(emailOutbox)
        .set({ html: "", text: "", attachments: [], ics: null, bodyPurgedAt: at, updatedAt: at })
        .where(inArray(emailOutbox.id, ids))
        .returning({ id: emailOutbox.id });
      purged += rows.length;
      if (rows.length < CHUNK) return { deleted: purged, done: true };
    }
    return { deleted: purged, done: false };
  });
  await step("sms_rows", () => chunkedDelete(db, smsMessages, smsMessages.id, lt(smsMessages.createdAt, ago(RETENTION.smsRowDays)), deadline));
  await step("verification_codes", () =>
    chunkedDelete(db, verificationCodes, verificationCodes.id, lt(verificationCodes.expiresAt, ago(RETENTION.verificationCodeDays)), deadline),
  );
  await step("trusted_devices", () => chunkedDelete(db, trustedDevices, trustedDevices.id, lt(trustedDevices.expiresAt, at), deadline));
  await step("auth_tokens", () =>
    chunkedDelete(db, authTokens, authTokens.id, lt(authTokens.expiresAt, ago(RETENTION.authTokenDays)), deadline),
  );
  return { counts, complete };
}
