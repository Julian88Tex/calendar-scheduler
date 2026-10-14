// The /api/public/polls/** and /api/polls/** route handlers on PGlite (SPEC MP-01, MP-02, MP-11, MP-12, MP-15, MP-30;
// research meeting-polls.md Part D): the redacted public JSON, 404, 308 and 410, vote submits with the bot checks and
// the edit cookies on both paths, the magic edit link (cookie, no state change), host routes behind the session with
// co-host permissions (403 on delete), and the creation grid busy overlay (same organization only, titles only for
// the requester's own events).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ext = vi.hoisted(() => ({ busy: {} as Record<string, { start: Date; end: Date; title: string }[]> }));
const req = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    getAll: () => [...req.cookies.entries()].map(([name, value]) => ({ name, value })),
    has: (name: string) => req.cookies.has(name),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) =>
      Object.fromEntries(
        p.userIds.map((id) => [
          id,
          { ok: true, stale: false, nocal: false, busy: (ext.busy[id] ?? []).map((b, i) => ({ ...b, allDay: false, calendarId: "cal-1", externalId: `ext-${i}` })) },
        ]),
      ),
  };
});

const { createSessionRecord, SESSION_COOKIE } = await import("@/lib/auth/session");
const { issueBookingFormToken } = await import("@/lib/booking");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { deletePoll } = await import("@/lib/polls/manage");
const { updatePoll } = await import("@/lib/polls/update");
const publicPoll = await import("@/app/api/public/polls/[slug]/route");
const responses = await import("@/app/api/public/polls/[slug]/responses/route");
const editLinkRoute = await import("@/app/api/public/polls/[slug]/edit/route");
const hostPoll = await import("@/app/api/polls/[id]/route");
const busyRoute = await import("@/app/api/polls/busy/route");
const exportRoute = await import("@/app/api/polls/[id]/export.csv/route");
const { useTestDb } = await import("../helpers/db");
const { NOW, advance, ip, la, newPoll, setupHost, vote } = await import("./helpers");

const t = useTestDb();
const ORIGIN = "http://localhost:3000";
beforeEach(() => {
  setFakeNow(NOW);
  req.cookies.clear();
  ext.busy = {};
});
afterEach(() => resetFakeTime());

type Host = Awaited<ReturnType<typeof setupHost>>;
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function signIn(host: Host): Promise<void> {
  const { token } = await createSessionRecord(t.db, host.user.id, { ip: "203.0.113.9", userAgent: "Mozilla/5.0 Chrome/141.0.0.0" });
  req.cookies.set(SESSION_COOKIE, token);
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip(), ...headers }, body: JSON.stringify(body) });
}

describe("GET /api/public/polls/{slug} (MP-12, MP-15)", () => {
  it("answers the redacted view: no other participant names or emails in host_only polls", async () => {
    const host = await setupHost(t.db);
    const { slug } = await newPoll(host);
    expect((await vote(slug, { name: "Ana Lima", email: "ana@example.com" })).ok).toBe(true);
    const res = await publicPoll.GET(new Request(`${ORIGIN}/api/public/polls/${slug}`), slugCtx(slug));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("Ana Lima");
    expect(text).not.toContain("ana@example.com");
    expect(text).not.toContain(host.user.email);
    expect(JSON.parse(text)).toMatchObject({ poll: { slug, title: "Roadmap sync", resultsVisibility: "host_only" }, participants: null, me: null, canVote: true });
  });

  it("404 for an unknown slug, 308 for an old link ending, 410 once deleted", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    expect((await publicPoll.GET(new Request(`${ORIGIN}/api/public/polls/missing-poll`), slugCtx("missing-poll"))).status).toBe(404);
    await updatePoll(host.actor, { pollId, slug: "renamed-poll" });
    const moved = await publicPoll.GET(new Request(`${ORIGIN}/api/public/polls/${slug}?i=abc`), slugCtx(slug));
    expect(moved.status).toBe(308);
    expect(moved.headers.get("location")).toBe(`${ORIGIN}/api/public/polls/renamed-poll?i=abc`);
    await deletePoll(host.actor, { pollId, notify: false });
    const gone = await publicPoll.GET(new Request(`${ORIGIN}/api/public/polls/renamed-poll`), slugCtx("renamed-poll"));
    expect(gone.status).toBe(410);
    expect(await gone.json()).toEqual({ error: "gone", message: "This poll is no longer available." });
  });
});

describe("POST /api/public/polls/{slug}/responses (MP-09, MP-11, MP-30)", () => {
  it("checks the origin and the bot token, then saves the vote and sets the httpOnly edit cookies on both paths", async () => {
    const host = await setupHost(t.db);
    const { slug } = await newPoll(host);
    const body = { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin", votes: [] as unknown[] };
    const crossSite = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, body, { origin: "https://evil.example" }), slugCtx(slug));
    expect(crossSite.status).toBe(403);
    const noToken = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, body), slugCtx(slug));
    expect(noToken.status).toBe(400);
    expect(await noToken.json()).toMatchObject({ ok: false, code: "bot" });
    const formToken = await issueBookingFormToken();
    const tooFast = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, { ...body, formToken }), slugCtx(slug));
    expect(await tooFast.json()).toMatchObject({ code: "bot" });
    advance(3_000);
    const ok = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, { ...body, formToken, website: "" }), slugCtx(slug));
    expect(ok.status).toBe(201);
    const json = (await ok.json()) as { ok: boolean; editToken: string | null; status: string };
    expect(json).toMatchObject({ ok: true, status: "responded", editToken: null });
    const cookies = ok.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.find((c) => c.includes(`Path=/p/${slug}`))).toMatch(/^kairos_poll_edit=[^;]+; Path=\/p\/[a-z0-9]+; Max-Age=31536000; HttpOnly; SameSite=Lax/);
    expect(cookies.find((c) => c.includes(`Path=/api/public/polls/${slug}`))).toMatch(/^kairos_poll_edit_api=/);
    const honeypot = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, { ...body, email: "bot@example.com", formToken, website: "http://spam" }), slugCtx(slug));
    expect(await honeypot.json()).toMatchObject({ code: "bot" });
  });

  it("answers 409 duplicate_email when someone types another participant's email", async () => {
    const host = await setupHost(t.db);
    const { slug } = await newPoll(host);
    expect((await vote(slug)).ok).toBe(true);
    const formToken = await issueBookingFormToken();
    advance(3_000);
    const res = await responses.POST(postJson(`${ORIGIN}/api/public/polls/${slug}/responses`, { name: "Mallory", email: "ana@example.com", timezone: "UTC", votes: [], formToken }), slugCtx(slug));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "duplicate_email" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("GET /api/public/polls/{slug}/edit (MP-11)", () => {
  it("sets the edit cookies for a valid token and redirects to the clean URL; an invalid token only opens the poll", async () => {
    const host = await setupHost(t.db);
    const { slug } = await newPoll(host);
    const r = await vote(slug);
    if (!r.ok) throw new Error("vote");
    const res = await editLinkRoute.GET(new Request(`${ORIGIN}/api/public/polls/${slug}/edit?t=${encodeURIComponent(r.editToken)}`), slugCtx(slug));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/p/${slug}`);
    expect(res.headers.getSetCookie()).toHaveLength(2);
    const bad = await editLinkRoute.GET(new Request(`${ORIGIN}/api/public/polls/${slug}/edit?t=${"a".repeat(43)}`), slugCtx(slug));
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/p/${slug}?link=expired`);
    expect(bad.headers.getSetCookie()).toEqual([]);
  });
});

describe("host routes (MP-01, MP-02)", () => {
  it("needs a session, lets co-hosts read but not delete, and lets the creator delete", async () => {
    const host = await setupHost(t.db);
    const co = await setupHost(t.db, { name: "Kim Co", organizationId: host.user.organizationId, orgRole: "user" });
    const { pollId } = await newPoll(host, { coHostIds: [co.user.id] });
    expect((await hostPoll.GET(new Request(`${ORIGIN}/api/polls/${pollId}`), idCtx(pollId))).status).toBe(401);
    await signIn(co);
    const read = await hostPoll.GET(new Request(`${ORIGIN}/api/polls/${pollId}`), idCtx(pollId));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ access: "manage", canDelete: false, poll: { id: pollId } });
    const del = (who: string) => new Request(`${ORIGIN}/api/polls/${pollId}`, { method: "DELETE", headers: { origin: ORIGIN, "content-type": "application/json", "x-test": who }, body: "{}" });
    expect((await hostPoll.DELETE(del("co"), idCtx(pollId))).status).toBe(403);
    req.cookies.clear();
    await signIn(host);
    const csv = await exportRoute.GET(new Request(`${ORIGIN}/api/polls/${pollId}/export.csv`), idCtx(pollId));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toContain("roadmap-sync-responses.csv");
    expect((await hostPoll.DELETE(del("owner"), idCtx(pollId))).status).toBe(200);
  });

  it("busy overlay: same organization only, event titles only for the requester's own calendars (GEN-08)", async () => {
    const host = await setupHost(t.db);
    const co = await setupHost(t.db, { name: "Kim Co", organizationId: host.user.organizationId, orgRole: "user" });
    const outsider = await setupHost(t.db, { name: "Out Sider" });
    ext.busy[host.user.id] = [{ start: la("2030-10-09 09:00"), end: la("2030-10-09 10:00"), title: "Board prep" }];
    ext.busy[co.user.id] = [{ start: la("2030-10-09 11:00"), end: la("2030-10-09 12:00"), title: "Private 1:1" }];
    await signIn(host);
    const url = (ids: string[]) => `${ORIGIN}/api/polls/busy?start=${encodeURIComponent(la("2030-10-07 00:00").toISOString())}&end=${encodeURIComponent(la("2030-10-14 00:00").toISOString())}&hostIds=${ids.join(",")}`;
    const res = await busyRoute.GET(new Request(url([co.user.id])), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { busy: Record<string, { kind: string; title: string | null }[]>; workingHours: unknown[] };
    expect(body.busy[host.user.id]).toEqual([expect.objectContaining({ kind: "calendar", title: "Board prep" })]);
    expect(body.busy[co.user.id]).toEqual([expect.objectContaining({ kind: "calendar", title: null })]);
    expect(JSON.stringify(body)).not.toContain("Private 1:1");
    expect(body.workingHours.length).toBeGreaterThan(0);
    expect((await busyRoute.GET(new Request(url([outsider.user.id])), undefined)).status).toBe(403);
  });
});
