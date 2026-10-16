// Redirect after booking (SPEC BK-21). Pure and client safe: the confirmation page and createBooking build the same
// URL. With "Pass event details" the URL gains event_type_name, event_type_uuid, event_start_time, event_end_time
// (ISO 8601 in the invitee zone), guests, assigned_to, invitee_uuid, invitee_email, invitee_first_name,
// invitee_last_name, invitee_full_name, invitee_payment_amount, invitee_payment_currency, text_reminder_number, the
// UTM parameters and answer_1 to answer_10 (URL encoded by URLSearchParams).
import { zoneClock } from "@/lib/slots/zone";

export type RedirectInput =
  | { url: string; passDetails: false }
  | {
      url: string;
      passDetails: true;
      eventTypeName: string;
      eventTypeId: string;
      start: Date;
      end: Date;
      zone: string;
      guests: string[];
      assignedTo: string | null;
      invitee: {
        id: string;
        email: string;
        name: string;
        firstName: string | null;
        lastName: string | null;
        textReminderNumber: string | null;
        utmSource: string | null;
        utmMedium: string | null;
        utmCampaign: string | null;
        utmContent: string | null;
        utmTerm: string | null;
      };
      answers: string[];
      payment: { amount: string; currency: string } | null;
    };

/** ISO 8601 with the zone's offset ("2026-10-14T10:00:00-07:00"). */
export function isoInZone(at: Date, zone: string): string {
  let clock;
  try {
    clock = zoneClock(zone);
  } catch {
    clock = zoneClock("UTC");
  }
  const ms = at.getTime();
  const naive = clock.toNaive(ms);
  const offsetMin = Math.round((naive - ms) / 60_000);
  const local = new Date(Math.floor(naive / 1000) * 1000).toISOString().slice(0, 19);
  if (offsetMin === 0) return `${local}Z`;
  const sign = offsetMin > 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The redirect URL, or null when the configured URL is not http(s). */
export function buildRedirectUrl(input: RedirectInput): string | undefined {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!input.passDetails) return url.toString();
  const set = (k: string, v: string | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, v);
  };
  const inv = input.invitee;
  set("event_type_name", input.eventTypeName);
  set("event_type_uuid", input.eventTypeId);
  set("event_start_time", isoInZone(input.start, input.zone));
  set("event_end_time", isoInZone(input.end, input.zone));
  set("guests", input.guests.join(","));
  set("assigned_to", input.assignedTo);
  set("invitee_uuid", inv.id);
  set("invitee_email", inv.email);
  const [first, ...rest] = inv.name.trim().split(/\s+/);
  set("invitee_first_name", inv.firstName ?? first ?? null);
  set("invitee_last_name", inv.lastName ?? (rest.length ? rest.join(" ") : null));
  set("invitee_full_name", inv.name);
  set("invitee_payment_amount", input.payment?.amount);
  set("invitee_payment_currency", input.payment?.currency);
  set("text_reminder_number", inv.textReminderNumber);
  set("utm_source", inv.utmSource);
  set("utm_medium", inv.utmMedium);
  set("utm_campaign", inv.utmCampaign);
  set("utm_content", inv.utmContent);
  set("utm_term", inv.utmTerm);
  input.answers.slice(0, 10).forEach((a, i) => set(`answer_${i + 1}`, a));
  return url.toString();
}

