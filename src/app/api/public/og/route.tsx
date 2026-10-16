// OWNER: booking-pages.
//
// GET /api/public/og?handle=&event=&for=: the link preview card (Open Graph image, 1200x630 PNG) of a public landing or
// booking page, in the look of the persona the link asks for (src/components/booking/server/og-card.ts). Everything on
// the card comes from the database, never from the query, so the route cannot be used to draw arbitrary text. Cached
// briefly at the CDN; chat apps cache previews on their side anyway. Unknown handles are 404.
import { PERSONA_PARAM } from "@/components/booking/lib/friends";
import { loadOgCard } from "@/components/booking/server/og-card";
import { renderOgImage } from "@/components/booking/server/og-image";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const handle = q.get("handle")?.slice(0, 100);
  if (!handle) return new Response("Not found", { status: 404 });
  const card = await loadOgCard({ handle, event: q.get("event")?.slice(0, 200) || null, persona: q.get(PERSONA_PARAM)?.slice(0, 40) || null });
  if (!card) return new Response("Not found", { status: 404 });
  return renderOgImage(card, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" } });
}
