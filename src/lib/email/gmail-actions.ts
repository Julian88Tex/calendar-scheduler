// OWNER: gmail (email sending from the owner's Gmail).
//
// Server action of the "Send emails from your Gmail" card on Integrations > Google Calendar (ARCHITECTURE section 26
// rule 3). Thin: parse, authenticate (runAction), call setGmailSending with the signed-in actor (it checks that the
// actor is the instance owner inside its write transaction), run the released emails after the response, revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { runJobsAfterResponse } from "@/lib/jobs";
import { GmailSendingInput } from "./gmail-schemas";
import { GMAIL_CARD_PATH, setGmailSending } from "./gmail-view";

export async function saveGmailSending(input: GmailSendingInput): Promise<ActionResult<{ enabled: boolean; connectionId: string | null }>> {
  return runAction(GmailSendingInput, input, async (v, { actor }) => {
    const res = await setGmailSending(actor, v);
    if (res.releasedJobIds.length) runJobsAfterResponse({ ids: res.releasedJobIds, thenAnyDue: false });
    revalidatePath(GMAIL_CARD_PATH);
    revalidatePath("/app/integrations");
    return { enabled: res.enabled, connectionId: res.connectionId };
  });
}
