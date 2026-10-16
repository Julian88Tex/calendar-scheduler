// "Best" option ranking (SPEC MP-28; research meeting-polls.md B19). Pure and client safe; also used by auto-book
// (which instead requires every relevant participant at a strict Yes).
//
// Per option: yes, ifNeedBe (maybe), no, unknown (respondents without a vote row for it, the "?" cells), requiredOk
// (every required participant answered Yes or If need be; true when nobody is required), hostFree, isPast.
// Sort key for future options, descending unless noted: requiredOk, attendable = yes + maybe, yes, hostFree, no
// (ascending), start (ascending, earliest first). "Best" = every future option equal to the first one on the first five
// keys (ties get several stars, Doodle style); no badge when nobody has responded. Past options follow, by start,
// without a rank.
import type { ParticipantStatus, VoteChoice } from "./types";

export type RankOption = {
  id: string;
  /** Epoch ms of the start (date-only options: local midnight in the poll zone). */
  start: number;
};

export type RankVote = { participantId: string; optionId: string; choice: VoteChoice };

export type RankParticipant = { id: string; status: ParticipantStatus; isRequired: boolean };

export type RankOptions = {
  /** The host's manual "Your preference" row (MP-17). */
  hostPreference?: Record<string, VoteChoice> | null;
  /** Count the host's preference as one more response (default false, Calendly does not count the host). */
  countHostPreference?: boolean;
};

export type RankedOption = {
  id: string;
  start: number;
  yes: number;
  ifNeedBe: number;
  no: number;
  unknown: number;
  attendable: number;
  requiredOk: boolean;
  hostFree: boolean;
  isPast: boolean;
  /** 1-based position among future options; null for past options. */
  rank: number | null;
  isBest: boolean;
};

/** Respondents: participants who submitted at least once (including Decline). Invited non-respondents do not count. */
export function isRespondent(p: Pick<RankParticipant, "status">): boolean {
  return p.status === "responded" || p.status === "declined";
}

function compare(a: RankedOption, b: RankedOption): number {
  if (a.requiredOk !== b.requiredOk) return a.requiredOk ? -1 : 1;
  if (a.attendable !== b.attendable) return b.attendable - a.attendable;
  if (a.yes !== b.yes) return b.yes - a.yes;
  if (a.hostFree !== b.hostFree) return a.hostFree ? -1 : 1;
  if (a.no !== b.no) return a.no - b.no;
  if (a.start !== b.start) return a.start - b.start;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when two options tie on the first five keys (the "Best" group). */
function sameGroup(a: RankedOption, b: RankedOption): boolean {
  return a.requiredOk === b.requiredOk && a.attendable === b.attendable && a.yes === b.yes && a.hostFree === b.hostFree && a.no === b.no;
}

/**
 * Ranks a poll's options. `hostBusy` holds the option ids where a host (owner or co-host) has an external conflict or
 * an app meeting. Returns future options in rank order, then past options by start.
 */
export function rankPollOptions(
  options: readonly RankOption[],
  votes: readonly RankVote[],
  participants: readonly RankParticipant[],
  hostBusy: ReadonlySet<string> | readonly string[],
  now: Date | number,
  opts: RankOptions = {},
): RankedOption[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const busy = hostBusy instanceof Set ? hostBusy : new Set(hostBusy as readonly string[]);
  const respondents = participants.filter(isRespondent);
  const respondentIds = new Set(respondents.map((p) => p.id));
  const required = requiredIds(participants);
  const byOption = new Map<string, Map<string, VoteChoice>>();
  for (const v of votes) {
    if (!respondentIds.has(v.participantId) && !required.has(v.participantId)) continue;
    let m = byOption.get(v.optionId);
    if (!m) byOption.set(v.optionId, (m = new Map()));
    m.set(v.participantId, v.choice);
  }
  const hostPref = opts.countHostPreference ? (opts.hostPreference ?? null) : null;

  const rows: RankedOption[] = options.map((o) => {
    const m = byOption.get(o.id) ?? new Map<string, VoteChoice>();
    let yes = 0;
    let ifNeedBe = 0;
    let no = 0;
    let unknown = 0;
    for (const p of respondents) {
      const c = m.get(p.id);
      if (c === "yes") yes++;
      else if (c === "if_need_be") ifNeedBe++;
      else if (c === "no") no++;
      else unknown++;
    }
    const pref = hostPref?.[o.id];
    if (pref === "yes") yes++;
    else if (pref === "if_need_be") ifNeedBe++;
    else if (pref === "no") no++;
    let requiredOk = true;
    for (const id of required) {
      const c = m.get(id);
      if (c !== "yes" && c !== "if_need_be") {
        requiredOk = false;
        break;
      }
    }
    return {
      id: o.id,
      start: o.start,
      yes,
      ifNeedBe,
      no,
      unknown,
      attendable: yes + ifNeedBe,
      requiredOk,
      hostFree: !busy.has(o.id),
      isPast: o.start <= nowMs,
      rank: null,
      isBest: false,
    };
  });

  const future = rows.filter((r) => !r.isPast).sort(compare);
  const past = rows.filter((r) => r.isPast).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  future.forEach((r, i) => (r.rank = i + 1));
  const anyResponse = respondents.length > 0 || Boolean(hostPref && Object.keys(hostPref).length > 0);
  const first = future[0];
  if (first && anyResponse) for (const r of future) if (sameGroup(r, first)) r.isBest = true;
  return [...future, ...past];
}

/** Required participant ids (whatever their status: a required person who has not answered blocks requiredOk). */
function requiredIds(participants: readonly RankParticipant[]): Set<string> {
  return new Set(participants.filter((p) => p.isRequired).map((p) => p.id));
}

/**
 * Auto-book candidates (MP-31): the relevant participants are the required ones when any are marked, else every
 * participant invited by email. Every relevant participant must have responded; returns the future option ids where all
 * of them answered a strict Yes and no host is busy, earliest first. Empty when nobody is relevant.
 */
export function consensusOptions(
  options: readonly RankOption[],
  votes: readonly RankVote[],
  participants: readonly (RankParticipant & { invited: boolean })[],
  hostBusy: ReadonlySet<string> | readonly string[],
  now: Date | number,
): string[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const busy = hostBusy instanceof Set ? hostBusy : new Set(hostBusy as readonly string[]);
  const required = participants.filter((p) => p.isRequired);
  const relevant = required.length ? required : participants.filter((p) => p.invited);
  if (!relevant.length || relevant.some((p) => !isRespondent(p))) return [];
  const yes = new Map<string, Set<string>>();
  for (const v of votes) {
    if (v.choice !== "yes") continue;
    let s = yes.get(v.optionId);
    if (!s) yes.set(v.optionId, (s = new Set()));
    s.add(v.participantId);
  }
  return options
    .filter((o) => o.start > nowMs && !busy.has(o.id) && relevant.every((p) => yes.get(o.id)?.has(p.id)))
    .sort((a, b) => a.start - b.start)
    .map((o) => o.id);
}
