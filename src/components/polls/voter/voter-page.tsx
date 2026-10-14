// The public voter page /p/{slug} (SPEC MP-07 to MP-15, MP-29, MP-30; research B5, B17): the booking page shell with
// the poll details on the left and, on the right, the options in the voter's own time zone (time zone picker, or "Times
// are shown in {zone}" in fixed mode), the answer controls, vote summaries when the poll shows them, "Check my
// calendar", the sticky "{n} preferred times" / "Share times" footer, "None of these work for me", the details step,
// the confirmation with "Edit your preferred times", comments, and the read-only states (closed, booked, ended).
//
// Identity and editing later: the server identifies the voter by the edit cookie, the ?i= invite link or the signed-in
// account. Inside embeds the edit token is mirrored in localStorage and sent back in the fallback header (all calls go
// through the public route handlers, see ./api.ts), so returning on the same device shows "Edit your preferred times"
// there too. Unsent answers survive a reload and the Google calendar check round trip (sessionStorage). Client
// component.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { BookingCard, BookingMainSection, BookingPanelHeading } from "@/components/public/booking-card";
import { useBrowserZone, useTimeFormat, rememberTimeFormat } from "@/components/booking/use-browser-env";
import { createTurnstileRunner, type TurnstileRunner } from "@/components/booking/lib/turnstile";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimeZoneButton } from "@/components/ui/time-zone-select";
import { toast } from "@/components/ui/toast";
import { readFallbackCookie } from "@/lib/client/embed-cookie";
import { isInIframe, postPageHeight } from "@/lib/embed-events";
import { EDIT_COOKIE, POLL_COPY } from "@/lib/polls/constants";
import { groupOptionsByLocalDate } from "@/lib/polls/display";
import type { VoteChoice, VoterCalendarCheck, VoterPollView } from "@/lib/polls/types";
import { looksLikeEmail } from "@/lib/polls/validation";
import { friendlyZoneName } from "@/lib/time/zones";
import { CommentsThread } from "../comments";
import { applyChoice, attending, countAttending, selectState, votesPayload, type Answers } from "../lib/answers";
import { relativeTime } from "../lib/format";
import { pt, ptCount } from "../lib/t";
import type { VoterPageProps } from "../types";
import { addComment, deleteComment, fetchVoterView, requestCode, submitVote } from "./api";
import { CalendarCheck } from "./calendar-check";
import { DetailsStep, type DetailsValues } from "./details-step";
import { OptionRow } from "./option-row";
import { VoterSidePanel } from "./side-panel";
import { AnswerSummary, BookedPanel, DonePanel, MessagePanel } from "./state-panels";
import { VoterGrid } from "./voter-grid";
import { AnswerIcon } from "../answer-icon";

type Stage = "select" | "details" | "done";

type SessionDraft = { answers: Answers; values: Partial<DetailsValues>; inviteToken: string | null; savedAt: number };

const draftKey = (slug: string) => `kairos:poll-vote:${slug}`;

function readSession(slug: string): SessionDraft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug));
    if (!raw) return null;
    const v = JSON.parse(raw) as SessionDraft;
    if (!v || typeof v !== "object" || Date.now() - (v.savedAt ?? 0) > 6 * 3_600_000) return null;
    return v;
  } catch {
    return null;
  }
}

function writeSession(slug: string, d: SessionDraft | null): void {
  try {
    if (d) window.sessionStorage.setItem(draftKey(slug), JSON.stringify(d));
    else window.sessionStorage.removeItem(draftKey(slug));
  } catch {
    // blocked storage
  }
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function initialStage(view: VoterPollView): Stage {
  return view.me?.submitted ? "done" : "select";
}

export function VoterPage(props: VoterPageProps) {
  const { slug, shell } = props;
  const [view, setView] = useState<VoterPollView>(props.view);
  const [inviteToken, setInviteToken] = useState<string | null>(props.inviteToken);
  const browserZone = useBrowserZone();
  const timeFormat = useTimeFormat();
  const hour12 = (timeFormat ?? "12h") === "12h";
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const fixed = view.poll.timeZoneMode === "fixed";
  const zone = fixed ? view.poll.timezone : (zoneChoice ?? browserZone ?? view.poll.timezone);
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(props.view.me?.votes ?? {}) }));
  const [stage, setStage] = useState<Stage>(() => initialStage(props.view));
  const [declining, setDeclining] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [check, setCheck] = useState<VoterCalendarCheck | null>(props.calendarCheck);
  const [values, setValues] = useState<DetailsValues>(() => ({
    name: props.view.me?.name ?? props.view.prefill?.name ?? "",
    email: props.view.me?.email ?? props.view.prefill?.email ?? "",
    comment: "",
    subscribe: props.view.me?.subscribed ?? false,
    code: "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof DetailsValues | "form", string>>>({});
  const [formExpired, setFormExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [codeStep, setCodeStep] = useState<{ sentTo: string } | null>(null);
  const [resending, setResending] = useState(false);
  const [answersError, setAnswersError] = useState<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const requestId = useRef<string>(newRequestId());
  const panelRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const now = useNow();

  const poll = view.poll;
  const preview = view.viewerIsHost;
  const canVote = view.canVote && poll.status === "open";
  const stored = useMemo(() => view.me?.votes ?? {}, [view.me]);
  const future = useMemo(() => view.options.filter((o) => !o.isPast), [view.options]);
  const futureIds = useMemo(() => future.map((o) => o.id), [future]);
  const single = poll.maxChoicesPerParticipant === 1;
  const selectedCount = countAttending(answers, futureIds);
  const groups = useMemo(() => groupOptionsByLocalDate(view.options, zone, poll.timezone), [view.options, zone, poll.timezone]);
  const showDuration = poll.durationMinutes === null;
  const unknown = new Set(view.me?.unknownOptionIds ?? []);
  const showGridToggle = Boolean(view.participants && view.participants.some((x) => !x.isYou));

  // Turnstile (instance setting): loaded ahead of the details step.
  useEffect(() => {
    if (!props.turnstileSiteKey) return;
    const runner = createTurnstileRunner(props.turnstileSiteKey);
    turnstile.current = runner;
    runner.preload();
    return () => runner.dispose();
  }, [props.turnstileSiteKey]);

  const refresh = useCallback(
    async (token: string | null = inviteToken) => {
      const res = await fetchVoterView(slug, token);
      if (res.ok) {
        setView(res.view);
        return res.view;
      }
      return null;
    },
    [slug, inviteToken],
  );

  // Restore unsent answers (reload, calendar check round trip) and, inside embeds, the response stored on this device.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    // After the first paint: storage is client only, and state updates belong outside the effect body.
    void Promise.resolve().then(() => {
    const draft = readSession(slug);
    const restore = (v: VoterPollView) => {
      if (draft && canVoteOf(v)) {
        setAnswers((a) => ({ ...a, ...draft.answers }));
        setValues((x) => ({ ...x, ...draft.values, name: v.prefill?.locked ? x.name : (draft.values.name ?? x.name), email: v.prefill?.locked || v.me?.email ? x.email : (draft.values.email ?? x.email) }));
        if (v.me?.submitted) setStage("select");
      }
    };
    const token = !props.inviteToken && draft?.inviteToken ? draft.inviteToken : null;
    if (token) setInviteToken(token);
    if ((shell.embed || isInIframe()) && !props.view.me && readFallbackCookie(EDIT_COOKIE)) {
      void refresh(token ?? props.inviteToken).then((v) => {
        if (v?.me) {
          setAnswers({ ...v.me.votes });
          setValues((x) => ({ ...x, name: v.me!.name, email: v.me!.email ?? x.email, subscribe: v.me!.subscribed }));
          setStage(v.me.submitted ? "done" : "select");
        }
        if (v) restore(v);
      });
    } else if (token) {
      void refresh(token).then((v) => {
        if (v?.prefill) setValues((x) => ({ ...x, name: v.prefill!.name, email: v.prefill!.email }));
        if (v) restore(v);
      });
    } else restore(props.view);
    if (draft) writeSession(slug, null);
    });
  }, [slug, shell.embed, props.view, props.inviteToken, refresh]);

  // Calendar check result after the Google round trip.
  useEffect(() => {
    if (props.flags.calendarChecked) toast.success(pt("voter.calendarChecked"));
  }, [props.flags.calendarChecked]);

  // Inline embeds: report the height to the parent page.
  useEffect(() => {
    if (!shell.embed || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => postPageHeight());
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [shell.embed]);

  // Move focus to the new panel heading on stage changes (screen readers hear the new step).
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [stage]);

  const saveSession = useCallback(() => {
    writeSession(slug, { answers, values: { name: values.name, email: values.email, comment: values.comment, subscribe: values.subscribe }, inviteToken, savedAt: Date.now() });
  }, [slug, answers, values, inviteToken]);

  const blockedReason = useCallback(
    (optionId: string, next: VoteChoice): string | null => {
      const o = view.options.find((x) => x.id === optionId);
      if (!o) return null;
      return selectState({ optionId, isPast: o.isPast, isFull: o.isFull, current: answers, stored, maxChoices: poll.maxChoicesPerParticipant, next }).reason;
    },
    [view.options, answers, stored, poll.maxChoicesPerParticipant],
  );

  const choose = (optionId: string, next: VoteChoice) => {
    setAnswersError(null);
    setAnswers((a) => applyChoice(a, optionId, next, poll.maxChoicesPerParticipant));
  };

  const markFree = check
    ? () => {
        let next = { ...answers };
        for (const o of future) {
          if (check.statuses[o.id] !== "free" || attending(next[o.id])) continue;
          if (selectState({ optionId: o.id, isPast: o.isPast, isFull: o.isFull, current: next, stored, maxChoices: poll.maxChoicesPerParticipant, next: "yes" }).disabled) continue;
          next = applyChoice(next, o.id, "yes", poll.maxChoicesPerParticipant);
        }
        setAnswers(next);
      }
    : null;

  const goDetails = (decline: boolean) => {
    if (!decline && selectedCount === 0) {
      setAnswersError(pt("voter.selectedNone"));
      return;
    }
    setDeclining(decline);
    setErrors({});
    setStage("details");
    window.scrollTo?.({ top: 0 });
  };

  const emailLocked = Boolean(view.me?.email) || Boolean(view.prefill?.locked);
  const nameLocked = Boolean(view.prefill?.locked && view.prefill.name);
  const needsCode = poll.verifyEmail && !view.me?.emailVerified && !(view.me && inviteToken);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!values.name.trim()) next.name = "Enter your name.";
    const email = values.email.trim();
    if (poll.requireEmail && !email) next.email = "Enter your email.";
    else if (email && !looksLikeEmail(email)) next.email = "Enter a valid email address.";
    if (codeStep && values.code.length !== 6) next.code = "Enter the 6-digit code we sent to your email.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const sendCode = async (): Promise<boolean> => {
    const email = values.email.trim();
    const res = await requestCode(slug, { email, name: values.name.trim() || null });
    if (!res.ok) {
      setErrors({ form: res.message });
      return false;
    }
    if (!res.required) return true;
    setCodeStep({ sentTo: email });
    return false;
  };

  const submit = async () => {
    if (preview || submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    setErrors({});
    try {
      if (needsCode && values.email.trim() && !codeStep) {
        const proceed = await sendCode();
        if (!proceed) return;
      }
      let turnstileToken: string | null = null;
      if (turnstile.current) {
        try {
          turnstileToken = await turnstile.current.token(turnstileRef.current);
        } catch {
          setErrors({ form: "We couldn't verify you're not a robot. Try again." });
          return;
        }
      }
      const res = await submitVote(slug, {
        name: values.name.trim(),
        email: values.email.trim() || null,
        timezone: fixed ? (browserZone ?? poll.timezone) : zone,
        locale: "en",
        votes: declining ? [] : votesPayload(answers, futureIds),
        declined: declining,
        comment: !declining && poll.allowComments && values.comment.trim() ? values.comment.trim() : null,
        subscribe: !declining && poll.canSubscribe ? values.subscribe : false,
        inviteToken,
        verificationCode: codeStep ? values.code : null,
        website: honeypotRef.current?.value ?? "",
        formToken: props.formToken,
        turnstileToken,
        requestId: requestId.current,
        embed: shell.embed || isInIframe(),
      });
      if (!res.ok) {
        requestId.current = newRequestId();
        if (res.code === "verification_required") {
          setCodeStep({ sentTo: values.email.trim() });
          if (!codeStep) await sendCode();
          setErrors({ code: res.message });
          return;
        }
        if (res.code === "bot") setFormExpired(true);
        if (res.code === "closed" || res.code === "full" || res.code === "max_choices") {
          await refresh();
          if (res.code !== "closed") setStage("select");
          setAnswersError(res.message);
          return;
        }
        const fe = res.fieldErrors ?? {};
        const next: typeof errors = {
          name: fe.name?.[0],
          email: fe.email?.[0],
          comment: fe.comment?.[0],
          code: fe.verificationCode?.[0],
        };
        if (!next.name && !next.email && !next.comment && !next.code) next.form = res.message;
        setErrors(next);
        return;
      }
      requestId.current = newRequestId();
      writeSession(slug, null);
      const fresh = await refresh();
      if (fresh?.me) {
        setAnswers({ ...fresh.me.votes });
        setValues((x) => ({ ...x, name: fresh.me!.name, email: fresh.me!.email ?? x.email, comment: "", code: "" }));
      }
      setCodeStep(null);
      setStage("done");
      window.scrollTo?.({ top: 0 });
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Rendering

  const side = (
    <VoterSidePanel
      hosts={poll.hosts}
      title={poll.title}
      durationMinutes={poll.durationMinutes}
      location={poll.location}
      deadline={poll.deadline}
      descriptionHtml={poll.descriptionHtml}
      zone={zone}
      hour12={hour12}
      fixedZoneName={fixed ? friendlyZoneName(poll.timezone) : null}
      logoUrl={shell.logoUrl}
      operatorEmail={shell.operatorEmail}
      privacyUrl={shell.privacyUrl}
      showFooter={!shell.embed}
    />
  );

  const comments =
    view.comments && poll.allowComments ? (
      <CommentsThread
        className="mt-10 border-t border-line pt-6"
        comments={view.comments}
        now={now}
        note={poll.commentsHostOnly ? pt("voter.hostOnlyComments") : null}
        composer={
          canVote && !preview
            ? {
                needName: !view.me && !view.prefill,
                onSubmit: async ({ body, name }) => {
                  const res = await addComment(slug, { body, name, inviteToken });
                  if (!res.ok) return { ok: false, message: res.message, fieldErrors: res.fieldErrors };
                  await refresh();
                  toast.success(pt("voter.commentAdded"));
                  return { ok: true };
                },
              }
            : null
        }
        onDelete={async (id) => {
          const res = await deleteComment(slug, id, inviteToken);
          if (!res.ok) toast.error(res.message);
          else {
            await refresh();
            toast.success(pt("voter.commentDeleted"));
          }
        }}
      />
    ) : null;

  const banners = (
    <div className="flex flex-col gap-3 empty:hidden">
      {preview && (
        <Banner
          variant="info"
          action={
            props.resultsHref ? (
              <Button asChild size="sm" variant="secondary">
                <a href={props.resultsHref}>{pt("voter.previewResults")}</a>
              </Button>
            ) : undefined
          }
        >
          {pt("voter.previewBanner")}
        </Banner>
      )}
      {props.flags.linkExpired && (
        <Banner variant="warning" title={pt("voter.linkExpired")}>
          {pt("voter.linkExpiredHint")}
        </Banner>
      )}
      {props.flags.oauthError && <Banner variant="error">{props.flags.oauthError}</Banner>}
      {canVote && poll.deadlineSoon && poll.deadline && <Banner variant="warning">{pt("voter.votingClosesSoon", { relative: relativeTime(poll.deadline, now) })}</Banner>}
      {canVote && stage === "select" && view.me?.overLimit && poll.maxChoicesPerParticipant && (
        <Banner variant="warning">{pt("voter.overLimit", { n: poll.maxChoicesPerParticipant })}</Banner>
      )}
      {canVote && stage === "select" && view.me?.submitted && (view.me.unknownOptionIds.length ?? 0) > 0 && <Banner variant="info">{pt("voter.unknownOptions")}</Banner>}
    </div>
  );

  let main: React.ReactNode;
  if (poll.status === "booked" && view.booked) {
    main = (
      <BookingMainSection>
        {banners}
        <div className="mt-2">
          <BookedPanel booked={view.booked} zone={zone} hour12={hour12} location={poll.location} />
        </div>
        {view.me?.submitted && (
          <div className="mx-auto mt-8 max-w-[440px]">
            <p className="mb-2 text-eyebrow text-ink-2">{pt("voter.yourAnswers")}</p>
            <AnswerSummary options={view.options} votes={view.me.votes} zone={zone} pollZone={poll.timezone} hour12={hour12} />
          </div>
        )}
        {comments}
      </BookingMainSection>
    );
  } else if (!canVote) {
    const ended = poll.status === "expired";
    main = (
      <BookingMainSection>
        {banners}
        <div className="mt-2">
          <MessagePanel kind={ended ? "ended" : "closed"} title={ended ? pt("voter.expiredTitle") : pt("voter.closedTitle")} hint={ended ? pt("voter.expiredHint") : pt("voter.closedHint")}>
            {view.me?.submitted && (
              <div className="mx-auto max-w-[440px]">
                <p className="mb-2 text-eyebrow text-ink-2">{pt("voter.yourAnswers")}</p>
                <AnswerSummary options={view.options} votes={view.me.votes} zone={zone} pollZone={poll.timezone} hour12={hour12} />
              </div>
            )}
          </MessagePanel>
        </div>
        {!ended && view.options.some((o) => o.counts) && (
          <div className="mt-8 flex flex-col gap-2">
            {groups.map((g) => (
              <section key={g.date} aria-label={g.label} className="flex flex-col gap-2">
                <h3 className="text-title-sm text-public-text">{g.label}</h3>
                {g.options.map((o) => (
                  <OptionRow
                    key={o.id}
                    option={o}
                    dateLabel={g.label}
                    zone={zone}
                    hour12={hour12}
                    showDuration={showDuration}
                    value={stored[o.id]}
                    allowIfNeedBe={poll.allowIfNeedBe}
                    single={single}
                    blockedReason={() => null}
                    onChange={() => undefined}
                    readOnly
                    freeBusy={null}
                    isNew={false}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {comments}
      </BookingMainSection>
    );
  } else if (stage === "done" && view.me) {
    main = (
      <BookingMainSection>
        {banners}
        <div className="mt-2">
          <DonePanel
            declined={view.me.status === "declined"}
            options={view.options}
            votes={view.me.votes}
            zone={zone}
            pollZone={poll.timezone}
            hour12={hour12}
            hasEmail={Boolean(view.me.email)}
            canEdit={canVote}
            onEdit={() => {
              setAnswers({ ...view.me!.votes });
              setDeclining(false);
              setStage("select");
            }}
          />
        </div>
        {comments}
      </BookingMainSection>
    );
  } else if (stage === "details") {
    main = (
      <BookingMainSection>
        <DetailsStep
          declining={declining}
          values={values}
          onChange={(v) => setValues((x) => ({ ...x, ...v }))}
          errors={errors}
          emailRequired={poll.requireEmail}
          emailLocked={emailLocked}
          nameLocked={nameLocked}
          lockedNote={view.prefill?.locked && view.prefill.email ? pt(view.me ? "voter.readOnlyIdentity" : "voter.signedInAs", { email: view.prefill.email }) : null}
          allowComment={poll.allowComments}
          canSubscribe={poll.canSubscribe}
          codeStep={codeStep}
          resending={resending}
          onResendCode={async () => {
            setResending(true);
            try {
              const res = await requestCode(slug, { email: values.email.trim(), name: values.name.trim() || null });
              if (res.ok) toast.success(pt("voter.verifySent"));
              else setErrors({ code: res.message });
            } finally {
              setResending(false);
            }
          }}
          submitting={submitting}
          preview={preview}
          formExpired={formExpired}
          summary={
            <div className="rounded-[var(--radius-card)] border border-line p-4">
              <p className="mb-2 text-eyebrow text-ink-2">{pt("voter.chosenTimes")}</p>
              <AnswerSummary options={future} votes={answers} zone={zone} pollZone={poll.timezone} hour12={hour12} />
            </div>
          }
          onBack={() => setStage("select")}
          onSubmit={() => void submit()}
          honeypotRef={honeypotRef}
          turnstileRef={turnstileRef}
          showTurnstile={Boolean(props.turnstileSiteKey)}
        />
      </BookingMainSection>
    );
  } else {
    main = (
      <div className="flex min-h-full flex-col">
        <BookingMainSection className="flex-1 pb-4">
          {banners}
          <div className="mt-1 flex flex-col gap-1">
            <BookingPanelHeading>{pt("voter.heading")}</BookingPanelHeading>
            <p className="text-body-md text-ink-2">{pt("voter.subtext")}</p>
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            {fixed ? (
              <p className="text-body-md text-ink-2" data-testid="fixed-zone">
                {pt("voter.timesShownIn", { zone: friendlyZoneName(poll.timezone) })}
              </p>
            ) : (
              <TimeZoneButton value={zone} onChange={setZoneChoice} hour12={hour12} onHour12Change={(h) => rememberTimeFormat(h ? "12h" : "24h")} />
            )}
            {!preview && (
              <CalendarCheck
                slug={slug}
                embed={shell.embed}
                googleStartPath={view.calendarCheck.googleStartPath}
                account={view.calendarCheck.account}
                check={check}
                now={now}
                onChange={setCheck}
                onBeforeNavigate={saveSession}
                onMarkFree={markFree}
              />
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {poll.allowIfNeedBe ? (
              <ul aria-label={pt("voter.legendLabel")} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-2" data-testid="answer-legend">
                <li className="flex items-center gap-1.5">
                  <AnswerIcon value="yes" size={16} />
                  {pt("voter.legendYes")}
                </li>
                <li className="flex items-center gap-1.5">
                  <AnswerIcon value="if_need_be" size={16} />
                  {pt("voter.legendIfNeedBe")}
                </li>
                <li className="flex items-center gap-1.5">
                  <AnswerIcon value="no" size={16} />
                  {pt("voter.legendNo")}
                </li>
              </ul>
            ) : (
              <span />
            )}
            {showGridToggle && (
              <SegmentedControl
                aria-label={pt("voter.viewToggle")}
                size="sm"
                value={layout}
                onValueChange={setLayout}
                options={[
                  { value: "list", label: pt("voter.listView") },
                  { value: "grid", label: pt("voter.gridView") },
                ]}
              />
            )}
          </div>

          {single && <p className="mt-3 text-body-md text-ink-2">{pt("voter.singleChoiceHint")}</p>}
          {poll.maxChoicesPerParticipant && poll.maxChoicesPerParticipant > 1 && <p className="mt-3 text-body-md text-ink-2">{pt("voter.maxChoices", { n: poll.maxChoicesPerParticipant })}</p>}
          {view.respondentCount !== null && view.respondentCount > 0 && (
            <p className="mt-3 text-body-sm text-ink-2">{ptCount(view.respondentCount, "voter.respondent", "voter.respondents")}</p>
          )}

          {view.options.length === 0 ? (
            <p className="mt-6 text-body-md text-ink-2">{pt("voter.noOptions")}</p>
          ) : layout === "grid" && view.participants ? (
            <div className="mt-5">
              <VoterGrid
                options={view.options}
                pollZone={poll.timezone}
                zone={zone}
                hour12={hour12}
                participants={view.participants}
                answers={answers}
                allowIfNeedBe={poll.allowIfNeedBe}
                single={single}
                editable={!preview}
                blockedReason={blockedReason}
                onChange={choose}
              />
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-6" role={single ? "radiogroup" : undefined} aria-label={single ? pt("voter.heading") : undefined}>
              {groups.map((g) => (
                <section key={g.date} aria-labelledby={`date-${g.date}`} className="flex flex-col gap-2">
                  <h3 id={`date-${g.date}`} className="text-title-sm text-public-text" data-testid="option-date">
                    {g.label}
                  </h3>
                  {g.options.map((o) => (
                    <OptionRow
                      key={o.id}
                      option={o}
                      dateLabel={g.label}
                      zone={zone}
                      hour12={hour12}
                      showDuration={showDuration}
                      value={answers[o.id]}
                      allowIfNeedBe={poll.allowIfNeedBe}
                      single={single}
                      blockedReason={(next) => blockedReason(o.id, next)}
                      onChange={(next) => choose(o.id, next)}
                      readOnly={false}
                      freeBusy={check?.statuses[o.id] ?? null}
                      isNew={Boolean(view.me?.submitted) && unknown.has(o.id)}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}

          {future.length >= 3 && selectedCount === 1 && !single && (
            <p className="mt-4 text-body-md text-ink-2" role="status">
              {POLL_COPY.singleSpotWarning.trim()}
            </p>
          )}
          {comments}
        </BookingMainSection>

        <div className="sticky bottom-0 z-10 border-t border-line bg-public-bg px-5 py-3 min-[600px]:px-8" data-testid="vote-footer">
          {answersError && (
            <p className="mb-2 text-body-sm text-danger-text" role="alert">
              {answersError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-label text-public-text" aria-live="polite" data-testid="preferred-count">
              {ptCount(selectedCount, "voter.preferredTime", "voter.preferredTimes")}
            </p>
            <Button type="button" onClick={() => goDetails(false)} disabled={selectedCount === 0} data-testid="share-times">
              {pt("voter.shareTimes")}
            </Button>
          </div>
          {future.length > 0 && (
            <button type="button" onClick={() => goDetails(true)} className="mt-2 text-body-md font-semibold text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-brand">
              {pt("voter.decline")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <BookingCard side={side} ribbon={shell.ribbon && !shell.embed} embed={shell.embed} className="min-[1000px]:max-w-[1060px] min-[1000px]:[&_aside]:w-[38%]">
      <div ref={panelRef} className="h-full">
        {main}
      </div>
    </BookingCard>
  );
}

function canVoteOf(v: VoterPollView): boolean {
  return v.canVote && v.poll.status === "open";
}
