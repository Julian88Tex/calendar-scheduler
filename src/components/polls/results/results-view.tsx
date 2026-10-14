// The meeting poll results page /app/polls/{id} (SPEC MP-16, MP-17, MP-18, MP-21, MP-25; research B6, B7, B8).
//
// Header: back to Meeting polls, title and status badge, "{r} of {i} responded", the deadline countdown, duration,
// location and hosts; "Copy link", "Invite people", "Edit", "Close voting" / "Reopen voting" / "Reopen poll" and the
// kebab (Duplicate, Export CSV, Delete poll). Banners: the booked meeting ("View meeting"), a canceled meeting with
// "Reopen poll", a reopened poll whose meeting stays, reserved times (clear, retry). Views "Top times" (default) and
// "Grid" (remembered per browser), the zone picker, and the side sections "Not responded yet", "Comments" and
// "Activity". Live updates every 15 seconds while the page is visible, with "{Name} voted" toasts. Deep links:
// ?book={optionId} opens the Book dialog, ?duplicate=1 offers to duplicate. Client component.
"use client";

import { CalendarCheck, Clock, Link as LinkIcon, Pencil, UserPlus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { AvatarGroup } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/client/use-copy";
import { cn } from "@/lib/cn";
import {
  addHostCommentAction,
  clearHoldsAction,
  deleteHostCommentAction,
  duplicatePollAction,
  invitePeopleAction,
  pollActivityAction,
  retryHoldsAction,
  sendRemindersAction,
  updateParticipantAction,
  updatePollAction,
} from "@/lib/polls/actions";
import type { HostParticipantView, PollActivityView, VoteChoice } from "@/lib/polls/types";
import { formatDateLong, formatTimeRange } from "@/lib/time/format";
import { LocationLine } from "../voter/side-panel";
import { CommentsThread } from "../comments";
import { activityText, liveToast } from "../lib/activity";
import { failureMessage, unwrap } from "../lib/action";
import { durationLabel, hostNamesLabel, relativeTime, responsesLabel } from "../lib/format";
import { pt, ptCount } from "../lib/t";
import { PollDialogs, PollMenu, type PollDialogName, type PollMenuPoll } from "../poll-menu";
import { PollStatusBadge } from "../status-badge";
import type { ResultsPageProps } from "../types";
import { BookDialog } from "./book-dialog";
import { AddParticipantDialog, EditVotesDialog, RemoveParticipantDialog } from "./participant-dialogs";
import { ResultsGrid, type RowAction } from "./results-grid";
import { TopTimes } from "./top-times";

const VIEW_KEY = "kairos:poll-results-view";
const LIVE_MS = 15_000;

const subscribeView = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

function readView(): "top" | "grid" {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "top";
  } catch {
    return "top";
  }
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ResultsView({ data, viewer, bookOptionId, offerDuplicate }: ResultsPageProps) {
  const router = useRouter();
  const now = useNow();
  const poll = data.poll;
  const s = poll.settings;
  const [zone, setZone] = useState(viewer.timezone);
  const storedTab = useSyncExternalStore(subscribeView, readView, () => "top" as const);
  const [tabChoice, setTab] = useState<"top" | "grid" | null>(null);
  const tab = tabChoice ?? storedTab;
  const [book, setBook] = useState<string | null>(bookOptionId);
  const [dialog, setDialog] = useState<PollDialogName>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(offerDuplicate);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<HostParticipantView | null>(null);
  const [removing, setRemoving] = useState<HostParticipantView | null>(null);
  const [reminding, setReminding] = useState(false);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [holdsBusy, setHoldsBusy] = useState(false);
  const [prefsOverride, setPrefs] = useState<Record<string, VoteChoice> | null>(null);
  const prefs = prefsOverride ?? s.hostPreferences;
  const lastSeen = useRef<string>(data.activity[0]?.createdAt ?? new Date().toISOString());
  const refresh = useCallback(() => router.refresh(), [router]);


  // Drop the deep link parameters once handled (a refresh does not reopen the dialogs).
  useEffect(() => {
    if (!bookOptionId && !offerDuplicate) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    url.searchParams.delete("duplicate");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [bookOptionId, offerDuplicate]);

  // Live updates (MP-16): new votes and comments since the last seen activity.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await pollActivityAction({ pollId: poll.id, since: lastSeen.current });
      if (stopped || !res.ok || !res.data.length) return;
      const fresh = [...res.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      lastSeen.current = fresh[fresh.length - 1]!.createdAt;
      for (const a of fresh) {
        const msg = liveToast(a);
        if (msg) toast.info(msg);
      }
      refresh();
    };
    const t = setInterval(() => void tick(), LIVE_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [poll.id, refresh]);

  useEffect(() => {
    if (data.activity[0] && data.activity[0].createdAt > lastSeen.current) lastSeen.current = data.activity[0].createdAt;
  }, [data.activity]);

  const active = poll.status === "open" || poll.status === "closed";
  const canBook = active;
  const meeting = data.booked;
  const meetingEnd = meeting && !meeting.allDayDate ? meeting.end : null;
  const menuPoll: PollMenuPoll = {
    id: poll.id,
    title: poll.title,
    status: poll.status,
    canDelete: data.canDelete,
    respondents: data.counts.respondents,
    deadline: s.deadline,
    meeting: meeting ? { start: meeting.start, end: meetingEnd, status: meeting.status } : null,
  };
  const whenOf = (start: string, end: string | null) => (end ? `${formatDateLong(start, zone)}, ${formatTimeRange(start, end, zone, "en", viewer.hour12)}` : formatDateLong(start, zone));
  const hasRequired = data.participants.some((x) => x.isRequired);
  const notResponded = data.participants.filter((x) => x.status === "invited");

  const rowAction = async (x: HostParticipantView, action: RowAction) => {
    try {
      if (action === "edit") setEditing(x);
      else if (action === "remove") setRemoving(x);
      else if (action === "copy_email" && x.email) {
        if (await copyText(x.email)) toast.success(pt("results.emailCopied"));
      } else if (action === "required") {
        await unwrap(updateParticipantAction({ pollId: poll.id, participantId: x.id, isRequired: !x.isRequired }));
        toast.success(pt("results.requiredSaved"));
        refresh();
      } else if (action === "resend" && x.email) {
        await unwrap(invitePeopleAction({ pollId: poll.id, recipients: [{ email: x.email, name: x.name, required: x.isRequired }] }));
        toast.success(pt("invite.sentOne"));
        refresh();
      } else if (action === "remind") {
        const out = await unwrap(sendRemindersAction({ pollId: poll.id, participantIds: [x.id] }));
        toast[out.sent ? "success" : "info"](out.sent ? pt("results.reminderSentOne") : pt("results.reminderThrottled"));
        refresh();
      }
    } catch (e) {
      toast.error(failureMessage(e));
    }
  };

  const savePreference = async (optionId: string, choice: VoteChoice) => {
    const next = { ...prefs, [optionId]: choice };
    setPrefs(next);
    try {
      const res = await unwrap(updatePollAction({ pollId: poll.id, hostPreferences: next }));
      if (res.done) refresh();
    } catch (e) {
      setPrefs(prefsOverride);
      toast.error(failureMessage(e));
    }
  };

  const setCountPreference = async (on: boolean) => {
    try {
      await unwrap(updatePollAction({ pollId: poll.id, countHostPreference: on }));
      toast.success(pt("results.requiredSaved"));
      refresh();
    } catch (e) {
      toast.error(failureMessage(e));
    }
  };

  const remindAll = async () => {
    setReminding(true);
    try {
      const out = await unwrap(sendRemindersAction({ pollId: poll.id }));
      toast[out.sent ? "success" : "info"](out.sent ? (out.sent === 1 ? pt("results.reminderSentOne") : pt("results.remindersSent")) : pt("results.reminderThrottled"));
      refresh();
    } catch (e) {
      toast.error(failureMessage(e));
    } finally {
      setReminding(false);
    }
  };

  const holds = data.holds;
  const holdsBanner =
    holds.enabled && active ? (
      <Banner
        variant={holds.failed ? "warning" : "info"}
        role="status"
        action={
          <div className="flex gap-2">
            {holds.failed > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={holdsBusy}
                onClick={async () => {
                  setHoldsBusy(true);
                  try {
                    await unwrap(retryHoldsAction({ pollId: poll.id }));
                    refresh();
                  } catch (e) {
                    toast.error(failureMessage(e));
                  } finally {
                    setHoldsBusy(false);
                  }
                }}
              >
                {pt("results.retryHolds")}
              </Button>
            )}
            {holds.active + holds.pending + holds.failed > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={holdsBusy}
                onClick={async () => {
                  setHoldsBusy(true);
                  try {
                    await unwrap(clearHoldsAction({ pollId: poll.id }));
                    toast.success(pt("results.holdsCleared"));
                    refresh();
                  } catch (e) {
                    toast.error(failureMessage(e));
                  } finally {
                    setHoldsBusy(false);
                  }
                }}
              >
                {pt("results.clearHolds")}
              </Button>
            )}
          </div>
        }
      >
        {holds.failed > 0
          ? pt("results.holdsFailed", { count: holds.failed, provider: holds.provider ?? "your calendar" })
          : holds.pending > 0
            ? pt("results.holdsPending")
            : holds.active > 0
              ? ptCount(holds.active, "results.holdsActiveOne", "results.holdsActive")
              : pt("results.holdsSkipped", { app: "Kairos" })}
      </Banner>
    ) : null;

  const header = (
    <PageHeader
      back={{ href: "/app/scheduling/meeting-polls" as Route, label: pt("results.backToList") }}
      title={<span data-testid="results-title">{poll.title}</span>}
      badge={<PollStatusBadge status={poll.status} />}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{responsesLabel(data.counts.respondents, data.counts.invited, "results")}</span>
          {s.deadline && poll.status === "open" && (
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="size-4" />
              {pt("results.closesIn", { relative: relativeTime(s.deadline, now) })}
            </span>
          )}
          {poll.status === "closed" && <span>{pt("results.closedAt")}</span>}
          <span>{durationLabel(poll.durationMinutes, { mixed: "mixed" })}</span>
          {poll.locationView && <span>{poll.locationView.isConference ? (poll.locationView.provider ?? poll.locationView.text) : poll.locationView.text}</span>}
          {data.hosts.length > 1 && (
            <span className="inline-flex items-center gap-1.5">
              <AvatarGroup users={data.hosts.map((h) => ({ name: h.name, src: h.avatarUrl }))} size="xs" />
              {pt("results.hostedBy", { names: hostNamesLabel(data.hosts.map((h) => h.name)) })}
            </span>
          )}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {poll.status !== "canceled" && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LinkIcon aria-hidden="true" className="size-4" />}
              onClick={async () => {
                if (await copyText(poll.link)) toast.success(pt("common.linkCopied"));
              }}
            >
              {pt("common.copyLink")}
            </Button>
          )}
          {active && (
            <Button variant="secondary" size="sm" leftIcon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => setDialog("invite")}>
              {pt("results.invite")}
            </Button>
          )}
          {poll.status !== "canceled" && (
            <Button asChild variant="secondary" size="sm" leftIcon={<Pencil aria-hidden="true" className="size-4" />}>
              <Link href={`/app/polls/${poll.id}/edit` as Route}>{pt("results.edit")}</Link>
            </Button>
          )}
          {poll.status === "open" && (
            <Button variant="secondary" size="sm" onClick={() => setDialog("close")} data-testid="close-voting">
              {pt("results.closeVoting")}
            </Button>
          )}
          {poll.status === "closed" && (
            <Button variant="secondary" size="sm" onClick={() => setDialog("reopen_voting")}>
              {pt("results.reopenVoting")}
            </Button>
          )}
          {poll.status === "booked" && (
            <Button variant="secondary" size="sm" onClick={() => setDialog("reopen_poll")}>
              {pt("results.reopenPoll")}
            </Button>
          )}
          <PollMenu
            poll={menuPoll}
            zone={s.timezone}
            hour12={viewer.hour12}
            hostName={viewer.name}
            hide={{ edit: true, invite: true, lifecycle: true }}
            onChanged={refresh}
            onDeleted={() => router.push("/app/scheduling/meeting-polls" as Route)}
          />
        </div>
      }
    />
  );

  const comments = (
    <CommentsThread
      heading={pt("results.comments")}
      headingLevel={2}
      comments={data.comments}
      now={now}
      note={!s.allowComments ? pt("results.commentsOff") : s.resultsVisibility === "host_only" ? pt("results.hostOnlyComments") : null}
      composer={
        s.allowComments && active
          ? {
              needName: false,
              placeholder: pt("results.commentPlaceholder"),
              submitLabel: pt("results.commentSubmit"),
              onSubmit: async ({ body }) => {
                const res = await addHostCommentAction({ pollId: poll.id, body });
                if (!res.ok) return { ok: false, message: res.error.message, fieldErrors: res.error.fieldErrors };
                refresh();
                return { ok: true };
              },
            }
          : null
      }
      onDelete={async (id) => {
        const res = await deleteHostCommentAction({ pollId: poll.id, commentId: id });
        if (!res.ok) toast.error(res.error.message);
        else refresh();
      }}
    />
  );

  return (
    <div className="flex flex-col gap-5" data-testid="poll-results">
      {header}

      <div className="flex flex-col gap-3 empty:hidden">
        {meeting && poll.status === "booked" && meeting.status === "active" && (
          <Banner
            variant="success"
            icon={<CalendarCheck aria-hidden="true" />}
            action={
              meeting.scheduledEventId ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/app/meetings?event=${meeting.scheduledEventId}` as Route}>{pt("results.viewMeeting")}</Link>
                </Button>
              ) : undefined
            }
          >
            <span data-testid="booked-banner">{pt("results.bookedBanner", { when: meeting.allDayDate ? formatDateLong(`${meeting.allDayDate}T12:00:00Z`, "UTC") : whenOf(meeting.start, meeting.end) })}</span>
          </Banner>
        )}
        {meeting && meeting.status === "canceled" && poll.status === "booked" && (
          <Banner
            variant="warning"
            title={pt("results.bookedBannerCanceled")}
            action={
              <Button size="sm" variant="secondary" onClick={() => setDialog("reopen_poll")}>
                {pt("results.reopenPoll")}
              </Button>
            }
          >
            {pt("results.bookedBannerCanceledHint")}
          </Banner>
        )}
        {meeting && meeting.status === "active" && active && <Banner variant="info">{pt("results.reopenedBanner", { when: whenOf(meeting.start, meetingEnd) })}</Banner>}
        {holdsBanner}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              const next = v === "grid" ? "grid" : "top";
              setTab(next);
              try {
                window.localStorage.setItem(VIEW_KEY, next);
              } catch {
                // blocked storage
              }
            }}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <TabsList aria-label={pt("results.viewLabel")}>
                <TabsTrigger value="top">{pt("results.topTimes")}</TabsTrigger>
                <TabsTrigger value="grid">{pt("results.grid")}</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <label htmlFor="results-zone" className="text-body-sm text-ink-2">
                  {pt("results.timesIn")}
                </label>
                <TimeZoneSelect id="results-zone" value={zone} onChange={setZone} hour12={viewer.hour12} className="w-[260px] max-w-full" showCurrentTime={false} />
              </div>
            </div>
            {!data.hasResponses && active && (
              <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-medium bg-white p-5 text-center">
                <p className="text-title-sm text-ink">{pt("results.emptyHeading")}</p>
                <p className="mt-1 text-body-md text-ink-2">{pt("results.emptyBody")}</p>
              </div>
            )}
            <TabsContent value="top" className="mt-4">
              <TopTimes
                options={data.options}
                ranking={data.ranking}
                zone={zone}
                pollZone={s.timezone}
                hour12={viewer.hour12}
                allowIfNeedBe={s.allowIfNeedBe}
                hasRequired={hasRequired}
                mixedDurations={poll.durationMinutes === null}
                canBook={canBook}
                bookedMeetingActive={Boolean(meeting && meeting.status === "active")}
                onBook={setBook}
              />
            </TabsContent>
            <TabsContent value="grid" className="mt-4">
              <ResultsGrid
                options={data.options}
                participants={data.participants}
                zone={zone}
                pollZone={s.timezone}
                hour12={viewer.hour12}
                allowIfNeedBe={s.allowIfNeedBe}
                hostPreferences={prefs}
                countHostPreference={s.countHostPreference}
                editable={active}
                onPreference={(id, c) => void savePreference(id, c)}
                onCountPreference={(on) => void setCountPreference(on)}
                onRowAction={(x, a) => void rowAction(x, a)}
                onAddParticipant={() => setAddOpen(true)}
              />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label={pt("results.activity")}>
          {poll.locationView && (
            <div className="rounded-[var(--radius-card)] border border-line bg-white p-4 [&_div]:text-ink-2">
              <LocationLine location={poll.locationView} />
            </div>
          )}
          <section aria-labelledby="not-responded" className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="not-responded" className="text-title-sm text-ink">
                {pt("results.notResponded")}
                {notResponded.length > 0 && <span className="ml-1 font-normal text-ink-2">({notResponded.length})</span>}
              </h2>
              {notResponded.length > 0 && poll.status === "open" && (
                <Button size="sm" variant="secondary" loading={reminding} onClick={() => void remindAll()}>
                  {pt("results.remindAll")}
                </Button>
              )}
            </div>
            {notResponded.length === 0 ? (
              <p className="mt-2 text-body-md text-ink-2">{data.counts.invited > 0 ? pt("results.notRespondedEmpty") : pt("results.notRespondedNone")}</p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {notResponded.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-label text-ink">{x.name || x.email}</p>
                      {x.name && x.email && <p className="truncate text-body-sm text-ink-2">{x.email}</p>}
                      <p className="text-body-sm text-ink-2">{x.lastRemindedAt ? pt("results.reminded", { relative: relativeTime(x.lastRemindedAt, now) }) : x.invitedAt ? pt("results.invitedAt", { relative: relativeTime(x.invitedAt, now) }) : pt("results.neverReminded")}</p>
                    </div>
                    {poll.status === "open" && x.email && !x.unsubscribed && (
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="shrink-0"
                        loading={remindingId === x.id}
                        aria-label={`${pt("results.sendReminder")}: ${x.name || x.email}`}
                        onClick={async () => {
                          setRemindingId(x.id);
                          try {
                            await rowAction(x, "remind");
                          } finally {
                            setRemindingId(null);
                          }
                        }}
                      >
                        {pt("results.sendReminder")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">{comments}</div>
          <ActivityFeed items={data.activity} now={now} />
        </aside>
      </div>

      {book && <BookDialog pollId={poll.id} optionId={book} zone={zone} hour12={viewer.hour12} onOpenChange={(v) => !v && setBook(null)} onBooked={refresh} />}
      <PollDialogs poll={menuPoll} open={dialog} setOpen={setDialog} zone={s.timezone} hour12={viewer.hour12} hostName={viewer.name} onChanged={refresh} onDeleted={() => router.push("/app/scheduling/meeting-polls" as Route)} />
      {addOpen && (
        <AddParticipantDialog open onOpenChange={setAddOpen} pollId={poll.id} options={data.options} zone={zone} pollZone={s.timezone} hour12={viewer.hour12} allowIfNeedBe={s.allowIfNeedBe} onDone={refresh} />
      )}
      {editing && (
        <EditVotesDialog
          participant={editing}
          onOpenChange={(v) => !v && setEditing(null)}
          pollId={poll.id}
          options={data.options}
          zone={zone}
          pollZone={s.timezone}
          hour12={viewer.hour12}
          allowIfNeedBe={s.allowIfNeedBe}
          onDone={refresh}
        />
      )}
      {removing && <RemoveParticipantDialog pollId={poll.id} participant={removing} onOpenChange={(v) => !v && setRemoving(null)} onDone={refresh} />}
      <ConfirmDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        title={pt("results.duplicateTitle")}
        description={pt("results.duplicateBody")}
        confirmLabel={pt("results.duplicateConfirm")}
        onConfirm={async () => {
          const out = await unwrap(duplicatePollAction({ pollId: poll.id }));
          toast.success(pt("list.duplicatedToast"));
          router.push(`/app/polls/${out.pollId}/edit` as Route);
        }}
      />
    </div>
  );
}

function ActivityFeed({ items, now }: { items: PollActivityView[]; now: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <section aria-labelledby="poll-activity" className="rounded-[var(--radius-card)] border border-line bg-white p-4">
      <h2 id="poll-activity" className="text-title-sm text-ink">
        {pt("results.activity")}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-body-md text-ink-2">{pt("results.activityEmpty")}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {shown.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 text-body-md">
              <span className="min-w-0 break-words text-ink">{activityText(a)}</span>
              <time dateTime={a.createdAt} className={cn("shrink-0 text-body-sm text-ink-2")}>
                {relativeTime(a.createdAt, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {items.length > 8 && !all && (
        <Button variant="tertiary" size="sm" className="mt-2" onClick={() => setAll(true)}>
          {pt("results.showMore")}
        </Button>
      )}
    </section>
  );
}
