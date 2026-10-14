// The meeting poll wizard (SPEC MP-02, MP-03, MP-05, MP-27; research B3, B14): a full-screen page like Calendly's
// poll creation, with the settings column on the left and the calendar on the right.
//
// Create (/app/polls/new): step 1 "Choose times to offer" (time zone, duration, hosts, the week grid over the busy
// overlay, or the month view; "{x}/100 times selected"; Next once a time is picked), step 2 "Meeting details" (name,
// location, description, optional and more settings) and "Share meeting poll", then the share screen. The unsent draft
// stays in localStorage until the poll is shared.
// Edit (/app/polls/{id}/edit): the same two steps over the published poll; "Save changes" removes times (a confirm
// lists the voters of times with votes), saves the changed settings only (a more public visibility asks first) and
// adds the new times (optionally emailing the people who already voted). Started times are frozen; a booked poll keeps
// its times until it is reopened. Client component.
"use client";

import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { useMediaQuery } from "@/lib/client";
import { cn } from "@/lib/cn";
import { addPollOptionsAction, createPollAction, removePollOptionsAction, updatePollAction } from "@/lib/polls/actions";
import { POLL_ERRORS } from "@/lib/polls/constants";
import { freeTimesForDay, localDate, weekDates } from "@/lib/polls/grid";
import { formatDateMedium, formatDateShort } from "@/lib/time/format";
import { addDays } from "@/lib/time/luxon";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { clearDraft, draftOptions, readDraft, storedOptions, writeDraft, type DurationChoice } from "../lib/draft";
import { addOptions, diffOptions, fromViews, replaceOption, sortOptions, toInput, toggleOption, type DraftOption } from "../lib/options";
import { deadlineIso, emptyDetails, settingsFromView, settingsPayload, updatePatch, type DetailsState } from "../lib/settings";
import { pt } from "../lib/t";
import type { WizardProps } from "../types";
import { DetailsForm } from "./details-form";
import { MonthPicker } from "./month-picker";
import { SharePanel } from "./share-panel";
import { AddTimeDialog, CopyDayDialog } from "./time-dialogs";
import { TimesSidebar } from "./times-sidebar";
import { useGridOverlay } from "./use-overlay";
import { WeekGrid } from "./week-grid";

type Step = "times" | "details" | "share";

type Ask = { title: string; body: string; voters: string[]; confirmLabel: string; resolve: (ok: boolean) => void } | null;

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function weekLabel(dates: string[]): string {
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const a = formatDateShort(`${first}T12:00:00Z`, "UTC");
  const b = formatDateShort(`${last}T12:00:00Z`, "UTC");
  const y1 = first.slice(0, 4);
  const y2 = last.slice(0, 4);
  if (y1 !== y2) return `${a}, ${y1} to ${b}, ${y2}`;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${a} to ${sameMonth ? last.slice(8, 10).replace(/^0/, "") : b}, ${y1}`;
}

function durationOf(choice: DurationChoice): number | null {
  return choice.kind === "all_day" ? null : choice.minutes;
}

const noopSubscribe = () => () => {};

/** Client only: the wizard reads the unsent draft from localStorage while it initializes. */
export function PollWizard(p: WizardProps) {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!hydrated) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-canvas" aria-busy="true">
        <Spinner size="lg" label={pt("common.loading")} />
      </div>
    );
  }
  return <WizardInner {...p} />;
}

function WizardInner(p: WizardProps) {
  const router = useRouter();
  const edit = p.mode === "edit" ? p.poll : null;
  const now = useNow();
  const phone = useMediaQuery("(max-width: 649px)");

  const initial = useMemo(() => {
    if (edit) {
      const options = fromViews(edit.options);
      const allDayOnly = options.length > 0 && options.every((o) => o.kind === "date");
      const details: DetailsState = {
        title: edit.title,
        descriptionHtml: edit.descriptionHtml ?? "",
        location: edit.location,
        settings: settingsFromView(edit.settings),
      };
      return {
        zone: edit.settings.timezone,
        duration: (allDayOnly ? { kind: "all_day" } : { kind: "minutes", minutes: Math.min(1440, Math.max(5, edit.defaultDurationMinutes)) }) as DurationChoice,
        options,
        details,
        cohostIds: edit.cohostIds,
      };
    }
    return { zone: p.viewer.timezone, duration: { kind: "minutes", minutes: 30 } as DurationChoice, options: [] as DraftOption[], details: emptyDetails(), cohostIds: [] as string[] };
  }, [edit, p.viewer.timezone]);

  // The unsent draft of a new poll (read once on the client).
  const [boot] = useState(() => {
    if (edit) return null;
    const d = readDraft(p.viewer.userId, Date.now());
    return d ? { d, list: draftOptions(d, Date.now()) } : null;
  });
  const [step, setStep] = useState<Step>("times");
  const [zone, setZone] = useState(boot?.d.timezone ?? initial.zone);
  const [duration, setDuration] = useState<DurationChoice>(boot?.d.duration ?? initial.duration);
  const [options, setOptions] = useState<DraftOption[]>(boot?.list ?? initial.options);
  const [details, setDetails] = useState<DetailsState>(() =>
    boot ? { ...initial.details, title: boot.d.title, descriptionHtml: boot.d.descriptionHtml, location: boot.d.location } : initial.details,
  );
  const [cohostIds, setCohostIds] = useState<string[]>(initial.cohostIds);
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => {
    const today = localDate(Date.now(), initial.zone);
    const firstFuture = sortOptions(boot?.list ?? initial.options, initial.zone).find((o) => (o.kind === "timed" ? o.start : 0) > Date.now() || o.kind === "date");
    const fromOption = firstFuture ? (firstFuture.kind === "date" ? firstFuture.date : localDate(firstFuture.start, initial.zone)) : null;
    return fromOption && fromOption > today ? fromOption : today;
  });
  const [day, setDay] = useState(anchor);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ pollId: string; slug: string; link: string } | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [copyDay, setCopyDay] = useState<string | null>(null);
  const [notifyVoters, setNotifyVoters] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);

  const booked = edit?.status === "booked";
  const timesLocked = booked ? POLL_ERRORS.optionsLocked : null;
  const durationMinutes = durationOf(duration);
  const today = localDate(now, zone);
  const dates = useMemo(() => weekDates(anchor, p.viewer.weekStart), [anchor, p.viewer.weekStart]);
  const gridDates = useMemo(() => (phone ? [dates.includes(day) ? day : dates.find((d) => d >= today) ?? dates[0]!] : dates), [phone, dates, day, today]);
  const range = useMemo(() => {
    const first = gridDates[0]!;
    const last = gridDates[gridDates.length - 1]!;
    // Local midnights of the visible dates in the grid zone (a little margin covers DST and long events).
    const start = new Date(`${first}T00:00:00Z`).getTime() - 36 * 3_600_000;
    const end = new Date(`${addDays(last, 1)}T00:00:00Z`).getTime() + 36 * 3_600_000;
    return { start, end };
  }, [gridDates]);
  const overlay = useGridOverlay({ start: range.start, end: range.end, hostIds: cohostIds, pollId: edit?.id ?? null, requesterId: p.viewer.userId, enabled: step !== "share" && view === "week" });

  useEffect(() => {
    if (boot?.list.length) toast.info(pt("wizard.draftRestored"));
  }, [boot]);

  // Keep the draft (create only) until the poll is shared.
  useEffect(() => {
    if (edit || created) return;
    const t = setTimeout(() => {
      if (!options.length && !details.title.trim()) {
        clearDraft();
        return;
      }
      writeDraft({
        userId: p.viewer.userId,
        savedAt: Date.now(),
        timezone: zone,
        duration,
        options: storedOptions(options),
        title: details.title,
        descriptionHtml: details.descriptionHtml,
        location: details.location,
        settings: {},
      });
    }, 400);
    return () => clearTimeout(t);
  }, [edit, created, options, details.title, details.descriptionHtml, details.location, zone, duration, p.viewer.userId]);

  const dirty = useMemo(() => {
    if (created) return false;
    if (!edit) return options.length > 0 || Boolean(details.title.trim());
    const diff = diffOptions(initial.options, options);
    if (diff.removedIds.length || diff.added.length) return true;
    const patch = updatePatch(
      { title: edit.title, descriptionHtml: edit.descriptionHtml, location: edit.location, timezone: edit.settings.timezone, defaultDurationMinutes: edit.defaultDurationMinutes, settings: edit.settings, cohostIds: edit.cohostIds },
      { details, timezone: zone, defaultDurationMinutes: durationMinutes ?? 1440, cohostIds },
    );
    return Object.keys(patch).length > 0;
  }, [created, edit, initial.options, options, details, zone, durationMinutes, cohostIds]);

  useEffect(() => {
    if (!dirty || !edit) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty, edit]);

  // Focus the step heading (screen readers hear the new step).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const confirmAsync = useCallback((a: Omit<NonNullable<Ask>, "resolve">) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve })), []);

  // -------------------------------------------------------------------------------------------------------------
  // Option edits

  const onToggle = (o: DraftOption) => {
    const res = toggleOption(options, o);
    if (res.change === "full") toast.error(pt("wizard.tooMany"));
    if (res.change === "frozen") toast.error(pt("wizard.timesFrozen"));
    setOptions(res.list);
  };
  const onAdd = (o: DraftOption) => {
    const res = addOptions(options, [o]);
    if (res.full) toast.error(pt("wizard.tooMany"));
    setOptions(res.list);
  };
  const onAddMany = (list: DraftOption[]) => {
    const res = addOptions(options, list);
    if (res.full) toast.error(pt("wizard.tooMany"));
    setOptions(res.list);
    return res.added;
  };
  const onRemove = (key: string) => setOptions((list) => list.filter((o) => o.key !== key || o.frozen));
  const onReplace = (key: string, next: DraftOption) => setOptions((list) => replaceOption(list, key, next));
  const onClear = () => setOptions((list) => list.filter((o) => o.frozen));

  const onDayAction = (date: string, action: "free" | "copy") => {
    if (action === "copy") {
      setCopyDay(date);
      return;
    }
    if (durationMinutes === null) return;
    const free = freeTimesForDay({
      date,
      zone,
      durationMinutes,
      working: overlay.working,
      busy: overlay.busy.map((b) => ({ start: b.start, end: b.end })),
      now: Date.now(),
      step: 15,
    }).map((f) => ({ kind: "timed" as const, key: `t:${new Date(f.start).getTime()}:${new Date(f.end).getTime()}`, start: new Date(f.start).getTime(), end: new Date(f.end).getTime() }));
    const added = onAddMany(free);
    toast.info(added ? pt("wizard.addedFreeTimes", { count: added }) : pt("wizard.noFreeTimes"));
  };

  // -------------------------------------------------------------------------------------------------------------
  // Submit

  const goDetails = () => {
    if (!options.length) {
      toast.error(pt("wizard.nextDisabled"));
      return;
    }
    setStep("details");
  };

  const validateDetails = (): boolean => {
    const next: Record<string, string[]> = {};
    if (!details.title.trim()) next.title = ["Enter a meeting name."];
    if (deadlineIso(details.settings, zone) === "invalid") next.deadline = ["Enter a valid date and time"];
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const create = async () => {
    if (busy || !validateDetails()) return;
    setBusy(true);
    setFormError(null);
    try {
      const out = await unwrap(
        createPollAction({
          title: details.title.trim(),
          timezone: zone,
          defaultDurationMinutes: durationMinutes ?? 1440,
          options: sortOptions(options, zone).map(toInput),
          location: details.location,
          descriptionHtml: details.descriptionHtml || null,
          coHostIds: cohostIds,
          ...settingsPayload(details.settings, zone),
        }),
      );
      clearDraft();
      setCreated({ pollId: out.pollId, slug: out.slug, link: out.link });
      setStep("share");
      toast.success(pt("wizard.created"));
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setErrors(fe);
      if (Object.keys(fe).some((k) => k === "options" || k.startsWith("options."))) {
        setStep("times");
        setFormError(fe.options?.[0] ?? failureMessage(e));
      } else setFormError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!edit || busy) return;
    if (!validateDetails()) {
      setStep("details");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const diff = diffOptions(initial.options, options);
      if (diff.removedIds.length) {
        let res = await unwrap(removePollOptionsAction({ pollId: edit.id, optionIds: diff.removedIds, confirm: false }));
        if (!res.done) {
          const ok = await confirmAsync({ title: pt("wizard.removeVotedTitle"), body: res.confirm.message || pt("wizard.removeVotedBody"), voters: res.confirm.voters, confirmLabel: pt("wizard.removeVotedConfirm") });
          if (!ok) return;
          res = await unwrap(removePollOptionsAction({ pollId: edit.id, optionIds: diff.removedIds, confirm: true }));
        }
      }
      const patch = updatePatch(
        { title: edit.title, descriptionHtml: edit.descriptionHtml, location: edit.location, timezone: edit.settings.timezone, defaultDurationMinutes: edit.defaultDurationMinutes, settings: edit.settings, cohostIds: edit.cohostIds },
        { details, timezone: zone, defaultDurationMinutes: durationMinutes ?? 1440, cohostIds },
      );
      if (Object.keys(patch).length) {
        let res = await unwrap(updatePollAction({ pollId: edit.id, ...patch }));
        if (!res.done) {
          const ok = await confirmAsync({ title: pt("wizard.morePublicTitle"), body: res.confirm.message, voters: [], confirmLabel: pt("wizard.morePublicConfirm") });
          if (!ok) return;
          res = await unwrap(updatePollAction({ pollId: edit.id, ...patch, confirmPublic: true }));
        }
      }
      if (diff.added.length) {
        await unwrap(addPollOptionsAction({ pollId: edit.id, options: sortOptions(diff.added, zone).map(toInput), notifyParticipants: edit.respondentCount > 0 && notifyVoters }));
      }
      toast.success(pt("wizard.saved"));
      router.push(`/app/polls/${edit.id}` as Route);
      router.refresh();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setErrors(fe);
      const optionError = Object.keys(fe).some((k) => k === "options" || k.startsWith("options."));
      if (optionError) setStep("times");
      else if (Object.keys(fe).length) setStep("details");
      setFormError(optionError ? (fe.options?.[0] ?? failureMessage(e)) : failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exit = () => {
    const target = (edit ? `/app/polls/${edit.id}` : "/app/scheduling/meeting-polls") as Route;
    if (dirty) {
      setExitConfirm(true);
      return;
    }
    router.push(target);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Rendering

  const firstDate = dates[0]!;
  const prevDisabled = firstDate <= today;
  const nextDisabled = firstDate > addDays(today, 360);
  const newWithVoters = Boolean(edit && edit.respondentCount > 0 && diffOptions(initial.options, options).added.length > 0);

  function shiftDay(delta: number) {
    const current = gridDates[0]!;
    const next = addDays(current, delta);
    if (next < today) return;
    setDay(next);
    if (!dates.includes(next)) setAnchor(next);
  }
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        {view === "week" && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(today)} disabled={dates.includes(today)}>
              {pt("wizard.today")}
            </Button>
            <IconButton aria-label={phone ? pt("wizard.previousDay") : pt("wizard.previousWeek")} disabled={phone ? gridDates[0]! <= today : prevDisabled} onClick={() => (phone ? shiftDay(-1) : setAnchor((a) => addDays(a, -7)))}>
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={phone ? pt("wizard.nextDay") : pt("wizard.nextWeek")} disabled={nextDisabled} onClick={() => (phone ? shiftDay(1) : setAnchor((a) => addDays(a, 7)))}>
              <ChevronRight aria-hidden="true" />
            </IconButton>
            <h2 className="text-title-sm text-ink" aria-live="polite">
              {weekLabel(dates)}
            </h2>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!timesLocked && (
          <Button variant="secondary" size="sm" leftIcon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setAddTimeOpen(true)} data-testid="add-time">
            {pt("wizard.addTime")}
          </Button>
        )}
        <SegmentedControl
          aria-label={pt("wizard.viewLabel")}
          size="sm"
          value={view}
          onValueChange={setView}
          options={[
            { value: "week", label: pt("wizard.week") },
            { value: "month", label: pt("wizard.month") },
          ]}
        />
      </div>
    </div>
  );



  const dayStrip = phone && view === "week" && (
    <div className="flex gap-1 overflow-x-auto border-b border-line bg-white px-2 py-2" role="group" aria-label={weekLabel(dates)}>
      {dates.map((d) => {
        const past = d < today;
        const selected = gridDates[0] === d;
        const count = options.filter((o) => (o.kind === "date" ? o.date === d : localDate(o.start, zone) === d)).length;
        return (
          <button
            key={d}
            type="button"
            disabled={past}
            aria-pressed={selected}
            onClick={() => setDay(d)}
            className={cn(
              "flex min-w-[44px] flex-1 flex-col items-center rounded-[var(--radius-card)] py-1.5 text-body-sm disabled:opacity-40",
              selected ? "bg-primary text-white" : "text-ink hover:bg-primary-soft",
            )}
          >
            <span className="font-semibold">{formatDateShort(`${d}T12:00:00Z`, "UTC").split(" ")[0]}</span>
            <span className="text-[16px] font-bold">{Number(d.slice(8, 10))}</span>
            <span aria-hidden="true" className={cn("mt-0.5 size-1.5 rounded-full", count ? (selected ? "bg-white" : "bg-primary") : "bg-transparent")} />
            {count > 0 && <span className="sr-only">{count}</span>}
          </button>
        );
      })}
    </div>
  );

  const calendar =
    view === "month" ? (
      <MonthPicker
        zone={zone}
        hour12={p.viewer.hour12}
        now={now}
        weekStart={p.viewer.weekStart}
        durationMinutes={durationMinutes}
        locked={timesLocked}
        onAdd={(list) => {
          const added = onAddMany(list);
          if (added) toast.success(pt("wizard.addedFreeTimes", { count: added }));
        }}
      />
    ) : (
      <WeekGrid
        dates={gridDates}
        zone={zone}
        hour12={p.viewer.hour12}
        now={now}
        options={options}
        durationMinutes={durationMinutes}
        busy={overlay.busy}
        working={overlay.working}
        locked={timesLocked}
        onToggle={onToggle}
        onAdd={onAdd}
        onRemove={onRemove}
        onReplace={onReplace}
        onDayAction={onDayAction}
        onError={(m) => toast.error(m)}
        scrollToMinutes={p.workingStartMinutes ?? 7 * 60}
        label={phone ? pt("wizard.dayGridLabel", { day: formatDateMedium(`${gridDates[0]!}T12:00:00Z`, "UTC") }) : pt("wizard.gridLabel", { week: weekLabel(dates) })}
        dayMenus={!phone}
      />
    );

  const footer =
    step === "times" ? (
      <div className="flex flex-col gap-2">
        {edit ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("details")} className="flex-1">
              {pt("common.next")}
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!dirty} className="flex-1" data-testid="wizard-save">
              {pt("common.saveChanges")}
            </Button>
          </div>
        ) : (
          <Button onClick={goDetails} disabled={!options.length} fullWidth data-testid="wizard-next">
            {pt("common.next")}
          </Button>
        )}
      </div>
    ) : (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setStep("times")} disabled={busy}>
          {pt("common.back")}
        </Button>
        {edit ? (
          <Button onClick={() => void save()} loading={busy} disabled={!dirty} className="flex-1" data-testid="wizard-save">
            {pt("common.saveChanges")}
          </Button>
        ) : (
          <Button onClick={() => void create()} loading={busy} className="flex-1" data-testid="share-poll">
            {pt("wizard.sharePoll")}
          </Button>
        )}
      </div>
    );

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-canvas text-ink" data-testid="poll-wizard">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton aria-label={pt("wizard.exit")} onClick={exit}>
            <X aria-hidden="true" />
          </IconButton>
          <span className="truncate text-title-sm text-ink">{edit ? pt("wizard.editTitle") : pt("wizard.newTitle")}</span>
        </div>
        {step !== "share" && <Stepper total={2} current={step === "times" ? 1 : 2} labels={[pt("wizard.stepTimes"), pt("wizard.stepDetails")]} className="hidden w-48 sm:flex" />}
      </header>

      {step === "share" && created ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SharePanel
            pollId={created.pollId}
            slug={created.slug}
            link={created.link}
            title={details.title.trim()}
            options={options}
            zone={zone}
            hour12={p.viewer.hour12}
            hostName={p.viewer.name}
            onSlugChange={(slug, link) => setCreated((c) => (c ? { ...c, slug, link } : c))}
            onDone={() => router.push(`/app/polls/${created.pollId}` as Route)}
          />
        </div>
      ) : (
        <div className={cn("flex min-h-0 flex-1", phone ? "flex-col overflow-y-auto" : "flex-row")}>
          <aside
            className={cn(
              "flex shrink-0 flex-col border-line bg-white",
              phone ? "border-b" : cn("min-h-0 border-r", step === "details" ? "w-[440px] max-w-[48%]" : "w-[340px]"),
            )}
            aria-labelledby="wizard-step-heading"
          >
            <div className={cn("flex flex-col gap-5 p-5", !phone && "min-h-0 flex-1 overflow-y-auto")}>
              <div>
                <p className="text-eyebrow text-ink-2">{pt("wizard.stepOf", { current: step === "times" ? 1 : 2, total: 2 })}</p>
                <h1 id="wizard-step-heading" ref={headingRef} tabIndex={-1} className="mt-1 text-title-lg text-ink outline-none">
                  {step === "times" ? pt("wizard.stepTimes") : pt("wizard.stepDetails")}
                </h1>
              </div>
              {formError && <Banner variant="error">{formError}</Banner>}
              {timesLocked && step === "times" && <Banner variant="info">{timesLocked}</Banner>}
              {step === "times" ? (
                <TimesSidebar
                  zone={zone}
                  onZoneChange={setZone}
                  duration={duration}
                  onDurationChange={setDuration}
                  viewer={p.viewer}
                  members={p.members}
                  cohostIds={cohostIds}
                  onCohostsChange={setCohostIds}
                  canRemoveCohosts={!edit || edit.canRemoveCohosts}
                  options={options}
                  onRemove={onRemove}
                  onClear={onClear}
                  locked={timesLocked}
                  overlay={{ loading: overlay.loading, error: overlay.error, hasCohostBusy: overlay.busy.some((b) => b.owner === "cohost") }}
                />
              ) : (
                <DetailsForm
                  value={details}
                  onChange={setDetails}
                  zone={zone}
                  hour12={p.viewer.hour12}
                  weekStart={p.viewer.weekStart}
                  userId={p.viewer.userId}
                  optionCount={options.length}
                  errors={errors}
                  locationLocked={Boolean(edit?.meetingLocked)}
                  booked={booked}
                  titleRef={titleRef}
                />
              )}
              {newWithVoters && edit && (
                <Checkbox
                  label={edit.respondentCount === 1 ? pt("wizard.notifyVoter") : pt("wizard.notifyVoters", { count: edit.respondentCount })}
                  checked={notifyVoters}
                  onCheckedChange={setNotifyVoters}
                />
              )}
            </div>
            {!phone && <div className="shrink-0 border-t border-line bg-white p-4">{footer}</div>}
          </aside>
          {(step === "times" || !phone) && (
            <main className={cn("flex min-w-0 flex-1 flex-col", phone && "h-[70dvh] shrink-0")} aria-label={pt("wizard.stepTimes")}>
              {toolbar}
              {dayStrip}
              {calendar}
            </main>
          )}
          {phone && <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-line bg-white p-4">{footer}</div>}
        </div>
      )}

      {addTimeOpen && (
        <AddTimeDialog
          open
          onOpenChange={setAddTimeOpen}
          zone={zone}
          hour12={p.viewer.hour12}
          now={now}
          weekStart={p.viewer.weekStart}
          durationMinutes={durationMinutes}
          initialDate={gridDates[0]!}
          onAdd={(o) => {
            onAdd(o);
            toast.success(pt("wizard.added"));
          }}
        />
      )}
      {copyDay && (
        <CopyDayDialog
          open
          onOpenChange={(v) => !v && setCopyDay(null)}
          zone={zone}
          now={now}
          weekStart={p.viewer.weekStart}
          fromDate={copyDay}
          options={options}
          onCopy={(list) => {
            const added = onAddMany(list);
            toast.success(pt("wizard.addedFreeTimes", { count: added }));
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(ask)}
        onOpenChange={(v) => {
          if (!v && ask) {
            ask.resolve(false);
            setAsk(null);
          }
        }}
        title={ask?.title ?? ""}
        description={ask?.body}
        confirmLabel={ask?.confirmLabel}
        variant="destructive"
        onConfirm={() => {
          ask?.resolve(true);
          setAsk(null);
        }}
      >
        {ask && ask.voters.length > 0 && (
          <ul className="list-disc pl-5 text-body-md text-ink">
            {ask.voters.slice(0, 10).map((v, i) => (
              <li key={`${v}-${i}`}>{v}</li>
            ))}
            {ask.voters.length > 10 && <li>{`+${ask.voters.length - 10}`}</li>}
          </ul>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={exitConfirm}
        onOpenChange={setExitConfirm}
        title={edit ? pt("wizard.exitEditConfirmTitle") : pt("wizard.exitConfirmTitle")}
        description={edit ? pt("wizard.exitEditConfirmBody") : pt("wizard.exitConfirmBody")}
        confirmLabel={edit ? pt("wizard.discard") : pt("wizard.leave")}
        cancelLabel={pt("wizard.keepEditing")}
        variant={edit ? "destructive" : "default"}
        onConfirm={() => router.push((edit ? `/app/polls/${edit.id}` : "/app/scheduling/meeting-polls") as Route)}
      />
    </div>
  );
}
