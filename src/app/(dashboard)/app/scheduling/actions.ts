"use server";
// Scheduling list Server Actions (ARCHITECTURE section 26 rule 3, SPEC ET-08): thin wrappers that parse the bulk
// inputs, run the bulk services (which authorize every row through the event type services) and refresh the page.
// Single event type actions (On/Off, secret, note, duplicate, delete, reorder) are the shared ones in
// @/lib/event-types/actions.
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/actions";
import { bulkDeleteEventTypes, bulkSetEventTypesActive } from "./_components/bulk";
import { zBulkActiveInput, zBulkIdsInput } from "./_components/schemas";

/** ET-08 bulk "Delete": { ids } -> { deleted }. */
export async function bulkDeleteEventTypesAction(raw: unknown) {
  return runAction(zBulkIdsInput, raw, async (input, { actor, db }) => {
    const result = await bulkDeleteEventTypes(db, actor, input.ids);
    revalidatePath("/app/scheduling");
    return result;
  });
}

/** ET-08 bulk "Toggle on/off": { ids, active } -> { updated, active }. */
export async function bulkSetEventTypesActiveAction(raw: unknown) {
  return runAction(zBulkActiveInput, raw, async (input, { actor, db }) => {
    const result = await bulkSetEventTypesActive(db, actor, input.ids, input.active);
    revalidatePath("/app/scheduling");
    return result;
  });
}
