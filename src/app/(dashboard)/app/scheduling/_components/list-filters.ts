// Scheduling list filters (SPEC ET-03, ET-06; walkthrough 5.1 and 5.2): the search box (event name or link, as you
// type) and the filter menu (Status On / Off, and Kind when the list holds more than one kind), kept in the URL query
// (?q=&status=&kind=) so a reload or a shared link shows the same view. Pure: client and server safe.
import { KIND_LABELS, type UiKind } from "@/lib/event-types/constants";
import type { EventTypeListItem } from "@/lib/event-types/types";

export type StatusFilter = "all" | "on" | "off";
export type KindFilter = "all" | UiKind;
export type ListFilters = { q: string; status: StatusFilter; kind: KindFilter };

export const DEFAULT_FILTERS: ListFilters = { q: "", status: "all", kind: "all" };

/** Longest search kept from the URL (longer input cannot match a 100 character name). */
export const SEARCH_MAX = 100;

/** SPEC ET-03: the search box filters as you type, 150ms after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 150;

const UI_KINDS = Object.keys(KIND_LABELS) as UiKind[];

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(sp: Params, key: string): string | undefined {
  const raw = sp instanceof URLSearchParams ? (sp.get(key) ?? undefined) : sp[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/** The filters of a URL query; unknown values fall back to "all". */
export function parseListFilters(sp: Params): ListFilters {
  const q = (read(sp, "q") ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
  const status = read(sp, "status");
  const kind = read(sp, "kind");
  return {
    q,
    status: status === "on" || status === "off" ? status : "all",
    kind: kind && (UI_KINDS as string[]).includes(kind) ? (kind as UiKind) : "all",
  };
}

/** "?q=coffee&status=off" for the non default filters, or "" when nothing is filtered. */
export function filtersQuery(f: ListFilters): string {
  const qs = new URLSearchParams();
  const q = f.q.trim();
  if (q) qs.set("q", q);
  if (f.status !== "all") qs.set("status", f.status);
  if (f.kind !== "all") qs.set("kind", f.kind);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** True when the search or a filter hides part of the list (reorder is then off, ET-07). */
export function hasActiveFilters(f: ListFilters): boolean {
  return f.q.trim() !== "" || f.status !== "all" || f.kind !== "all";
}

/** Number of filter menu choices in effect (the "Filter" button count; the search box is separate). */
export function activeFilterCount(f: ListFilters): number {
  return (f.status !== "all" ? 1 : 0) + (f.kind !== "all" ? 1 : 0);
}

/** Lowercase, accents removed, whitespace collapsed: "Café  Chat" -> "cafe chat". */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** ET-03: the name or the link (slug) contains the query; "in person" also finds the slug "in-person". */
export function matchesSearch(item: Pick<EventTypeListItem, "name" | "slug">, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const slug = item.slug.toLowerCase();
  return normalizeSearch(item.name).includes(q) || slug.includes(q) || slug.includes(q.replace(/ /g, "-"));
}

/** The items the filters keep, in their original order. */
export function filterEventTypes<T extends Pick<EventTypeListItem, "name" | "slug" | "active" | "kind">>(items: readonly T[], f: ListFilters): T[] {
  return items.filter(
    (item) =>
      matchesSearch(item, f.q) &&
      (f.status === "all" || (f.status === "on" ? item.active : !item.active)) &&
      (f.kind === "all" || item.kind === f.kind),
  );
}

/** The kinds present in the list, in Calendly's order, with their labels (the Kind filter shows when there are two or more). */
export function kindOptions(items: readonly Pick<EventTypeListItem, "kind">[]): { kind: UiKind; label: string }[] {
  const present = new Set(items.map((i) => i.kind));
  return UI_KINDS.filter((k) => present.has(k)).map((kind) => ({ kind, label: KIND_LABELS[kind] }));
}
