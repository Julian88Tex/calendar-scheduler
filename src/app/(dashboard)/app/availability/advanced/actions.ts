// Advanced settings server actions (SPEC AV-14, SCH-09): host meeting limits across all event types, auto-saved.
"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { setMeetingLimits } from "@/lib/availability";
import { MeetingLimitsInput, type MeetingLimits } from "@/lib/availability/schemas";

export async function saveMeetingLimitsAction(raw: unknown): Promise<ActionResult<MeetingLimits>> {
  return runAction(MeetingLimitsInput, raw, async (input, { actor, db }) => {
    const saved = await setMeetingLimits(db, actor.user.id, input);
    revalidatePath("/app/availability/advanced/troubleshoot");
    return saved;
  });
}
