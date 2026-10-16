// Results visibility on the voter page (SPEC MP-12, MP-14; research meeting-polls.md B5.6, B5.8). Pure and client
// safe; the public API runs every response through redactForVoter so the JSON only carries what the mode allows:
//
//   host_only    the viewer's own answers; "Full" still enforced and shown; no counts, names or other votes.
//   counts_only  per-option counts, no names, no grid.
//   after_vote   nothing about others until the viewer submits, then like everyone.
//   everyone     counts, names and every response (the Doodle grid).
//
// Emails of other participants never appear in any mode (the viewer's own email is returned separately, read-only).
// Comments: public comments are shown unless the poll is host_only now (after_vote: other voters' comments only once the
// viewer submitted); host_only comments (written while the poll was host_only) are shown to their author only. Hosts
// read comments through the host view instead.
import type { ParticipantStatus, PollCommentView, PollVisibility, VoteChoice, VoterParticipantView } from "./types";

export type VisParticipant = {
  id: string;
  name: string;
  status: ParticipantStatus;
  /** Votes on live options. */
  votes: Readonly<Record<string, VoteChoice>>;
};

export type VisComment = {
  id: string;
  participantId: string | null;
  authorUserId: string | null;
  authorName: string;
  body: string;
  visibility: "public" | "host_only";
  createdAt: string;
};

export type VisInput = {
  visibility: PollVisibility;
  optionIds: readonly string[];
  /** Live participants in submission order (respondents and invited people). */
  participants: readonly VisParticipant[];
  comments: readonly VisComment[];
  maxVotesPerOption: number | null;
  viewer: { participantId: string | null; submitted: boolean };
};

export type VisOutput = {
  /** Per option: capacity flag (always), counts and names (when allowed). */
  options: Record<string, { isFull: boolean; counts: { yes: number; ifNeedBe: number } | null; voters: { yes: string[]; ifNeedBe: string[] } | null }>;
  participants: VoterParticipantView[] | null;
  respondentCount: number | null;
  comments: PollCommentView[];
  showCounts: boolean;
  showNames: boolean;
};

const isRespondent = (p: Pick<VisParticipant, "status">) => p.status === "responded" || p.status === "declined";

/** What the mode reveals to this viewer. */
export function visibilityFlags(visibility: PollVisibility, viewerSubmitted: boolean): { showNames: boolean; showCounts: boolean } {
  const showNames = visibility === "everyone" || (visibility === "after_vote" && viewerSubmitted);
  return { showNames, showCounts: showNames || visibility === "counts_only" };
}

/** "Get updates when others vote" is offered only when the viewer can see something about others (MP-09). */
export function canSubscribe(visibility: PollVisibility): boolean {
  return visibility !== "host_only";
}

/**
 * Capacity per option (MP-08): Yes and If need be of everyone except `exceptParticipantId` count toward the limit.
 * Returns the option ids that are full for that participant.
 */
export function fullOptionIds(
  optionIds: readonly string[],
  participants: readonly VisParticipant[],
  maxVotesPerOption: number | null,
  exceptParticipantId: string | null,
): Set<string> {
  const out = new Set<string>();
  if (!maxVotesPerOption) return out;
  for (const id of optionIds) {
    let n = 0;
    for (const p of participants) {
      if (p.id === exceptParticipantId) continue;
      const c = p.votes[id];
      if (c === "yes" || c === "if_need_be") n++;
    }
    if (n >= maxVotesPerOption) out.add(id);
  }
  return out;
}

/** The voter-facing projection (see the file header). */
export function redactForVoter(input: VisInput): VisOutput {
  const { showNames, showCounts } = visibilityFlags(input.visibility, input.viewer.submitted);
  const respondents = input.participants.filter(isRespondent);
  const full = fullOptionIds(input.optionIds, input.participants, input.maxVotesPerOption, input.viewer.participantId);

  const options: VisOutput["options"] = {};
  for (const id of input.optionIds) {
    let yes = 0;
    let ifNeedBe = 0;
    const yesNames: string[] = [];
    const maybeNames: string[] = [];
    for (const p of respondents) {
      const c = p.votes[id];
      if (c === "yes") {
        yes++;
        yesNames.push(p.name);
      } else if (c === "if_need_be") {
        ifNeedBe++;
        maybeNames.push(p.name);
      }
    }
    options[id] = {
      isFull: full.has(id),
      counts: showCounts ? { yes, ifNeedBe } : null,
      voters: showNames ? { yes: yesNames, ifNeedBe: maybeNames } : null,
    };
  }

  const participants: VoterParticipantView[] | null = showNames
    ? respondents.map((p, i) => ({
        key: `r${i + 1}`,
        name: p.name,
        status: p.status,
        votes: Object.fromEntries(input.optionIds.filter((id) => p.votes[id]).map((id) => [id, p.votes[id]!])),
        isYou: p.id === input.viewer.participantId,
      }))
    : null;

  const hostOnlyNow = input.visibility === "host_only";
  // after_vote shows nothing about others before the viewer submits: other voters' comments wait too (they often say
  // which times suit them); the hosts' public comments stay visible.
  const hideVoterComments = input.visibility === "after_vote" && !input.viewer.submitted;
  const comments: PollCommentView[] = input.comments
    .filter((c) => {
      const mine = Boolean(input.viewer.participantId && c.participantId === input.viewer.participantId);
      if (mine) return true;
      if (hideVoterComments && !c.authorUserId) return false;
      return c.visibility === "public" && !hostOnlyNow;
    })
    .map((c) => ({
      id: c.id,
      authorName: c.authorName,
      isHost: Boolean(c.authorUserId),
      body: c.body,
      createdAt: c.createdAt,
      hostOnly: c.visibility === "host_only" || hostOnlyNow,
      canDelete: Boolean(input.viewer.participantId && c.participantId === input.viewer.participantId && !c.authorUserId),
    }));

  return {
    options,
    participants,
    respondentCount: showCounts ? respondents.length : null,
    comments,
    showCounts,
    showNames,
  };
}
