// OWNER: polls-core.
//
// GET /api/polls/slug-available?slug={ending}&pollId={id}   "Customize link" (SPEC MP-04, MP-05): { available } for a
// valid ending no other live poll or recent redirect uses (the poll's own slug counts as available).
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { hostActor } from "@/lib/polls/route-helpers";
import { checkSlugAvailable } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const actor = await hostActor(request);
  const q = new URL(request.url).searchParams;
  const slug = (q.get("slug") ?? "").trim();
  const pollId = q.get("pollId") ?? undefined;
  if (!slug || slug.length > 100) throw new AppError("validation", "Enter a link ending.", { fieldErrors: { slug: ["Enter a link ending."] } });
  if (pollId && !isUuid(pollId)) throw new AppError("validation", "Invalid poll.");
  return json({ available: await checkSlugAvailable(actor, slug, pollId) });
});
