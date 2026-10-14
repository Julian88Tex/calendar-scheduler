// Voter calendar check services (SPEC MP-13): the ICS link and signed-in user checks behind
// POST /api/public/polls/{slug}/freebusy, the OAuth result (voter-oauth.ts) and reading the stored result back for the
// voter page. Nothing about the voter's calendar is written to the database. Server only.
import "server-only";
import { getDb } from "@/db";
import { hashIp } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { now as clockNow } from "@/lib/time/now";
import { POLL_ERRORS } from "./constants";
import { accountBusy, checkRange, decodeCheck, encodeCheck, icsBusy, statusesFor, type Busy } from "./freebusy";
import { loadOptions, loadPollBySlug, type OptionRow, type PollRow } from "./load";
import type { VoterCalendarCheck } from "./types";

async function livePoll(slug: string): Promise<{ poll: PollRow; options: OptionRow[] }> {
  const db = await getDb();
  const found = await loadPollBySlug(db, slug, clockNow());
  if (!found || found.poll.deletedAt || found.poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
  return { poll: found.poll, options: await loadOptions(db, found.poll.id) };
}

/** Runs a check from busy intervals and returns the result plus its cookie value. */
export async function checkFromBusy(
  poll: PollRow,
  options: OptionRow[],
  busy: readonly Busy[],
  source: VoterCalendarCheck["source"],
): Promise<{ check: VoterCalendarCheck; cookie: string }> {
  const at = clockNow();
  const statuses = statusesFor(poll, options, busy, at);
  return { check: { source, checkedAt: at.toISOString(), statuses }, cookie: await encodeCheck(poll.id, statuses, source, at) };
}

/** "Paste an ICS link" or the signed-in user's own calendars (10 checks per IP per hour). */
export async function checkVoterCalendar(
  slug: string,
  input: { icsUrl?: string | null; userId?: string | null },
  ctx: { ip?: string | null } = {},
): Promise<{ check: VoterCalendarCheck; cookie: string; slug: string }> {
  const { poll, options } = await livePoll(slug);
  const limit = await rateLimit(`poll-freebusy:ip:${await hashIp(ctx.ip)}`, 10, 3600);
  if (!limit.ok) throw rateLimitedError(limit);
  const range = checkRange(poll, options, clockNow());
  let busy: Busy[] = [];
  let source: VoterCalendarCheck["source"];
  if (input.icsUrl) {
    source = "ics";
    if (range) busy = await icsBusy(input.icsUrl, range);
  } else if (input.userId) {
    source = "account";
    if (range) busy = await accountBusy(input.userId, range);
  } else {
    throw new AppError("validation", POLL_ERRORS.icsInvalid, { fieldErrors: { icsUrl: [POLL_ERRORS.icsInvalid] } });
  }
  const out = await checkFromBusy(poll, options, busy, source);
  return { ...out, slug: poll.slug };
}

/** The voter's last check for this poll (from their cookie), or null. */
export async function readVoterCalendarCheck(slug: string, cookieValue: string | null | undefined): Promise<VoterCalendarCheck | null> {
  if (!cookieValue) return null;
  const db = await getDb();
  const found = await loadPollBySlug(db, slug, clockNow());
  if (!found) return null;
  const options = await loadOptions(db, found.poll.id);
  return decodeCheck(cookieValue, found.poll.id, options.map((o) => o.id));
}
