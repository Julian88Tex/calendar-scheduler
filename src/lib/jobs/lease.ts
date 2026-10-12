// Global leases in instance_settings (ARCHITECTURE section 12.2 and 12.3): "at most once per minute across every
// server instance" throttles for the opportunistic runner (key job_runner_lease) and /api/cron in open mode (key
// cron_open_lease). One atomic upsert: the row is taken only when the previous lease expired (app clock, $now) or this
// holder already owns it. Value shape: { holder, until (ISO), untilMs }.
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { instanceSettings } from "@/db/schema";
import { now } from "../time/now";

export type LeaseValue = { holder: string; until: string; untilMs: number };

/** Takes the lease `key` for `ttlMs` when it is free. Returns true when this holder owns it now. */
export async function acquireLease(db: DbOrTx, key: string, ttlMs: number, holder: string, at: Date = now()): Promise<boolean> {
  const untilMs = at.getTime() + Math.max(1, Math.trunc(ttlMs));
  const value: LeaseValue = { holder, until: new Date(untilMs).toISOString(), untilMs };
  const current = sql`(case when (${instanceSettings.value}->>'untilMs') ~ '^[0-9]+(\\.[0-9]+)?$'
    then (${instanceSettings.value}->>'untilMs')::double precision else 0 end)`;
  const rows = await db
    .insert(instanceSettings)
    .values({ key, value, updatedAt: at })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value, updatedAt: at },
      setWhere: sql`${current} <= ${at.getTime()} or ${instanceSettings.value}->>'holder' = ${holder}`,
    })
    .returning({ key: instanceSettings.key });
  return rows.length > 0;
}

/** Releases the lease when this holder still owns it (makes it free immediately). */
export async function releaseLease(db: DbOrTx, key: string, holder: string): Promise<void> {
  await db
    .update(instanceSettings)
    .set({ value: { holder: "", until: new Date(0).toISOString(), untilMs: 0 } satisfies LeaseValue })
    .where(sql`${instanceSettings.key} = ${key} and ${instanceSettings.value}->>'holder' = ${holder}`);
}

/** The current lease value, or null. */
export async function readLease(db: DbOrTx, key: string): Promise<LeaseValue | null> {
  const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, key));
  const v = row?.value as Partial<LeaseValue> | undefined;
  return v && typeof v.untilMs === "number" && typeof v.holder === "string" ? (v as LeaseValue) : null;
}
