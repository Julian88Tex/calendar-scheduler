// Shared setup for the calendar-integrations tests: a user with a Google connection (fake or encrypted tokens), the
// mocked connection context, and small time helpers.
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { calendarConnections, calendars } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { createCalendarConnection, createUser, type TestUser } from "../factories";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** A connection context like credentials.ts returns (tests mock withConnection with it). */
export const fakeContext = (connectionId: string) => ({
  connectionId,
  userId: "",
  provider: "google" as const,
  accessToken: "fake-access",
  unavailableStatuses: ["busy", "tentative", "oof", "workingElsewhere"],
});

export type GoogleSetup = {
  user: TestUser;
  connectionId: string;
  calendarIds: string[];
  externalIds: string[];
};

/** A user with one Google connection; calendars default to one primary, checked, writable calendar. */
export async function setupGoogle(
  db: DbOrTx,
  opts: {
    user?: TestUser;
    timezone?: string;
    calendars?: { externalId?: string; name?: string; isPrimary?: boolean; canWrite?: boolean; checkConflicts?: boolean; includeBuffers?: boolean }[];
    status?: "active" | "needs_reauth" | "error";
    encrypted?: { accessToken: string; refreshToken: string | null; expiresAt: Date };
  } = {},
): Promise<GoogleSetup> {
  const user = opts.user ?? (await createUser(db, { timezone: opts.timezone ?? "America/Los_Angeles" }));
  const { connection, calendars: cals } = await createCalendarConnection(db, {
    userId: user.id,
    provider: "google",
    status: opts.status ?? "active",
    calendars: opts.calendars,
  });
  if (opts.encrypted) {
    await db
      .update(calendarConnections)
      .set({
        accessTokenEnc: await encrypt(opts.encrypted.accessToken),
        refreshTokenEnc: opts.encrypted.refreshToken ? await encrypt(opts.encrypted.refreshToken) : null,
        tokenExpiresAt: opts.encrypted.expiresAt,
      })
      .where(eq(calendarConnections.id, connection.id));
  }
  return { user, connectionId: connection.id, calendarIds: cals.map((c) => c.id), externalIds: cals.map((c) => c.externalId) };
}

export type CalendarRow = typeof calendars.$inferSelect;
