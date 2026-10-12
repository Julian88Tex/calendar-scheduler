// OWNER: foundation-ui.
//
// The instance operator contact (SPEC MK-02, GEN-19, GEN-21) for "Report abuse" on public pages and "Report a problem"
// in the dashboard Help menu: instance_settings.operator ({ name, email }) when an instance admin set it, else the first
// instance admin. Server only; cached per request.
import "server-only";
import { asc, eq, isNull, and } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { instanceSettings, users } from "@/db/schema";
import { log } from "@/lib/logger";

export type OperatorContact = { name: string | null; email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parses the stored instance setting value. */
export function parseOperatorSetting(value: unknown): OperatorContact | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { name?: unknown; email?: unknown };
  const email = typeof v.email === "string" ? v.email.trim() : "";
  if (!EMAIL.test(email)) return null;
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : null;
  return { name, email };
}

export const getOperatorContact = cache(async (): Promise<OperatorContact | null> => {
  try {
    const db = await getDb();
    const [setting] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "operator")).limit(1);
    const fromSetting = parseOperatorSetting(setting?.value);
    if (fromSetting) return fromSetting;
    const [admin] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.isInstanceAdmin, true), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt))
      .limit(1);
    return admin ? { name: admin.name, email: admin.email } : null;
  } catch (e) {
    log.warn("operator.lookup_failed", { error: e });
    return null;
  }
});

/** The operator email or null (convenience for PublicPageShell and PublicFooterLinks). */
export async function getOperatorEmail(): Promise<string | null> {
  return (await getOperatorContact())?.email ?? null;
}
