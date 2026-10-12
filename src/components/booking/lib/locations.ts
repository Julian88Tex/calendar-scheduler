// Location display rules of the public booking pages (SPEC VID-01 to VID-06, BK-03, BK-11, BK-20). Pure and client
// safe.
//
//   toPublicLocations(configs)   what may reach the browser before booking: hidden addresses and custom texts
//                                ("Display location only after confirmation") and the inbound call number never do
//   locationRows(list)           the details panel rows (one location: its text; several: one row per kind)
//   locationOption(l)            the "Location" radio label on the details form (BK-11)
//   locationInput(l)             the extra field a choice needs: the phone (outbound call) or text (ask invitee)
//   meetingLocation(resolved)    the confirmation page row of a booked meeting
import type { LocationConfig, LocationKind, ResolvedLocation } from "@/db/types";
import { bt } from "./t";

export type PublicLocation = {
  id: string;
  kind: LocationKind;
  position: number;
  /** Text shown before booking (physical address or custom text), null when the host hides it until booking. */
  text: string | null;
  /** Physical: the additional information (street address, notes), when the location is shown. */
  additionalInfo: string | null;
  /** Ask invitee: the host's prompt, shown as helper text. */
  prompt: string | null;
};

export type LocationIcon = "video" | "pin" | "phone" | "custom";

export type LocationRow = { key: string; icon: LocationIcon; text: string; detail: string | null };

const CONFERENCE_KINDS: ReadonlySet<LocationKind> = new Set([
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "webex_conference",
  "gotomeeting_conference",
]);

/** Kinds no booking page offers until their integrations exist (SPEC VID-16). */
const HIDDEN_KINDS: ReadonlySet<LocationKind> = new Set(["webex_conference", "gotomeeting_conference"]);

export function isConferenceKind(kind: LocationKind | null | undefined): boolean {
  return Boolean(kind && CONFERENCE_KINDS.has(kind));
}

const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? "").replace(/\r\n?/g, "\n").trim();
  return v ? v : null;
};

/** The locations a booking page may show, sorted by position, with hidden details stripped (VID-02, VID-04, VID-05). */
export function toPublicLocations(configs: readonly LocationConfig[] | null | undefined): PublicLocation[] {
  return [...(configs ?? [])]
    .filter((c) => c && typeof c.id === "string" && !HIDDEN_KINDS.has(c.kind))
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const shown = c.kind === "physical" ? c.displayBeforeBooking !== false : c.kind === "custom" ? c.displayBeforeBooking === true : false;
      return {
        id: c.id,
        kind: c.kind,
        position: c.position,
        text: shown ? clean(c.location) : null,
        additionalInfo: c.kind === "physical" && shown ? clean(c.additionalInfo) : null,
        prompt: c.kind === "ask_invitee" ? clean(c.location) : null,
      };
    });
}

/** Provider name of a conferencing kind ("Google Meet"). */
export function providerName(kind: LocationKind): string {
  switch (kind) {
    case "google_conference":
      return bt("location.googleMeet");
    case "microsoft_teams_conference":
      return bt("location.microsoftTeams");
    case "zoom_conference":
      return bt("location.zoom");
    case "jitsi_conference":
      return bt("location.jitsi");
    case "webex_conference":
      return bt("location.webex");
    case "gotomeeting_conference":
      return bt("location.gotomeeting");
    default:
      return bt("location.custom");
  }
}

function iconOf(kind: LocationKind): LocationIcon {
  if (isConferenceKind(kind)) return "video";
  if (kind === "inbound_call" || kind === "outbound_call") return "phone";
  if (kind === "custom") return "custom";
  return "pin";
}

/** The row of a single location (VID-01 pre-booking display). */
function singleRow(l: PublicLocation): LocationRow {
  const key = l.id;
  switch (l.kind) {
    case "physical":
      return { key, icon: "pin", text: l.text ?? bt("location.afterBooking"), detail: l.text ? l.additionalInfo : null };
    case "custom":
      return { key, icon: "custom", text: l.text ?? bt("location.afterBooking"), detail: null };
    case "inbound_call":
      return { key, icon: "phone", text: bt("location.inbound"), detail: null };
    case "outbound_call":
      return { key, icon: "phone", text: bt("location.outbound"), detail: null };
    case "ask_invitee":
      return { key, icon: "pin", text: bt("location.askInvitee"), detail: null };
    default:
      return { key, icon: "video", text: bt("location.conferencing"), detail: null };
  }
}

/**
 * Details panel rows (BK-03): one location shows its own text; several list each kind on its own row (our choice):
 * several in-person venues collapse to "In-person meeting", conferencing kinds show their provider names.
 */
export function locationRows(list: readonly PublicLocation[]): LocationRow[] {
  if (list.length === 0) return [];
  if (list.length === 1) return [singleRow(list[0]!)];
  const byKind = new Map<LocationKind, PublicLocation[]>();
  for (const l of list) {
    const group = byKind.get(l.kind);
    if (group) group.push(l);
    else byKind.set(l.kind, [l]);
  }
  const rows: LocationRow[] = [];
  for (const [kind, group] of byKind) {
    const first = group[0]!;
    if (kind === "physical" && group.length > 1) {
      rows.push({ key: `kind-${kind}`, icon: "pin", text: bt("location.inPerson"), detail: null });
      continue;
    }
    if (group.length === 1 && (kind === "physical" || kind === "custom")) {
      const row = singleRow(first);
      rows.push({ ...row, detail: null });
      continue;
    }
    rows.push({ key: `kind-${kind}`, icon: iconOf(kind), text: locationOption(first).label, detail: null });
  }
  return rows;
}

/** The "Location" radio option of a choice (BK-11). */
export function locationOption(l: PublicLocation): { label: string; detail: string | null; icon: LocationIcon } {
  switch (l.kind) {
    case "physical":
      return { label: l.text ?? bt("location.inPerson"), detail: l.text ? l.additionalInfo : null, icon: "pin" };
    case "custom":
      return { label: l.text ?? bt("location.custom"), detail: null, icon: "custom" };
    case "inbound_call":
      return { label: bt("location.optionInbound"), detail: null, icon: "phone" };
    case "outbound_call":
      return { label: bt("location.optionOutbound"), detail: null, icon: "phone" };
    case "ask_invitee":
      return { label: bt("location.optionAskInvitee"), detail: null, icon: "pin" };
    default:
      return { label: providerName(l.kind), detail: null, icon: "video" };
  }
}

/** The extra input a location needs from the invitee (VID-03 phone, VID-06 text), or null. */
export function locationInput(l: PublicLocation | null | undefined): "phone" | "text" | null {
  if (!l) return null;
  if (l.kind === "outbound_call") return "phone";
  if (l.kind === "ask_invitee") return "text";
  return null;
}

export type MeetingLocationView = {
  icon: LocationIcon;
  /** Main line (address, phone, provider, invitee text). */
  text: string;
  /** Second line (street address, dial-in). */
  detail: string | null;
  /** Clickable target (join link, tel:, custom URL). */
  href: string | null;
};

const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;

/** The booked meeting's location row on the confirmation page (BK-20, VID-01 to VID-06), or null without one. */
export function meetingLocation(loc: ResolvedLocation | null | undefined, opts: { hostName: string; stableJoinUrl?: string | null }): MeetingLocationView | null {
  if (!loc?.kind) return null;
  const text = clean(loc.location);
  const info = clean(loc.additionalInfo);
  switch (loc.kind) {
    case "physical":
      return { icon: "pin", text: text ?? bt("location.inPerson"), detail: info, href: null };
    case "custom":
      return { icon: "custom", text: text ?? bt("location.custom"), detail: null, href: text && HTTP_URL.test(text) ? text : null };
    case "inbound_call":
      return { icon: "phone", text: text ? bt("location.callHost", { phone: text }) : bt("location.outbound"), detail: info, href: text ? `tel:${text.replace(/[^\d+]/g, "")}` : null };
    case "outbound_call":
      return { icon: "phone", text: text ? bt("location.hostWillCall", { host: opts.hostName, phone: text }) : bt("location.outbound"), detail: null, href: null };
    case "ask_invitee":
      return { icon: "pin", text: text ?? bt("location.askInvitee"), detail: null, href: null };
    default: {
      const ready = loc.status === "pushed" && loc.joinUrl && HTTP_URL.test(loc.joinUrl);
      if (!ready) return { icon: "video", text: bt("location.conferencingToFollow"), detail: providerName(loc.kind), href: null };
      return { icon: "video", text: providerName(loc.kind), detail: loc.joinUrl, href: opts.stableJoinUrl ?? loc.joinUrl };
    }
  }
}
