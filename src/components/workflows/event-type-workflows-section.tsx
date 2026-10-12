// OWNER: workflows.
//
// EventTypeWorkflowsSection (ARCHITECTURE section 25, SPEC ET-25, NT-09; docs/SCOPE.md workflows lite): the reminder
// rows of the event type editor's "Notifications and workflows" section, mounted by the event type editor after its
// calendar invitation or email confirmation row: "Email reminders" (invitees, default 24 hours before, up to 3
// timings) and "Email reminders to host", each with Edit and On/Off. Client component; it loads its own data, or the
// editor page can preload it with getEventTypeReminders(actor, eventTypeId) from @/lib/workflows and pass `initial`.
"use client";

import type { EventTypeRemindersView } from "@/lib/workflows/types";
import { RemindersSection } from "./reminders-section";

export type EventTypeWorkflowsSectionProps = {
  /** null for an event type that was not saved yet. */
  eventTypeId: string | null;
  canEdit: boolean;
  /** Optional preloaded data (getEventTypeReminders on the server) to render without a loading state. */
  initial?: EventTypeRemindersView | null;
};

export function EventTypeWorkflowsSection({ eventTypeId, canEdit, initial }: EventTypeWorkflowsSectionProps) {
  if (!eventTypeId) {
    return <p className="text-body-md text-ink-2">Save this event type to set up email reminders.</p>;
  }
  return <RemindersSection key={eventTypeId} eventTypeId={eventTypeId} canEdit={canEdit} initial={initial ?? null} />;
}
