// OWNER: gmail (email sending from the owner's Gmail).
//
// Zod schema of the "Send emails from your Gmail" action (ARCHITECTURE section 26 rule 4). Client and server safe.
import { z } from "zod";

export const GmailSendingInput = z.object({
  /** The switch: true sends booking emails from the owner's Gmail, false keeps them in the outbox. */
  enabled: z.boolean(),
  /** The Google account to send from (one of the owner's connections that allowed Gmail sending). */
  connectionId: z.uuid("Invalid account").nullish(),
});
export type GmailSendingInput = z.infer<typeof GmailSendingInput>;
