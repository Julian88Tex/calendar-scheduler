// Scheduling page, Event types tab (SPEC ET-03 to ET-12, ET-33; walkthrough 5.1 and 5.2; docs/SCOPE.md: one person,
// one-on-one event types). The toolbar (search "Search event types" filtering by name or link as you type, 150ms
// debounce, and the Filter menu; both kept in the URL), the personal section (header with the user's link, then the
// event type cards in their landing page order), drag and drop reorder (mouse, touch and keyboard), card actions through
// the shared event type actions (On/Off, secret, internal note, duplicate, delete) with optimistic updates, the bulk
// bar ("{n} selected": Delete with one confirmation, Toggle on/off, Clear) and the empty states. A refused action rolls
// back, toasts the reason and reloads the list from the server (the list may be stale, for example after a change in
// another tab). After a delete, focus moves to the next card (GEN-05) instead of falling back to the page. Client
// component.
"use client";

import { Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toast";
// Direct imports (not the @/components/event-types barrel) keep the location editor out of this page's bundle.
import { DeleteEventTypeDialog } from "@/components/event-types/delete-event-type-dialog";
import { InternalNoteDialog } from "@/components/event-types/internal-note-dialog";
import type { ActionError } from "@/lib/actions";
import { duplicateEventTypeAction, reorderEventTypesAction, setEventTypeActiveAction, setEventTypeSecretAction } from "@/lib/event-types/actions";
import { DELETE_BODY } from "@/lib/event-types/constants";
import type { EventTypeListItem } from "@/lib/event-types/types";
import { bulkDeleteEventTypesAction, bulkSetEventTypesActiveAction } from "../actions";
import { EventTypeCard } from "./event-type-card";
import { FilterMenu } from "./filter-menu";
import { DEFAULT_FILTERS, filterEventTypes, filtersQuery, hasActiveFilters, kindOptions, SEARCH_DEBOUNCE_MS, type ListFilters } from "./list-filters";
import { bulkDeletedToast, bulkDeleteTitle, bulkToggledToast, bulkToggleTurnsOn } from "./list-text";
import { applyOrder, focusAfterRemoval, REORDER_HINT, reorderAnnouncements } from "./reorder";
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
const SEARCH_ID = `${LIST_ID}-search`;

/** Errors after which the list on screen may be out of date (the row is gone, moved or no longer editable). */
const staleList = (error: ActionError) => error.code !== "validation" && error.code !== "rate_limited";

/**
 * Focuses the card `id` (its name link), else the list's fallback control, once dialogs are gone and focus fell back
 * to the page: Radix returns focus to the removed card's menu button, which no longer exists.
 */
function focusWhenSettled(id: string | null): () => void {
  let frame = 0;
  let timer = 0;
  let frames = 0;
  const target = () =>
    (id ? document.querySelector<HTMLElement>(`[data-event-type-id="${id}"] h3 a`) : null) ??
    document.querySelector<HTMLElement>("[data-list-focus-fallback]") ??
    document.getElementById(SEARCH_ID);
  const attempt = () => {
    if (document.querySelector('[role="alertdialog"], [role="dialog"]') && frames++ < 120) {
      frame = requestAnimationFrame(attempt);
      return;
    }
    // After the dialog's own focus restore (a zero delay timer once it unmounts).
    timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) target()?.focus();
    }, 50);
  };
  frame = requestAnimationFrame(attempt);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

export function EventTypesView({ profile, items: serverItems, initialFilters }: EventTypesViewProps) {
  const router = useRouter();
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
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{
    id: string;
    note: string | null;
  } | null>(null);
  // The share dialog keeps its event type while it closes (the close animation still shows it).
  const [shareTarget, setShareTarget] = useState<EventTypeListItem | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // The ids the bulk delete confirmation was opened for, and their count (kept for the title while it closes).
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkDeleteCount, setBulkDeleteCount] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Where focus goes after cards were removed (a new object per removal).
  const [focusRequest, setFocusRequest] = useState<{
    id: string | null;
  } | null>(null);
  const shareTrigger = useRef<HTMLElement | null>(null);
  const deletedRef = useRef(false);
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

  useEffect(() => (focusRequest ? focusWhenSettled(focusRequest.id) : undefined), [focusRequest]);

  const filtering = hasActiveFilters(filters);
  const visible = useMemo(() => filterEventTypes(items, filters), [items, filters]);
  const selectedItems = useMemo(() => visible.filter((e) => selected.has(e.id)), [visible, selected]);
  const kinds = useMemo(() => kindOptions(items), [items]);

  // The latest filters for callbacks that outlive a render (the debounced search).
  const filtersRef = useRef(initialFilters);
  /** Bulk actions act on what is visible: drop selections that `list` under `f` hides. */
  const pruneSelection = (list: readonly EventTypeListItem[], f: ListFilters) => {
    const keep = new Set(filterEventTypes(list, f).map((e) => e.id));
    setSelected((s) => ([...s].every((id) => keep.has(id)) ? s : new Set([...s].filter((id) => keep.has(id)))));
  };
  const updateFilters = (patch: Partial<ListFilters>) => {
    const next = { ...filtersRef.current, ...patch };
    filtersRef.current = next;
    setFilters(next);
    pruneSelection(itemsRef.current, next);
  };
  const clearFilters = () => {
    setSearchText("");
    updateFilters(DEFAULT_FILTERS);
  };

  /** Applies `fn` to the local list (and drops selections the result hides under the current filters). */
  const changeItems = (fn: (list: EventTypeListItem[]) => EventTypeListItem[]) => {
    const next = fn(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    pruneSelection(next, filtersRef.current);
  };
  const patchItems = (patches: ReadonlyMap<string, Partial<EventTypeListItem>>) =>
    changeItems((list) => list.map((e) => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)));
  const patchItem = (id: string, patch: Partial<EventTypeListItem>) => patchItems(new Map([[id, patch]]));
  const refused = (error: ActionError, message = error.message) => {
    toast.error(message);
    if (staleList(error)) router.refresh();
  };
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
    setFocusRequest({
      id: focusAfterRemoval(
        orderedRef.current.map((e) => e.id),
        gone,
      ),
    });
    changeItems((list) => list.filter((e) => !gone.has(e.id)));
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
  };

  // Reorder (ET-07): the whole personal section, only when nothing is filtered.
  const reorderEnabled = !filtering && items.length > 1;
  const commitOrder = useCallback(
    async (order: string[]) => {
      const previous = itemsRef.current;
      const next = applyOrder(previous, order).map((e, position) => ({
        ...e,
        position,
      }));
      itemsRef.current = next;
      setItems(next);
      const result = await reorderEventTypesAction({ ids: order });
      if (!result.ok) {
        itemsRef.current = previous;
        setItems(previous);
        toast.error(result.error.code === "internal" ? reorderAnnouncements.failed : result.error.message);
        if (staleList(result.error)) router.refresh();
      }
    },
    [router],
  );
  const reorder = useReorder({
    ids: items.map((e) => e.id),
    enabled: reorderEnabled,
    idPrefix: LIST_ID,
    onCommit: commitOrder,
  });
  const ordered = useMemo(() => {
    const byId = new Map(visible.map((e) => [e.id, e]));
    return filtering ? visible : reorder.order.map((id) => byId.get(id)).filter((e): e is EventTypeListItem => Boolean(e));
  }, [filtering, visible, reorder.order]);
  const orderedRef = useRef(ordered);
  useLayoutEffect(() => {
    orderedRef.current = ordered;
  }, [ordered]);

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
      refused(r.error);
      return;
    }
    toast.success(active ? "Event type turned on" : "Event type turned off");
  };

  const setSecret = async (item: EventTypeListItem, secret: boolean) => {
    patchItem(item.id, { secret });
    const r = await withPending(item.id, () => setEventTypeSecretAction({ id: item.id, secret }));
    if (!r.ok) {
      patchItem(item.id, { secret: item.secret });
      refused(r.error);
      return;
    }
    toast.success(secret ? "Event type is now secret" : "Event type is now public");
  };

  const duplicate = async (item: EventTypeListItem) => {
    const r = await withPending(item.id, () => duplicateEventTypeAction({ id: item.id }));
    if (!r.ok) {
      refused(r.error);
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
    patchItems(new Map(ids.map((id) => [id, { active: on }])));
    const r = await bulkSetEventTypesActiveAction({ ids, active: on });
    setBulkBusy(false);
    if (!r.ok) {
      patchItems(new Map(targets.map((e) => [e.id, { active: e.active }])));
      refused(r.error);
      return;
    }
    // Event types deleted meanwhile (another tab) are skipped; the refreshed list no longer shows them.
    if (r.data.updated.length) toast.success(bulkToggledToast(r.data.updated.length, on));
    else toast.info("These event types were already deleted.");
  };

  const bulkDelete = async () => {
    const ids = bulkDeleteIds ?? [];
    if (!ids.length) return;
    const r = await bulkDeleteEventTypesAction({ ids });
    if (!r.ok) {
      if (staleList(r.error)) router.refresh();
      throw new Error(r.error.message);
    }
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

  const dialogs = (
    <>
      <ConfirmDialog
        open={bulkDeleteIds !== null}
        onOpenChange={(v) => !v && setBulkDeleteIds(null)}
        title={bulkDeleteTitle(bulkDeleteCount)}
        description={DELETE_BODY}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={bulkDelete}
      />
      {deleteTarget && (
        <DeleteEventTypeDialog
          open
          onOpenChange={(v) => {
            if (v) return;
            // Closed without deleting: the delete may have been refused because the list is stale, so reload it.
            if (!deletedRef.current) router.refresh();
            deletedRef.current = false;
            setDeleteTarget(null);
          }}
          eventType={deleteTarget}
          onDeleted={(id) => {
            deletedRef.current = true;
            removeItems([id]);
          }}
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
        open={shareOpen}
        onOpenChange={setShareOpen}
        eventType={
          shareTarget?.publicUrl
            ? {
                name: shareTarget.name,
                publicUrl: shareTarget.publicUrl,
                secret: shareTarget.secret,
                active: shareTarget.active,
              }
            : null
        }
        returnFocusRef={shareTrigger}
      />
    </>
  );

  const empty = (
    <section aria-labelledby={`${LIST_ID}-heading`} className="flex flex-col gap-6">
      <h2 id={`${LIST_ID}-heading`} className="sr-only">
        Personal event types
      </h2>
      <SectionHeader profile={profile} />
      <div className="rounded-[var(--radius-card)] border border-line bg-white">
        <EmptyState
          illustration={<Illustration name="calendar-plus" />}
          heading="Create scheduling links with event types"
          headingLevel={3}
          body="Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or office hours."
          action={
            <Button asChild leftIcon={<Plus aria-hidden="true" />}>
              <Link href={NEW_EVENT_TYPE_HREF} data-list-focus-fallback>
                New event type
              </Link>
            </Button>
          }
        />
      </div>
    </section>
  );

  const selectedCount = selectedItems.length;
  const turnsOn = bulkToggleTurnsOn(selectedItems);

  return (
    <div className="flex flex-col gap-6">
      {items.length === 0 ? (
        empty
      ) : (
        <>
          <div role="search" aria-label="Event types" className="flex items-center gap-3">
            <SearchInput
              id={SEARCH_ID}
              value={searchText}
              onValueChange={setSearchText}
              onSearch={(q) => updateFilters({ q })}
              debounceMs={SEARCH_DEBOUNCE_MS}
              placeholder="Search event types"
              aria-label="Search event types"
              className="min-w-0 flex-1 sm:max-w-xs"
            />
            <div className="ml-auto flex shrink-0 items-center gap-2">
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
                  headingLevel={3}
                  body="Try another name or link, or clear the search and filters."
                  action={
                    <Button variant="secondary" onClick={clearFilters} data-list-focus-fallback>
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
                <ul aria-label="Personal event types" className="flex flex-col gap-3">
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
                      registerRow={reorder.registerRow(item.id)}
                      onShare={(trigger) => {
                        shareTrigger.current = trigger;
                        setShareTarget(item);
                        setShareOpen(true);
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

          {/* Room for the bar, which floats above the toast area so result toasts never cover its buttons. */}
          {selectedCount > 0 && <div aria-hidden="true" className="h-20" />}
          <BulkActionBar count={selectedCount} onClear={() => setSelected(new Set())} className="bottom-20">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                setBulkDeleteIds(selectedItems.map((e) => e.id));
                setBulkDeleteCount(selectedItems.length);
              }}
              className="inline-flex min-h-10 items-center gap-1.5 px-3 py-1.5 text-[14px] font-semibold disabled:opacity-60 sm:min-h-8"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void bulkToggle()}
              aria-label={turnsOn ? "Toggle on/off: turn on" : "Toggle on/off: turn off"}
              className="inline-flex min-h-10 items-center gap-1.5 px-3 py-1.5 text-[14px] font-semibold disabled:opacity-60 sm:min-h-8"
            >
              <Power aria-hidden="true" className="size-4" />
              Toggle on/off
            </button>
          </BulkActionBar>
        </>
      )}
      {dialogs}
    </div>
  );
}
