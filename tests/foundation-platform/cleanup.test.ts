// system.cleanup retention (SPEC GEN-16, ADM-04; ARCHITECTURE section 12.2) with the fake clock: every rule deletes
// (or purges) exactly what is past its retention and keeps the rest.
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { enqueueJob, runDueJobs } from "@/lib/jobs";
import { runRetentionCleanup } from "@/lib/jobs/cleanup";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { createCalendarConnection, createUser, createWebhookSubscription } from "../factories";
import { useTestDb } from "../helpers/db";

vi.mock("@/lib/admin/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/booking/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/calendars/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/contacts/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/lifecycle/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/links/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/meetings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/payments/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/polls/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/settings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/teams/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/webhooks/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/workflows/jobs", () => ({ handlers: {}, periodic: [] }));

const t = useTestDb();
afterEach(() => resetFakeTime());

const DAY = 86_400_000;
const T = Date.parse("2032-01-15T12:00:00Z");
const ago = (days: number) => new Date(T - days * DAY);

describe("system.cleanup", () => {
  it("with the fake clock advanced 15 days, removes a succeeded job and keeps a pending one (GEN-16 acceptance)", async () => {
    setFakeNow(new Date(T));
    const done = await enqueueJob(t.db, { type: "nothing.registered_ok" });
    await t.db.update(jobs).set({ status: "succeeded", finishedAt: new Date(T) }).where(eq(jobs.id, done!));
    const pending = await enqueueJob(t.db, { type: "nothing.registered_pending", runAt: new Date(T + 30 * DAY) });
    setFakeNow(new Date(T + 15 * DAY));
    await enqueueJob(t.db, { type: "system.cleanup", idempotencyKey: "cleanup-acceptance" });
    const r = await runDueJobs({ budgetMs: 20_000, types: ["system.cleanup"] });
    expect(r).toMatchObject({ ran: 1, succeeded: 1 });
    const left = await t.db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, [done!, pending!]));
    expect(left.map((x) => x.id)).toEqual([pending!]);
  });

  it("applies every retention rule at business time", async () => {
    await t.db.delete(jobs);
    const user = await createUser(t.db);
    const { calendars } = await createCalendarConnection(t.db, { userId: user.id });
    const cal = calendars[0]!;
    const sub = await createWebhookSubscription(t.db, { owner: user });

    const mkJob = async (status: (typeof jobs.$inferSelect)["status"], finishedDaysAgo: number | null) => {
      const [row] = await t.db
        .insert(jobs)
        .values({
          type: "x",
          runAt: ago(100),
          status,
          finishedAt: finishedDaysAgo === null ? null : ago(finishedDaysAgo),
          createdAt: ago(100),
        })
        .returning({ id: jobs.id });
      return row!.id;
    };
    const jobIds = {
      succeededOld: await mkJob("succeeded", 15),
      succeededRecent: await mkJob("succeeded", 13),
      canceledOld: await mkJob("canceled", 20),
      deadOld: await mkJob("dead", 91),
      deadRecent: await mkJob("dead", 60),
      pendingOld: await mkJob("pending", null),
    };

    const [evOld] = await t.db.insert(domainEvents).values({ type: "booking.created", payload: {}, occurredAt: ago(31) }).returning();
    const [evNew] = await t.db.insert(domainEvents).values({ type: "booking.created", payload: {}, occurredAt: ago(29) }).returning();

    const [delOld] = await t.db
      .insert(webhookDeliveries)
      .values({ subscriptionId: sub.id, event: "invitee.created", payload: {}, createdAt: ago(31) })
      .returning();
    const [delNew] = await t.db
      .insert(webhookDeliveries)
      .values({ subscriptionId: sub.id, event: "invitee.created", payload: {}, createdAt: ago(40), deliveredAt: ago(29) })
      .returning();

    const extRow = (fetchedDaysAgo: number) => ({
      calendarId: cal.id,
      userId: user.id,
      externalId: `ext-${fetchedDaysAgo}`,
      startAt: ago(1),
      endAt: ago(1),
      busy: true,
      fetchedAt: ago(fetchedDaysAgo),
    });
    const [extOld] = await t.db.insert(externalEvents).values(extRow(8)).returning();
    const [extNew] = await t.db.insert(externalEvents).values(extRow(6)).returning();
    const [winOld] = await t.db
      .insert(calendarSyncWindows)
      .values({ calendarId: cal.id, windowStart: ago(10), windowEnd: ago(9), fetchedAt: ago(8), status: "ok" })
      .returning();
    const [winNew] = await t.db
      .insert(calendarSyncWindows)
      .values({ calendarId: cal.id, windowStart: ago(8), windowEnd: ago(7), fetchedAt: ago(6), status: "ok" })
      .returning();
    // A Calendly import calendar (CAL-22) is never refetched: its old cache rows are kept.
    const { calendars: importCalendars } = await createCalendarConnection(t.db, { userId: user.id, provider: "calendly_import" });
    const importCal = importCalendars[0]!;
    const [extImported] = await t.db.insert(externalEvents).values({ ...extRow(30), calendarId: importCal.id }).returning();
    const [winImported] = await t.db
      .insert(calendarSyncWindows)
      .values({ calendarId: importCal.id, windowStart: ago(40), windowEnd: ago(39), fetchedAt: ago(30), status: "ok" })
      .returning();

    const sess = (expiresInDays: number, revokedDaysAgo: number | null, n: string) => ({
      userId: user.id,
      tokenHash: `hash-${n}`,
      expiresAt: new Date(T + expiresInDays * DAY),
      revokedAt: revokedDaysAgo === null ? null : ago(revokedDaysAgo),
    });
    const [sExpired] = await t.db.insert(sessions).values(sess(-1, null, "a")).returning();
    const [sValid] = await t.db.insert(sessions).values(sess(10, null, "b")).returning();
    const [sRevokedOld] = await t.db.insert(sessions).values(sess(10, 8, "c")).returning();
    const [sRevokedNew] = await t.db.insert(sessions).values(sess(10, 1, "d")).returning();

    await t.db.insert(rateLimitBuckets).values([
      { key: "old", windowStart: ago(3), count: 1 },
      { key: "new", windowStart: ago(1), count: 1 },
    ]);

    const fileRow = (expiresAt: Date | null, n: string) => ({
      purpose: "export" as const,
      contentType: "text/csv",
      byteSize: 1,
      sha256: n,
      data: Buffer.from("x"),
      expiresAt,
    });
    const [fExpired] = await t.db.insert(files).values(fileRow(new Date(T - 3_600_000), "a")).returning();
    const [fFuture] = await t.db.insert(files).values(fileRow(new Date(T + DAY), "b")).returning();
    const [fNoExpiry] = await t.db.insert(files).values(fileRow(null, "c")).returning();

    const outbox = (createdDaysAgo: number, key: string) => ({
      toAddresses: ["a@example.com"],
      fromAddress: "notifications@localhost",
      subject: "Hello",
      html: "<p>Body</p>",
      text: "Body",
      attachments: [{ filename: "a.txt", contentType: "text/plain", contentBase64: "eA==" }],
      ics: "BEGIN:VCALENDAR",
      icsMethod: "REQUEST",
      template: "t",
      category: "transactional",
      status: "stored" as const,
      idempotencyKey: key,
      createdAt: ago(createdDaysAgo),
    });
    const [oPurge] = await t.db.insert(emailOutbox).values(outbox(31, "o1")).returning();
    const [oKeep] = await t.db.insert(emailOutbox).values(outbox(29, "o2")).returning();
    const [oDelete] = await t.db.insert(emailOutbox).values(outbox(91, "o3")).returning();

    const sms = (createdDaysAgo: number, key: string) => ({
      toNumber: "+14155550100",
      body: "Hi",
      status: "stored" as const,
      idempotencyKey: key,
      createdAt: ago(createdDaysAgo),
    });
    const [smsOld] = await t.db.insert(smsMessages).values(sms(91, "s1")).returning();
    const [smsNew] = await t.db.insert(smsMessages).values(sms(30, "s2")).returning();

    const [codeOld] = await t.db.insert(verificationCodes).values({ purpose: "booking", codeHash: "c1", expiresAt: ago(2) }).returning();
    const [codeNew] = await t.db
      .insert(verificationCodes)
      .values({ purpose: "booking", codeHash: "c2", expiresAt: new Date(T - 3_600_000) })
      .returning();
    const [devOld] = await t.db.insert(trustedDevices).values({ emailNormalized: "a@example.com", tokenHash: "d1", expiresAt: ago(1) }).returning();
    const [devNew] = await t.db
      .insert(trustedDevices)
      .values({ emailNormalized: "a@example.com", tokenHash: "d2", expiresAt: new Date(T + DAY) })
      .returning();
    const [tokOld] = await t.db.insert(authTokens).values({ purpose: "password_reset", tokenHash: "t1", expiresAt: ago(31) }).returning();
    const [tokNew] = await t.db.insert(authTokens).values({ purpose: "password_reset", tokenHash: "t2", expiresAt: ago(10) }).returning();

    const { counts, complete } = await runRetentionCleanup(t.db, new Date(T));
    expect(complete).toBe(true);

    const ids = async <R extends { id: string }>(rows: Promise<R[]>) => (await rows).map((r) => r.id).sort();
    expect(await ids(t.db.select({ id: jobs.id }).from(jobs))).toEqual(
      [jobIds.succeededRecent, jobIds.deadRecent, jobIds.pendingOld].sort(),
    );
    expect(await ids(t.db.select({ id: domainEvents.id }).from(domainEvents))).toEqual([evNew!.id]);
    expect(evOld).toBeTruthy();
    expect(await ids(t.db.select({ id: webhookDeliveries.id }).from(webhookDeliveries))).toEqual([delNew!.id]);
    expect(delOld).toBeTruthy();
    expect(await ids(t.db.select({ id: externalEvents.id }).from(externalEvents))).toEqual([extNew!.id, extImported!.id].sort());
    expect(extOld).toBeTruthy();
    expect(await ids(t.db.select({ id: calendarSyncWindows.id }).from(calendarSyncWindows))).toEqual([winNew!.id, winImported!.id].sort());
    expect(winOld).toBeTruthy();
    expect(await ids(t.db.select({ id: sessions.id }).from(sessions))).toEqual([sValid!.id, sRevokedNew!.id].sort());
    expect(sExpired && sRevokedOld).toBeTruthy();
    expect((await t.db.select().from(rateLimitBuckets)).map((b) => b.key)).toEqual(["new"]);
    expect(await ids(t.db.select({ id: files.id }).from(files))).toEqual([fFuture!.id, fNoExpiry!.id].sort());
    expect(fExpired).toBeTruthy();

    const out = await t.db.select().from(emailOutbox);
    expect(out.map((o) => o.id).sort()).toEqual([oPurge!.id, oKeep!.id].sort());
    expect(oDelete).toBeTruthy();
    const purged = out.find((o) => o.id === oPurge!.id)!;
    expect(purged).toMatchObject({ html: "", text: "", ics: null, attachments: [], subject: "Hello" });
    expect(purged.bodyPurgedAt?.toISOString()).toBe(new Date(T).toISOString());
    const kept = out.find((o) => o.id === oKeep!.id)!;
    expect(kept).toMatchObject({ html: "<p>Body</p>", bodyPurgedAt: null });

    expect(await ids(t.db.select({ id: smsMessages.id }).from(smsMessages))).toEqual([smsNew!.id]);
    expect(smsOld).toBeTruthy();
    expect(await ids(t.db.select({ id: verificationCodes.id }).from(verificationCodes))).toEqual([codeNew!.id]);
    expect(codeOld).toBeTruthy();
    expect(await ids(t.db.select({ id: trustedDevices.id }).from(trustedDevices))).toEqual([devNew!.id]);
    expect(devOld).toBeTruthy();
    expect(await ids(t.db.select({ id: authTokens.id }).from(authTokens))).toEqual([tokNew!.id]);
    expect(tokOld).toBeTruthy();

    expect(counts).toMatchObject({
      jobs_finished: 2,
      jobs_dead: 1,
      domain_events: 1,
      webhook_deliveries: 1,
      external_events: 1,
      calendar_sync_windows: 1,
      sessions: 2,
      rate_limit_buckets: 1,
      files_expired: 1,
      outbox_bodies_purged: 1,
      outbox_rows: 1,
      sms_rows: 1,
    });

    // Idempotent: a second run changes nothing.
    const again = await runRetentionCleanup(t.db, new Date(T));
    expect(Object.values(again.counts).every((n) => n === 0)).toBe(true);
  });

  it("stops at the budget and the job enqueues a continuation", async () => {
    setFakeNow(new Date(T));
    const r = await runRetentionCleanup(t.db, new Date(T), { budgetMs: 0 });
    expect(r.complete).toBe(false);
    await t.db.delete(jobs);
    const { builtinHandlers } = await import("@/lib/jobs/builtin-handlers");
    const id = await enqueueJob(t.db, { type: "system.cleanup", idempotencyKey: "budget-test" });
    // A normal run completes and does not enqueue a continuation.
    await runDueJobs({ budgetMs: 20_000, types: ["system.cleanup"] });
    expect((await t.db.select().from(jobs).where(eq(jobs.id, id!)))[0]?.status).toBe("succeeded");
    expect((await t.db.select().from(jobs).where(eq(jobs.type, "system.cleanup")))).toHaveLength(1);
    expect(builtinHandlers["system.cleanup"]).toBeTypeOf("function");
  });
});
