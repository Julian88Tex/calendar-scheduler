// Uploaded files and GET /api/files/{id}, the audit log, and the meeting template context.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionState: { user: { id: string } | null } = { user: null };
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => sessionState.user }));

const { auditLog, files, users } = await import("@/db/schema");
const { audit } = await import("@/lib/audit");
const { loadActorCtx } = await import("@/lib/authz");
const { detectImageType, fileUrl, imageDimensions, saveFile, saveImageUpload } = await import("@/lib/files");
const { GET } = await import("@/app/api/files/[id]/route");
const { buildMeetingTemplateContext } = await import("@/lib/template-context");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createBooking, createEventType, createUser } = await import("../factories");

const t = useTestDb();
afterEach(() => {
  sessionState.user = null;
  resetFakeTime();
});

/** A valid 2x3 PNG header (enough for type and dimension checks). */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const get = (id: string, init: { etag?: string; download?: string } = {}) =>
  GET(
    new Request(`http://localhost:3000/api/files/${id}${init.download ? `?download=${init.download}` : ""}`, {
      headers: init.etag ? { "if-none-match": init.etag } : {},
    }),
    { params: Promise.resolve({ id }) },
  );

describe("files", () => {
  it("detects image types and dimensions from headers", () => {
    expect(detectImageType(png(2, 3))).toBe("image/png");
    expect(imageDimensions(png(640, 480), "image/png")).toEqual({ width: 640, height: 480 });
    const gif = Buffer.from("GIF89a\x0a\x00\x14\x00", "binary");
    expect(detectImageType(gif)).toBe("image/gif");
    expect(imageDimensions(gif, "image/gif")).toEqual({ width: 10, height: 20 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
    expect(detectImageType(jpeg)).toBe("image/jpeg");
    expect(imageDimensions(jpeg, "image/jpeg")).toEqual({ width: 400, height: 300 });
    expect(detectImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });

  it("saveImageUpload validates type, size and dimensions", async () => {
    const u = await createUser(t.db);
    const saved = await saveImageUpload(new Blob([new Uint8Array(png(128, 128))]), "avatar", { ownerUserId: u.id });
    expect(saved).toMatchObject({ width: 128, height: 128, contentType: "image/png", url: fileUrl(saved.id) });
    const [row] = await t.db.select().from(files).where(eq(files.id, saved.id));
    expect(row?.data?.length).toBe(33);
    await expect(saveImageUpload(Buffer.from("<svg/>"), "avatar", { ownerUserId: u.id })).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { file: ["Upload a PNG, JPG, WebP or GIF image."] },
    });
    await expect(saveImageUpload(png(5000, 10), "logo", { ownerUserId: u.id })).rejects.toMatchObject({ code: "validation" });
    await expect(saveImageUpload(png(10, 10), "logo", { ownerUserId: u.id, maxBytes: 10 })).rejects.toMatchObject({ code: "validation" });
    await expect(saveImageUpload(Buffer.alloc(0), "logo", { ownerUserId: u.id })).rejects.toMatchObject({ code: "validation" });
  });

  it("serves public images with an immutable cache and ETag, and private files to their owner only", async () => {
    const owner = await createUser(t.db);
    const other = await createUser(t.db);
    const avatar = await saveImageUpload(png(4, 4), "avatar", { ownerUserId: owner.id });
    const res = await get(avatar.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = res.headers.get("etag")!;
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png(4, 4));
    expect((await get(avatar.id, { etag })).status).toBe(304);

    const exp = await saveFile({ data: Buffer.from("a,b\n1,2\n"), contentType: "text/csv", purpose: "export", ownerUserId: owner.id });
    expect((await get(exp.id)).status).toBe(404); // signed out
    sessionState.user = { id: other.id };
    expect((await get(exp.id)).status).toBe(404); // not the owner (no existence leak)
    sessionState.user = { id: owner.id };
    const mine = await get(exp.id, { download: "meetings export.csv" });
    expect(mine.status).toBe(200);
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect(mine.headers.get("content-disposition")).toBe('attachment; filename="meetings export.csv"');
    expect(await mine.text()).toBe("a,b\n1,2\n");

    setFakeNow("2030-01-01T00:00:00Z");
    const expiring = await saveFile({
      data: Buffer.from("x"),
      contentType: "text/plain",
      purpose: "export",
      ownerUserId: owner.id,
      expiresAt: new Date("2030-01-02T00:00:00Z"),
    });
    expect((await get(expiring.id)).status).toBe(200);
    setFakeNow("2030-01-03T00:00:00Z");
    expect((await get(expiring.id)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("audit", () => {
  it("writes actor, action, namespace, target and details (inside a transaction or standalone)", async () => {
    const u = await createUser(t.db, { name: "Auditor" });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    const actor = await loadActorCtx(t.db, row!);
    setFakeNow("2030-05-05T05:05:05Z");
    const id = await t.db.transaction((tx) =>
      audit({ action: "role.changed", namespace: "org", targetType: "user", targetId: u.id, details: { to: "admin" }, actor }, tx),
    );
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.id, id!));
    expect(entry).toMatchObject({
      organizationId: u.organizationId,
      actorType: "user",
      actorUserId: u.id,
      actorLabel: "Auditor",
      action: "role.changed",
      namespace: "org",
      targetType: "user",
      targetId: u.id,
      details: { to: "admin" },
    });
    // The business clock (fake time keeps flowing from the set instant).
    expect(Math.abs(entry!.occurredAt.getTime() - Date.parse("2030-05-05T05:05:05Z"))).toBeLessThan(5000);
    const sysId = await audit({ action: "system.cleanup", namespace: "admin", ip: "1.2.3.4", userAgent: "cron" });
    const [sys] = await t.db.select().from(auditLog).where(eq(auditLog.id, sysId!));
    expect(sys).toMatchObject({ actorType: "system", actorUserId: null, ip: "1.2.3.4", userAgent: "cron" });
  });
});

describe("buildMeetingTemplateContext (NT-07)", () => {
  it("renders names, links and times in the recipient's zone and format", async () => {
    const host = await createUser(t.db, { name: "Julian Joseph", slug: "julian-ctx", timezone: "America/Los_Angeles" });
    const { eventType } = await createEventType(t.db, { owner: host, name: "30 Minute Meeting", slug: "30min" });
    const { scheduledEvent, invitee } = await createBooking(t.db, {
      eventType,
      start: "2026-10-14T16:00:00Z",
      invitee: {
        name: "Ana Maria Lopez",
        email: "ana@example.com",
        timezone: "Europe/Berlin",
        guests: ["g1@example.com", "g2@example.com"],
        questionsAndAnswers: [
          { questionId: null, question: "What would you like to discuss?", type: "text", position: 0, answer: "Roadmap" },
        ],
        overrides: { timeFormat: "24h", utmSource: "newsletter" },
      },
      location: {
        configId: null,
        kind: "google_conference",
        location: null,
        additionalInfo: null,
        joinUrl: "https://meet.google.com/abc-defg-hij",
        status: "pushed",
        providerMeetingId: null,
        password: null,
        dialIn: null,
        data: null,
        error: null,
      },
    });
    const forInvitee = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee!.id, recipient: "invitee" });
    expect(forInvitee).toMatchObject({
      event_name: "30 Minute Meeting",
      event_date: "Wednesday, October 14, 2026",
      event_time: "18:00",
      event_end_time: "18:30",
      event_time_zone: "Central European Time",
      my_name: "Julian Joseph",
      host_name: "Julian Joseph",
      invitee_full_name: "Ana Maria Lopez",
      invitee_first_name: "Ana",
      invitee_email: "ana@example.com",
      invitee_uuid: invitee!.id,
      invitees_count: 1,
      guests: "g1@example.com, g2@example.com",
      questions_and_answers: "What would you like to discuss?\nRoadmap",
      answer_1: "Roadmap",
      answer_2: "",
      utm_source: "newsletter",
      location: "https://meet.google.com/abc-defg-hij",
      join_url: `http://localhost:3000/events/${scheduledEvent.id}/join`,
      cancel_url: `http://localhost:3000/cancellations/${invitee!.id}`,
      reschedule_url: `http://localhost:3000/reschedulings/${invitee!.id}`,
      event_type_url: "http://localhost:3000/julian-ctx/30min",
    });
    const forHost = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee!.id, recipient: "host" });
    expect(forHost).toMatchObject({ event_time: "9:00am", event_time_zone: "Pacific Time - US & Canada" });
    const slot = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, recipient: "other", timeZone: "America/New_York" });
    expect(slot).toMatchObject({ event_time: "12:00pm", invitees_count: 1 });
    expect(slot.invitee_email).toBeUndefined();
    expect(await buildMeetingTemplateContext({ scheduledEventId: "00000000-0000-4000-8000-000000000000", recipient: "host" })).toEqual({});
  });
});
