// Pure logic of the Scheduling list (SPEC ET-03, ET-04, ET-06, ET-07, ET-08): URL filters, search by name or link,
// Status and Kind filters, the card meta line, the bulk bar rules and copy, and the reorder helpers.
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filterEventTypes,
  filtersQuery,
  hasActiveFilters,
  kindOptions,
  matchesSearch,
  normalizeSearch,
  parseListFilters,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX,
} from "@/app/(dashboard)/app/scheduling/_components/list-filters";
import {
  bulkDeletedToast,
  bulkDeleteTitle,
  bulkToggledToast,
  bulkToggleTurnsOn,
  durationsLabel,
  eventTypesCount,
  metaLine,
} from "@/app/(dashboard)/app/scheduling/_components/list-text";
import {
  applyOrder,
  dropOrder,
  focusAfterRemoval,
  moveId,
  pointerDropTarget,
  reorderAnnouncements,
  sameOrder,
} from "@/app/(dashboard)/app/scheduling/_components/reorder";
import { BULK_MAX, zBulkActiveInput, zBulkIdsInput } from "@/app/(dashboard)/app/scheduling/_components/schemas";
import type { UiKind } from "@/lib/event-types/constants";
import { formatDuration } from "@/lib/time/format";

type Item = { id: string; name: string; slug: string; active: boolean; kind: UiKind };
const items: Item[] = [
  { id: "a", name: "30 Minute Virtual", slug: "30min", active: true, kind: "one_on_one" },
  { id: "b", name: "60 Minute Virtual", slug: "60min", active: false, kind: "one_on_one" },
  { id: "c", name: "In-Person Meal or Coffee", slug: "meal", active: true, kind: "one_on_one" },
  { id: "d", name: "Café Chat", slug: "in-person-chat", active: true, kind: "group" },
];

describe("URL filters (ET-06)", () => {
  it("parses q, status and kind and ignores unknown values", () => {
    expect(parseListFilters({})).toEqual(DEFAULT_FILTERS);
    expect(parseListFilters({ q: "  coffee   chat ", status: "off", kind: "group" })).toEqual({ q: "coffee chat", status: "off", kind: "group" });
    expect(parseListFilters({ status: "maybe", kind: "webinar" })).toEqual(DEFAULT_FILTERS);
    expect(parseListFilters({ q: ["first", "second"], status: ["on"] })).toMatchObject({ q: "first", status: "on" });
    expect(parseListFilters(new URLSearchParams("q=meal&status=on&kind=one_on_one"))).toEqual({ q: "meal", status: "on", kind: "one_on_one" });
    expect(parseListFilters({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_MAX);
  });

  it("serializes only what differs from the defaults and round trips", () => {
    expect(filtersQuery(DEFAULT_FILTERS)).toBe("");
    expect(filtersQuery({ q: " meal ", status: "all", kind: "all" })).toBe("?q=meal");
    const f = { q: "café & tea", status: "off", kind: "one_on_one" } as const;
    const query = filtersQuery(f);
    expect(query).toBe("?q=caf%C3%A9+%26+tea&status=off&kind=one_on_one");
    expect(parseListFilters(new URLSearchParams(query.slice(1)))).toEqual(f);
  });

  it("knows when filters hide part of the list", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: "   " })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: "a" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: "on" })).toBe(true);
    expect(activeFilterCount({ q: "a", status: "off", kind: "group" })).toBe(2);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: "a" })).toBe(0);
  });

  it("debounces the search by 150ms (ET-03)", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
  });
});

describe("search by name or link (ET-03)", () => {
  it("matches the name or the slug, ignoring case, accents and extra spaces", () => {
    expect(normalizeSearch("  Café   CHAT ")).toBe("cafe chat");
    expect(matchesSearch(items[0]!, "minute")).toBe(true);
    expect(matchesSearch(items[0]!, "30MIN")).toBe(true);
    expect(matchesSearch(items[2]!, "meal")).toBe(true);
    expect(matchesSearch(items[3]!, "cafe")).toBe(true);
    expect(matchesSearch(items[3]!, "in person")).toBe(true);
    expect(matchesSearch(items[0]!, "coffee")).toBe(false);
    expect(matchesSearch(items[0]!, "")).toBe(true);
  });

  it("filters by search, status and kind and keeps the order; clearing restores everything", () => {
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterEventTypes(items, { ...DEFAULT_FILTERS, ...f }).map((i) => i.id);
    expect(ids({ q: "virtual" })).toEqual(["a", "b"]);
    expect(ids({ q: "60min" })).toEqual(["b"]);
    expect(ids({ status: "off" })).toEqual(["b"]);
    expect(ids({ status: "on" })).toEqual(["a", "c", "d"]);
    expect(ids({ kind: "group" })).toEqual(["d"]);
    expect(ids({ q: "virtual", status: "on" })).toEqual(["a"]);
    expect(ids({ q: "nothing like this" })).toEqual([]);
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
  });

  it("offers the kinds present in the list, in Calendly's order", () => {
    expect(kindOptions(items)).toEqual([
      { kind: "one_on_one", label: "One-on-One" },
      { kind: "group", label: "Group" },
    ]);
    expect(kindOptions(items.slice(0, 3))).toHaveLength(1);
  });
});

describe("card text and bulk rules (ET-04, ET-08, ET-12)", () => {
  it("builds the meta line with durations, locations and the kind", () => {
    expect(durationsLabel([30])).toBe("30 min");
    expect(durationsLabel([15, 30, 90])).toBe("15 min / 30 min / 1 hr 30 min");
    expect(durationsLabel([60, 120])).toBe(`1 hr / ${formatDuration(120)}`);
    expect(metaLine({ durations: [30], locationKinds: ["google_conference"], locationSummary: "Google Meet", kindLabel: "One-on-One" })).toBe(
      "30 min, Google Meet, One-on-One",
    );
    expect(metaLine({ durations: [120], locationKinds: [], locationSummary: "No location given", kindLabel: "One-on-One" })).toBe(`${formatDuration(120)}, One-on-One`);
    expect(
      metaLine({
        durations: [15, 30],
        locationKinds: ["physical", "physical", "ask_invitee"],
        locationSummary: "In-person meeting (2), Ask invitee",
        kindLabel: "One-on-One",
      }),
    ).toBe("15 min / 30 min, In-person meeting (2), Ask invitee, One-on-One");
  });

  it("Toggle on/off turns all on when any is off, else all off", () => {
    expect(bulkToggleTurnsOn([{ active: true }, { active: false }])).toBe(true);
    expect(bulkToggleTurnsOn([{ active: false }, { active: false }])).toBe(true);
    expect(bulkToggleTurnsOn([{ active: true }, { active: true }])).toBe(false);
  });

  it("uses one confirmation title and toasts with the right plural", () => {
    expect(bulkDeleteTitle(1)).toBe("Delete event type?");
    expect(bulkDeleteTitle(3)).toBe("Delete 3 event types?");
    expect(eventTypesCount(1)).toBe("1 event type");
    expect(bulkDeletedToast(3)).toBe("3 event types deleted");
    expect(bulkToggledToast(1, false)).toBe("1 event type turned off");
    expect(bulkToggledToast(2, true)).toBe("2 event types turned on");
  });

  it("validates bulk inputs", () => {
    const id = "6f1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(zBulkIdsInput.safeParse({ ids: [id] }).success).toBe(true);
    expect(zBulkIdsInput.safeParse({ ids: [] }).success).toBe(false);
    expect(zBulkIdsInput.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
    expect(zBulkIdsInput.safeParse({ ids: Array.from({ length: BULK_MAX + 1 }, () => id) }).success).toBe(false);
    expect(zBulkActiveInput.safeParse({ ids: [id], active: "yes" }).success).toBe(false);
    expect(zBulkActiveInput.safeParse({ ids: [id], active: false }).success).toBe(true);
  });
});

describe("reorder helpers (ET-07)", () => {
  const order = ["a", "b", "c", "d"];

  it("moves one id to an index, clamped", () => {
    expect(moveId(order, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(order, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveId(order, "b", -5)).toEqual(["b", "a", "c", "d"]);
    expect(moveId(order, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveId(order, "zz", 1)).toEqual(order);
    expect(moveId(order, "c", 2)).toEqual(order);
  });

  it("drops a dragged card before or after another", () => {
    expect(dropOrder(order, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
    expect(dropOrder(order, "a", "c", "before")).toEqual(["b", "a", "c", "d"]);
    expect(dropOrder(order, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(dropOrder(order, "b", "b", "after")).toEqual(order);
    expect(dropOrder(order, "a", "b", "before")).toEqual(order);
  });

  it("compares and applies orders", () => {
    expect(sameOrder(order, [...order])).toBe(true);
    expect(sameOrder(order, ["a", "b", "d", "c"])).toBe(false);
    expect(sameOrder(order, ["a", "b", "c"])).toBe(false);
    const list = order.map((id) => ({ id }));
    expect(applyOrder(list, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("finds where a pointer drag lands from the cards' boxes (mouse and touch)", () => {
    // Four 100px cards with 12px gaps: a 0-100, b 112-212, c 224-324, d 336-436.
    const boxes = order.map((id, i) => ({ id, top: i * 112, bottom: i * 112 + 100 }));
    // Dragging d upward: above a's middle lands before a; between a's and b's middles before b.
    expect(pointerDropTarget(order, boxes, 10, "d")).toEqual({ id: "a", position: "before" });
    expect(pointerDropTarget(order, boxes, 120, "d")).toEqual({ id: "b", position: "before" });
    // Below every middle: after the last other card, which for d is where it already is (no change, no line).
    expect(pointerDropTarget(order, boxes, 999, "d")).toBeNull();
    expect(pointerDropTarget(order, boxes, 999, "a")).toEqual({ id: "d", position: "after" });
    // Dragging b down over c's lower half lands before d; just above its own neighbor changes nothing.
    expect(pointerDropTarget(order, boxes, 300, "b")).toEqual({ id: "d", position: "before" });
    expect(pointerDropTarget(order, boxes, 230, "b")).toBeNull();
    // The dragged card's own (moving) box is ignored; a list of one has nowhere to go.
    expect(pointerDropTarget(order, [...boxes, { id: "b", top: -500, bottom: -400 }], 10, "b")).toEqual({ id: "a", position: "before" });
    expect(pointerDropTarget(["a"], [{ id: "a", top: 0, bottom: 100 }], 300, "a")).toBeNull();
    const landing = pointerDropTarget(order, boxes, 120, "d")!;
    expect(dropOrder(order, "d", landing.id, landing.position)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves focus to the next card after a delete, else the previous one (GEN-05)", () => {
    expect(focusAfterRemoval(order, new Set(["b"]))).toBe("c");
    expect(focusAfterRemoval(order, new Set(["b", "c"]))).toBe("d");
    expect(focusAfterRemoval(order, new Set(["d"]))).toBe("c");
    expect(focusAfterRemoval(order, new Set(["c", "d"]))).toBe("b");
    expect(focusAfterRemoval(order, new Set(["a", "c"]))).toBe("b");
    expect(focusAfterRemoval(order, new Set(order))).toBeNull();
    expect(focusAfterRemoval(order, new Set(["zz"]))).toBe("a");
    expect(focusAfterRemoval([], new Set(["a"]))).toBeNull();
  });

  it("announces each keyboard step", () => {
    expect(reorderAnnouncements.lifted("Coffee", 1, 3)).toContain("Picked up Coffee. Position 1 of 3.");
    expect(reorderAnnouncements.moved("Coffee", 2, 3)).toBe("Coffee moved to position 2 of 3.");
    expect(reorderAnnouncements.dropped("Coffee", 2, 3)).toBe("Coffee dropped at position 2 of 3.");
    expect(reorderAnnouncements.canceled("Coffee", 1)).toBe("Reorder canceled. Coffee is back at position 1.");
  });
});
