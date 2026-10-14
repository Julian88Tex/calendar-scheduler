// Page state of the invitee cancel and reschedule pages (SPEC CR-02, CR-03, CR-08, SCH-23). Pure and client safe:
// lifecycle-core's getInviteeChangeContext decides (policy.ts) whether the invitee may cancel or reschedule right now;
// this module turns that decision into what a page shows:
//
//   redirect   the URL's invitee was rescheduled: links in older emails open the active invitee of the chain (CR-02)
//   form       the cancel form, or the reschedule booking flow
//   blocked    a state card: already canceled, already occurred, the SCH-23 cutoff ("Please contact {Host}" with the
//              host's email), or "This event can no longer be rescheduled." (event type off or deleted, one-off and
//              poll meetings) while the cancel page keeps working
import type { ChangeBlock } from "@/lib/lifecycle/policy";
import { lt } from "./t";

export type ChangeKind = "cancel" | "reschedule";

export type ChangeDecision = {
  requestedInviteeId: string;
  /** The active invitee of the chain (the page's subject). */
  inviteeId: string;
  moved: boolean;
  cancelBlock: ChangeBlock | null;
  rescheduleBlock: ChangeBlock | null;
};

export type BlockedCopy = {
  reason: ChangeBlock["reason"];
  title: string;
  body: string | null;
  /** SCH-23: the host to contact. */
  contact: { name: string; email: string } | null;
  /** Reschedule page only: the cancel page still works (event type off, one-off or poll meeting). */
  cancelAvailable: boolean;
};

export type ChangePageState = { state: "redirect"; inviteeId: string } | { state: "form" } | { state: "blocked"; copy: BlockedCopy };

/** "/cancellations/{id}" or "/reschedulings/{id}" with an optional query string. */
export function changePagePath(kind: ChangeKind, inviteeId: string, query?: string): string {
  const base = `/${kind === "cancel" ? "cancellations" : "reschedulings"}/${encodeURIComponent(inviteeId)}`;
  const q = (query ?? "").replace(/^\?/, "");
  return q ? `${base}?${q}` : base;
}

function contactOf(block: ChangeBlock): BlockedCopy["contact"] {
  return block.reason === "cutoff" && block.hostEmail ? { name: block.hostName ?? "", email: block.hostEmail } : null;
}

/** The state card copy of a refusal (see the file header). */
export function blockedCopy(kind: ChangeKind, d: Pick<ChangeDecision, "cancelBlock" | "rescheduleBlock">, hostName: string): BlockedCopy | null {
  if (kind === "cancel") {
    const b = d.cancelBlock;
    if (!b) return null;
    return { reason: b.reason, title: b.message, body: null, contact: contactOf(b), cancelAvailable: false };
  }
  const b = d.rescheduleBlock;
  if (!b) return null;
  if (b.reason === "cutoff") return { reason: b.reason, title: b.message, body: null, contact: contactOf(b), cancelAvailable: false };
  const c = d.cancelBlock;
  // "This event can no longer be rescheduled." with the reason when the meeting itself is over or canceled.
  const body =
    c?.reason === "canceled" || c?.reason === "rescheduled"
      ? lt("reschedule.blockedBody.canceled")
      : c?.reason === "occurred"
        ? lt("reschedule.blockedBody.occurred")
        : c?.reason === "cutoff"
          ? c.message
          : hostName
            ? lt("reschedule.blockedBody.other", { hostName })
            : null;
  return {
    reason: b.reason,
    title: b.message,
    body,
    contact: c?.reason === "cutoff" ? contactOf(c) : null,
    cancelAvailable: c === null,
  };
}

/** What a cancel or reschedule page shows for a change decision (see the file header). */
export function changePageState(kind: ChangeKind, d: ChangeDecision, hostName: string): ChangePageState {
  if (d.moved && d.inviteeId !== d.requestedInviteeId) return { state: "redirect", inviteeId: d.inviteeId };
  const copy = blockedCopy(kind, d, hostName);
  return copy ? { state: "blocked", copy } : { state: "form" };
}

/** "This event will be canceled for Ana Lima and 2 guests." (CR-02), or null without guests. */
export function guestsNotice(inviteeName: string, guestCount: number): string | null {
  if (guestCount <= 0) return null;
  return guestCount === 1 ? lt("cancel.guestsOne", { name: inviteeName }) : lt("cancel.guests", { name: inviteeName, count: guestCount });
}

/** The query string of a request's search params (single values only), kept across the chain redirect. */
export function queryStringOf(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  return q.toString();
}
