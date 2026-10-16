// /api/test/time (E2E only): the fake business clock of src/lib/time/now.ts.
//   GET                               -> { now, offsetMs }
//   POST { now: ISO string | null }   -> sets now() to that instant (time keeps flowing); null restores real time
//   POST { advanceMs: number }        -> moves the clock forward (or back) by that many milliseconds
//   POST { offsetMs: number }         -> sets the raw offset
// Every business-time SQL comparison receives $now from now(), so the jobs runner, reservation expiry, rate limit
// windows and session expiry all see the fake time.
import { getTimeOffsetMs, now, setFakeNow, setTimeOffsetMs } from "@/lib/time/now";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

const state = () => ({ now: now().toISOString(), offsetMs: getTimeOffsetMs() });

export const GET = withTestGuard(async () => testJson(state()));

export const POST = withTestGuard(async (request) => {
  const body = await readJson<{ now?: string | null; advanceMs?: number; offsetMs?: number }>(request);
  if (typeof body.advanceMs === "number") setTimeOffsetMs(getTimeOffsetMs() + body.advanceMs);
  else if (typeof body.offsetMs === "number") setTimeOffsetMs(body.offsetMs);
  else if (body.now === null) setFakeNow(null);
  else if (typeof body.now === "string") setFakeNow(body.now);
  else return testJson({ error: "validation", message: "Pass now, advanceMs or offsetMs" }, { status: 400 });
  return testJson(state());
});
