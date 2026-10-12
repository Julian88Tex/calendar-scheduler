// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// EventTypeWorkflowsSection (ARCHITECTURE section 25, SPEC ET-25, NT-09): basic notifications and attached workflows in
// the event type editor. Foundation stub: a placeholder.
export type EventTypeWorkflowsSectionProps = {
  /** null for an event type that was not saved yet. */
  eventTypeId: string | null;
  canEdit: boolean;
};

export function EventTypeWorkflowsSection({ eventTypeId, canEdit: _canEdit }: EventTypeWorkflowsSectionProps) {
  return (
    <p className="text-body-md text-ink-2">
      {eventTypeId ? "Workflows are not available yet." : "Save the event type to add workflows."}
    </p>
  );
}
