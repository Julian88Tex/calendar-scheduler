// Schedules tab server actions (SPEC AV-02 to AV-10; ARCHITECTURE section 26 rules 3 to 5): thin wrappers that
// validate with the module schemas, authenticate through runAction and call the availability services, which check
// that every schedule and event type belongs to the signed-in user. Auto-saved edits (weekly hours, zone, date-specific
// hours) skip revalidation so the page keeps its optimistic state; structural changes revalidate the tab.
"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import {
  cloneSchedule,
  createSchedule,
  deleteDateOverride,
  deleteSchedule,
  renameSchedule,
  setDefaultSchedule,
  setScheduleEventTypes,
  updateScheduleTimezone,
  updateWeeklyHours,
  upsertDateOverrides,
} from "@/lib/availability";
import {
  ActiveOnInput,
  CreateScheduleInput,
  DeleteOverrideInput,
  DeleteScheduleInput,
  RenameScheduleInput,
  ScheduleRefInput,
  ScheduleTimezoneInput,
  UpsertOverridesInput,
  WeeklyHoursInput,
} from "@/lib/availability/schemas";

const PATH = "/app/availability";

export async function createScheduleAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(CreateScheduleInput, raw, async (input, { actor, db }) => {
    const row = await createSchedule(db, actor.user.id, { name: input.name, timezone: actor.user.timezone });
    revalidatePath(PATH);
    return { id: row.id };
  });
}

export async function renameScheduleAction(raw: unknown): Promise<ActionResult<{ name: string }>> {
  return runAction(RenameScheduleInput, raw, async (input, { actor, db }) => {
    const row = await renameSchedule(db, actor.user.id, input.scheduleId, input.name);
    revalidatePath(PATH);
    return { name: row.name };
  });
}

export async function setDefaultScheduleAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(ScheduleRefInput, raw, async (input, { actor, db }) => {
    const row = await setDefaultSchedule(db, actor.user.id, input.scheduleId);
    revalidatePath(PATH);
    return { id: row.id };
  });
}

export async function cloneScheduleAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(ScheduleRefInput, raw, async (input, { actor, db }) => {
    const row = await cloneSchedule(db, actor.user.id, input.scheduleId);
    revalidatePath(PATH);
    return { id: row.id };
  });
}

export async function deleteScheduleAction(raw: unknown): Promise<ActionResult<{ reassigned: number; replacementId: string }>> {
  return runAction(DeleteScheduleInput, raw, async (input, { actor, db }) => {
    const result = await deleteSchedule(db, actor.user.id, input.scheduleId, { replacementId: input.replacementId ?? null });
    revalidatePath(PATH);
    return result;
  });
}

export async function saveWeeklyHoursAction(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  return runAction(WeeklyHoursInput, raw, async (input, { actor, db }) => {
    await updateWeeklyHours(db, actor.user.id, input.scheduleId, input.weeklyHours);
    return { saved: true as const };
  });
}

export async function saveScheduleTimezoneAction(raw: unknown): Promise<ActionResult<{ timezone: string }>> {
  return runAction(ScheduleTimezoneInput, raw, async (input, { actor, db }) => {
    await updateScheduleTimezone(db, actor.user.id, input.scheduleId, input.timezone);
    return { timezone: input.timezone };
  });
}

export async function saveDateOverridesAction(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  return runAction(UpsertOverridesInput, raw, async (input, { actor, db }) => {
    await upsertDateOverrides(db, actor.user.id, input.scheduleId, { dates: input.dates, intervals: input.intervals });
    return { saved: true as const };
  });
}

export async function deleteDateOverrideAction(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  return runAction(DeleteOverrideInput, raw, async (input, { actor, db }) => {
    await deleteDateOverride(db, actor.user.id, input.scheduleId, input.date);
    return { saved: true as const };
  });
}

export async function applyActiveOnAction(raw: unknown): Promise<ActionResult<{ changed: number }>> {
  return runAction(ActiveOnInput, raw, async (input, { actor, db }) => {
    const result = await setScheduleEventTypes(db, actor.user.id, input.scheduleId, {
      eventTypeIds: input.eventTypeIds,
      replaceCustom: input.replaceCustom,
    });
    revalidatePath(PATH);
    revalidatePath("/app/scheduling");
    return result;
  });
}
