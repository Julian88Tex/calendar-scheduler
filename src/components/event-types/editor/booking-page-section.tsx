// Booking page options section (SPEC ET-23, SCH-10, CAL-20): the Event link (static profile prefix plus the editable
// slug with a live uniqueness check), start time increments with an example, the time zone display (detect or lock)
// and, when the owner has writable calendars, the "Add events to" destination override. Client component.
"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { FieldError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { formatMinutes } from "@/components/ui/time-input-utils";
import { useDebounced } from "@/lib/client";
import { checkEventSlugAction } from "@/lib/event-types/actions";
import { INCREMENT_MAX, INCREMENT_MIN, INCREMENT_PRESETS } from "@/lib/event-types/constants";
import type { EditorCalendarOption } from "@/lib/event-types/types";
import { slugify } from "@/lib/slugs";
import { errorOf, FieldGroup, MinutesSelect, minutesLabel, type SectionProps } from "./fields";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/** "30 min: 9:00, 9:30, 10:00" (ET-23 example under the increments select). */
export function incrementExample(minutes: number, hour12 = true): string {
  const starts = [0, 1, 2].map((k) => 9 * 60 + k * minutes).filter((m) => m < 1440);
  const fmt = (m: number) => formatMinutes(m, hour12).replace(/(am|pm)$/i, "");
  return `${minutesLabel(minutes)}: ${starts.map(fmt).join(", ")}`;
}

type SlugState = { status: "idle" | "checking" | "available" | "taken" | "invalid"; message: string | null; slug: string };

function useSlugCheck(slug: string, savedSlug: string, eventTypeId: string | null, enabled: boolean): SlugState {
  const debounced = useDebounced(slug, 400);
  const [result, setResult] = useState<SlugState | null>(null);
  const checkable = enabled && Boolean(debounced) && debounced !== savedSlug && SLUG_RE.test(debounced);
  useEffect(() => {
    if (!checkable) return;
    let alive = true;
    checkEventSlugAction({ slug: debounced, eventTypeId })
      .then((r) => {
        if (!alive) return;
        setResult(
          r.ok
            ? { status: r.data.available ? "available" : "taken", message: r.data.message, slug: debounced }
            : { status: "idle", message: null, slug: debounced },
        );
      })
      .catch(() => alive && setResult({ status: "idle", message: null, slug: debounced }));
    return () => {
      alive = false;
    };
  }, [checkable, debounced, eventTypeId]);
  if (!enabled || !slug || slug === savedSlug) return { status: "idle", message: null, slug };
  if (!SLUG_RE.test(slug)) return { status: "invalid", message: "Use lowercase letters, numbers and hyphens.", slug };
  if (result?.slug === slug) return result;
  return { status: "checking", message: null, slug };
}

export function BookingPageSection({
  draft,
  update,
  errors,
  disabled,
  linkPrefix,
  savedSlug,
  eventTypeId,
  isNew,
  hour12,
  scheduleZone,
  calendars,
  defaultCalendarName,
}: SectionProps & {
  linkPrefix: string | null;
  savedSlug: string;
  eventTypeId: string | null;
  isNew: boolean;
  hour12: boolean;
  scheduleZone: string;
  calendars: EditorCalendarOption[];
  defaultCalendarName: string | null;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const shownSlug = draft.slug || (isNew ? slugify(draft.name) : "");
  const check = useSlugCheck(draft.slug, savedSlug, eventTypeId, !disabled && Boolean(draft.slug));
  const slugError = errorOf(errors, "slug") ?? (check.status === "taken" || check.status === "invalid" ? check.message : null);
  const incrementError = errorOf(errors, "slotIncrementMinutes");
  const zoneError = errorOf(errors, "lockedTimeZone");

  return (
    <div className="flex flex-col gap-7">
      <FieldGroup title="Event link" id={`${base}-link`}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center overflow-hidden rounded-[var(--radius-input)] border border-line bg-pebble focus-within:border-primary">
            {linkPrefix && (
              <span className="max-w-[55%] shrink-0 truncate pl-3 text-body-md text-ink-2" title={linkPrefix}>
                {linkPrefix}
              </span>
            )}
            <Input
              id={`${base}-slug`}
              aria-labelledby={`${base}-link`}
              aria-describedby={slugError ? `${base}-slug-error` : `${base}-slug-status`}
              value={shownSlug}
              maxLength={100}
              disabled={disabled}
              invalid={Boolean(slugError)}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
              className="min-w-0 flex-1 rounded-none border-0 bg-white"
            />
          </div>
          <span id={`${base}-slug-status`} role="status" aria-live="polite" className="text-body-sm text-ink-2">
            {check.status === "checking" && draft.slug && draft.slug !== savedSlug && (
              <span className="inline-flex items-center gap-1">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> Checking availability
              </span>
            )}
            {check.status === "available" && (
              <span className="inline-flex items-center gap-1 text-success-text">
                <Check aria-hidden="true" className="size-3.5" /> This link is available
              </span>
            )}
            {isNew && !draft.slug && "Your link follows the event name until you change it."}
          </span>
          {slugError && <FieldError id={`${base}-slug-error`} error={slugError} />}
        </div>
      </FieldGroup>

      <FieldGroup title="Start time increments" hint="Show available start times in increments of">
        <MinutesSelect
          value={draft.slotIncrementMinutes}
          onChange={(slotIncrementMinutes) => update({ slotIncrementMinutes })}
          presets={INCREMENT_PRESETS}
          min={INCREMENT_MIN}
          max={INCREMENT_MAX}
          disabled={disabled}
          invalid={Boolean(incrementError)}
          aria-label="Start time increments"
        />
        <p className="text-body-sm text-ink-2">{incrementExample(draft.slotIncrementMinutes, hour12)}</p>
        {incrementError && <FieldError error={incrementError} />}
      </FieldGroup>

      <FieldGroup title="Time zone display">
        <RadioGroup
          aria-label="Time zone display"
          value={draft.timeZoneDisplay}
          disabled={disabled}
          onValueChange={(v) =>
            update(v === "locked" ? { timeZoneDisplay: "locked", lockedTimeZone: draft.lockedTimeZone ?? scheduleZone } : { timeZoneDisplay: "auto" })
          }
          options={[
            { value: "auto", label: "Automatically detect and show the times in my invitee's time zone", description: "Recommended" },
            { value: "locked", label: "Lock the timezone (best for in-person events)" },
          ]}
        />
        {draft.timeZoneDisplay === "locked" && (
          <div className="flex flex-col gap-1.5 pl-7">
            <TimeZoneSelect
              value={draft.lockedTimeZone ?? scheduleZone}
              onChange={(lockedTimeZone) => update({ lockedTimeZone })}
              disabled={disabled}
              hour12={hour12}
              aria-label="Locked time zone"
            />
            {zoneError && <FieldError error={zoneError} />}
          </div>
        )}
      </FieldGroup>

      {calendars.length > 0 && (
        <FieldGroup title="Add events to" hint="The calendar that new meetings of this event type are added to.">
          <Select
            aria-label="Add events to"
            value={draft.destinationCalendarId ?? "default"}
            disabled={disabled}
            onValueChange={(v) => update({ destinationCalendarId: v === "default" ? null : v })}
            options={[
              { value: "default", label: defaultCalendarName ? `Default (${defaultCalendarName})` : "Default calendar" },
              ...calendars.map((c) => ({ value: c.id, label: c.accountEmail ? `${c.name} (${c.accountEmail})` : c.name, textValue: c.name })),
            ]}
          />
          {errorOf(errors, "destinationCalendarId") && <FieldError error={errorOf(errors, "destinationCalendarId")} />}
        </FieldGroup>
      )}
    </div>
  );
}
