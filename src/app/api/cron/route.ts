// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/cron (ARCHITECTURE section 12.3): with CRON_SECRET set, requires "Authorization: Bearer {CRON_SECRET}"
// (Vercel Cron and the GitHub Actions workflow send it); without it, runs throttled. Writes
// instance_settings.last_cron_at and runs due jobs with a 250 second budget.
// Foundation stub: the secret check, last_cron_at and runDueJobs; the open-mode DB lease throttle is foundation-platform's.
import { getDb } from "@/db";
import { instanceSettings } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { apiError, json } from "@/lib/http";
import { runDueJobs } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { timingSafeEqualStr } from "@/lib/crypto";
import { now } from "@/lib/time/now";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  const budgetMs = secret ? 250_000 : 20_000;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (!timingSafeEqualStr(header, `Bearer ${secret}`)) return json({ error: "unauthorized", message: "Unauthorized" }, { status: 401 });
  } else {
    log.warn("cron.open_mode", { message: "CRON_SECRET is not set; /api/cron runs without authentication." });
  }
  try {
    const db = await getDb();
    const at = now();
    await db
      .insert(instanceSettings)
      .values({ key: "last_cron_at", value: at.toISOString() })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value: at.toISOString() } });
    const result = await runDueJobs({ budgetMs });
    return json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
