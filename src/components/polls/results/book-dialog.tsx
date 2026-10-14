// "Book meeting time" (SPEC MP-18, MP-19, MP-20, MP-21; research B7.1; Calendly pop-up): loads bookingPreviewAction
// (the live conflict check and the default invitee selection), then "Book meeting" through bookPollAction.
// - Summary: title, date and time in the host zone, "{n} participants in other zones", duration, location, hosts.
// - Conflicts: an app meeting blocks ("You already have '{event}' at this time" with a link); external calendar events
//   and other polls' holds warn (amber) but allow booking; buffers and this poll's holds never conflict.
// - Invitees: respondents who can attend and those who can't (checked; "Only people who can attend"), invited people
//   who didn't respond (unchecked; "Include all"), people without an email disabled ("No email, can't send an invite"),
//   "+ Add invitee" rows, remove (x).
// - Message to invitees, "Send meeting reminders" (24 h and 1 h before), the hidden invitees note, the rebook note.
// BookingPreview.unbookableReason disables "Book meeting" with its message. Client component.
"use client";

import { CalendarDays, Clock, Globe, Plus, Users, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { LocationGlyph } from "@/components/booking/location-icon";
import { bookingPreviewAction, bookPollAction } from "@/lib/polls/actions";
import { MAX_BOOKING_MESSAGE_LENGTH, MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, POLL_COPY } from "@/lib/polls/constants";
import { optionLongLabel } from "@/lib/polls/display";
import type { BookingPreview, BookingPreviewInvitee } from "@/lib/polls/types";
import { looksLikeEmail } from "@/lib/polls/validation";
import { formatDuration } from "@/lib/time/format";
import { friendlyZoneName } from "@/lib/time/zones";
import { AnswerIcon } from "../answer-icon";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { hostNamesLabel } from "../lib/format";
import { pt, ptCount } from "../lib/t";

export type BookDialogProps = {
  pollId: string;
  optionId: string;
  zone: string;
  hour12: boolean;
  onOpenChange: (v: boolean) => void;
  onBooked: () => void;
};

type Extra = { id: number; name: string; email: string };

function answerLabel(i: BookingPreviewInvitee): string {
  if (i.status === "declined") return pt("book.answerDeclined");
  if (i.answer === "yes") return pt("book.answerYes");
  if (i.answer === "if_need_be") return pt("book.answerIfNeedBe");
  if (i.answer === "no") return pt("book.answerNo");
  return "";
}

export function BookDialog(p: BookDialogProps) {
  const [preview, setPreview] = useState<BookingPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<Extra[]>([]);
  const [message, setMessage] = useState("");
  const [reminders, setReminders] = useState(false);
  const [notifyExcluded, setNotifyExcluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraErrors, setExtraErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    void bookingPreviewAction({ pollId: p.pollId, optionId: p.optionId }).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setLoadError(res.error.message);
        return;
      }
      setPreview(res.data);
      setChecked(new Set(res.data.invitees.filter((i) => i.checked && i.email).map((i) => i.participantId)));
      setReminders(res.data.sendMeetingReminders);
    });
    return () => {
      live = false;
    };
  }, [p.pollId, p.optionId]);

  const visible = useMemo(() => (preview?.invitees ?? []).filter((i) => !hidden.has(i.participantId)), [preview, hidden]);
  const sections = useMemo(
    () => ({
      can: visible.filter((i) => i.section === "can_attend"),
      cannot: visible.filter((i) => i.section === "cannot_attend"),
      none: visible.filter((i) => i.section === "no_response"),
    }),
    [visible],
  );
  const validExtras = extras.filter((e) => e.email.trim());
  const selectedCount = visible.filter((i) => checked.has(i.participantId)).length + validExtras.length;
  const blocked = Boolean(preview && (preview.blocking.length > 0 || preview.unbookableReason));

  const toggle = (id: string, on: boolean) =>
    setChecked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const book = async () => {
    if (!preview || blocked || busy) return;
    const errs: Record<number, string> = {};
    for (const e of extras) {
      if (!e.email.trim() && !e.name.trim()) continue;
      if (!looksLikeEmail(e.email.trim())) errs[e.id] = "Enter a valid email address.";
    }
    setExtraErrors(errs);
    if (Object.keys(errs).length) return;
    if (selectedCount === 0) {
      setError(pt("book.noneSelected"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await unwrap(
        bookPollAction({
          pollId: p.pollId,
          optionId: p.optionId,
          invitees: [
            ...visible.filter((i) => checked.has(i.participantId) && i.email).map((i) => ({ participantId: i.participantId, email: i.email! })),
            ...validExtras.map((e) => ({ participantId: null, name: e.name.trim() || null, email: e.email.trim() })),
          ],
          message: message.trim() || null,
          sendMeetingReminders: reminders,
          notifyExcluded,
        }),
      );
      toast.success(out.mode === "rebooked" ? pt("book.rebooked") : out.mode === "unchanged" ? pt("book.unchanged") : pt("book.booked"));
      p.onOpenChange(false);
      p.onBooked();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setError(fe.invitees?.[0] ?? Object.values(fe)[0]?.[0] ?? failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const section = (title: string, list: BookingPreviewInvitee[], action: React.ReactNode) =>
    list.length > 0 && (
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line py-2">
          <p className="text-label-sm text-ink-2">
            {title} ({list.length})
          </p>
          {action}
        </div>
        <ul>
          {list.map((i) => (
            <li key={i.participantId} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
              <Checkbox
                checked={checked.has(i.participantId)}
                disabled={!i.email}
                onCheckedChange={(on) => toggle(i.participantId, on)}
                aria-label={i.name || i.email || ""}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label text-ink">{i.name}</p>
                <p className="truncate text-body-sm text-ink-2">{i.email ?? i.disabledReason}</p>
              </div>
              {i.answer || i.status === "declined" ? (
                <span className="flex shrink-0 items-center gap-1 text-body-sm text-ink-2">
                  <AnswerIcon value={i.status === "declined" ? "no" : (i.answer ?? "no")} size={16} />
                  {answerLabel(i)}
                </span>
              ) : null}
              <IconButton aria-label={pt("book.removeInvitee", { name: i.name || i.email || "" })} size="sm" onClick={() => setHidden((s) => new Set(s).add(i.participantId))}>
                <X aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(v) => !busy && p.onOpenChange(v)}
      title={pt("book.title")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)} disabled={busy}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={() => void book()} loading={busy} disabled={!preview || blocked || selectedCount === 0} data-testid="book-submit">
            {pt("book.submit")}
          </Button>
        </>
      }
    >
      {loadError ? (
        <Banner variant="error">{loadError}</Banner>
      ) : !preview ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={pt("book.loading")}>
          <Skeleton width="60%" height={20} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="40%" height={14} />
          <Skeleton height={120} />
        </div>
      ) : (
        <div className="flex flex-col gap-5" data-testid="book-dialog">
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-pebble p-4">
            <p className="text-title-sm text-ink">{preview.title}</p>
            <p className="flex items-start gap-2 text-body-md text-ink">
              <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-2" />
              <span data-testid="book-when">{optionLongLabel(preview.option, p.zone, { hour12: p.hour12 })}</span>
            </p>
            <p className="flex items-start gap-2 text-body-md text-ink-2">
              <Globe aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {friendlyZoneName(p.zone)}
                {preview.otherZones > 0 && <> · {ptCount(preview.otherZones, "book.otherZone", "book.otherZones")}</>}
              </span>
            </p>
            {!preview.option.allDayDate && (
              <p className="flex items-start gap-2 text-body-md text-ink-2">
                <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {formatDuration(preview.option.durationMinutes)}
              </p>
            )}
            {preview.location && (
              <p className="flex items-start gap-2 text-body-md text-ink-2">
                <span className="mt-0.5 inline-flex shrink-0 [&_svg]:size-4">
                  <LocationGlyph icon={preview.location.isConference ? "video" : "pin"} />
                </span>
                <span className="whitespace-pre-line">{preview.location.isConference ? (preview.location.provider ?? preview.location.text) : preview.location.text}</span>
              </p>
            )}
            <p className="flex items-start gap-2 text-body-md text-ink-2">
              <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {hostNamesLabel(preview.hosts.map((h) => h.name))}
            </p>
          </div>

          {preview.unbookableReason && <Banner variant="error">{preview.unbookableReason}</Banner>}
          {preview.blocking.map((b, i) => (
            <Banner
              key={`b${i}`}
              variant="error"
              action={
                b.meetingId ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/app/meetings?event=${b.meetingId}` as Route}>{pt("book.viewConflict")}</Link>
                  </Button>
                ) : undefined
              }
            >
              {b.title ? pt("book.blocking", { event: b.title }) : pt("book.blockingUntitled")}
            </Banner>
          ))}
          {preview.warnings.map((w, i) => (
            <Banner key={`w${i}`} variant="warning" title={w.kind === "hold" ? (w.title ? pt("book.warningHold", { title: w.title }) : pt("book.warningHoldUntitled")) : w.title ? pt("book.warningCalendar", { title: w.title }) : pt("book.warningCalendarHost", { host: w.hostName ?? pt("common.host") })}>
              {pt("book.warningAllowed")}
            </Banner>
          ))}
          {preview.rebook && (
            <Banner variant="info">
              {preview.rebook.sameOption
                ? pt("book.rebookSame")
                : pt("book.rebookMove", { from: optionLongLabel({ start: preview.rebook.start, end: preview.rebook.end, allDayDate: null, durationMinutes: 0 }, p.zone, { hour12: p.hour12 }) })}
            </Banner>
          )}
          {preview.hideInvitees && <p className="text-body-md text-ink-2">{POLL_COPY.hiddenInvitees}</p>}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-title-sm text-ink">{pt("book.invitees")}</p>
              <p className="text-body-sm text-ink-2" aria-live="polite">
                {ptCount(selectedCount, "book.selectedOne", "book.selectedCount")}
              </p>
            </div>
            {section(
              pt("book.canAttend"),
              sections.can,
              sections.cannot.length > 0 ? (
                <Button variant="tertiary" size="sm" onClick={() => setChecked((s) => new Set([...s].filter((id) => !sections.cannot.some((c) => c.participantId === id))))}>
                  {pt("book.onlyCanAttend")}
                </Button>
              ) : null,
            )}
            {section(pt("book.cannotAttend"), sections.cannot, null)}
            {section(
              pt("book.noResponse"),
              sections.none,
              <Button variant="tertiary" size="sm" onClick={() => setChecked((s) => new Set([...s, ...sections.none.filter((n) => n.email).map((n) => n.participantId)]))}>
                {pt("book.includeAll")}
              </Button>,
            )}
            {extras.map((e) => (
              <div key={e.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input aria-label={pt("book.addInviteeName")} placeholder={pt("book.addInviteeName")} value={e.name} maxLength={MAX_NAME_LENGTH} onChange={(ev) => setExtras((l) => l.map((x) => (x.id === e.id ? { ...x, name: ev.target.value } : x)))} />
                  <Input
                    aria-label={pt("book.addInviteeEmail")}
                    placeholder={pt("book.addInviteeEmail")}
                    type="email"
                    value={e.email}
                    maxLength={MAX_EMAIL_LENGTH}
                    invalid={Boolean(extraErrors[e.id])}
                    onChange={(ev) => setExtras((l) => l.map((x) => (x.id === e.id ? { ...x, email: ev.target.value } : x)))}
                  />
                  <IconButton aria-label={pt("common.remove")} size="sm" onClick={() => setExtras((l) => l.filter((x) => x.id !== e.id))}>
                    <X aria-hidden="true" />
                  </IconButton>
                </div>
                <FieldError error={extraErrors[e.id]} />
              </div>
            ))}
            <div>
              <Button variant="tertiary" size="sm" leftIcon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setExtras((l) => [...l, { id: Date.now() + l.length, name: "", email: "" }])}>
                {pt("book.addInvitee").replace(/^\+\s*/, "")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-message" className="text-label text-ink">
              {pt("book.message")}
            </label>
            <Textarea id="book-message" rows={3} value={message} maxLength={MAX_BOOKING_MESSAGE_LENGTH} placeholder={pt("book.messagePlaceholder")} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p id="book-reminders" className="text-label text-ink">
                {pt("book.sendReminders")}
              </p>
              <p id="book-reminders-hint" className="text-body-sm text-ink-2">
                {pt("book.sendRemindersHint")}
              </p>
            </div>
            <Switch checked={reminders} onCheckedChange={setReminders} aria-labelledby="book-reminders" aria-describedby="book-reminders-hint" />
          </div>
          {preview.invitees.some((i) => i.status !== "invited") && <Checkbox label={pt("book.notifyExcluded")} checked={notifyExcluded} onCheckedChange={setNotifyExcluded} />}
          <FieldError error={error} />
        </div>
      )}
    </Dialog>
  );
}
