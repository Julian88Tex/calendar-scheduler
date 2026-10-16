// POST /api/public/compare/busy   { calendarIds, start, end } -> { busy: [{ start, end }] (epoch ms, merged across the
//                                 chosen calendars), failed: [{ id, reason }] }. Booking page "Compare with my calendar":
//                                 the visitor's own busy times from Google free/busy (no titles, nothing stored).
//                                 Same origin only; COMPARE_BUSY_PER_HOUR lookups per connection.
import { z } from "zod";
import { COMPARE_BUSY_PER_HOUR, COMPARE_MAX_CALENDARS, COMPARE_MAX_DAYS } from "@/lib/compare/constants";
import { CompareTokenError, compareBusy } from "@/lib/compare/google";
import { clearCompareCookie, readCompareSession } from "@/lib/compare/session";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, json, readJsonBody, route } from "@/lib/http";
import { log } from "@/lib/logger";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z
  .object({
    calendarIds: z.array(z.string().trim().min(1).max(320)).min(1).max(COMPARE_MAX_CALENDARS),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  })
  .refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "End must be after start", path: ["end"] })
  .refine((v) => Date.parse(v.end) - Date.parse(v.start) <= COMPARE_MAX_DAYS * 86_400_000, { message: `Ask for at most ${COMPARE_MAX_DAYS} days`, path: ["end"] });

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const session = await readCompareSession(request);
  if (!session) return json({ error: "unauthorized", message: "Connect your calendar first.", connected: false }, { status: 401 });
  const input = await readJsonBody(request, Body);
  await assertRateLimit(`compare:busy:${session.id}`, COMPARE_BUSY_PER_HOUR, 3600);
  try {
    const out = await compareBusy(session, [...new Set(input.calendarIds)], { start: new Date(input.start), end: new Date(input.end) });
    return json(out);
  } catch (e) {
    if (e instanceof CompareTokenError) return clearCompareCookie(json({ error: "unauthorized", message: "Connect your calendar again.", connected: false }, { status: 401 }));
    if (e instanceof AppError) throw e;
    log.warn("compare.busy_failed", { error: e });
    return json({ error: "internal", message: "We couldn't load your busy times." }, { status: 502 });
  }
});
