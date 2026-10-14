// OWNER: polls-core.
//
// GET /api/polls/busy?start={ISO}&end={ISO}&hostIds={id,id}&pollId={id}   the creation grid overlay (SPEC MP-02): busy
// blocks of the requester and the chosen co-hosts (same organization only; event titles only for the requester's own
// calendars, GEN-08), app meetings, other polls' holds, and the requester's working hours. At most 62 days.
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { hostActor } from "@/lib/polls/route-helpers";
import { getPollGridOverlay } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const actor = await hostActor(request);
  const q = new URL(request.url).searchParams;
  const start = new Date(q.get("start") ?? "");
  const end = new Date(q.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new AppError("validation", "start and end must be ISO dates and times.");
  const hostIds = (q.get("hostIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hostIds.some((id) => !isUuid(id))) throw new AppError("validation", "Invalid host.");
  const pollId = q.get("pollId");
  if (pollId && !isUuid(pollId)) throw new AppError("validation", "Invalid poll.");
  return json(await getPollGridOverlay(actor, { start, end, hostIds, pollId }));
});
