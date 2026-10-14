// OWNER: polls-core.
//
// POST /api/public/polls/{slug}/verify-email   "Verify email" (SPEC MP-04, MP-09): { email, name? } sends a 6-digit
// code valid for 10 minutes -> { ok, required, expiresAt } (required false when the poll does not verify emails).
// Same origin only; 10 requests per IP and 5 codes per email per hour.
import { assertSameOrigin, getClientIp, readJsonBody, route } from "@/lib/http";
import { ok, slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { requestVoteCode } from "@/lib/polls/server";
import { VerifyEmailSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";

export const POST = route<PublicPollRouteCtx>(async (request, ctx) => {
  assertSameOrigin(request);
  const slug = slugParam((await ctx.params).slug);
  const input = await readJsonBody(request, VerifyEmailSchema);
  return ok(await requestVoteCode(slug, input, { ip: getClientIp(request) }));
});
