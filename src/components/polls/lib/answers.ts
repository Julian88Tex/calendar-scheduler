// The voter's answers (SPEC MP-08): the Yes / If need be / No cycle, the ARIA state, and which options can still be
// selected (past options are frozen, full options can't be newly chosen, "Max choices per participant"). Pure and
// client safe; the server enforces the same rules in the vote transaction.
import type { VoteChoice } from "@/lib/polls/types";
import { pt } from "./t";

export type Answers = Record<string, VoteChoice>;

export function attending(c: VoteChoice | undefined | null): boolean {
  return c === "yes" || c === "if_need_be";
}

/** Click cycle: No -> Yes -> If need be -> No (If need be on); No <-> Yes (off). */
export function nextChoice(current: VoteChoice | undefined, allowIfNeedBe: boolean): VoteChoice {
  if (!current || current === "no") return "yes";
  if (current === "yes") return allowIfNeedBe ? "if_need_be" : "no";
  return "no";
}

/** aria-checked of the answer control: true (Yes), mixed (If need be), false (No). */
export function ariaChecked(c: VoteChoice | undefined): "true" | "mixed" | "false" {
  return c === "yes" ? "true" : c === "if_need_be" ? "mixed" : "false";
}

export function answerText(c: VoteChoice | undefined | null): string {
  return c === "yes" ? pt("common.yes") : c === "if_need_be" ? pt("common.ifNeedBe") : pt("common.no");
}

export function countAttending(a: Answers, optionIds?: readonly string[]): number {
  const ids = optionIds ?? Object.keys(a);
  return ids.filter((id) => attending(a[id])).length;
}

export type SelectState = { disabled: boolean; reason: string | null };

/**
 * Whether the voter can set `next` on an option: past options never change; a full option can't be newly chosen
 * (the voter's own stored selection may be removed and put back); the max choices limit blocks new selections.
 */
export function selectState(p: {
  optionId: string;
  isPast: boolean;
  isFull: boolean;
  current: Answers;
  stored: Answers;
  maxChoices: number | null;
  next: VoteChoice;
}): SelectState {
  if (p.isPast) return { disabled: true, reason: pt("voter.past") };
  const choosing = attending(p.next) && !attending(p.current[p.optionId]);
  if (!choosing) return { disabled: false, reason: null };
  if (p.isFull && !attending(p.stored[p.optionId])) return { disabled: true, reason: pt("voter.full") };
  if (p.maxChoices && p.maxChoices > 1 && countAttending(p.current) >= p.maxChoices) {
    return { disabled: true, reason: pt("voter.maxChoices", { n: p.maxChoices }) };
  }
  return { disabled: false, reason: null };
}

/** Applies a choice; with "Max choices" 1 (radio list) a new selection replaces the previous one. */
export function applyChoice(current: Answers, optionId: string, choice: VoteChoice, maxChoices: number | null): Answers {
  const out: Answers = { ...current };
  if (maxChoices === 1 && attending(choice)) {
    for (const id of Object.keys(out)) if (id !== optionId && attending(out[id])) out[id] = "no";
  }
  out[optionId] = choice;
  return out;
}

/** The votes payload: every future option with an explicit answer (missing ones are No). */
export function votesPayload(answers: Answers, futureIds: readonly string[]): { optionId: string; choice: VoteChoice }[] {
  return futureIds.map((optionId) => ({ optionId, choice: answers[optionId] ?? "no" }));
}
