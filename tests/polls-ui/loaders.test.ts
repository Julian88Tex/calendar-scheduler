// Page data loaders of the meeting poll pages (SPEC MP-01, MP-07, MP-12, MP-16, MP-17, MP-26, MP-27): the voter page
// (slug checks, 404, 410, the canonical slug and magic edit redirects, the voter identity passed to polls-core, the
// calendar check and OAuth flags, branding and embed colors, the host preview link), the results page (unknown and
// foreign polls are 404, ?book= and ?duplicate=1 deep links), the list query and the edit wizard data. polls-core's
// contract is mocked so the pages are shown to follow its decisions; co-host candidates come from a PGlite database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostPollView, VoterPollView } from "@/lib/polls/types";

const state = vi.hoisted(() => ({
  voter: null as unknown,
  voterCalls: [] as unknown[],
  user: null as null | { id: string; name: string; email: string },
  editToken: null as string | null,
  check: null as unknown,
  host: null as unknown,
  hostError: null as unknown,
  hostCalls: [] as unknown[],
  listCalls: [] as unknown[],
  profile: null as unknown,
}));

vi.mock("@/lib/polls/server", () => ({
  getVoterView: async (slug: string, identity: unknown) => {
    state.voterCalls.push({ slug, identity });
    return state.voter;
  },
  issuePollFormToken: async () => "form-token",
  readEditTokenFromHeaders: async () => state.editToken,
  readCheckCookieFromHeaders: async () => "check-cookie",
  readVoterCalendarCheck: async (slug: string, cookie: string | null) => (cookie ? state.check : null),
  getHostPoll: async (_actor: unknown, id: string, opts?: unknown) => {
    state.hostCalls.push({ id, opts });
    if (state.hostError) throw state.hostError;
    return state.host;
  },
  listPolls: async (_actor: unknown, query: unknown) => {
    state.listCalls.push(query);
    return { items: [], nextCursor: null };
  },
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => state.user,
}));
vi.mock("@/components/booking/server/host", () => ({ loadHostProfile: async () => state.profile }));
vi.mock("@/components/public/operator", () => ({ getOperatorEmail: async () => "ops@example.com" }));
vi.mock("@/lib/availability", () => ({
  getDefaultSchedule: async () => ({ id: "s1" }),
  loadScheduleInput: async () => ({ weekly: [[], [{ start: 540, end: 1020 }], [{ start: 480, end: 720 }], [], [], [], []] }),
}));

const { AppError } = await import("@/lib/errors");
const { loadVoterPage, normalizeSlug, voterMetadataTitle } = await import("@/components/polls/server/voter");
const { loadEditWizard, loadPollsList, loadResultsPage, parseListQuery, resultsDeepLinks } = await import("@/components/polls/server/host");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");

const t = useTestDb();
const POLL_ID = "5eed0000-0000-4000-8000-0000000000a1";

function voterView(over: Partial<VoterPollView> = {}): VoterPollView {
  return {
    poll: {
      title: "Roadmap sync",
      hosts: [
        { userId: "cohost-1", name: "Ben Ito", role: "cohost" },
        { userId: "owner-1", name: "Ana Lima", role: "owner" },
      ],
    },
    viewerIsHost: false,
    ...over,
  } as unknown as VoterPollView;
}

function hostView(over: Record<string, unknown> = {}): HostPollView {
  return {
    poll: {
      id: POLL_ID,
      slug: "roadmap-sync",
      link: "http://localhost:3000/p/roadmap-sync",
      status: "open",
      title: "Roadmap sync",
      descriptionHtml: null,
      location: null,
      defaultDurationMinutes: 30,
      settings: { timezone: "America/New_York" },
    },
    options: [
      { id: "o-past", isPast: true },
      { id: "o-next", isPast: false },
    ],
    hosts: [
      { userId: "owner-1", role: "owner", name: "Ana Lima", email: "ana@example.com", avatarUrl: null },
      { userId: "gone-1", role: "cohost", name: "Former Colleague", email: "former@example.com", avatarUrl: null },
    ],
    counts: { respondents: 2 },
    booked: null,
    canRemoveCohosts: true,
    ...over,
  } as unknown as HostPollView;
}

beforeEach(() => {
  Object.assign(state, { voter: null, voterCalls: [], user: null, editToken: null, check: null, host: null, hostError: null, hostCalls: [], listCalls: [], profile: null });
});

describe("normalizeSlug", () => {
  it("accepts lowercase link endings and rejects anything else", () => {
    expect(normalizeSlug("Roadmap-Sync")).toBe("roadmap-sync");
    expect(normalizeSlug("team%20sync")).toBeNull();
    expect(normalizeSlug("%E0%A4%A")).toBeNull();
    expect(normalizeSlug("a".repeat(101))).toBeNull();
  });
});

describe("loadVoterPage", () => {
  it("answers 404 for a bad or unknown slug without asking polls-core about bad ones", async () => {
    expect(await loadVoterPage("not a slug", {})).toEqual({ kind: "not_found" });
    expect(state.voterCalls).toHaveLength(0);
    state.voter = { status: 404 };
    expect(await loadVoterPage("missing", {})).toEqual({ kind: "not_found" });
  });

  it("shows the canceled state for a deleted poll", async () => {
    state.voter = { status: 410 };
    const r = await loadVoterPage("gone", { primary_color: "00a2ff" });
    expect(r).toMatchObject({ kind: "gone", shell: { ribbon: true, operatorEmail: "ops@example.com", branding: { primaryColor: "#00a2ff" } } });
  });

  it("redirects an old link ending permanently, keeping the invite and embed parameters", async () => {
    state.voter = { status: 301, canonicalSlug: "new-sync", editPath: null };
    expect(await loadVoterPage("old-sync", { i: "inv", embed_type: "Inline", utm_source: "x" })).toEqual({ kind: "redirect", to: "/p/new-sync?i=inv&embed_type=Inline", permanent: true });
  });

  it("sends a voter with an edit cookie on an old link through the magic edit path", async () => {
    state.editToken = "edit-1";
    state.voter = { status: 301, canonicalSlug: "new-sync", editPath: "/api/public/polls/new-sync/edit?t=edit-1" };
    expect(await loadVoterPage("old-sync", {})).toEqual({ kind: "redirect", to: "/api/public/polls/new-sync/edit?t=edit-1", permanent: false });
  });

  it("passes the voter identity to polls-core and builds the page props", async () => {
    state.user = { id: "u9", name: "Priya Raman", email: "priya@example.com" };
    state.editToken = "edit-2";
    state.check = { checkedAt: "2026-10-14T10:00:00Z", statuses: {} };
    state.profile = { brandColors: { primary: "#112233", background: null, text: null }, logoUrl: "/logo.png", showBranding: false, privacyUrl: "https://example.com/privacy" };
    state.voter = { status: 200, view: voterView(), canonicalSlug: "roadmap-sync", pollId: POLL_ID };
    const r = await loadVoterPage("Roadmap-Sync", { i: "invite-token", calendar: "checked", link: "expired", oauth_error: "canceled", provider: "google" });
    expect(state.voterCalls[0]).toEqual({
      slug: "roadmap-sync",
      identity: { editToken: "edit-2", inviteToken: "invite-token", userId: "u9", viewer: { userId: "u9", name: "Priya Raman", email: "priya@example.com" } },
    });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.props).toMatchObject({
      slug: "roadmap-sync",
      inviteToken: "invite-token",
      formToken: "form-token",
      calendarCheck: state.check,
      flags: { calendarChecked: true, linkExpired: true },
      resultsHref: null,
      shell: { ribbon: false, logoUrl: "/logo.png", privacyUrl: "https://example.com/privacy", branding: { primaryColor: "#112233" } },
    });
    expect(r.props.flags.oauthError).toMatch(/Google/);
  });

  it("links a host previewing their own poll to the results and ignores a calendar flag without a check", async () => {
    state.voter = { status: 200, view: voterView({ viewerIsHost: true }), canonicalSlug: "roadmap-sync", pollId: POLL_ID };
    const r = await loadVoterPage("roadmap-sync", { calendar: "checked", oauth_error: "weird" });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.props.resultsHref).toBe(`/app/polls/${POLL_ID}`);
    expect(r.props.flags).toEqual({ calendarChecked: false, linkExpired: false, oauthError: "We couldn't check your calendar. Try again." });
  });

  it("titles the page with the poll and the owner's name for link previews", () => {
    expect(voterMetadataTitle(voterView())).toEqual({ title: "Roadmap sync", ogTitle: "Ana Lima: Roadmap sync" });
  });
});

describe("results page", () => {
  it("is 404 for a malformed id, an unknown poll or another organization's poll", async () => {
    const owner = await f.createUser(t.db);
    const actor = { user: owner, orgId: owner.organizationId, orgRole: owner.orgRole, isInstanceAdmin: false, teamRoles: new Map(), groupAdminOf: new Set<string>() };
    expect(await loadResultsPage(actor, "nope", {})).toBeNull();
    expect(state.hostCalls).toHaveLength(0);
    state.hostError = new AppError("not_found");
    expect(await loadResultsPage(actor, POLL_ID, {})).toBeNull();
    state.hostError = new AppError("forbidden");
    expect(await loadResultsPage(actor, POLL_ID, {})).toBeNull();
    state.hostError = new Error("database down");
    await expect(loadResultsPage(actor, POLL_ID, {})).rejects.toThrow("database down");
  });

  it("marks the poll viewed and honors the ?book= and ?duplicate=1 deep links", async () => {
    const owner = await f.createUser(t.db, { timezone: "Europe/Berlin", overrides: { timeFormat: "24h" } });
    const actor = { user: owner, orgId: owner.organizationId, orgRole: owner.orgRole, isInstanceAdmin: false, teamRoles: new Map(), groupAdminOf: new Set<string>() };
    state.host = hostView();
    const r = await loadResultsPage(actor, POLL_ID, { book: "o-next", duplicate: "1" });
    expect(state.hostCalls[0]).toEqual({ id: POLL_ID, opts: { markViewed: true } });
    expect(r).toMatchObject({ bookOptionId: "o-next", offerDuplicate: true, viewer: { userId: owner.id, timezone: "Europe/Berlin", hour12: false } });
    // A past or unknown option can't be booked from a link.
    expect(resultsDeepLinks(hostView(), { book: "o-past" })).toEqual({ bookOptionId: null, offerDuplicate: false });
    expect(resultsDeepLinks(hostView(), { book: ["o-x", "o-next"] })).toEqual({ bookOptionId: null, offerDuplicate: false });
    // "Book this time" from an older email: a poll booked (or ended) since then doesn't open the Book dialog.
    const statusOf = (status: string) => hostView({ poll: { ...hostView().poll, status } });
    expect(resultsDeepLinks(statusOf("closed"), { book: "o-next" }).bookOptionId).toBe("o-next");
    for (const status of ["booked", "expired", "canceled"]) expect(resultsDeepLinks(statusOf(status), { book: "o-next" }).bookOptionId).toBeNull();
  });
});

describe("Meeting polls list", () => {
  it("parses the filter, search and hosted by query with safe defaults", () => {
    expect(parseListQuery({})).toEqual({ filter: "open", q: "", hostedBy: "all" });
    expect(parseListQuery({ filter: "booked", q: "  sync ", hosted: "cohosted" })).toEqual({ filter: "booked", q: "sync", hostedBy: "cohosted" });
    expect(parseListQuery({ filter: "drop table", hosted: "anyone", q: "x".repeat(150) })).toMatchObject({ filter: "open", hostedBy: "all", q: "x".repeat(100) });
  });

  it("offers Hosted by only when the organization has other people", async () => {
    const solo = await f.createUser(t.db);
    const actor = (u: typeof solo) => ({ user: u, orgId: u.organizationId, orgRole: u.orgRole, isInstanceAdmin: false, teamRoles: new Map(), groupAdminOf: new Set<string>() });
    const alone = await loadPollsList(actor(solo), { filter: "all", q: "sync" });
    expect(state.listCalls[0]).toEqual({ filter: "all", q: "sync", hostedBy: "all" });
    expect(alone.showHostedBy).toBe(false);
    await f.createUser(t.db, { organizationId: solo.organizationId, name: "Ben Ito" });
    expect((await loadPollsList(actor(solo), {})).showHostedBy).toBe(true);
  });
});

describe("edit wizard", () => {
  it("loads the poll with its co-hosts, keeping ones who left the organization, and the working hours start", async () => {
    const owner = await f.createUser(t.db, { name: "Ana Lima" });
    const colleague = await f.createUser(t.db, { organizationId: owner.organizationId, name: "Ben Ito" });
    await f.createUser(t.db, { name: "Other Org" });
    const actor = { user: owner, orgId: owner.organizationId, orgRole: owner.orgRole, isInstanceAdmin: false, teamRoles: new Map(), groupAdminOf: new Set<string>() };
    state.host = hostView({ booked: { status: "active" } });
    const w = await loadEditWizard(actor, POLL_ID);
    expect(state.hostCalls[0]).toEqual({ id: POLL_ID, opts: undefined });
    expect(w).toMatchObject({ mode: "edit", workingStartMinutes: 480, poll: { id: POLL_ID, cohostIds: ["gone-1"], respondentCount: 2, meetingLocked: true, canRemoveCohosts: true } });
    expect(w!.members.map((m) => m.name)).toEqual(["Ben Ito", "Former Colleague"]);
    expect(w!.members[0]!.userId).toBe(colleague.id);
  });

  it("is 404 for a deleted poll", async () => {
    const owner = await f.createUser(t.db);
    const actor = { user: owner, orgId: owner.organizationId, orgRole: owner.orgRole, isInstanceAdmin: false, teamRoles: new Map(), groupAdminOf: new Set<string>() };
    state.host = hostView({ poll: { ...(hostView().poll as object), status: "canceled" } });
    expect(await loadEditWizard(actor, POLL_ID)).toBeNull();
  });
});
