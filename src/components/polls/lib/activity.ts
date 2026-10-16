// Activity feed text of the results page (SPEC MP-16 "Activity"; polls-core src/lib/polls/activity.ts data shapes) and
// the live update toasts ("{Name} voted"). Pure and client safe.
import type { PollActivityView } from "@/lib/polls/types";
import { pt, ptCount } from "./t";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function activityText(a: PollActivityView): string {
  const name = a.participantName ?? str(a.data.name) ?? pt("results.activityTypes.someone");
  const k = "results.activityTypes";
  switch (a.type) {
    case "created":
      return a.actorName ? pt(`${k}.created`, { actor: a.actorName }) : pt(`${k}.createdNoActor`);
    case "edited":
      if (a.data.kind === "meeting_canceled") return pt(`${k}.meetingCanceled`);
      if (a.data.kind === "invitee_canceled") return pt(`${k}.inviteeCanceled`, { name: str(a.data.name) ?? name });
      return pt(`${k}.edited`);
    case "options_added":
      return ptCount(num(a.data.count), `${k}.optionAdded`, `${k}.optionsAdded`);
    case "options_removed":
      return ptCount(num(a.data.count), `${k}.optionRemoved`, `${k}.optionsRemoved`);
    case "invited":
      return ptCount(num(a.data.count), `${k}.invitedOne`, `${k}.invited`);
    case "reminder_sent":
      return ptCount(num(a.data.count), `${k}.reminderSentOne`, `${k}.reminderSent`);
    case "voted":
      return pt(`${k}.voted`, { name });
    case "vote_changed":
      return pt(`${k}.voteChanged`, { name });
    case "declined":
      return pt(`${k}.declined`, { name });
    case "participant_removed":
      return pt(`${k}.participantRemoved`, { name });
    case "commented":
      return pt(`${k}.commented`, { name });
    case "comment_deleted":
      return pt(`${k}.commentDeleted`);
    case "voting_closed":
      return a.data.reason === "deadline" ? pt(`${k}.votingClosedDeadline`) : pt(`${k}.votingClosed`);
    case "voting_reopened":
      return pt(`${k}.votingReopened`);
    case "booked":
      return a.data.auto ? pt(`${k}.bookedAuto`) : pt(`${k}.booked`);
    case "rebooked":
      return pt(`${k}.rebooked`);
    case "reopened":
      return pt(`${k}.reopened`);
    case "canceled":
      return pt(`${k}.canceled`);
    case "expired":
      return pt(`${k}.expired`);
    default:
      return pt(`${k}.edited`);
  }
}

/** The toast of a live update, or null for activity that doesn't need one. */
export function liveToast(a: PollActivityView): string | null {
  const name = a.participantName ?? str(a.data.name);
  if (!name) return null;
  if (a.type === "voted") return pt("results.liveVoted", { name });
  if (a.type === "vote_changed") return pt("results.liveChanged", { name });
  if (a.type === "declined") return pt("results.liveDeclined", { name });
  if (a.type === "commented" && !a.actorName) return pt("results.liveCommented", { name });
  return null;
}
