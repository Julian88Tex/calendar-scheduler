"use server";
// Invitee cancel (SPEC CR-02, CR-05, SCH-23, GEN-08): the form on /cancellations/{inviteeId} posts here (never a GET).
// The invitee id is the capability; lifecycle-core's cancelInvitee applies the CR-02 rules on the locked rows (already
// canceled, rescheduled, started, inside the cutoff, the required reason) and sends the cancellation emails right after
// the response. Thin: parse, rate limit (per invitee and per IP), call the service.
import { headers } from "next/headers";
import { z } from "zod";
import { runAction } from "@/lib/actions";
import { hashIp } from "@/lib/crypto";
import { getClientIp } from "@/lib/http";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { cancelInvitee } from "@/lib/lifecycle";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

const CancelInput = z.object({
  inviteeId: z.uuid(),
  reason: z.string().max(2000, lifecycleMessages.changes.reasonTooLong).optional().nullable(),
});

export async function cancelInviteeAction(raw: unknown) {
  return runAction(
    CancelInput,
    raw,
    async (input) => {
      const ip = await hashIp(getClientIp(await headers()));
      await assertRateLimit(rateLimitKey("lifecycle", "cancel", "ip", ip), 30, 3600);
      const r = await cancelInvitee({ inviteeId: input.inviteeId, actor: { type: "invitee" }, reason: input.reason ?? null });
      return { meetingCanceled: r.meetingCanceled };
    },
    { auth: "none", rateLimit: { key: (i) => rateLimitKey("lifecycle", "cancel", i.inviteeId), limit: 10, windowSeconds: 600 } },
  );
}
