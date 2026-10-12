// OWNER: calendar-integrations.
//
// Zod schemas of the calendar settings actions (ARCHITECTURE section 26 rule 4). Client and server safe.
import { z } from "zod";

const id = z.uuid("Invalid id");

export const ConflictCalendarsInput = z.object({
  changes: z
    .array(z.object({ calendarId: id, checked: z.boolean() }))
    .min(1, "Choose at least one calendar.")
    .max(500),
});
export type ConflictCalendarsInput = z.infer<typeof ConflictCalendarsInput>;

export const DestinationCalendarInput = z.object({ calendarId: id.nullable() });
export type DestinationCalendarInput = z.infer<typeof DestinationCalendarInput>;

export const CalendarSyncSettingsInput = z
  .object({ calendarId: id, includeBuffers: z.boolean().optional(), syncChanges: z.boolean().optional() })
  .refine((v) => v.includeBuffers !== undefined || v.syncChanges !== undefined, { message: "Nothing to change." });
export type CalendarSyncSettingsInput = z.infer<typeof CalendarSyncSettingsInput>;

export const DisconnectCalendarInput = z.object({ connectionId: id });
export type DisconnectCalendarInput = z.infer<typeof DisconnectCalendarInput>;
