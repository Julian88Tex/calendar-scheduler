// Calendar connections (fake provider credentials), calendars, cached external busy events and conferencing.
import type { DbOrTx } from "@/db";
import { calendarConnections, calendars, calendarSyncWindows, conferencingConnections, externalEvents } from "@/db/schema";
import { one, toDate, uniq } from "./_util";

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;

export type CreateCalendarConnectionOptions = {
  userId: string;
  provider?: CalendarConnectionRow["provider"];
  accountEmail?: string;
  status?: CalendarConnectionRow["status"];
  /** Calendars of the connection (default: one primary, writable, conflict-checked calendar). */
  calendars?: {
    externalId?: string;
    name?: string;
    isPrimary?: boolean;
    canWrite?: boolean;
    checkConflicts?: boolean;
    includeBuffers?: boolean;
    timezone?: string | null;
  }[];
  overrides?: Partial<typeof calendarConnections.$inferInsert>;
};

/**
 * Tokens are placeholders ("fake.<provider>"), not encrypt() output: pair the connection with the fake provider from
 * tests/helpers/fake-providers.ts (or vi.mock the credentials module) instead of decrypting them.
 */
export async function createCalendarConnection(db: DbOrTx, opts: CreateCalendarConnectionOptions) {
  const provider = opts.provider ?? "google";
  const accountEmail = opts.accountEmail ?? `${uniq("cal")}@example.com`;
  const connection = one(
    await db
      .insert(calendarConnections)
      .values({
        userId: opts.userId,
        provider,
        accountEmail,
        displayName: accountEmail,
        providerAccountId: uniq("acct"),
        accessTokenEnc: provider === "google" || provider === "microsoft" ? `fake.${provider}.access` : null,
        refreshTokenEnc: provider === "google" || provider === "microsoft" ? `fake.${provider}.refresh` : null,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: opts.status ?? "active",
        ...opts.overrides,
      })
      .returning(),
    "calendar connection",
  );
  const specs = opts.calendars ?? [{ isPrimary: true, canWrite: true, checkConflicts: true }];
  const created = specs.length
    ? await db
        .insert(calendars)
        .values(
          specs.map((c, i) => ({
            connectionId: connection.id,
            userId: opts.userId,
            externalId: c.externalId ?? (i === 0 ? accountEmail : uniq("calext")),
            name: c.name ?? (i === 0 ? accountEmail : `Calendar ${i + 1}`),
            isPrimary: c.isPrimary ?? i === 0,
            canWrite: c.canWrite ?? true,
            checkConflicts: c.checkConflicts ?? true,
            includeBuffers: c.includeBuffers ?? false,
            timezone: c.timezone ?? null,
          })),
        )
        .returning()
    : [];
  return { connection, calendars: created };
}

/**
 * Inserts cached external events for a calendar and marks the covering window fresh, so a busy lookup treats them
 * as up to date without calling a provider.
 */
export async function addExternalBusy(
  db: DbOrTx,
  opts: {
    calendar: CalendarRow;
    events: { start: Date | string; end: Date | string; title?: string | null; busy?: boolean; allDay?: boolean }[];
    window?: { start: Date | string; end: Date | string };
    fetchedAt?: Date;
  },
) {
  const rows = opts.events.length
    ? await db
        .insert(externalEvents)
        .values(
          opts.events.map((e) => ({
            calendarId: opts.calendar.id,
            userId: opts.calendar.userId,
            externalId: uniq("ev"),
            startAt: toDate(e.start),
            endAt: toDate(e.end),
            allDay: e.allDay ?? false,
            title: e.title ?? "Busy",
            busy: e.busy ?? true,
            fetchedAt: opts.fetchedAt ?? new Date(),
          })),
        )
        .returning()
    : [];
  if (opts.window) {
    await db.insert(calendarSyncWindows).values({
      calendarId: opts.calendar.id,
      windowStart: toDate(opts.window.start),
      windowEnd: toDate(opts.window.end),
      fetchedAt: opts.fetchedAt ?? new Date(),
      status: "ok",
    });
  }
  return rows;
}

export async function createConferencingConnection(
  db: DbOrTx,
  opts: { userId: string; provider?: "zoom" | "webex" | "gotomeeting"; isDefault?: boolean },
) {
  return one(
    await db
      .insert(conferencingConnections)
      .values({
        userId: opts.userId,
        provider: opts.provider ?? "zoom",
        accountEmail: `${uniq("zoom")}@example.com`,
        providerUserId: uniq("zu"),
        accessTokenEnc: "fake.zoom.access",
        refreshTokenEnc: "fake.zoom.refresh",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isDefault: opts.isDefault ?? true,
      })
      .returning(),
    "conferencing connection",
  );
}
