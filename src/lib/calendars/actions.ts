// OWNER: calendar-integrations.
//
// Server actions of the Calendar settings page and the Google Calendar integration page (SPEC CAL-07, CAL-08, CAL-13,
// CAL-14, CAL-16). Thin: parse, authenticate (runAction), call the service with the signed-in actor (every service
// checks ownership inside its write transaction, GEN-08), revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { runJobsAfterResponse } from "@/lib/jobs";
import { disconnectConnection, setCalendarSyncSettings, setConflictCalendars, setDestinationCalendar } from "./connections";
import { CalendarSyncSettingsInput, ConflictCalendarsInput, DestinationCalendarInput, DisconnectCalendarInput } from "./schemas";

function revalidate() {
  revalidatePath("/app/availability/calendar-settings");
  revalidatePath("/app/integrations/calendars/google");
  revalidatePath("/app/integrations");
}

export async function saveConflictCalendars(input: ConflictCalendarsInput): Promise<ActionResult<{ changed: number }>> {
  return runAction(ConflictCalendarsInput, input, async (v, { actor }) => {
    const res = await setConflictCalendars(actor, v.changes);
    runJobsAfterResponse({ types: ["calendars.watch_connection"], thenAnyDue: false });
    revalidate();
    return res;
  });
}

export async function saveDestinationCalendar(input: DestinationCalendarInput): Promise<ActionResult<{ calendarId: string | null }>> {
  return runAction(DestinationCalendarInput, input, async (v, { actor }) => {
    await setDestinationCalendar(actor, v.calendarId);
    runJobsAfterResponse({ types: ["calendars.watch_connection"], thenAnyDue: false });
    revalidate();
    return { calendarId: v.calendarId };
  });
}

export async function saveCalendarSyncSettings(input: CalendarSyncSettingsInput): Promise<ActionResult<{ calendarId: string }>> {
  return runAction(CalendarSyncSettingsInput, input, async (v, { actor }) => {
    await setCalendarSyncSettings(actor, v);
    revalidate();
    return { calendarId: v.calendarId };
  });
}

export async function disconnectCalendar(input: DisconnectCalendarInput): Promise<ActionResult<{ destinationCleared: boolean; email: string | null }>> {
  return runAction(DisconnectCalendarInput, input, async (v, { actor }) => {
    const res = await disconnectConnection(actor, v.connectionId);
    if (res.revokeJobId) runJobsAfterResponse({ ids: [res.revokeJobId], thenAnyDue: false });
    revalidate();
    return { destinationCleared: res.destinationCleared, email: res.email };
  });
}
