// Small view helpers shared by the queries, the emails and the booking dialog. Pure and client safe.
import type { LocationConfig } from "@/db/types";
import { CONFERENCING_COPY, conferenceProviderName, isConferenceKind } from "@/lib/conferencing/kinds";
import type { PollLocationView } from "./types";

/** The location line before booking (MP-07 pre-booking display rules). */
export function locationView(location: LocationConfig | null | undefined): PollLocationView {
  if (!location) return null;
  const conference = isConferenceKind(location.kind);
  const provider = conference ? conferenceProviderName(location.kind) : null;
  let text = "";
  if (conference) text = CONFERENCING_COPY.beforeBooking;
  else if (location.kind === "inbound_call") text = location.phoneNumber ?? "";
  else if (location.kind === "physical") text = location.location ?? "";
  else if (location.kind === "custom") text = location.displayBeforeBooking === false ? "" : (location.location ?? "");
  return { kind: location.kind, text, additionalInfo: location.additionalInfo ?? null, isConference: conference, provider };
}
