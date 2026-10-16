// lifecycle-ui public exports for other modules (meetings-dashboard): the host meeting dialogs and their props types
// (SPEC CR-06, CR-07, CR-08, CR-11, CR-14). Every component is a Client Component; pass a HostMeetingSummary built by
// your own queries or by loadHostMeetingSummary (src/components/lifecycle/server/host-meeting.ts, server only). The
// dialogs call the Server Actions in ./actions.ts (lifecycle-core services with the signed-in user as the actor) and
// revalidate /app/meetings. Not built (docs/SCOPE.md: solo event types only, features the owner doesn't use): block
// invitee (CR-12), the group invitee limit (CR-20), round robin host choice and reassignment (CR-09, CR-19).
export { HostCancelDialog, type HostCancelDialogProps } from "./host-cancel-dialog";
export { RescheduleChoiceDialog, type RescheduleChoiceDialogProps, type RescheduleStep } from "./reschedule-choice-dialog";
export { HostTimePicker, type HostPick, type HostTimePickerProps } from "./host-time-picker";
export { MarkNoShowButton, type MarkNoShowButtonProps } from "./mark-no-show-button";
export { NotesEditor, type NotesEditorProps } from "./notes-editor";
export { MeetingBrief } from "./meeting-brief";
export type { HostMeetingInvitee, HostMeetingSummary } from "./types";
