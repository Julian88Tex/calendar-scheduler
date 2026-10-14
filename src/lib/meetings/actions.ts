"use server";
// Server Actions of the Meetings page that lifecycle-ui's dialogs do not cover (ARCHITECTURE 26 rule 3): "Retry" of a
// failed Google Meet link or calendar write (SPEC MT-06, VID-12). Thin: parse, authenticate, call lifecycle-core with
// the signed-in user as the actor (it authorizes manage access and refuses canceled or ended meetings), revalidate.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/actions";
import { retryProvisioning } from "@/lib/lifecycle";

const RetryInput = z.object({ scheduledEventId: z.uuid() });

export async function retryMeetingProvisioningAction(raw: unknown) {
  return runAction(RetryInput, raw, async (input, { actor }) => {
    await retryProvisioning({ scheduledEventId: input.scheduledEventId, actor: { type: "user", ctx: actor } });
    try {
      revalidatePath("/app/meetings");
    } catch {
      // Outside a request (tests): nothing to revalidate.
    }
    return { scheduledEventId: input.scheduledEventId };
  });
}
