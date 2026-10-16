// Inputs of the Scheduling list bulk actions (SPEC ET-08): the selected event type ids, plus the On/Off value for
// "Toggle on/off". Client and server safe (zod only).
import { z } from "zod";
import { zId } from "@/lib/validation";

/** Most event types one bulk action changes (a page shows every event type of the section). */
export const BULK_MAX = 200;

export const zBulkIdsInput = z.object({
  ids: z
    .array(zId)
    .min(1, "Select at least one event type.")
    .max(BULK_MAX, `Select up to ${BULK_MAX} event types at a time.`),
});

export const zBulkActiveInput = zBulkIdsInput.extend({ active: z.boolean() });

export type BulkIdsInput = z.infer<typeof zBulkIdsInput>;
export type BulkActiveInput = z.infer<typeof zBulkActiveInput>;
