// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GET /api/cron (SPEC GEN-16, ARCHITECTURE section 12.3): the trigger for Vercel Cron (daily on Hobby), the bundled
// GitHub Actions workflow (every 10 minutes) and external pingers (cron-job.org, Upstash QStash: every 5 minutes for
// on-time reminders). POST is accepted too (QStash schedules POST by default).
// - CRON_SECRET set: requires "Authorization: Bearer {CRON_SECRET}" (401 otherwise) and runs due jobs with a 250
//   second budget (maxDuration 300).
// - CRON_SECRET unset: open but throttled to one run per minute across all instances (DB lease cron_open_lease) with a
//   20 second budget; extra calls answer 200 { skipped: "throttled" } so pingers do not report failures. Harmless
//   because jobs are idempotent.
// Every run writes instance_settings.last_cron_at (the admin freshness warning reads it, GEN-16 and ADM-03).
import { getDb } from "@/db";
import { instanceSettings } from "@/db/schema";
import { timingSafeEqualStr } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { apiError, json } from "@/lib/http";
import { runDueJobs } from "@/lib/jobs";
import { acquireLease } from "@/lib/jobs/lease";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Budget with CRON_SECRET (leaves 50 seconds of the 300 second function limit for the job in flight). */
const AUTHORIZED_BUDGET_MS = 250_000;
const OPEN_BUDGET_MS = 20_000;
const OPEN_LEASE_KEY = "cron_open_lease";
const OPEN_LEASE_MS = 60_000;

async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (!timingSafeEqualStr(header, `Bearer ${secret}`)) {
      return json({ error: "unauthorized", message: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }
  }
  try {
    const db = await getDb();
    const at = now();
    const runId = `cron-${Math.random().toString(36).slice(2, 10)}`;
    if (!secret) {
      const acquired = await acquireLease(db, OPEN_LEASE_KEY, OPEN_LEASE_MS, runId, at);
      if (!acquired) {
        return json({ ok: true, mode: "open", skipped: "throttled", ran: 0, succeeded: 0, failed: 0, remaining: null });
      }
      log.warn("cron.open_mode", { message: "CRON_SECRET is not set; /api/cron runs without authentication (throttled)." });
    }
    await db
      .insert(instanceSettings)
      .values({ key: "last_cron_at", value: at.toISOString(), updatedAt: at })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value: at.toISOString(), updatedAt: at } });
    const result = await runDueJobs({ budgetMs: secret ? AUTHORIZED_BUDGET_MS : OPEN_BUDGET_MS, workerId: "cron", maxJobs: 2_000 });
    log.info("cron.ran", { ...result, mode: secret ? "authorized" : "open" });
    return json({ ok: true, mode: secret ? "authorized" : "open", ...result });
  } catch (e) {
    log.error("cron.failed", { error: e });
    return apiError(e);
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
