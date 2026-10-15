// The Meetings page body (SPEC MT-01, MT-02, MT-05, MT-08, MT-11, MT-15; walkthrough 10.1): the counter "Displaying 1
// - 25 of 42 Events", a white card with the tabs Upcoming | Past | Date Range, "Export" (CSV of the tab and filters)
// and "Filter" (opens the filter row), the date range picker on the Date Range tab (choosing the tab opens its calendar
// right away, like Calendly), the meetings grouped under date headers, "Previous" / "Next" pages and the empty states
// with "Share your link". The state lives in the URL: tabs, filters and pages navigate (keeping the current view until
// the next one arrives); "Details" only rewrites ?event={id} in place. docs/SCOPE.md: one person, so no "My {AppName}"
// switch, no Unconfirmed or Pending tabs and no buffers toggle. Client component.
"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button, buttonClassName } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";
import { MEDIA, useMediaQuery } from "@/lib/client/use-media-query";
import { cn } from "@/lib/cn";
import { fill, MEETINGS_COPY as C } from "@/lib/meetings/copy";
import { activeFilterCount, clearedFilters, DEFAULT_STATUS, exportHref, hasActiveFilters, meetingsHref, RANGE_MAX, RANGE_MIN, type MeetingsTab, type QueryPatch } from "@/lib/meetings/filters";
import { rangePresets } from "@/lib/meetings/ranges";
import type { MeetingsPageData, MeetingView } from "@/lib/meetings/types";
import { ExportButton } from "./export-button";
import { FilterBar } from "./filter-bar";
import { MeetingRow } from "./meeting-row";
import { useBusinessClock } from "./use-business-clock";

const TABS: { tab: MeetingsTab; label: string }[] = [
  { tab: "upcoming", label: C.tabs.upcoming },
  { tab: "past", label: C.tabs.past },
  { tab: "range", label: C.tabs.range },
];

const LIST_ID = "meetings-list";

/**
 * After a cancel or a reschedule the row that held the focus leaves the list. Once the new data is in (and only if the
 * focus was lost to the page body), focus moves to the expanded meeting's details (the new time) or to the list.
 * Returns the function that arms it for the next refreshes (15 seconds).
 */
function useFocusAfterRefresh(data: MeetingsPageData): () => void {
  const until = useRef(0);
  useEffect(() => {
    if (until.current < Date.now()) return;
    const current = document.activeElement;
    if (current && current !== document.body && current.isConnected) return;
    until.current = 0;
    const event = data.query.event;
    const target = (event && document.getElementById(`meeting-${event}-details`)) || document.getElementById(LIST_ID);
    target?.focus({ preventScroll: true });
  }, [data]);
  return useCallback(() => {
    until.current = Date.now() + 15_000;
  }, []);
}

export function MeetingsView({ data }: { data: MeetingsPageData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const phone = useMediaQuery(MEDIA.dashboardDrawer);
  const now = useBusinessClock(data.serverNow);
  const query = data.query;

  const [expanded, setExpanded] = useState<string | null>(query.event);
  const [seenEvent, setSeenEvent] = useState<string | null>(query.event);
  if (query.event !== seenEvent) {
    // New server data (a navigation or a refresh after an action) wins.
    setSeenEvent(query.event);
    setExpanded(query.event);
  }
  const filtered = hasActiveFilters(query);
  // The filter row opens by itself for filters the user chose. "Canceled events" added by a deep link to a canceled
  // meeting (statusExplicit false, also the refresh right after canceling an expanded meeting) does not open it.
  const chosenFilters = hasActiveFilters(query.statusExplicit ? query : { ...query, status: [...DEFAULT_STATUS] });
  const [filtersOpen, setFiltersOpen] = useState(chosenFilters);
  const [seenFiltered, setSeenFiltered] = useState(chosenFilters);
  if (chosenFilters !== seenFiltered) {
    setSeenFiltered(chosenFilters);
    if (chosenFilters) setFiltersOpen(true);
  }

  const navigate = (href: string, replace = false) =>
    startTransition(() => {
      if (replace) router.replace(href as Route, { scroll: false });
      else router.push(href as Route, { scroll: false });
    });
  const change = (patch: QueryPatch, opts: { replace?: boolean } = {}) => navigate(meetingsHref(query, { event: null, ...patch }), opts.replace);

  const restoreFocusSoon = useFocusAfterRefresh(data);
  // A click on the Date Range tab opens its calendar: the picker mounts open once the range data arrives.
  const [rangeOpen, setRangeOpen] = useState(false);

  const toggle = (id: string, open: boolean) => {
    const next = open ? id : null;
    setExpanded(next);
    try {
      // A null state lets the App Router adopt the new URL (its own entries carry internal state).
      window.history.replaceState(null, "", meetingsHref(query, { event: next }));
    } catch {
      // History unavailable: the expansion still works, only the URL does not follow.
    }
  };

  const rowProps = (m: MeetingView) => ({
    meeting: m,
    expanded: expanded === m.id,
    onToggle: (open: boolean) => toggle(m.id, open),
    phone,
    now,
    onFilterByEventType: (eventTypeId: string) => {
      setExpanded(null);
      setFiltersOpen(true);
      change({ eventTypeIds: [eventTypeId] });
    },
    onCanceled: () => {
      setExpanded(null);
      restoreFocusSoon();
      navigate(meetingsHref(query, { event: null }), true);
    },
    onRescheduled: (scheduledEventId: string) => {
      restoreFocusSoon();
      navigate(meetingsHref(query, { event: scheduledEventId, after: null, before: null, page: 1 }));
    },
    onOpenMeeting: (scheduledEventId: string) => navigate(`/app/meetings?event=${encodeURIComponent(scheduledEventId)}`),
  });

  const empty = data.groups.length === 0;
  const emptyHeading = query.tab === "past" ? C.empty.past : query.tab === "range" ? C.empty.range : C.empty.upcoming;
  const filterCount = activeFilterCount(query);
  const presets = rangePresets(data.today, data.weekStart);
  const prevHref = data.pager.prev ? meetingsHref(query, { before: data.pager.prev.before, after: null, page: data.pager.prev.page, event: null }) : null;
  const nextHref = data.pager.next ? meetingsHref(query, { after: data.pager.next.after, before: null, page: data.pager.next.page, event: null }) : null;

  const pageLink = (href: string | null, label: string, dir: "prev" | "next") => {
    const content = (
      <>
        {dir === "prev" && <ChevronLeft aria-hidden="true" />}
        {label}
        {dir === "next" && <ChevronRight aria-hidden="true" />}
      </>
    );
    const cls = buttonClassName({ variant: "secondary", size: "sm" });
    if (!href) {
      return (
        <Button variant="secondary" size="sm" disabled>
          {content}
        </Button>
      );
    }
    return (
      <Link
        href={href as Route}
        rel={dir}
        className={cls}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(href);
          window.scrollTo({ top: 0 });
        }}
      >
        {content}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="min-h-5 text-body-md text-ink-2 sm:text-right" aria-live="polite" data-testid="meetings-counter">
        {data.total > 0 ? fill(C.displaying, { from: data.from, to: data.to, total: data.total }) : null}
      </p>
      <section aria-label={C.title} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
        <div className="flex flex-col gap-2 border-b border-line px-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <nav aria-label={C.tabsLabel} className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = query.tab === t.tab;
              const href = meetingsHref(query, { tab: t.tab, start: null, end: null, event: null });
              return (
                <Link
                  key={t.tab}
                  href={href as Route}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    setRangeOpen(t.tab === "range");
                    if (!active) navigate(href);
                  }}
                  className={cn(
                    "inline-flex min-h-12 items-center gap-1 border-b-[3px] px-3 text-[15px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                    active ? "border-primary font-bold text-ink" : "border-transparent font-semibold text-ink-2 hover:text-ink",
                  )}
                  data-testid={`meetings-tab-${t.tab}`}
                >
                  {t.label}
                  {t.tab === "range" && <ChevronDown aria-hidden="true" className="size-4" />}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 pb-3 sm:pt-3">
            <ExportButton href={exportHref(query)} />
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={filtersOpen}
              aria-controls="meetings-filter-bar"
              aria-label={filterCount ? fill(C.filterApplied, { count: filterCount }) : C.filter}
              leftIcon={<ListFilter aria-hidden="true" />}
              onClick={() => setFiltersOpen((v) => !v)}
              data-testid="meetings-filter-toggle"
            >
              {C.filter}
              {filterCount > 0 && (
                <span aria-hidden="true" className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] leading-none font-bold text-white">
                  {filterCount}
                </span>
              )}
            </Button>
          </div>
        </div>
        {query.tab === "range" && query.start && query.end && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6" data-testid="meetings-range">
            <DateRangePicker
              aria-label={C.rangeLabel}
              open={rangeOpen}
              onOpenChange={setRangeOpen}
              value={{ start: query.start, end: query.end }}
              onChange={(r) => {
                if (r.start && r.end) change({ tab: "range", start: r.start, end: r.end });
              }}
              presets={presets}
              weekStart={data.weekStart}
              min={RANGE_MIN}
              max={RANGE_MAX}
            />
            <span className="text-body-sm text-ink-2">{data.timeZoneLabel}</span>
          </div>
        )}
        {filtersOpen && (
          <div id="meetings-filter-bar">
            <FilterBar query={query} eventTypes={data.eventTypes} onChange={change} />
          </div>
        )}
        <div id={LIST_ID} tabIndex={-1} aria-busy={pending} className={cn("transition-opacity outline-none", pending && "opacity-60")} data-testid="meetings-list">
          {data.eventNotFound && (
            <div className="px-4 pt-4 sm:px-6">
              <Banner variant="warning" dismissible role="status">
                {C.notFound}
              </Banner>
            </div>
          )}
          {data.pinned && (
            <div className="border-b-4 border-line" data-testid="meetings-pinned">
              <h2 className="border-b border-line bg-canvas px-4 py-3 text-title-sm text-ink sm:px-6">{C.pinned}</h2>
              <ul>
                <MeetingRow {...rowProps(data.pinned)} />
              </ul>
            </div>
          )}
          {empty ? (
            <EmptyState
              illustration={<Illustration name="calendar" />}
              heading={emptyHeading}
              body={filtered ? C.empty.filteredBody : data.shareUrl ? C.empty.body : null}
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => change(clearedFilters())}>
                    {C.clearAll}
                  </Button>
                ) : data.shareUrl ? (
                  <CopyButton value={data.shareUrl} label={C.empty.share} variant="primary" />
                ) : null
              }
            />
          ) : (
            data.groups.map((g) => (
              <DayGroup key={g.dateKey} label={g.label}>
                {g.meetings.map((m) => (
                  <MeetingRow key={m.id} {...rowProps(m)} />
                ))}
              </DayGroup>
            ))
          )}
        </div>
        {(data.pager.prev || data.pager.next) && (
          <nav aria-label={C.pagination} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
            {pageLink(prevHref, C.previous, "prev")}
            {pageLink(nextHref, C.next, "next")}
          </nav>
        )}
      </section>
    </div>
  );
}

function DayGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="border-b border-line bg-canvas px-4 py-3 text-[15px] leading-6 font-bold text-ink sm:px-6">{label}</h2>
      <ul>{children}</ul>
    </div>
  );
}
