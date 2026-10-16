// GET /api/meetings/export?{the Meetings page query}: the "Export" CSV of the current tab and filters (SPEC MT-11).
// Signed-in users only (401 otherwise), their own meetings only (the Meetings page visibility), 20 exports per 10
// minutes per user. Streams the file as it is built (src/lib/meetings/export.ts); safe to GET (changes nothing).
import { getApiActorCtx } from "@/lib/authz";
import { route } from "@/lib/http";
import { log } from "@/lib/logger";
import { MEETINGS_COPY } from "@/lib/meetings/copy";
import { exportFilename } from "@/lib/meetings/csv";
import { exportCsvLines } from "@/lib/meetings/export";
import { parseMeetingsQuery } from "@/lib/meetings/filters";
import { todayIn, viewerContext } from "@/lib/meetings/queries";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lines are sent in chunks of about this many characters. */
const CHUNK = 64 * 1024;

export const GET = route(async (request) => {
  const actor = await getApiActorCtx();
  await assertRateLimit(rateLimitKey("meetings-export", actor.user.id), 20, 600, { message: MEETINGS_COPY.errors.exportRateLimited });
  const query = parseMeetingsQuery(new URL(request.url).searchParams);
  const lines = exportCsvLines(actor, query);
  // The first line (the header) is read before answering, so a failure up front still gets a JSON error response.
  const head = await lines.next();
  const encoder = new TextEncoder();
  let done = Boolean(head.done);
  let pending = head.done ? "" : head.value;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!done && pending.length < CHUNK) {
          const next = await lines.next();
          if (next.done) done = true;
          else pending += next.value;
        }
        if (pending) controller.enqueue(encoder.encode(pending));
        pending = "";
        if (done) controller.close();
      } catch (e) {
        log.error("meetings.export_failed", { userId: actor.user.id, error: e });
        controller.error(e);
      }
    },
    async cancel() {
      await lines.return(undefined);
    },
  });
  const filename = exportFilename(query.tab, todayIn(viewerContext(actor)));
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
