// OWNER: event-types-editor. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Location kind labels (SPEC VID-01), server and client safe (meetings list, emails, editors).
import type { LocationKind } from "@/db/types";

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  physical: "In-person meeting",
  outbound_call: "Phone call (you call invitee)",
  inbound_call: "Phone call (invitee calls you)",
  google_conference: "Google Meet",
  microsoft_teams_conference: "Microsoft Teams",
  zoom_conference: "Zoom",
  jitsi_conference: "Jitsi Meet",
  custom: "Custom",
  ask_invitee: "Ask invitee",
  webex_conference: "Webex",
  gotomeeting_conference: "GoTo Meeting",
};
