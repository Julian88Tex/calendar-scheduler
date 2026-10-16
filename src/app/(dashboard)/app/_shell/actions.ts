// OWNER: foundation-ui.
//
// Shell server actions (SPEC GEN-20, GEN-23, AU-08): persist the sidebar collapse state (users.preferences
// .sidebarCollapsed, merged into the jsonb so other preferences are kept), update the profile time zone from the
// GEN-23 banner (profile zone only, never schedule zones) and resend the verification email (rate limited).
"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { users } from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/actions";
import { sendVerificationEmail } from "@/lib/auth/verify-email";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { zTimeZone } from "@/lib/validation";

const Collapsed = z.boolean();
const Zone = zTimeZone;

export async function setSidebarCollapsed(collapsed: boolean): Promise<ActionResult<{ collapsed: boolean }>> {
  return runAction(Collapsed, collapsed, async (value, { actor, db }) => {
    await db
      .update(users)
      .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ sidebarCollapsed: value })}::jsonb` })
      .where(eq(users.id, actor.user.id));
    return { collapsed: value };
  });
}

export async function updateProfileTimeZone(zone: string): Promise<ActionResult<{ timezone: string }>> {
  return runAction(Zone, zone, async (value, { actor, db }) => {
    await db.update(users).set({ timezone: value }).where(eq(users.id, actor.user.id));
    revalidatePath("/app", "layout");
    return { timezone: value };
  });
}

export async function resendVerificationEmail(): Promise<ActionResult<{ sent: true }>> {
  return runAction(z.undefined().optional(), undefined, async (_input, { actor }) => {
    if (actor.user.emailVerifiedAt) throw new AppError("conflict", "Your email address is already verified.");
    await assertRateLimit(`verify-email-resend:${actor.user.id}`, 5, 3600, { message: "Too many emails sent. Try again in an hour." });
    await sendVerificationEmail(actor.user.id);
    return { sent: true as const };
  });
}
