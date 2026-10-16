// Event type components (ARCHITECTURE section 25, SPEC ET-12, ET-13, ET-17): exported for the Scheduling list
// (event-types-list), settings, links and polls. Client components.
//   LocationEditor({ value, onChange, mode, allowedKinds?, userId, disabled?, conferencing?, errors?, label? })
//   DeleteEventTypeDialog({ open, onOpenChange, eventType: { id, name }, onDeleted? })
//   InternalNoteDialog({ open, onOpenChange, eventTypeId, note, onSaved?, onApply? })
// The editor itself is ./editor/event-type-editor (rendered by /app/event-types/**).
export { LocationEditor, type LocationEditorProps } from "./location-editor";
export { LOCATION_KIND_LABELS } from "./location-labels";
export { DeleteEventTypeDialog, type DeleteEventTypeDialogProps } from "./delete-event-type-dialog";
export { InternalNoteDialog, type InternalNoteDialogProps } from "./internal-note-dialog";
