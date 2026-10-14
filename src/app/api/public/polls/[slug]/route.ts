// OWNER: polls-core.
//
// GET /api/public/polls/{slug}   the voter page data as JSON (SPEC MP-07 to MP-15), redacted per results visibility
// (MP-12: in host_only the body holds no other participant's name; emails are never included). The caller is
// identified by the edit cookie (or the embed fallback header), ?i={invite token}, or the signed-in app user.
// 200 VoterPollView; 308 to the canonical slug for an old link ending (a valid edit cookie of the old path is set again
// on the new paths); 404 unknown slug; 410 deleted poll (no details).
import { getCurrentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { appendEditCookie, getVoterView, readEditToken } from "@/lib/polls/server";

export const dynamic = "force-dynamic";

export const GET = route<PublicPollRouteCtx>(async (request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const url = new URL(request.url);
  const user = await getCurrentUser();
  const result = await getVoterView(slug, {
    editToken: readEditToken(request),
    inviteToken: url.searchParams.get("i"),
    userId: user?.id ?? null,
    viewer: user ? { userId: user.id, name: user.name, email: user.email } : null,
  });
  if (result.status === 404) throw new AppError("not_found", "This poll could not be found.");
  if (result.status === 410) return json({ error: "gone", message: "This poll is no longer available." }, { status: 410 });
  if (result.status === 301) {
    const next = new URL(`/api/public/polls/${encodeURIComponent(result.canonicalSlug)}`, url);
    next.search = url.search;
    const response = new Response(null, { status: 308, headers: { Location: next.toString(), "Cache-Control": "no-store, max-age=0" } });
    // The edit cookies were scoped to the old link ending: carry a valid one over to the new paths.
    const token = result.editPath ? readEditToken(request) : null;
    return token ? appendEditCookie(response, result.canonicalSlug, token) : response;
  }
  return json(result.view);
});
