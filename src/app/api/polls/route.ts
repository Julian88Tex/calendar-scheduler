// OWNER: polls-core.
//
// GET  /api/polls   the signed-in user's meeting polls (SPEC MP-26): ?filter=open|booked|ended|all|deleted (default
//                   open), q, hostedBy=me|cohosted|all, cursor, limit (1 to 100, default 25) -> PollListPage.
// POST /api/polls   "Share meeting poll" (MP-03): CreatePollInput -> 201 { ok, pollId, slug, link, eventTypeId }.
import { AppError } from "@/lib/errors";
import { json, readJsonBody, route } from "@/lib/http";
import { hostActor, ok } from "@/lib/polls/route-helpers";
import { createPoll, listPolls } from "@/lib/polls/server";
import { CreatePollSchema, ListPollsSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const actor = await hostActor(request);
  const q = new URL(request.url).searchParams;
  const parsed = ListPollsSchema.safeParse({
    filter: q.get("filter") ?? undefined,
    q: q.get("q") ?? undefined,
    hostedBy: q.get("hostedBy") ?? undefined,
    cursor: q.get("cursor") ?? undefined,
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
  });
  if (!parsed.success) throw new AppError("validation", "Check the filters and try again.");
  return json(await listPolls(actor, parsed.data));
});

export const POST = route(async (request) => {
  const actor = await hostActor(request);
  const input = await readJsonBody(request, CreatePollSchema);
  return ok(await createPoll(actor, input), 201);
});
