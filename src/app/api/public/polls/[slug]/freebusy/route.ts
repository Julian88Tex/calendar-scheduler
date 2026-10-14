// OWNER: polls-core.
//
// POST   /api/public/polls/{slug}/freebusy   "Check my calendar" (SPEC MP-13): { icsUrl } ("Paste an ICS link", fetched
//                                           server side through safeFetch) or { source: "account" } (the signed-in
//                                           app user's conflict calendars) -> { ok, check: { source, checkedAt,
//                                           statuses: { [optionId]: busy | free | unknown } } }. The result is also
//                                           stored in the voter's browser only (signed cookie on /p/{slug}, 30
//                                           minutes); nothing about the calendar is kept in the database.
// DELETE /api/public/polls/{slug}/freebusy   "Clear" -> { ok }.
// Google and Microsoft go through the OAuth intent poll_freebusy instead (oauthStartPath, result on /p/{slug}?calendar=
// checked). Same origin only; 10 checks per IP per hour.
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, getClientIp, readJsonBody, route } from "@/lib/http";
import { ok, slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { appendCheckCookie, checkVoterCalendar, clearCheckCookie } from "@/lib/polls/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  icsUrl: z.string().trim().min(8).max(2048).optional(),
  source: z.enum(["ics", "account"]).optional(),
  embed: z.boolean().default(false),
});

export const POST = route<PublicPollRouteCtx>(async (request, ctx) => {
  assertSameOrigin(request);
  const slug = slugParam((await ctx.params).slug);
  const input = await readJsonBody(request, Body);
  let userId: string | null = null;
  if (!input.icsUrl) {
    if (input.source !== "account") throw new AppError("validation", "Paste an ICS link.", { fieldErrors: { icsUrl: ["Paste an ICS link."] } });
    const user = await getCurrentUser();
    if (!user) throw new AppError("unauthorized");
    userId = user.id;
  }
  const out = await checkVoterCalendar(slug, { icsUrl: input.icsUrl ?? null, userId }, { ip: getClientIp(request) });
  return appendCheckCookie(ok({ check: out.check }), out.slug, out.cookie, { embed: input.embed });
});

export const DELETE = route<PublicPollRouteCtx>(async (request, ctx) => {
  assertSameOrigin(request);
  const slug = slugParam((await ctx.params).slug);
  const embed = new URL(request.url).searchParams.get("embed") === "1";
  return clearCheckCookie(ok(), slug, { embed });
});
