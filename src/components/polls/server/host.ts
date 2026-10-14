// Host-side page loaders of meeting polls (SPEC MP-01, MP-02, MP-16, MP-17, MP-26, MP-27): the Meeting polls list,
// the create wizard, the edit wizard and the results page, on top of polls-core's read models (getHostPoll, listPolls)
// plus the viewer's display preferences, the organization people who can co-host, and the working hours start of the
// default schedule (first scroll position of the week grid). Every loader authorizes through polls-core (requirePollAccess)
// and maps its errors: unknown or foreign polls are 404. Server only.
import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { organizationMemberships, users } from "@/db/schema";
import { getDefaultSchedule, loadScheduleInput } from "@/lib/availability";
import type { ActorCtx } from "@/lib/authz";
import { isAppError } from "@/lib/errors";
import { fileUrl } from "@/lib/files";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { getHostPoll, listPolls } from "@/lib/polls/server";
import type { PollHostedBy, PollListFilter } from "@/lib/polls/types";
import { now as clockNow } from "@/lib/time/now";
import { isValidTimeZone } from "@/lib/time/zones";
import type { EditPollData, HostOption, PollsListProps, ResultsPageProps, ViewerPrefs, WizardProps } from "../types";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export function viewerPrefs(user: ActorCtx["user"]): ViewerPrefs {
  return {
    userId: user.id,
    name: user.name?.trim() || user.email,
    email: user.email,
    avatarUrl: user.avatarFileId ? fileUrl(user.avatarFileId) : (user.avatarUrl ?? null),
    timezone: isValidTimeZone(user.timezone) ? user.timezone : "UTC",
    hour12: user.timeFormat !== "24h",
    weekStart: user.weekStart === 1 ? 1 : 0,
    locale: user.locale || "en",
  };
}

/** Other live people of the actor's organization (co-host candidates, MP-02: same organization only). */
export async function listCohostCandidates(actor: ActorCtx): Promise<HostOption[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarFileId: users.avatarFileId, avatarUrl: users.avatarUrl })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(and(eq(organizationMemberships.organizationId, actor.orgId), ne(users.id, actor.user.id), isNull(users.deletedAt)))
    .orderBy(asc(users.name))
    .limit(500);
  return rows.map((r) => ({ userId: r.id, name: r.name?.trim() || r.email, email: r.email, avatarUrl: r.avatarFileId ? fileUrl(r.avatarFileId) : (r.avatarUrl ?? null) }));
}

/** Earliest working hours start (minutes) of the default schedule over the coming week, or null. */
export async function workingStartMinutes(userId: string): Promise<number | null> {
  try {
    const schedule = await getDefaultSchedule(userId);
    if (!schedule) return null;
    const start = clockNow();
    const input = await loadScheduleInput(schedule.id, { start, end: new Date(start.getTime() + 7 * 86_400_000) });
    if (!input) return null;
    let min: number | null = null;
    for (const day of input.weekly) for (const r of day) min = min === null ? r.start : Math.min(min, r.start);
    return min;
  } catch (e) {
    log.warn("polls.working_start_failed", { error: e });
    return null;
  }
}

const FILTERS: PollListFilter[] = ["open", "booked", "ended", "all"];
const HOSTED: PollHostedBy[] = ["all", "me", "cohosted"];

export function parseListQuery(sp: SearchParams): { filter: PollListFilter; q: string; hostedBy: PollHostedBy } {
  const f = one(sp, "filter");
  const h = one(sp, "hosted");
  return {
    filter: f && (FILTERS as string[]).includes(f) ? (f as PollListFilter) : "open",
    q: (one(sp, "q") ?? "").slice(0, 100),
    hostedBy: h && (HOSTED as string[]).includes(h) ? (h as PollHostedBy) : "all",
  };
}

export async function loadPollsList(actor: ActorCtx, sp: SearchParams): Promise<PollsListProps> {
  const query = parseListQuery(sp);
  const [page, members] = await Promise.all([listPolls(actor, { filter: query.filter, q: query.q || undefined, hostedBy: query.hostedBy }), listCohostCandidates(actor)]);
  return {
    ...query,
    items: page.items,
    nextCursor: page.nextCursor,
    showHostedBy: members.length > 0 || page.items.some((i) => i.role !== "owner"),
    viewer: viewerPrefs(actor.user),
  };
}

/** The ?book={optionId} and ?duplicate=1 deep links of the results page (unknown options are ignored). */
export function resultsDeepLinks(data: ResultsPageProps["data"], sp: SearchParams): Pick<ResultsPageProps, "bookOptionId" | "offerDuplicate"> {
  const book = one(sp, "book");
  return { bookOptionId: book && data.options.some((o) => o.id === book && !o.isPast) ? book : null, offerDuplicate: one(sp, "duplicate") === "1" };
}

/** Results page data; null for an unknown poll or one the actor can't open (the page answers 404). */
export async function loadResultsPage(actor: ActorCtx, id: string, sp: SearchParams): Promise<ResultsPageProps | null> {
  if (!isUuid(id)) return null;
  try {
    const data = await getHostPoll(actor, id, { markViewed: true });
    return { data, viewer: viewerPrefs(actor.user), ...resultsDeepLinks(data, sp) };
  } catch (e) {
    if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) return null;
    throw e;
  }
}

export async function loadCreateWizard(actor: ActorCtx): Promise<WizardProps> {
  const [members, start] = await Promise.all([listCohostCandidates(actor), workingStartMinutes(actor.user.id)]);
  return { mode: "create", viewer: viewerPrefs(actor.user), members, workingStartMinutes: start, poll: null };
}

/** Edit wizard data; null for an unknown poll, one the actor can't open, or a deleted one. */
export async function loadEditWizard(actor: ActorCtx, id: string): Promise<WizardProps | null> {
  if (!isUuid(id)) return null;
  try {
    const data = await getHostPoll(actor, id);
    if (data.poll.status === "canceled") return null;
    const [members, start] = await Promise.all([listCohostCandidates(actor), workingStartMinutes(actor.user.id)]);
    const poll: EditPollData = {
      id: data.poll.id,
      slug: data.poll.slug,
      link: data.poll.link,
      status: data.poll.status,
      title: data.poll.title,
      descriptionHtml: data.poll.descriptionHtml,
      location: data.poll.location,
      defaultDurationMinutes: data.poll.defaultDurationMinutes,
      settings: data.poll.settings,
      options: data.options,
      cohostIds: data.hosts.filter((h) => h.role === "cohost").map((h) => h.userId),
      respondentCount: data.counts.respondents,
      meetingLocked: Boolean(data.booked && data.booked.status === "active"),
      canRemoveCohosts: data.canRemoveCohosts,
    };
    // Co-hosts already on the poll stay listed even when they left the organization.
    const known = new Set(members.map((m) => m.userId));
    const extra = data.hosts.filter((h) => h.role === "cohost" && !known.has(h.userId)).map((h) => ({ userId: h.userId, name: h.name, email: h.email, avatarUrl: h.avatarUrl }));
    return { mode: "edit", viewer: viewerPrefs(actor.user), members: [...members, ...extra], workingStartMinutes: start, poll };
  } catch (e) {
    if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) return null;
    throw e;
  }
}
