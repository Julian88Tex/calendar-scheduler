// The event type editor (SPEC ET-14 to ET-29, ET-33; walkthrough 7; docs/SCOPE.md: one-on-one event types). A
// full-page view: the left settings panel (440px, its own scroll) with collapsible section rows (icon, bold title,
// one-line summary, chevron; several can be open), "More options" revealing the secondary sections in Calendly's
// order, a sticky footer ("More options", "Preview" on narrow screens, "Cancel", "Save changes"), and the live preview of
// the booking page on the right (ET-29). Edits stay local until "Save changes", which saves the whole event type with
// one validated server action; errors expand and scroll to the first failing section; leaving with unsaved changes
// asks first. Viewers get a read-only editor. Client component; the page passes the server data.
"use client";

import { AlignLeft, CalendarClock, CheckCircle2, ClipboardList, Clock, Eye, Bell, Link2, MapPin, Timer, Users } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { StickyFooterBar } from "@/components/ui/sticky-footer-bar";
import { toast } from "@/components/ui/toast";
import { copyText, useMediaQuery } from "@/lib/client";
import { cn } from "@/lib/cn";
import {
  duplicateEventTypeAction,
  saveEventTypeAction,
  setEventTypeActiveAction,
  setEventTypeSecretAction,
} from "@/lib/event-types/actions";
import { MESSAGES, SAVED_TOAST, UNSAVED_BODY, UNSAVED_TITLE } from "@/lib/event-types/constants";
import {
  availabilityChanged,
  availabilitySummary,
  draftsEqual,
  durationSummary,
  htmlSummary,
  inviteeFormSummary,
  limitsSummary,
  locationSummary,
  notificationsSummary,
  previewDraftOf,
  scheduleContentOf,
} from "@/lib/event-types/draft";
import { draftFieldErrors, firstErrorSection, MORE_SECTIONS, validateDraft, type EditorSectionId } from "@/lib/event-types/schemas";
import type { EventTypeDraft, EventTypeEditorData } from "@/lib/event-types/types";
import type { EventTypeRemindersView } from "@/lib/workflows/types";
import { DeleteEventTypeDialog } from "../delete-event-type-dialog";
import { InternalNoteDialog } from "../internal-note-dialog";
import { AvailabilitySection } from "./availability-section";
import { DescriptionSection, DetailsSection, DurationSection, LocationSection } from "./basics-sections";
import { BookingPageSection } from "./booking-page-section";
import { ConfirmationSection } from "./confirmation-section";
import { EditorHeader } from "./editor-header";
import { InviteeFormSection } from "./invitee-form-section";
import { LimitsSection } from "./limits-section";
import { PersonasSection, personasSummary } from "./personas-section";
import { effectiveMode, NotificationsSection } from "./notifications-section";
import { PreviewPane } from "./preview-pane";
import { useUnsavedGuard } from "./use-unsaved-guard";

export type EventTypeEditorProps = {
  data: EventTypeEditorData;
  /** Section to open and scroll to on load (?section=limits). */
  initialSection?: EditorSectionId | null;
  /** Preloaded reminders (EventTypeWorkflowsSection renders without a loading state). */
  remindersInitial?: EventTypeRemindersView | null;
};

const SECTION_TITLES: Record<EditorSectionId, string> = {
  details: "Event name and color",
  duration: "Duration",
  location: "Location",
  availability: "Availability",
  description: "Description",
  limits: "Limits and buffers",
  bookingPage: "Booking page options",
  inviteeForm: "Invitee form",
  notifications: "Notifications",
  confirmation: "Confirmation page",
  personas: "Personas",
};

const sectionDomId = (id: EditorSectionId) => `section-${id}`;

export function EventTypeEditor({ data, initialSection = null, remindersInitial = null }: EventTypeEditorProps) {
  const router = useRouter();
  const kind = data.kind === "group" ? "group" : "solo";
  const canEdit = data.access !== "view";
  const isNew = data.mode === "create";
  const hour12 = data.owner.timeFormat !== "24h";

  const [eventTypeId, setEventTypeId] = useState<string | null>(data.eventTypeId);
  const [version, setVersion] = useState<string | null>(data.version);
  const [baseline, setBaseline] = useState<EventTypeDraft>(data.draft);
  const [draft, setDraft] = useState<EventTypeDraft>(data.draft);
  const [active, setActive] = useState(data.active);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<EditorSectionId>>(() => new Set(initialSection ? [initialSection] : isNew ? ["details"] : []));
  const [showMore, setShowMore] = useState(() => Boolean(initialSection && MORE_SECTIONS.includes(initialSection)));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  // The side preview shows from the lg breakpoint (1024px); narrower screens load it on "Preview".
  const wide = useMediaQuery("(min-width: 1024px)");
  const [reloadKey, setReloadKey] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scrollTo, setScrollTo] = useState<EditorSectionId | null>(initialSection);
  const panel = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  const dirty = !draftsEqual(draft, baseline);
  const navigate = useCallback((href: string) => router.push(href as Route), [router]);
  const guard = useUnsavedGuard(dirty && canEdit, navigate);

  // Server data refreshed elsewhere (another tab saved, router.refresh after an action) replaces a clean draft
  // (React's "adjust state when a prop changes" pattern: compared during render, no effect).
  const [seenVersion, setSeenVersion] = useState(data.version);
  if (data.version !== seenVersion) {
    setSeenVersion(data.version);
    if (data.version !== version && draftsEqual(draft, baseline)) {
      setBaseline(data.draft);
      setDraft(data.draft);
      setVersion(data.version);
      setActive(data.active);
    }
  }

  // The editor covers the app shell like Calendly's: keep the hidden shell out of the tab order and screen readers.
  useEffect(() => {
    const changed: Element[] = [];
    let node: Element | null = root.current;
    while (node && node.parentElement && node.parentElement !== document.body) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        changed.push(sibling);
      }
      node = node.parentElement;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const el of changed) el.removeAttribute("inert");
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    if (!scrollTo) return;
    const id = requestAnimationFrame(() => {
      document.getElementById(sectionDomId(scrollTo))?.scrollIntoView({ block: "start", behavior: "smooth" });
      setScrollTo(null);
    });
    return () => cancelAnimationFrame(id);
  }, [scrollTo]);

  const update = useCallback((patch: Partial<EventTypeDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
    setErrors((prev) => {
      const keys = Object.keys(patch);
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.some((p) => k === p || k.startsWith(`${p}.`))));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, []);

  const toggle = (id: EditorSectionId, v: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  const reveal = (fieldErrors: Record<string, string[]>) => {
    const section = firstErrorSection(fieldErrors);
    if (!section) return;
    if (MORE_SECTIONS.includes(section)) setShowMore(true);
    setOpen((cur) => new Set([...cur, section]));
    setScrollTo(section);
  };

  const save = async () => {
    if (!canEdit || saving) return;
    const checked = validateDraft(draft, kind);
    const extra: Record<string, string[]> = !isNew && !draft.slug.trim() ? { slug: [MESSAGES.slugInvalid] } : {};
    if (!checked.ok || Object.keys(extra).length) {
      const all = { ...(checked.ok ? {} : checked.fieldErrors), ...extra };
      setErrors(all);
      reveal(all);
      toast.error("Check the highlighted fields and try again.");
      return;
    }
    setSaving(true);
    const result = await saveEventTypeAction({ id: eventTypeId, version, kind: eventTypeId ? undefined : "one_on_one", draft });
    setSaving(false);
    if (!result.ok) {
      const fieldErrors = draftFieldErrors(result.error.fieldErrors);
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        reveal(fieldErrors);
      }
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }
    const saved = result.data;
    setBaseline(saved.draft);
    setDraft(saved.draft);
    setVersion(saved.version);
    setErrors({});
    setFormError(null);
    setReloadKey((k) => k + 1);
    toast.success(SAVED_TOAST);
    if (saved.created) {
      setEventTypeId(saved.id);
      guard.allowNext();
      router.replace(`/app/event-types/${saved.id}` as Route);
    } else {
      router.refresh();
    }
  };

  const applyServerVersion = (next: string) => setVersion(next);

  const setSecret = async (secret: boolean) => {
    if (!eventTypeId) {
      update({ secret });
      return;
    }
    setBusy(true);
    const r = await setEventTypeSecretAction({ id: eventTypeId, secret });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    applyServerVersion(r.data.version);
    setBaseline((b) => ({ ...b, secret }));
    setDraft((d) => ({ ...d, secret }));
    toast.success(secret ? "Event type is now secret" : "Event type is now public");
    router.refresh();
  };

  const setOnOff = async (next: boolean) => {
    if (!eventTypeId) return;
    setActive(next);
    const r = await setEventTypeActiveAction({ id: eventTypeId, active: next });
    if (!r.ok) {
      setActive(!next);
      toast.error(r.error.message);
      return;
    }
    applyServerVersion(r.data.version);
    toast.success(next ? "Event type turned on" : "Event type turned off");
    router.refresh();
  };

  const duplicate = async () => {
    if (!eventTypeId) return;
    setBusy(true);
    const r = await duplicateEventTypeAction({ id: eventTypeId });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success("Event type duplicated");
    guard.request(`/app/event-types/${r.data.id}`);
  };

  const copyLink = async () => {
    if (!data.publicUrl) return;
    const ok = await copyText(data.publicUrl);
    if (ok) toast.success("Link copied");
    else toast.error("Couldn't copy the link. Copy it from the address bar instead.");
  };

  const leave = () => guard.request("/app/scheduling");
  const cancel = () => {
    if (dirty) guard.request("/app/scheduling");
    else router.push("/app/scheduling");
  };

  const previewDraft = useMemo(() => previewDraftOf(draft, kind), [draft, kind]);
  const availabilityDirty = !isNew && availabilityChanged(draft, baseline);
  const disabled = !canEdit || saving;
  const sectionErrors = useMemo(() => {
    const out = new Set<EditorSectionId>();
    for (const key of Object.keys(errors)) {
      const s = firstErrorSection({ [key]: errors[key]! });
      if (s) out.add(s);
    }
    return out;
  }, [errors]);
  const scheduleZone = scheduleContentOf(draft.schedule, data.schedules)?.timezone ?? data.owner.timezone;
  const common = { draft, update, errors, disabled };

  const sectionCard = (id: EditorSectionId, icon: React.ReactNode, summary: React.ReactNode, children: React.ReactNode) => (
    <SectionCard
      key={id}
      id={sectionDomId(id)}
      title={SECTION_TITLES[id]}
      icon={icon}
      summary={summary}
      open={open.has(id)}
      onOpenChange={(v) => toggle(id, v)}
      badge={
        sectionErrors.has(id) ? (
          <span className="text-body-sm font-semibold text-danger-text">Fix errors</span>
        ) : undefined
      }
      className={cn("scroll-mt-2 rounded-none border-x-0 border-t-0", sectionErrors.has(id) && "bg-danger-soft/30")}
    >
      {children}
    </SectionCard>
  );

  const mode = effectiveMode(draft.notificationType, data.invitationsAvailable, kind);

  return (
    <div ref={root} className="fixed inset-0 z-30 flex bg-canvas text-ink">
      <section
        aria-label="Event type settings"
        className={cn(
          "flex h-full min-h-0 w-full flex-col border-line bg-white lg:w-[440px] lg:shrink-0 lg:border-r",
          mobilePreview && "hidden lg:flex",
        )}
      >
        <EditorHeader
          kindLabel={data.kindLabel}
          name={draft.name}
          color={draft.color}
          secret={draft.secret}
          active={active}
          internalNote={draft.internalNote}
          saved={Boolean(eventTypeId)}
          canEdit={canEdit}
          canDelete={data.canDelete}
          publicUrl={data.publicUrl}
          busy={busy || saving}
          onBack={leave}
          onCopyLink={copyLink}
          onNote={() => setNoteOpen(true)}
          onSecret={setSecret}
          onDuplicate={duplicate}
          onDelete={() => setDeleteOpen(true)}
          onActive={setOnOff}
        />
        <div ref={panel} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!canEdit && (
            <div className="px-4 pt-4 sm:px-6">
              <Banner variant="info">You can view this event type but not edit it.</Banner>
            </div>
          )}
          {formError && Object.keys(errors).length === 0 && (
            <div className="px-4 pt-4 sm:px-6">
              <Banner variant="error" role="alert">
                {formError}
              </Banner>
            </div>
          )}
          <div className="min-w-0">
            {sectionCard(
              "details",
              <span aria-hidden="true" className="mt-0.5 block size-4 rounded-full" style={{ backgroundColor: draft.color }} />,
              draft.name || "Untitled event type",
              <DetailsSection {...common} />,
            )}
            {sectionCard("duration", <Clock aria-hidden="true" />, durationSummary(draft.durations), <DurationSection {...common} kind={kind} />)}
            {sectionCard(
              "location",
              <MapPin aria-hidden="true" />,
              locationSummary(draft.locations),
              <LocationSection {...common} kind={kind} userId={data.owner.id} conferencing={data.conferencing} />,
            )}
            {sectionCard(
              "availability",
              <CalendarClock aria-hidden="true" />,
              availabilitySummary(draft.schedule, data.schedules, hour12, data.owner.weekStart),
              <AvailabilitySection
                {...common}
                schedules={data.schedules}
                hour12={hour12}
                weekStart={data.owner.weekStart}
                today={data.today}
                scheduleEditable={data.scheduleEditable}
              />,
            )}
            {showMore && (
              <>
                {data.personas &&
                  draft.personas &&
                  sectionCard("personas", <Users aria-hidden="true" />, personasSummary(draft, data.personas), <PersonasSection {...common} personas={data.personas} />)}
                {sectionCard(
                  "description",
                  <AlignLeft aria-hidden="true" />,
                  htmlSummary(draft.descriptionHtml) || "No description",
                  <DescriptionSection {...common} />,
                )}
                {sectionCard("limits", <Timer aria-hidden="true" />, limitsSummary(draft), <LimitsSection {...common} hostLimits={data.hostLimits} />)}
                {sectionCard(
                  "bookingPage",
                  <Link2 aria-hidden="true" />,
                  data.linkPrefix
                    ? `${data.linkPrefix}${draft.slug || (isNew ? "..." : "")}`
                    : Number.isInteger(draft.slotIncrementMinutes)
                      ? `${draft.slotIncrementMinutes} min increments`
                      : "Start time increments",
                  <BookingPageSection
                    {...common}
                    linkPrefix={data.linkPrefix}
                    savedSlug={baseline.slug}
                    eventTypeId={eventTypeId}
                    isNew={!eventTypeId}
                    hour12={hour12}
                    scheduleZone={scheduleZone}
                    calendars={data.calendars}
                    defaultCalendarName={data.defaultCalendarName}
                  />,
                )}
                {sectionCard("inviteeForm", <ClipboardList aria-hidden="true" />, inviteeFormSummary(draft, kind), <InviteeFormSection {...common} kind={kind} />)}
                {sectionCard(
                  "notifications",
                  <Bell aria-hidden="true" />,
                  notificationsSummary(mode, remindersInitial),
                  <NotificationsSection
                    {...common}
                    eventTypeId={eventTypeId}
                    invitationsAvailable={data.invitationsAvailable}
                    kind={kind}
                    remindersInitial={remindersInitial}
                  />,
                )}
                {sectionCard(
                  "confirmation",
                  <CheckCircle2 aria-hidden="true" />,
                  draft.afterBooking === "redirect" ? `Redirect to ${draft.redirectUrl || "an external site"}` : "Display confirmation page",
                  <ConfirmationSection {...common} />,
                )}
              </>
            )}
          </div>
          {!showMore && (
            <div className="px-4 py-5 sm:hidden">
              <Button variant="tertiary" onClick={() => setShowMore(true)}>
                More options
              </Button>
            </div>
          )}
          <div className="h-6" aria-hidden="true" />
        </div>
        <StickyFooterBar
          start={
            <>
              {!showMore && (
                <Button variant="tertiary" size="sm" onClick={() => setShowMore(true)} className="hidden sm:inline-flex">
                  More options
                </Button>
              )}
              <Button variant="tertiary" size="sm" leftIcon={<Eye aria-hidden="true" />} onClick={() => setMobilePreview(true)} className="lg:hidden">
                Preview
              </Button>
            </>
          }
        >
          {canEdit ? (
            <>
              <Button variant="secondary" onClick={cancel} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving} disabled={!dirty && !isNew}>
                Save changes
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => router.push("/app/scheduling")}>
              Close
            </Button>
          )}
        </StickyFooterBar>
      </section>

      <PreviewPane
        previewPath={data.previewPath}
        draft={previewDraft}
        availabilityDirty={availabilityDirty}
        reloadKey={reloadKey}
        className={cn("h-full flex-1", mobilePreview ? "flex pt-14 lg:pt-0" : "hidden lg:flex")}
        scaled={!mobilePreview}
        active={wide || mobilePreview}
      />
      {mobilePreview && (
        <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-white px-4 lg:hidden">
          <span className="text-title-sm text-ink">Preview</span>
          <Button variant="secondary" size="sm" onClick={() => setMobilePreview(false)}>
            Back to editor
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={guard.pendingHref !== null}
        onOpenChange={(v) => !v && guard.keepEditing()}
        title={UNSAVED_TITLE}
        description={UNSAVED_BODY}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => guard.discard()}
      />
      <InternalNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        eventTypeId={eventTypeId}
        note={draft.internalNote || null}
        onApply={(internalNote) => update({ internalNote })}
        onSaved={(note, next) => {
          applyServerVersion(next);
          setBaseline((b) => ({ ...b, internalNote: note ?? "" }));
          setDraft((d) => ({ ...d, internalNote: note ?? "" }));
          router.refresh();
        }}
      />
      {eventTypeId && (
        <DeleteEventTypeDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          eventType={{ id: eventTypeId, name: draft.name || baseline.name }}
          onDeleted={() => {
            guard.allowNext();
            router.push("/app/scheduling");
          }}
        />
      )}
    </div>
  );
}
