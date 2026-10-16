// Event type services public API (ARCHITECTURE sections 3.2 and 25; SPEC ET-01 to ET-34 as narrowed by docs/SCOPE.md:
// one-on-one event types). Server only. Client code imports the pure helpers from their own files:
// @/lib/event-types/constants (limits, labels, copy), @/lib/event-types/schemas (zod schemas, validateDraft,
// sectionOfField), @/lib/event-types/draft (defaults, summaries, preview draft) and @/lib/event-types/types (shapes).
// Server actions for client components live in @/lib/event-types/actions.
//
//   service.ts  saveEventType (create on first save, whole-form update), duplicateEventType, deleteEventType,
//               setEventTypeActive, setEventTypeSecret, setInternalNote, setEventTypeLocale, reorderEventTypes,
//               checkSlugAvailability, newEventTypeDefaults
//   queries.ts  getEventTypeEditorData, getNewEventTypeEditorData, listEventTypes, getConferencingOptionsFor
import "server-only";

export * from "./constants";
export type * from "./types";
export {
  checkSlugAvailability,
  deleteEventType,
  duplicateEventType,
  eventTypeAccessFor,
  newEventTypeDefaults,
  reorderEventTypes,
  saveEventType,
  setEventTypeActive,
  setEventTypeLocale,
  setEventTypeSecret,
  setInternalNote,
} from "./service";
export { getConferencingOptionsFor, getEventTypeEditorData, getNewEventTypeEditorData, listEventTypes } from "./queries";
export { validateDraft, type SaveEventTypeInput } from "./schemas";
export {
  availabilitySummary,
  copyName,
  copySlugCandidates,
  dedupeSlug,
  defaultDraft,
  draftOfRow,
  durationColumns,
  durationsOf,
  durationSummary,
  locationSummary,
  previewDraftOf,
} from "./draft";
