"use server";
// Shared event type server actions (ARCHITECTURE section 26 rule 3): thin wrappers that parse with the module schemas,
// call the services in ./service.ts (which authorize the actor) and revalidate the Scheduling page. Used by the editor
// (/app/event-types/**), the Scheduling list (event-types-list) and the dialogs in src/components/event-types.
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/actions";
import { getConferencingOptionsFor } from "./queries";
import {
  zConferencingInput,
  zEventTypeRef,
  zInternalNoteInput,
  zReorderInput,
  zSaveEventTypeInput,
  zSetActiveInput,
  zSetSecretInput,
  zSlugCheckInput,
} from "./schemas";
import {
  checkSlugAvailability,
  deleteEventType,
  duplicateEventType,
  reorderEventTypes,
  saveEventType,
  setEventTypeActive,
  setEventTypeSecret,
  setInternalNote,
} from "./service";

function refresh(id?: string) {
  revalidatePath("/app/scheduling");
  if (id) revalidatePath(`/app/event-types/${id}`);
}

/** ET-14 "Save changes": { id: null | uuid, version, kind?, draft } -> { id, slug, version, created }. */
export async function saveEventTypeAction(raw: unknown) {
  return runAction(zSaveEventTypeInput, raw, async (input, { actor, db }) => {
    const result = await saveEventType(db, actor, input);
    refresh(result.id);
    return result;
  });
}

/** ET-12 delete (soft, audited). */
export async function deleteEventTypeAction(raw: unknown) {
  return runAction(zEventTypeRef, raw, async (input, { actor, db }) => {
    await deleteEventType(db, actor, input.id);
    refresh();
    return { id: input.id };
  });
}

/** ET-11 duplicate -> { id, slug } of the copy. */
export async function duplicateEventTypeAction(raw: unknown) {
  return runAction(zEventTypeRef, raw, async (input, { actor, db }) => {
    const copy = await duplicateEventType(db, actor, input.id);
    refresh();
    return copy;
  });
}

/** ET-09 On/Off -> { version }. */
export async function setEventTypeActiveAction(raw: unknown) {
  return runAction(zSetActiveInput, raw, async (input, { actor, db }) => {
    const result = await setEventTypeActive(db, actor, input.id, input.active);
    refresh(input.id);
    return result;
  });
}

/** ET-10 Make secret / Make public -> { version }. */
export async function setEventTypeSecretAction(raw: unknown) {
  return runAction(zSetSecretInput, raw, async (input, { actor, db }) => {
    const result = await setEventTypeSecret(db, actor, input.id, input.secret);
    refresh(input.id);
    return result;
  });
}

/** ET-13 internal note -> { version, note }. */
export async function saveInternalNoteAction(raw: unknown) {
  return runAction(zInternalNoteInput, raw, async (input, { actor, db }) => {
    const result = await setInternalNote(db, actor, input.id, input.note);
    refresh(input.id);
    return result;
  });
}

/** ET-07 reorder: { ids } in their new order (one section). */
export async function reorderEventTypesAction(raw: unknown) {
  return runAction(zReorderInput, raw, async (input, { actor, db }) => {
    await reorderEventTypes(db, actor, input.ids);
    refresh();
    return { ok: true };
  });
}

/** ET-23 live slug check -> { slug, available, message }. */
export async function checkEventSlugAction(raw: unknown) {
  return runAction(zSlugCheckInput, raw, async (input, { actor, db }) => checkSlugAvailability(db, actor, input));
}

/** LocationEditor connect prompts: { userId } -> availability per conferencing kind. */
export async function loadConferencingOptionsAction(raw: unknown) {
  return runAction(zConferencingInput, raw, async (input, { actor }) => getConferencingOptionsFor(actor, input.userId));
}
