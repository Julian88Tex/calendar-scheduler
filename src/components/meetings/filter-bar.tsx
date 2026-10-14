// The filter row of the Meetings page (SPEC MT-08; walkthrough 10.1): the search box (invitee name or email, event
// name), "Event Types", "Status" ("Active events", "Canceled events") and "Invitee Emails" dropdowns, and "Clear all
// filters". docs/SCOPE.md has one person and no team, so the Teams, Hosts and Tracking ID filters of multi-user
// accounts are not offered. Every change navigates (the filters live in the URL). Client component.
"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/form-field";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { fill, MEETINGS_COPY as C } from "@/lib/meetings/copy";
import { clearedFilters, hasActiveFilters, MAX_FILTER_EMAILS, parseEmailList, type MeetingStatus, type MeetingsQuery, type QueryPatch } from "@/lib/meetings/filters";
import type { EventTypeOption } from "@/lib/meetings/types";

export type FilterBarProps = {
  query: MeetingsQuery;
  eventTypes: EventTypeOption[];
  onChange: (patch: QueryPatch) => void;
};

function FilterButton({ label, summary, active, ...rest }: { label: string; summary: string | null; active: boolean } & Omit<React.ComponentProps<"button">, "value">) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        active ? "border-primary bg-primary-soft text-primary-text" : "border-line-medium bg-white text-ink hover:bg-primary-soft",
      )}
    >
      <span>{label}</span>
      {summary && <span className="max-w-40 truncate font-normal">{`: ${summary}`}</span>}
      <ChevronDown aria-hidden="true" className="size-4" />
    </button>
  );
}

function EventTypesFilter({ query, eventTypes, onChange }: FilterBarProps) {
  const selected = query.eventTypeIds;
  const names = eventTypes.filter((e) => selected.includes(e.id)).map((e) => e.name);
  const value = selected.length === 0 ? null : selected.length === 1 ? (names[0] ?? fill(C.eventTypesCount, { count: 1 })) : fill(C.eventTypesCount, { count: selected.length });
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((s) => s !== id);
    onChange({ eventTypeIds: eventTypes.map((e) => e.id).filter((e) => next.includes(e)).concat(next.filter((n) => !eventTypes.some((e) => e.id === n))) });
  };
  return (
    <Popover align="start" aria-label={C.eventTypes} className="w-72" trigger={<FilterButton label={C.eventTypes} summary={value} active={selected.length > 0} />}>
      {eventTypes.length === 0 ? (
        <p className="text-body-md text-ink-2">{C.noEventTypes}</p>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-label text-ink">{C.eventTypes}</legend>
          {eventTypes.map((e) => (
            <Checkbox
              key={e.id}
              checked={selected.includes(e.id)}
              onCheckedChange={(v) => toggle(e.id, v)}
              label={
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                  {e.name}
                </span>
              }
            />
          ))}
          <div className="border-t border-line pt-2">
            <Button variant="tertiary" size="sm" className="-ml-3" disabled={selected.length === 0} onClick={() => onChange({ eventTypeIds: [] })}>
              {C.eventTypesAll}
            </Button>
          </div>
        </fieldset>
      )}
    </Popover>
  );
}

function StatusFilter({ query, onChange }: Pick<FilterBarProps, "query" | "onChange">) {
  const has = (s: MeetingStatus) => query.status.includes(s);
  const both = has("active") && has("canceled");
  const value = both ? `${C.statusActive}, ${C.statusCanceled}` : has("canceled") ? C.statusCanceled : null;
  const set = (s: MeetingStatus, on: boolean) => {
    const next = (["active", "canceled"] as const).filter((x) => (x === s ? on : has(x)));
    if (next.length) onChange({ status: [...next] });
  };
  return (
    <Popover align="start" aria-label={C.status} className="w-64" trigger={<FilterButton label={C.status} summary={value} active={!has("active") || both} />}>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-label text-ink">{C.status}</legend>
        {/* At least one status stays selected. */}
        <Checkbox checked={has("active")} disabled={has("active") && !has("canceled")} onCheckedChange={(v) => set("active", v)} label={C.statusActive} />
        <Checkbox checked={has("canceled")} disabled={has("canceled") && !has("active")} onCheckedChange={(v) => set("canceled", v)} label={C.statusCanceled} />
      </fieldset>
    </Popover>
  );
}

function EmailsFilter({ query, onChange }: Pick<FilterBarProps, "query" | "onChange">) {
  const id = `emails-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(query.emails.join(", "));
  const [error, setError] = useState<string | null>(null);
  const value = query.emails.length === 0 ? null : query.emails.length === 1 ? query.emails[0]! : fill(C.inviteeEmailsCount, { count: query.emails.length });
  const apply = () => {
    const parsed = parseEmailList(text);
    if (parsed.invalid.length || parsed.emails.length > MAX_FILTER_EMAILS) {
      setError(C.inviteeEmailsInvalid);
      return;
    }
    setError(null);
    setOpen(false);
    onChange({ emails: parsed.emails });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setText(query.emails.join(", "));
          setError(null);
        }
      }}
      align="start"
      aria-label={C.inviteeEmails}
      className="w-80"
      trigger={<FilterButton label={C.inviteeEmails} summary={value} active={query.emails.length > 0} />}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label htmlFor={id} className="text-label text-ink">
          {C.inviteeEmails}
        </label>
        <Textarea
          id={id}
          rows={3}
          value={text}
          invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          placeholder={C.inviteeEmailsPlaceholder}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              apply();
            }
          }}
        />
        <p id={`${id}-hint`} className="text-body-sm text-ink-2">
          {C.inviteeEmailsHint}
        </p>
        <FieldError id={`${id}-error`} error={error} />
        <div className="flex justify-end gap-2">
          {query.emails.length > 0 && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                setOpen(false);
                onChange({ emails: [] });
              }}
            >
              {C.clear}
            </Button>
          )}
          <Button type="submit" size="sm">
            {C.apply}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

export function FilterBar({ query, eventTypes, onChange }: FilterBarProps) {
  // The search box keeps what the user types; a change from elsewhere ("Clear all filters", back navigation) resets it.
  const [text, setText] = useState(query.q);
  const [synced, setSynced] = useState(query.q);
  const [sent, setSent] = useState<string | null>(null);
  if (query.q !== synced) {
    setSynced(query.q);
    if (query.q !== sent) setText(query.q);
  }
  return (
    <div role="group" aria-label={C.filtersRegion} className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-3 sm:px-6" data-testid="meetings-filters">
      <SearchInput
        value={text}
        onValueChange={setText}
        placeholder={C.searchPlaceholder}
        aria-label={C.searchLabel}
        debounceMs={400}
        onSearch={(v) => {
          const next = v.replace(/\s+/g, " ").trim();
          if (next === query.q) return;
          setSent(next);
          onChange({ q: next });
        }}
        className="w-full bg-white sm:w-64"
      />
      <EventTypesFilter query={query} eventTypes={eventTypes} onChange={onChange} />
      <StatusFilter query={query} onChange={onChange} />
      <EmailsFilter key={query.emails.join(",")} query={query} onChange={onChange} />
      {hasActiveFilters(query) && (
        <Button variant="tertiary" size="sm" onClick={() => onChange(clearedFilters())}>
          {C.clearAll}
        </Button>
      )}
    </div>
  );
}
