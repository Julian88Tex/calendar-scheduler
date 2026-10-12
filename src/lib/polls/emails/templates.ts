// Meeting poll email templates (SPEC MP-06, MP-23; research meeting-polls.md B10): Calendly-style content blocks from
// the shared email core, copy from the "poll-emails" namespace in the recipient's locale. Pure: every value (times
// already formatted in the recipient's zone, links already built) comes from the caller (notify.ts), and user text
// (titles, names, messages, comments) is always escaped by the block renderer.
import type { LocationKind } from "@/db/types";
import { renderEmail, type EmailBlock, type EmailBrand, type EmailField, type RenderedEmail } from "@/lib/email";
import { getT, type Translate } from "@/lib/i18n";
import type { VoteChoice } from "../types";

export type PollEmailBase = {
  locale: string;
  brand: EmailBrand;
  title: string;
  hostName: string;
};

/** An option line already formatted for the recipient ("Tuesday, October 20, 2026, 10:00am - 10:30am"). */
export type OptionLine = { label: string; choice?: VoteChoice | null; counts?: { yes: number; ifNeedBe: number } | null };

const MAX_LISTED = 5;

function tr(locale: string): Translate {
  return getT(locale, "poll-emails");
}

function choiceLabel(t: Translate, c: VoteChoice): string {
  return c === "yes" ? t("common.yes") : c === "if_need_be" ? t("common.ifNeedBe") : t("common.no");
}

function locationLabel(t: Translate, kind: LocationKind | null | undefined): string | null {
  if (!kind) return null;
  const key = `common.location_${kind}`;
  const v = t(key);
  return v === key ? null : v;
}

function timesCount(t: Translate, n: number): string {
  return n === 1 ? t("common.timesCountOne") : t("common.timesCount", { count: n });
}

function listLines(t: Translate, lines: readonly OptionLine[], max = MAX_LISTED): string[] {
  const shown = lines.slice(0, max).map((l) => (l.choice ? `${l.label}: ${choiceLabel(t, l.choice)}` : l.label));
  if (lines.length > max) shown.push(t("common.moreTimes", { count: lines.length - max }));
  return shown;
}

function countsLines(t: Translate, lines: readonly OptionLine[]): string[] {
  return lines.map((l) => (l.counts ? `${l.label} (${t("common.countsLine", { yes: l.counts.yes, ifNeedBe: l.counts.ifNeedBe })})` : l.label));
}

function respondedLine(t: Translate, respondents: number, invited: number | null): string {
  if (invited && invited > 0) return t("common.responded", { count: respondents, total: invited });
  return respondents === 1 ? t("common.respondedCountOne") : t("common.respondedCount", { count: respondents });
}

function participantFooter(t: Translate, unsubscribeUrl: string | null): { label: string; url: string }[] {
  return unsubscribeUrl ? [{ label: t("common.unsubscribe"), url: unsubscribeUrl }] : [];
}

function messageBlocks(t: Translate, hostName: string, message: string | null | undefined): EmailBlock[] {
  const m = message?.trim();
  return m ? [{ kind: "fields", items: [{ label: t("common.messageFrom", { hostName }), value: m }] }] : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Participant emails

export function invitationEmail(
  p: PollEmailBase & {
    name: string | null;
    subject?: string | null;
    message?: string | null;
    durationLabel: string | null;
    locationKind: LocationKind | null;
    options: OptionLine[];
    zoneLabel: string;
    deadline: string | null;
    voteUrl: string;
    unsubscribeUrl: string;
  },
): RenderedEmail {
  const t = tr(p.locale);
  const fields: EmailField[] = [];
  fields.push({ label: t("common.duration"), value: p.durationLabel ?? t("common.varies") });
  const loc = locationLabel(t, p.locationKind);
  if (loc) fields.push({ label: t("common.location"), value: loc });
  fields.push({ label: t("common.times"), value: timesCount(t, p.options.length) });
  if (p.deadline) fields.push({ label: t("common.votingCloses"), value: p.deadline });
  const blocks: EmailBlock[] = [
    ...(p.name ? [{ kind: "text" as const, text: t("invite.greeting", { name: p.name }) }] : []),
    { kind: "text", text: t("invite.intro", { hostName: p.hostName, title: p.title }) },
    ...messageBlocks(t, p.hostName, p.message),
    { kind: "fields", items: fields },
    { kind: "button", label: t("common.voteOnTimes"), url: p.voteUrl },
    { kind: "fields", items: [{ label: t("common.times"), lines: listLines(t, p.options) }] },
    { kind: "text", text: t("common.timesIn", { zone: p.zoneLabel }), muted: true, small: true },
  ];
  return renderEmail({
    subject: p.subject?.trim() || t("invite.subject", { hostName: p.hostName, title: p.title }),
    preheader: t("invite.intro", { hostName: p.hostName, title: p.title }),
    blocks,
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonInvited", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function reminderEmail(
  p: PollEmailBase & { name: string | null; deadline: string | null; options: OptionLine[]; zoneLabel: string; voteUrl: string; unsubscribeUrl: string },
): RenderedEmail {
  const t = tr(p.locale);
  const blocks: EmailBlock[] = [
    ...(p.name ? [{ kind: "text" as const, text: t("invite.greeting", { name: p.name }) }] : []),
    { kind: "text", text: t("reminder.intro", { hostName: p.hostName, title: p.title }) },
    ...(p.deadline ? [{ kind: "text" as const, text: t("reminder.deadline", { when: p.deadline }), bold: true }] : []),
    { kind: "button", label: t("common.voteOnTimes"), url: p.voteUrl },
    { kind: "fields", items: [{ label: t("common.times"), lines: listLines(t, p.options) }] },
    { kind: "text", text: t("common.timesIn", { zone: p.zoneLabel }), muted: true, small: true },
  ];
  return renderEmail({
    subject: t("reminder.subject", { hostName: p.hostName, title: p.title }),
    preheader: t("reminder.intro", { hostName: p.hostName, title: p.title }),
    blocks,
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonInvited", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function voterConfirmationEmail(
  p: PollEmailBase & { declined: boolean; selections: OptionLine[]; editUrl: string; unsubscribeUrl: string | null },
): RenderedEmail {
  const t = tr(p.locale);
  const lines = p.declined ? [t("confirmation.declined")] : p.selections.length ? p.selections.map((s) => (s.choice ? `${s.label}: ${choiceLabel(t, s.choice)}` : s.label)) : [t("confirmation.noTimes")];
  return renderEmail({
    subject: t("confirmation.subject", { title: p.title }),
    heading: t("confirmation.heading"),
    preheader: t("confirmation.intro"),
    blocks: [
      { kind: "text", text: t("confirmation.intro") },
      { kind: "text", text: p.title, bold: true },
      { kind: "fields", items: [{ label: t("confirmation.yourTimes"), lines }] },
      { kind: "button", label: t("common.reviewResponse"), url: p.editUrl },
    ],
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function othersVotedEmail(
  p: PollEmailBase & { respondents: number; invited: number | null; top: OptionLine[]; pollUrl: string; unsubscribeUrl: string },
): RenderedEmail {
  const t = tr(p.locale);
  const blocks: EmailBlock[] = [
    { kind: "text", text: t("othersVoted.intro", { title: p.title }) },
    { kind: "text", text: respondedLine(t, p.respondents, p.invited), bold: true },
  ];
  if (p.top.length) blocks.push({ kind: "fields", items: [{ label: t("common.topTimes"), lines: countsLines(t, p.top) }] });
  blocks.push({ kind: "button", label: t("common.viewPoll"), url: p.pollUrl });
  return renderEmail({
    subject: t("othersVoted.subject", { title: p.title }),
    preheader: t("othersVoted.intro", { title: p.title }),
    blocks,
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function commentEmail(
  p: PollEmailBase & { author: string; body: string; url: string; buttonLabel: "viewPoll" | "viewResults"; unsubscribeUrl: string | null; toHost: boolean },
): RenderedEmail {
  const t = tr(p.locale);
  return renderEmail({
    subject: t("comment.subject", { title: p.title }),
    preheader: t("comment.intro", { name: p.author, title: p.title }),
    blocks: [
      { kind: "text", text: t("comment.intro", { name: p.author, title: p.title }) },
      { kind: "notice", tone: "info", text: p.body },
      { kind: "button", label: t(`common.${p.buttonLabel}`), url: p.url },
    ],
    brand: p.brand,
    locale: p.locale,
    reason: p.toHost ? t("common.reasonHost") : t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function pollUpdatedEmail(p: PollEmailBase & { newTimes: OptionLine[]; zoneLabel: string; editUrl: string; unsubscribeUrl: string }): RenderedEmail {
  const t = tr(p.locale);
  return renderEmail({
    subject: t("updated.subject", { title: p.title }),
    preheader: t("updated.intro", { hostName: p.hostName, title: p.title }),
    blocks: [
      { kind: "text", text: t("updated.intro", { hostName: p.hostName, title: p.title }) },
      { kind: "fields", items: [{ label: t("updated.newTimes"), lines: listLines(t, p.newTimes) }] },
      { kind: "text", text: t("common.timesIn", { zone: p.zoneLabel }), muted: true, small: true },
      { kind: "button", label: t("common.updateResponse"), url: p.editUrl },
    ],
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function hostChangedVotesEmail(
  p: PollEmailBase & { kind: "edited" | "addedOnBehalf"; selections: OptionLine[]; editUrl: string; unsubscribeUrl: string },
): RenderedEmail {
  const t = tr(p.locale);
  const lines = p.selections.length ? p.selections.map((s) => (s.choice ? `${s.label}: ${choiceLabel(t, s.choice)}` : s.label)) : [t("confirmation.noTimes")];
  return renderEmail({
    subject: t(`${p.kind}.subject`, { hostName: p.hostName, title: p.title }),
    preheader: t(`${p.kind}.intro`, { hostName: p.hostName, title: p.title }),
    blocks: [
      { kind: "text", text: t(`${p.kind}.intro`, { hostName: p.hostName, title: p.title }) },
      { kind: "fields", items: [{ label: t("confirmation.yourTimes"), lines }] },
      { kind: "button", label: t("common.reviewResponse"), url: p.editUrl },
    ],
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

/** Participant notices without options: removed, reopened, poll canceled, a time chosen without them. */
export function participantNoticeEmail(
  p: PollEmailBase & { kind: "removed" | "reopened" | "canceled" | "timeChosen"; when?: string | null; url?: string | null; unsubscribeUrl: string | null },
): RenderedEmail {
  const t = tr(p.locale);
  const vars = { hostName: p.hostName, title: p.title, when: p.when ?? "" };
  const blocks: EmailBlock[] = [{ kind: "text", text: t(`${p.kind}.intro`, vars) }];
  if (p.url && p.kind === "reopened") blocks.push({ kind: "button", label: t("common.updateResponse"), url: p.url });
  return renderEmail({
    subject: t(`${p.kind}.subject`, vars),
    preheader: t(`${p.kind}.intro`, vars),
    blocks,
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonVoted", { hostName: p.hostName }),
    footerLinks: participantFooter(t, p.unsubscribeUrl),
  });
}

export function verificationCodeEmail(p: PollEmailBase & { code: string }): RenderedEmail {
  const t = tr(p.locale);
  return renderEmail({
    subject: t("code.subject", { code: p.code }),
    preheader: t("code.intro", { title: p.title }),
    blocks: [
      { kind: "text", text: t("code.intro", { title: p.title }) },
      { kind: "notice", tone: "info", text: p.code },
      { kind: "text", text: t("code.ignore"), muted: true, small: true },
    ],
    brand: p.brand,
    locale: p.locale,
  });
}

export function editLinkEmail(p: PollEmailBase & { invited: boolean; url: string }): RenderedEmail {
  const t = tr(p.locale);
  const intro = p.invited ? t("editLink.introInvited", { hostName: p.hostName, title: p.title }) : t("editLink.intro", { title: p.title });
  return renderEmail({
    subject: t("editLink.subject", { title: p.title }),
    preheader: intro,
    blocks: [
      { kind: "text", text: intro },
      { kind: "button", label: p.invited ? t("common.voteOnTimes") : t("common.reviewResponse"), url: p.url },
    ],
    brand: p.brand,
    locale: p.locale,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Host emails

export function voteReceivedEmail(
  p: PollEmailBase & {
    voterName: string;
    change: "voted" | "vote_changed" | "declined";
    answers: OptionLine[];
    top: OptionLine[];
    respondents: number;
    invited: number | null;
    resultsUrl: string;
    bookUrl: string | null;
  },
): RenderedEmail {
  const t = tr(p.locale);
  const intro =
    p.change === "declined"
      ? t("voteReceived.introDeclined", { name: p.voterName, title: p.title })
      : p.change === "vote_changed"
        ? t("voteReceived.introChanged", { name: p.voterName, title: p.title })
        : t("voteReceived.intro", { name: p.voterName, title: p.title });
  const answers = p.change === "declined" ? [t("voteReceived.noneWork")] : p.answers.length ? p.answers.map((a) => (a.choice ? `${a.label}: ${choiceLabel(t, a.choice)}` : a.label)) : [t("voteReceived.noneWork")];
  const blocks: EmailBlock[] = [
    { kind: "text", text: intro },
    { kind: "fields", items: [{ label: t("voteReceived.answers"), lines: answers }] },
    { kind: "fields", items: [{ label: t("common.topTimes"), lines: p.top.length ? countsLines(t, p.top) : [t("common.noAnswers")] }] },
    { kind: "text", text: respondedLine(t, p.respondents, p.invited), bold: true },
    { kind: "button", label: t("common.viewResults"), url: p.resultsUrl },
  ];
  if (p.bookUrl) blocks.push({ kind: "links", links: [{ label: t("common.bookThisTime"), url: p.bookUrl }] });
  return renderEmail({
    subject: t("voteReceived.subject", { name: p.voterName, title: p.title }),
    preheader: intro,
    blocks,
    brand: p.brand,
    locale: p.locale,
    reason: t("common.reasonHost"),
  });
}

export function digestEmail(
  p: Omit<PollEmailBase, "title" | "hostName"> & { polls: { title: string; votes: number; comments: number; top: OptionLine | null; url: string }[] },
): RenderedEmail {
  const t = tr(p.locale);
  const blocks: EmailBlock[] = [{ kind: "text", text: t("digest.intro") }];
  for (const poll of p.polls) {
    const lines = [t("digest.pollLine", { votes: poll.votes, comments: poll.comments })];
    if (poll.top) lines.push(`${t("votingClosed.topTime")}: ${countsLines(t, [poll.top])[0]}`);
    blocks.push({ kind: "fields", items: [{ label: poll.title, lines }] });
    blocks.push({ kind: "links", links: [{ label: t("common.viewResults"), url: poll.url }] });
  }
  return renderEmail({ subject: t("digest.subject"), preheader: t("digest.intro"), blocks, brand: p.brand, locale: p.locale, reason: t("common.reasonHost") });
}

/** Host status emails: voting closed, deadline approaching, ended without booking, auto-booked. */
export function hostStatusEmail(
  p: PollEmailBase & {
    kind: "votingClosed" | "deadlineWarning" | "ended" | "autoBooked";
    when?: string | null;
    respondents: number;
    invited: number | null;
    top: OptionLine | null;
    url: string;
  },
): RenderedEmail {
  const t = tr(p.locale);
  const vars = { title: p.title, when: p.when ?? "", hostName: p.hostName };
  const blocks: EmailBlock[] = [{ kind: "text", text: t(`${p.kind}.intro`, vars) }];
  if (p.kind !== "autoBooked") blocks.push({ kind: "text", text: respondedLine(t, p.respondents, p.invited), bold: true });
  if (p.top && p.kind !== "autoBooked" && p.kind !== "ended") blocks.push({ kind: "fields", items: [{ label: t("votingClosed.topTime"), lines: countsLines(t, [p.top]) }] });
  const action =
    p.kind === "votingClosed" ? t("common.bookNow") : p.kind === "deadlineWarning" ? t("deadlineWarning.action") : p.kind === "ended" ? t("ended.action") : t("common.viewMeeting");
  blocks.push({ kind: "button", label: action, url: p.url });
  return renderEmail({ subject: t(`${p.kind}.subject`, vars), preheader: t(`${p.kind}.intro`, vars), blocks, brand: p.brand, locale: p.locale, reason: t("common.reasonHost") });
}
