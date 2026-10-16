// OWNER: event-types-editor.
//
// LocationEditor (ARCHITECTURE section 25, SPEC ET-17, VID-01 to VID-07, VID-15): edits LocationConfig[] for event
// types, one-off meetings, polls and the profile default location (mode "single": at most one location). Offers the
// kinds docs/SCOPE.md builds (In-person, Google Meet, Ask invitee); other kinds stored on a record are listed with their
// label and can be removed. Several options let the invitee pick one on the booking form (BK-11); rows reorder with the
// grip (mouse or arrow keys). Google Meet shows the VID-07 requirement and a "Connect" link when the user's calendar
// connections cannot host it (conferencing availability is fetched for `userId` unless passed in `conferencing`).
"use client";

import { MapPin, MessageCircleQuestion, Pencil, Plus, Trash2, Video } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type * as React from "react";
import type { LocationConfig, LocationKind } from "@/db/types";
import { loadConferencingOptionsAction } from "@/lib/event-types/actions";
import {
  CONFERENCING_DETAILS_COPY,
  EDITOR_LOCATION_KINDS,
  GOOGLE_MEET_REQUIREMENT,
  LOCATION_TEXT_MAX,
  MAX_LOCATIONS,
  MESSAGES,
  SINGLETON_LOCATION_KINDS,
} from "@/lib/event-types/constants";
import type { EditorConferencingOption } from "@/lib/event-types/types";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { FieldError, FormField } from "../ui/form-field";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { ProviderLogo } from "../ui/provider-logo";
import { Textarea } from "../ui/textarea";
import { LOCATION_KIND_LABELS } from "./location-labels";
import { DragHandle, moveItem, SortableAssist, useSortable } from "./sortable";

export type LocationEditorProps = {
  value: LocationConfig[];
  onChange: (value: LocationConfig[]) => void;
  /** "single": at most one location (profile default, polls). */
  mode: "multiple" | "single";
  /** Restrict the offered kinds (default: the kinds the editor builds, docs/SCOPE.md). */
  allowedKinds?: LocationKind[];
  /** The user whose conferencing connections decide availability (connect prompts). */
  userId: string;
  disabled?: boolean;
  /** Preloaded availability per conferencing kind (skips the fetch). */
  conferencing?: Record<string, EditorConferencingOption> | null;
  /** Field errors keyed "{index}.location", "{index}" or "" (list level). */
  errors?: Record<string, string[]>;
  /** Accessible name of the list (default "Locations"). */
  label?: string;
};

/** Tile labels of the offered kinds (Calendly's location buttons). */
const TILE_LABELS: Partial<Record<LocationKind, string>> = {
  physical: "In-person",
  google_conference: "Google Meet",
  ask_invitee: "Ask invitee",
};

function KindIcon({ kind, className }: { kind: LocationKind; className?: string }) {
  if (kind === "google_conference") return <ProviderLogo provider="meet" size={20} className={className} />;
  if (kind === "zoom_conference") return <ProviderLogo provider="zoom" size={20} className={className} />;
  if (kind === "microsoft_teams_conference") return <ProviderLogo provider="teams" size={20} className={className} />;
  if (kind === "jitsi_conference") return <ProviderLogo provider="jitsi" size={20} className={className} />;
  if (kind === "physical") return <MapPin aria-hidden="true" className={cn("size-5 text-ink-2", className)} />;
  if (kind === "ask_invitee") return <MessageCircleQuestion aria-hidden="true" className={cn("size-5 text-ink-2", className)} />;
  return <Video aria-hidden="true" className={cn("size-5 text-ink-2", className)} />;
}

/** Kinds this component knows how to configure. */
const CONFIGURABLE: readonly LocationKind[] = EDITOR_LOCATION_KINDS;

type DialogState = { mode: "add" | "edit"; index: number | null; draft: LocationConfig } | null;

function useConferencing(userId: string, preloaded: Record<string, EditorConferencingOption> | null | undefined, needed: boolean) {
  const [fetched, setFetched] = useState<Record<string, EditorConferencingOption> | null>(null);
  useEffect(() => {
    if (preloaded !== undefined || !needed || !userId) return;
    let alive = true;
    loadConferencingOptionsAction({ userId })
      .then((r) => {
        if (alive && r.ok) setFetched(r.data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId, preloaded, needed]);
  return preloaded ?? fetched;
}

function rowTitle(l: LocationConfig): string {
  if (l.kind === "physical") return (l.location ?? "").split("\n")[0]?.trim() || LOCATION_KIND_LABELS.physical;
  return LOCATION_KIND_LABELS[l.kind] ?? l.kind;
}

function RowDetails({ l }: { l: LocationConfig }) {
  if (l.kind === "physical") {
    const lines = (l.location ?? "").split("\n").slice(1).filter((x) => x.trim());
    return (
      <>
        {lines.map((line, i) => (
          <span key={i} className="block break-words text-body-md text-ink-2">
            {line}
          </span>
        ))}
        {l.additionalInfo && <span className="block whitespace-pre-line break-words text-body-md text-ink-2">{l.additionalInfo}</span>}
        {l.displayBeforeBooking === false && <span className="mt-0.5 block text-body-sm font-semibold text-ink-2">Shown after confirmation</span>}
      </>
    );
  }
  if (l.kind === "ask_invitee") {
    return <span className="block text-body-md text-ink-2">{l.location ? `Invitees see: ${l.location}` : "Invitees enter a location when they book."}</span>;
  }
  if (l.kind === "google_conference" || l.kind === "zoom_conference" || l.kind === "microsoft_teams_conference" || l.kind === "jitsi_conference") {
    return <span className="block text-body-md text-ink-2">{CONFERENCING_DETAILS_COPY}</span>;
  }
  if (l.location) return <span className="block whitespace-pre-line break-words text-body-md text-ink-2">{l.location}</span>;
  return null;
}

export function LocationEditor({
  value,
  onChange,
  mode,
  allowedKinds,
  userId,
  disabled,
  conferencing,
  errors,
  label = "Locations",
}: LocationEditorProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const offered = (allowedKinds ?? [...CONFIGURABLE]).filter((k) => CONFIGURABLE.includes(k));
  const needsConferencing = offered.includes("google_conference") || value.some((l) => l.kind === "google_conference");
  const options = useConferencing(userId, conferencing, needsConferencing);
  const [dialog, setDialog] = useState<DialogState>(null);
  const max = mode === "single" ? 1 : MAX_LOCATIONS;
  const used = new Set(value.map((l) => l.kind));
  const addable = offered.filter((k) => !(SINGLETON_LOCATION_KINDS.includes(k) && used.has(k)));
  const canAdd = !disabled && value.length < max && addable.length > 0;

  const commit = (next: LocationConfig[]) => onChange(next.map((l, i) => ({ ...l, position: i })));
  const sortable = useSortable(value.length, (from, to) => commit(moveItem(value, from, to)), { disabled, idPrefix: `${base}-loc` });

  const start = (kind: LocationKind) => {
    const draft: LocationConfig = { id: newId(), kind, position: value.length };
    if (kind === "physical") {
      setDialog({ mode: "add", index: null, draft: { ...draft, location: "", additionalInfo: "", displayBeforeBooking: true } });
    } else if (kind === "ask_invitee") {
      setDialog({ mode: "add", index: null, draft: { ...draft, location: "" } });
    } else {
      commit(mode === "single" ? [draft] : [...value, draft]);
    }
  };

  const save = (draft: LocationConfig) => {
    if (!dialog) return;
    if (dialog.index === null) commit(mode === "single" ? [draft] : [...value, draft]);
    else commit(value.map((l, i) => (i === dialog.index ? draft : l)));
    setDialog(null);
  };

  const remove = (index: number) => commit(value.filter((_, i) => i !== index));
  const listError = errors?.[""] ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {value.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-md text-ink-2">Add a location for invitees</p>
          <div role="group" aria-label="Location types" className="grid grid-cols-3 gap-2">
            {offered.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={disabled}
                onClick={() => start(kind)}
                className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line bg-white px-2 py-3 text-center text-body-md font-semibold text-ink transition-colors hover:border-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                <KindIcon kind={kind} className="size-6" />
                <span>{TILE_LABELS[kind] ?? LOCATION_KIND_LABELS[kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul aria-label={label} className="flex flex-col gap-2">
          {value.map((l, i) => {
            const title = rowTitle(l);
            const editable = CONFIGURABLE.includes(l.kind) && l.kind !== "google_conference";
            const option = l.kind === "google_conference" ? options?.google_conference : undefined;
            const rowErrors = [...(errors?.[String(i)] ?? []), ...(errors?.[`${i}.location`] ?? []), ...(errors?.[`${i}.additionalInfo`] ?? [])];
            return (
              <li
                key={l.id}
                {...sortable.rowProps(i)}
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-[var(--radius-card)] border border-line bg-white py-2.5 pr-2 pl-1",
                  rowErrors.length > 0 && "border-danger",
                  sortable.overIndex === i && "border-primary bg-primary-soft",
                )}
              >
                {mode === "multiple" && <DragHandle {...sortable.handleProps(i, title)} className="mt-0.5" />}
                <span className={cn("mt-1.5 inline-flex shrink-0", mode === "single" && "ml-2")}>
                  <KindIcon kind={l.kind} />
                </span>
                <div className="min-w-0 flex-1 py-1">
                  <span className="block break-words text-body-md font-semibold text-ink">{title}</span>
                  <RowDetails l={l} />
                  {option && !option.available && (
                    <p className="mt-1.5 text-body-sm text-warning-text">
                      {option.reason || GOOGLE_MEET_REQUIREMENT}{" "}
                      {option.connectUrl && (
                        <Link href={option.connectUrl as Route} className="font-semibold text-primary-text underline">
                          Connect
                        </Link>
                      )}
                    </p>
                  )}
                  {rowErrors.length > 0 && <FieldError error={rowErrors[0]} className="mt-1" />}
                </div>
                <div className="flex shrink-0 items-center">
                  {editable && (
                    <IconButton
                      size="sm"
                      aria-label={`Edit ${title}`}
                      disabled={disabled}
                      onClick={() => setDialog({ mode: "edit", index: i, draft: { ...l } })}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </IconButton>
                  )}
                  <IconButton size="sm" aria-label={`Remove ${title}`} disabled={disabled} onClick={() => remove(i)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {value.length > 1 && <SortableAssist idPrefix={`${base}-loc`} announcement={sortable.announcement} />}
      {value.length > 0 && canAdd && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="tertiary" size="sm" leftIcon={<Plus aria-hidden="true" />} className="self-start">
              Add a location
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {addable.map((kind) => (
              <DropdownMenuItem key={kind} icon={<KindIcon kind={kind} className="size-4" />} onSelect={() => start(kind)}>
                {TILE_LABELS[kind] ?? LOCATION_KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {mode === "multiple" && value.length > 1 && <p className="text-body-sm text-ink-2">Invitees choose one of these locations when they book.</p>}
      {listError && <FieldError error={listError} />}
      {dialog && <LocationDialog state={dialog} onCancel={() => setDialog(null)} onSave={save} />}
    </div>
  );
}

function LocationDialog({ state, onCancel, onSave }: { state: NonNullable<DialogState>; onCancel: () => void; onSave: (l: LocationConfig) => void }) {
  const formId = `location-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [draft, setDraft] = useState<LocationConfig>(state.draft);
  const [error, setError] = useState<{ location?: string; additionalInfo?: string }>({});
  const isPhysical = draft.kind === "physical";
  const title = isPhysical ? "In-person meeting" : "Ask invitee";

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const location = (draft.location ?? "").replace(/\r\n?/g, "\n").trim();
    const additionalInfo = (draft.additionalInfo ?? "").replace(/\r\n?/g, "\n").trim();
    const next: { location?: string; additionalInfo?: string } = {};
    if (isPhysical && !location) next.location = MESSAGES.locationRequired;
    if (location.length > LOCATION_TEXT_MAX) next.location = MESSAGES.locationTooLong;
    if (additionalInfo.length > LOCATION_TEXT_MAX) next.additionalInfo = MESSAGES.locationTooLong;
    setError(next);
    if (next.location || next.additionalInfo) return;
    const out: LocationConfig = { id: draft.id, kind: draft.kind, position: draft.position };
    if (location) out.location = location;
    if (isPhysical) {
      if (additionalInfo) out.additionalInfo = additionalInfo;
      out.displayBeforeBooking = draft.displayBeforeBooking !== false;
    }
    onSave(out);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={title}
      description={isPhysical ? "Invitees see this location on the booking page and in their confirmation." : "Invitees enter a location of their choice when they book."}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            {state.mode === "add" ? "Add location" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {isPhysical ? (
          <>
            <FormField label="Location" required hint="Venue name or address. Add notes such as a dress code on a new line." error={error.location}>
              {(c) => (
                <Textarea
                  {...c}
                  rows={3}
                  autoResize
                  maxLength={LOCATION_TEXT_MAX}
                  value={draft.location ?? ""}
                  invalid={Boolean(error.location)}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  placeholder="Harbor Bistro - Waterfront"
                />
              )}
            </FormField>
            <FormField label="Additional information" hint="Street address, parking or directions." error={error.additionalInfo}>
              {(c) => (
                <Textarea
                  {...c}
                  rows={2}
                  autoResize
                  maxLength={LOCATION_TEXT_MAX}
                  value={draft.additionalInfo ?? ""}
                  invalid={Boolean(error.additionalInfo)}
                  onChange={(e) => setDraft({ ...draft, additionalInfo: e.target.value })}
                  placeholder="250 Embarcadero, San Francisco, CA 94111"
                />
              )}
            </FormField>
            <Checkbox
              label="Display location only after confirmation"
              description="The booking page shows 'Location will be provided after booking' instead."
              checked={draft.displayBeforeBooking === false}
              onCheckedChange={(v) => setDraft({ ...draft, displayBeforeBooking: !v })}
            />
          </>
        ) : (
          <FormField label="Instructions for invitees" hint="Optional. Shown under the location field on the booking form." error={error.location}>
            {(c) => (
              <Input
                {...c}
                maxLength={LOCATION_TEXT_MAX}
                value={draft.location ?? ""}
                invalid={Boolean(error.location)}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Any location"
              />
            )}
          </FormField>
        )}
      </form>
    </Dialog>
  );
}
