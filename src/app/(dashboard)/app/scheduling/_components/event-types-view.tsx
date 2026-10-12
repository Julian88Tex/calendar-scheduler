// Scheduling page, Event types tab (SPEC ET-03 to ET-12, ET-33; walkthrough 5.1 and 5.2; docs/SCOPE.md: one person,
// one-on-one event types). The toolbar (search "Search event types" filtering by name or link as you type, 150ms
// debounce, and the Filter menu; both kept in the URL), the personal section (header with the user's link, then the
// event type cards in their landing page order), drag and drop reorder (mouse and keyboard), card actions through
// the shared event type actions (On/Off, secret, internal note, duplicate, delete) with optimistic updates, the bulk
// bar ("{n} selected": Delete with one confirmation, Toggle on/off, Clear) and the empty states. Client component.
"use client";

import { Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toast";
import { DeleteEventTypeDialog, InternalNoteDialog } from "@/components/event-types";
import {
  duplicateEventTypeAction,
  reorderEventTypesAction,
  setEventTypeActiveAction,
  setEventTypeSecretAction,
} from "@/lib/event-types/actions";
import { DELETE_BODY } from "@/lib/event-types/constants";
import type { EventTypeListItem } from "@/lib/event-types/types";
import { bulkDeleteEventTypesAction, bulkSetEventTypesActiveAction } from "../actions";
import { EventTypeCard } from "./event-type-card";
import { FilterMenu } from "./filter-menu";
import {
  DEFAULT_FILTERS,
  filterEventTypes,
  filtersQuery,
  hasActiveFilters,
  kindOptions,
  SEARCH_DEBOUNCE_MS,
  type ListFilters,
} from "./list-filters";
import { bulkDeletedToast, bulkDeleteTitle, bulkToggledToast, bulkToggleTurnsOn } from "./list-text";
import { applyOrder, REORDER_HINT, reorderAnnouncements } from "./reorder";
import { SectionHeader, type SchedulingProfile } from "./section-header";
import { ShareDialog } from "./share-dialog";
import { useReorder } from "./use-reorder";

export type EventTypesViewProps = {
  profile: SchedulingProfile;
  items: EventTypeListItem[];
  initialFilters: ListFilters;
};

const NEW_EVENT_TYPE_HREF = "/app/event-types/new?kind=one_on_one" as const;
const LIST_ID = "personal-event-types";

export function EventTypesView({ profile, items: serverItems, initialFilters }: EventTypesViewProps) {
  // Local copy of the server list for optimistic updates; replaced whenever the server sends a fresh list.
  const [items, setItems] = useState(serverItems);
  const [prevServerItems, setPrevServerItems] = useState(serverItems);
  if (serverItems !== prevServerItems) {
    setPrevServerItems(serverItems);
    setItems(serverItems);
  }

  const [filters, setFilters] = useState<ListFilters>(initialFilters);
  const [searchText, setSearchText] = useState(initialFilters.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ id: string; note: string | null } | null>(null);
  const [shareTarget, setShareTarget] = useState<EventTypeListItem | null>(null);
  // The ids the bulk delete confirmation was opened for (its title keeps the count while it closes).
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const shareTrigger = useRef<HTMLElement | null>(null);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Filters live in the URL query (ET-06) without a server round trip.
  useEffect(() => {
    const query = filtersQuery(filters);
    if (window.location.search === query || (!query && !window.location.search)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${query}${window.location.hash}`);
  }, [filters]);

  const filtering = hasActiveFilters(filters);
  const visible = useMemo(() => filterEventTypes(items, filters), [items, filters]);
  const selectedItems = useMemo(() => visible.filter((e) => selected.has(e.id)), [visible, selected]);
  const kinds = useMemo(() => kindOptions(items), [items]);

  const updateFilters = (patch: Partial<ListFilters>) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      // Bulk actions act on what is visible: drop selections the new filters hide.
      const keep = new Set(filterEventTypes(items, next).map((e) => e.id));
      setSelected((s) => new Set([...s].filter((id) => keep.has(id))));
      return next;
    });
  };
  const clearFilters = () => {
    setSearchText("");
    updateFilters(DEFAULT_FILTERS);
  };

  const patchItem = (id: string, patch: Partial<EventTypeListItem>) => setItems((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const withPending = async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    setPending((s) => new Set(s).add(id));
    try {
      return await fn();
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };
  const removeItems = (ids: readonly string[]) => {
    const gone = new Set(ids);
    setItems((list) => list.filter((e) => !gone.has(e.id)));
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
  };

  // Reorder (ET-07): the whole personal section, only when nothing is filtered.
  const reorderEnabled = !filtering && items.length > 1;
  const commitOrder = useCallback(async (order: string[]) => {
    const previous = itemsRef.current;
    setItems(applyOrder(previous, order).map((e, position) => ({ ...e, position })));
    const result = await reorderEventTypesAction({ ids: order });
    if (!result.ok) {
      setItems(previous);
      toast.error(result.error.code === "internal" ? reorderAnnouncements.failed : result.error.message);
    }
  }, []);
  const reorder = useReorder({ ids: items.map((e) => e.id), enabled: reorderEnabled, idPrefix: LIST_ID, onCommit: commitOrder });
  const ordered = useMemo(() => {
    const byId = new Map(visible.map((e) => [e.id, e]));
    return filtering ? visible : reorder.order.map((id) => byId.get(id)).filter((e): e is EventTypeListItem => Boolean(e));
  }, [filtering, visible, reorder.order]);

  // A duplicated event type is outlined for a moment once the refreshed list shows it.
  useEffect(() => {
    if (!highlightId || !items.some((e) => e.id === highlightId)) return;
    document.querySelector(`[data-event-type-id="${highlightId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(timer);
  }, [highlightId, items]);

  const setActive = async (item: EventTypeListItem, active: boolean) => {
    patchItem(item.id, { active });
    const r = await withPending(item.id, () => setEventTypeActiveAction({ id: item.id, active }));
    if (!r.ok) {
      patchItem(item.id, { active: item.active });
      toast.error(r.error.message);
      return;
    }
    toast.success(active ? "Event type turned on" : "Event type turned off");
  };

  const setSecret = async (item: EventTypeListItem, secret: boolean) => {
    patchItem(item.id, { secret });
    const r = await withPending(item.id, () => setEventTypeSecretAction({ id: item.id, secret }));
    if (!r.ok) {
      patchItem(item.id, { secret: item.secret });
      toast.error(r.error.message);
      return;
    }
    toast.success(secret ? "Event type is now secret" : "Event type is now public");
  };

  const duplicate = async (item: EventTypeListItem) => {
    const r = await withPending(item.id, () => duplicateEventTypeAction({ id: item.id }));
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setHighlightId(r.data.id);
    toast.success("Event type duplicated");
  };

  const bulkToggle = async () => {
    const targets = selectedItems;
    if (!targets.length) return;
    const on = bulkToggleTurnsOn(targets);
    const ids = targets.map((e) => e.id);
    setBulkBusy(true);
    setItems((list) => list.map((e) => (ids.includes(e.id) ? { ...e, active: on } : e)));
    const r = await bulkSetEventTypesActiveAction({ ids, active: on });
    setBulkBusy(false);
    if (!r.ok) {
      const before = new Map(targets.map((e) => [e.id, e.active]));
      setItems((list) => list.map((e) => (before.has(e.id) ? { ...e, active: before.get(e.id) ?? e.active } : e)));
      toast.error(r.error.message);
      return;
    }
    toast.success(bulkToggledToast(ids.length, on));
  };

  const bulkDelete = async () => {
    const ids = bulkDeleteIds ?? [];
    if (!ids.length) return;
    const r = await bulkDeleteEventTypesAction({ ids });
    if (!r.ok) throw new Error(r.error.message);
    removeItems(ids);
    toast.success(bulkDeletedToast(ids.length));
  };

  const toggleSelected = (id: string, value: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  if (!items.length) {
    return (
      <section aria-labelledby={`${LIST_ID}-heading`} className="flex flex-col gap-6">
        <h2 id={`${LIST_ID}-heading`} className="sr-only">
          Personal event types
        </h2>
        <SectionHeader profile={profile} />
        <div className="rounded-[var(--radius-card)] border border-line bg-white">
          <EmptyState
            illustration={<Illustration name="calendar-plus" />}
            heading="Create scheduling links with event types"
            body="Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or office hours."
            action={
              <Button asChild leftIcon={<Plus aria-hidden="true" />}>
                <Link href={NEW_EVENT_TYPE_HREF}>New event type</Link>
              </Button>
            }
          />
        </div>
      </section>
    );
  }

  const selectedCount = selectedItems.length;
  const turnsOn = bulkToggleTurnsOn(selectedItems);

  return (
    <div className="flex flex-col gap-6">
      <div role="search" aria-label="Event types" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={searchText}
          onValueChange={setSearchText}
          onSearch={(q) => updateFilters({ q })}
          debounceMs={SEARCH_DEBOUNCE_MS}
          placeholder="Search event types"
          aria-label="Search event types"
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-2 sm:ml-auto">
          <FilterMenu filters={filters} kinds={kinds} onChange={updateFilters} />
        </div>
      </div>

      <section aria-labelledby={`${LIST_ID}-heading`} className="flex flex-col gap-4">
        <h2 id={`${LIST_ID}-heading`} className="sr-only">
          Personal event types
        </h2>
        <SectionHeader profile={profile} />

        {ordered.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-white">
            <EmptyState
              size="sm"
              illustration={<Illustration name="search" size={120} />}
              heading="No event types match your search."
              body="Try another name or link, or clear the search and filters."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear search and filters
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <span id={`${LIST_ID}-reorder-hint`} className="sr-only">
              {REORDER_HINT}
            </span>
            <ul aria-label="Personal event types" className="flex flex-col gap-3" {...reorder.listProps}>
              {ordered.map((item) => (
                <EventTypeCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onSelectedChange={(v) => toggleSelected(item.id, v)}
                  busy={pending.has(item.id) || bulkBusy}
                  handle={reorderEnabled ? reorder.handleProps(item.id, item.name) : null}
                  lifted={reorder.liftedId === item.id}
                  dragging={reorder.draggingId === item.id}
                  dropIndicator={reorder.dropTarget?.id === item.id ? reorder.dropTarget.position : null}
                  highlight={highlightId === item.id}
                  rowProps={reorderEnabled ? reorder.rowProps(item.id) : {}}
                  onShare={(trigger) => {
                    shareTrigger.current = trigger;
                    setShareTarget(item);
                  }}
                  onNote={() => setNoteTarget({ id: item.id, note: item.internalNote })}
                  onSecret={(v) => void setSecret(item, v)}
                  onDuplicate={() => void duplicate(item)}
                  onDelete={() => setDeleteTarget({ id: item.id, name: item.name })}
                  onActive={(v) => void setActive(item, v)}
                />
              ))}
            </ul>
            <span role="status" aria-live="polite" className="sr-only">
              {reorder.announcement}
            </span>
          </>
        )}
        {filtering && ordered.length > 0 && (
          <p className="text-body-sm text-ink-2" aria-live="polite">
            Showing {ordered.length} of {items.length} event types.{" "}
            <button type="button" onClick={clearFilters} className="font-semibold text-primary-text hover:underline">
              Clear search and filters
            </button>
          </p>
        )}
      </section>

      {selectedCount > 0 && <div aria-hidden="true" className="h-12" />}
      <BulkActionBar count={selectedCount} onClear={() => setSelected(new Set())}>
        <button
          type="button"
          disabled={bulkBusy}
          onClick={() => setBulkDeleteIds(selectedItems.map((e) => e.id))}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[14px] font-semibold disabled:opacity-60"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </button>
        <button
          type="button"
          disabled={bulkBusy}
          onClick={() => void bulkToggle()}
          aria-label={turnsOn ? "Toggle on/off: turn on" : "Toggle on/off: turn off"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[14px] font-semibold disabled:opacity-60"
        >
          <Power aria-hidden="true" className="size-4" />
          Toggle on/off
        </button>
      </BulkActionBar>

      <ConfirmDialog
        open={bulkDeleteIds !== null}
        onOpenChange={(v) => !v && setBulkDeleteIds(null)}
        title={bulkDeleteTitle(bulkDeleteIds?.length ?? selectedCount)}
        description={DELETE_BODY}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={bulkDelete}
      />
      {deleteTarget && (
        <DeleteEventTypeDialog
          open
          onOpenChange={(v) => !v && setDeleteTarget(null)}
          eventType={deleteTarget}
          onDeleted={(id) => removeItems([id])}
        />
      )}
      <InternalNoteDialog
        open={noteTarget !== null}
        onOpenChange={(v) => !v && setNoteTarget(null)}
        eventTypeId={noteTarget?.id ?? null}
        note={noteTarget?.note ?? null}
        onSaved={(note) => noteTarget && patchItem(noteTarget.id, { internalNote: note })}
      />
      <ShareDialog
        open={shareTarget !== null}
        onOpenChange={(v) => !v && setShareTarget(null)}
        eventType={shareTarget?.publicUrl ? { name: shareTarget.name, publicUrl: shareTarget.publicUrl, secret: shareTarget.secret, active: shareTarget.active } : null}
        returnFocusRef={shareTrigger}
      />
    </div>
  );
}
