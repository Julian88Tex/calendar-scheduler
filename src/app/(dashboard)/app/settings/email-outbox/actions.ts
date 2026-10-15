// OWNER: golden-path-qa.
//
// Email outbox page server actions: "Resend" of an email that failed for good (data.ts resendFailedEmail). Rate
// limited (one owner per instance, so one bucket); the page is revalidated so the new copy shows at the top.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { rateLimitKey } from "@/lib/rate-limit";
import { resendFailedEmail, type ResendResult } from "./data";

const ResendInput = z.object({ id: z.uuid(), version: z.iso.datetime({ offset: true }) });

export async function resendEmailAction(raw: unknown): Promise<ActionResult<ResendResult>> {
  return runAction(
    ResendInput,
    raw,
    async (input, { actor }) => {
      const result = await resendFailedEmail(actor, input);
      revalidatePath("/app/settings/email-outbox");
      return result;
    },
    { rateLimit: { key: () => rateLimitKey("email-outbox", "resend"), limit: 30, windowSeconds: 60, message: "Too many resends. Wait a minute and try again." } },
  );
}
