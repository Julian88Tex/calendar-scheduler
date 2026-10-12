// OWNER: conferencing.
//
// Jitsi Meet rooms (SPEC VID-10): no credentials, `{JITSI_BASE_URL or https://meet.jit.si}/{app-name-slug}-{20 random
// lowercase letters and digits}` (about 103 bits of randomness from crypto.getRandomValues, so rooms are unique and
// unguessable). Kept on reschedule, nothing to delete on cancel. docs/SCOPE.md does not offer Jitsi in any screen;
// existing Jitsi locations still get their rooms.
import "server-only";
import type { ResolvedLocation } from "@/db/types";
import { jitsiBaseUrl } from "@/lib/env";
import { jitsiRoom } from "@/lib/ids";

export function jitsiConference(): ResolvedLocation {
  const room = jitsiRoom();
  const joinUrl = `${jitsiBaseUrl().replace(/\/+$/, "")}/${room}`;
  return {
    configId: null,
    kind: "jitsi_conference",
    location: joinUrl,
    additionalInfo: null,
    joinUrl,
    status: "pushed",
    providerMeetingId: room,
    password: null,
    dialIn: null,
    data: { provider: "jitsi" },
    error: null,
  };
}
