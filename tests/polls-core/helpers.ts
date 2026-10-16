// Shared fixtures of the polls-core integration tests (PGlite): a Los Angeles host with an every-day 09:00 to 17:00
// schedule, polls created through the real createPoll service, votes through submitVote, and a job drain that runs
// the polls handlers (and, when asked, the lifecycle ones) through the real job runner. Mocks are declared in each
// test file (vi.mock is hoisted per file).
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import type { DB } from "@/db";
import { emailOutbox, jobs, meetingPollParticipants, meetingPollVotes, meetingPolls } from "@/db/schema";
import type { WeeklyHours } from "@/db/types";
import { loadActorCtx, type ActorCtx } from "@/lib/authz";
import { runDueJobs } from "@/lib/jobs";
import { createPoll } from "@/lib/polls/create";
import type { CreatePollInput, SubmitVoteInput } from "@/lib/polls/validation";
import { submitVote } from "@/lib/polls/vote";
import { now, setFakeNow } from "@/lib/time/now";
import { createSchedule, createUser, type TestUser } from "../factories";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const LA = "America/Los_Angeles";
/** Monday 2030-10-07 08:00 in Los Angeles. */
export const NOW = new Date("2030-10-07T15:00:00Z");

const all = [{ start: 9 * 60, end: 17 * 60 }];
export const EVERY_DAY: WeeklyHours = [all, all, all, all, all, all, all];
export const CAFE = { id: "5eed0000-0000-4000-8000-0000000000b1", kind: "physical" as const, position: 0, location: "Blue Bottle, 66 Mint St" };

/** "2030-10-08 10:00" in Los Angeles (PDT, UTC-7, holds before Nov 3, 2030). */
export function la(local: string): Date {
  const [d, t] = local.split(" ");
  return new Date(`${d}T${t}:00-07:00`);
}

/** A timed option input of `minutes` starting at an LA wall time. */
export function opt(local: string, minutes = 30): { start: string; end: string } {
  const s = la(local);
  return { start: s.toISOString(), end: new Date(s.getTime() + minutes * MIN).toISOString() };
}

export type Host = { user: TestUser; actor: ActorCtx };

export async function setupHost(db: DB, opts: { name?: string; email?: string; organizationId?: string; orgRole?: "owner" | "admin" | "user" } = {}): Promise<Host> {
  const user = await createUser(db, { name: opts.name ?? "Julian Joseph", email: opts.email, timezone: LA, organizationId: opts.organizationId, orgRole: opts.orgRole });
  await createSchedule(db, { userId: user.id, timezone: LA, weeklyHours: EVERY_DAY });
  return { user, actor: await loadActorCtx(db, user) };
}

export async function newPoll(host: Host, over: Partial<CreatePollInput> = {}) {
  return createPoll(host.actor, {
    title: "Roadmap sync",
    timezone: LA,
    defaultDurationMinutes: 30,
    options: [opt("2030-10-09 10:00"), opt("2030-10-09 11:00"), opt("2030-10-10 14:00")],
    location: CAFE,
    ...over,
  });
}

let ipSeq = 0;
/** A fresh client IP (rate limits are per IP). */
export function ip(): string {
  ipSeq++;
  return `203.0.113.${ipSeq % 250}`;
}

export function voteInput(over: Partial<SubmitVoteInput> = {}): SubmitVoteInput {
  return { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin", votes: [], ...over };
}

/** submitVote without the bot check (the form token is the voter page's job). */
export async function vote(slug: string, over: Partial<SubmitVoteInput> = {}, ctx: { editToken?: string | null; inviteToken?: string | null; userId?: string | null; ip?: string } = {}) {
  return submitVote(slug, voteInput(over), { skipBotCheck: true, ip: ctx.ip ?? ip(), editToken: ctx.editToken, inviteToken: ctx.inviteToken, userId: ctx.userId });
}

// The runner's type filter matches exact types or a trailing "*" prefix: list the polls subscriber jobs one by one.
const POLL_TYPES = ["polls.*", "event:booking.canceled:polls"];
const LIFECYCLE_TYPES = ["event:booking.created:lifecycle", "event:booking.canceled:lifecycle", "event:booking.rescheduled:lifecycle", "event:meeting.updated:lifecycle", "lifecycle.*"];

/**
 * Runs due polls jobs (and lifecycle ones with `lifecycle`) through the real runner until none is due, then fails the
 * test when one of them failed (the runner itself would only reschedule it).
 */
export async function drain(db: DB, opts: { lifecycle?: boolean; rounds?: number } = {}): Promise<void> {
  const types = opts.lifecycle ? [...POLL_TYPES, ...LIFECYCLE_TYPES] : POLL_TYPES;
  for (let i = 0; i < (opts.rounds ?? 10); i++) {
    const r = await runDueJobs({ budgetMs: 25_000, types, workerId: "test" });
    if (r.ran === 0) break;
  }
  const rows = await db
    .select({ type: jobs.type, lastError: jobs.lastError, status: jobs.status })
    .from(jobs)
    .where(and(or(like(jobs.type, "polls.%"), like(jobs.type, "event:%:polls"), like(jobs.type, "lifecycle.%"), like(jobs.type, "event:%:lifecycle")), inArray(jobs.status, ["dead", "failed", "pending"])));
  const broken = rows.filter((j) => j.lastError && j.lastError !== "no_handler" && !j.lastError.startsWith("retry_later"));
  if (broken.length) throw new Error(`job failed: ${broken.map((b) => `${b.type}: ${b.lastError}`).join("; ")}`);
}

/** Moves the business clock forward (jobs scheduled for later become due). */
export function advance(ms: number): void {
  setFakeNow(new Date(now().getTime() + ms));
}

export async function outbox(db: DB, opts: { to?: string; template?: string; scheduledEventId?: string; pollId?: string } = {}) {
  const rows = await db.select().from(emailOutbox).orderBy(asc(emailOutbox.createdAt));
  return rows.filter(
    (r) =>
      (!opts.to || r.toAddresses.includes(opts.to)) &&
      (!opts.template || r.template === opts.template) &&
      (!opts.scheduledEventId || r.scheduledEventId === opts.scheduledEventId) &&
      (!opts.pollId || r.pollId === opts.pollId),
  );
}

export async function pollRow(db: DB, id: string) {
  const [p] = await db.select().from(meetingPolls).where(eq(meetingPolls.id, id)).limit(1);
  if (!p) throw new Error("poll missing");
  return p;
}

export async function participantsOf(db: DB, pollId: string) {
  return db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, pollId)).orderBy(asc(meetingPollParticipants.createdAt));
}

export async function votesOf(db: DB, participantId: string): Promise<Record<string, string>> {
  const rows = await db.select().from(meetingPollVotes).where(eq(meetingPollVotes.participantId, participantId));
  return Object.fromEntries(rows.map((r) => [r.optionId, r.choice]));
}
