// OWNER: polls-core.
//
// GET  /api/public/polls/{slug}/unsubscribe?t={token}   never changes state (link scanners): 303 to the confirmation
//                                                     page /p/{slug}/unsubscribe?t={token} with its POST button.
// POST /api/public/polls/{slug}/unsubscribe?t={token}   one-click unsubscribe (RFC 8058 List-Unsubscribe-Post, SPEC
//                                                     MP-23): stops invitations, reminders and update emails of this
//                                                     poll for the participant. Mail providers post cross-site, so no
//                                                     origin check: the signed token is the capability. A browser
//                                                     form post is redirected back to the page (?done=1); other
//                                                     clients get { ok } (also for an already unsubscribed token).
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ok, slugParam, type PublicPollRouteCtx } from "@/lib/polls/route-helpers";
import { unsubscribe } from "@/lib/polls/server";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

function pagePath(slug: string, token: string, done = false): string {
  return `/p/${encodeURIComponent(slug)}/unsubscribe?t=${encodeURIComponent(token)}${done ? "&done=1" : ""}`;
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: absoluteUrl(path), "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer" } });
}

async function tokenOf(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("t");
  if (fromQuery) return fromQuery.trim();
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const t = form?.get("t");
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return "";
}

export const GET = route<PublicPollRouteCtx>(async (request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  return redirect(pagePath(slug, new URL(request.url).searchParams.get("t") ?? ""));
});

export const POST = route<PublicPollRouteCtx>(async (request, ctx) => {
  const slug = slugParam((await ctx.params).slug);
  const token = await tokenOf(request);
  if (!token || token.length > 300) throw new AppError("validation", "This unsubscribe link is invalid.");
  const done = await unsubscribe(slug, token);
  if (!done) throw new AppError("not_found", "This unsubscribe link is invalid or the poll no longer exists.");
  if (request.headers.get("sec-fetch-mode") === "navigate") return redirect(pagePath(slug, token, true));
  return ok({ unsubscribed: true });
});
