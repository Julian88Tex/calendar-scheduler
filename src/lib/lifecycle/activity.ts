// Meeting timeline rows (meeting_activity) written by the lifecycle module (SPEC MT-06 activity timeline, CAL-12
// fallback note, VID-12, NT-01 to NT-04 "email sent").
import "server-only";
import type { DbOrTx } from "@/db";
import { meetingActivity } from "@/db/schema";
import { now } from "@/lib/time/now";
import type { LifecycleActor } from "./types";

export type ActivityType = (typeof meetingActivity.$inferInsert)["type"];

export type ActivityInput = {
  scheduledEventId: string;
  inviteeId?: string | null;
  type: ActivityType;
  actor?: LifecycleActor | null;
  data?: Record<string, unknown>;
};

/** The meeting_activity actor columns of a lifecycle actor. */
export function activityActor(actor: LifecycleActor | null | undefined): { actorType: "user" | "system" | "api" | "invitee"; actorUserId: string | null } {
  if (!actor) return { actorType: "system", actorUserId: null };
  if (actor.type === "user") return { actorType: "user", actorUserId: actor.ctx.user.id };
  if (actor.type === "api") return { actorType: "api", actorUserId: actor.ctx.user.id };
  if (actor.type === "invitee") return { actorType: "invitee", actorUserId: null };
  return { actorType: "system", actorUserId: null };
}

export async function recordActivity(db: DbOrTx, rows: ActivityInput[]): Promise<void> {
  if (!rows.length) return;
  const at = now();
  await db.insert(meetingActivity).values(
    rows.map((r) => ({
      scheduledEventId: r.scheduledEventId,
      inviteeId: r.inviteeId ?? null,
      type: r.type,
      ...activityActor(r.actor),
      data: r.data ?? {},
      createdAt: at,
    })),
  );
}
