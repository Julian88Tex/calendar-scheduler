// OWNER: polls-core.
//
// POST /api/public/polls/{slug}/responses   "Share times" / "None of these work for me" (SPEC MP-08 to MP-11): a
// SubmitVoteInput body. Answers { ok: true, participantId, status, created, editToken? } and sets the edit cookies
// (the token is in the body only for embeds, embed: true), or { ok: false, code, message, fieldErrors? } with code
// validation (400) | max_choices (400) | bot (400) | verification_required (403) | duplicate_email (409: the existing
// participant gets a magic link by email instead) | closed (409) | full (409). Same origin only; bot checks and 10
// submits per IP per hour per poll.
import { getCurrentUser } from "@/lib/auth/session";
import { assertSameOrigin, getClientIp, json, readJsonBody, route } from "@/lib/http";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { appendEditCookie, readEditToken, submitVote } from "@/lib/polls/server";
import { SubmitVoteSchema } from "@/lib/polls/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATUS: Record<string, number> = { validation: 400, max_choices: 400, bot: 400, verification_required: 403, duplicate_email: 409, closed: 409, full: 409 };

export const POST = route<PublicPollRouteCtx>(async (request, ctx) => {
  assertSameOrigin(request);
  const slug = slugParam((await ctx.params).slug);
  const input = await readJsonBody(request, SubmitVoteSchema);
  const user = await getCurrentUser();
  const outcome = await submitVote(slug, input, {
    editToken: readEditToken(request),
    inviteToken: input.inviteToken ?? null,
    userId: user?.id ?? null,
    ip: getClientIp(request),
  });
  if (!outcome.ok) return json(outcome, { status: STATUS[outcome.code] ?? 400 });
  const { editToken, ...rest } = outcome;
  const response = json({ ...rest, editToken: input.embed ? editToken : null }, { status: outcome.created ? 201 : 200 });
  return appendEditCookie(response, slug, editToken, { embed: input.embed });
});
