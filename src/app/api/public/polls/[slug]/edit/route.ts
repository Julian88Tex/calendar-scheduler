// OWNER: polls-core.
//
// GET /api/public/polls/{slug}/edit?t={edit token}   the "Review or change your response" magic link (SPEC MP-11):
// sets the edit cookies when the token belongs to a live participant and redirects (303) to the clean voter URL
// /p/{slug}. It changes no vote or other state (link scanners are harmless); an invalid or stale token just opens the
// poll (?link=expired). Unknown or deleted polls redirect to /p/{slug} too, which shows the 404 or 410 page.
import { route } from "@/lib/http";
import { slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { appendEditCookie, verifyEditLink } from "@/lib/polls/server";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: absoluteUrl(path), "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer" } });
}

export const GET = route<PublicPollRouteCtx>(async (request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const token = new URL(request.url).searchParams.get("t");
  const link = await verifyEditLink(slug, token);
  if (!link) return redirect(`/p/${encodeURIComponent(slug)}`);
  const target = `/p/${encodeURIComponent(link.slug)}`;
  if (!link.valid || !token) return redirect(`${target}?link=expired`);
  return appendEditCookie(redirect(target), link.slug, token);
});
