// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Shell server actions: persist the sidebar collapse state (GEN-20, users.preferences.sidebarCollapsed) and update the
// profile time zone from the GEN-23 banner (profile zone only, never schedule zones).
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { isValidTimeZone } from "@/lib/time/zones";

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  const user = await requireUser({ onMissing: "throw" });
  const db = await getDb();
  await db
    .update(users)
    .set({ preferences: { ...(user.preferences ?? {}), sidebarCollapsed: collapsed === true } })
    .where(eq(users.id, user.id));
}

export async function updateProfileTimeZone(zone: string): Promise<void> {
  const user = await requireUser({ onMissing: "throw" });
  if (!isValidTimeZone(zone)) throw new AppError("validation", "Choose a valid time zone.");
  const db = await getDb();
  await db.update(users).set({ timezone: zone }).where(eq(users.id, user.id));
  revalidatePath("/app", "layout");
}
