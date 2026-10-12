// Copy and small rules of the Scheduling list (SPEC ET-04, ET-08, ET-12; walkthrough 5.1): the card meta line, the
// bulk bar labels and the On/Off rule of "Toggle on/off". Pure: client and server safe.
import { DELETE_TITLE } from "@/lib/event-types/constants";
import type { EventTypeListItem } from "@/lib/event-types/types";
import { formatDuration } from "@/lib/time/format";

/** "30 min", or "15 min / 30 min" when invitees choose among several durations (ET-04). */
export function durationsLabel(durations: readonly number[]): string {
  return durations.map(formatDuration).join(" / ");
}

/** ET-04 meta line: "30 min, Google Meet, One-on-One" (no location part when none is set). */
export function metaLine(item: Pick<EventTypeListItem, "durations" | "locationKinds" | "locationSummary" | "kindLabel">): string {
  const parts = [durationsLabel(item.durations)];
  if (item.locationKinds.length) parts.push(item.locationSummary);
  parts.push(item.kindLabel);
  return parts.filter(Boolean).join(", ");
}

/** "1 event type" / "3 event types". */
export function eventTypesCount(n: number): string {
  return `${n} event ${n === 1 ? "type" : "types"}`;
}

/** ET-08 "Toggle on/off": turns every selected event type on when any of them is off, else turns them all off. */
export function bulkToggleTurnsOn(selected: readonly Pick<EventTypeListItem, "active">[]): boolean {
  return selected.some((e) => !e.active);
}

/** Title of the single bulk delete confirmation (ET-08, ET-12). */
export function bulkDeleteTitle(n: number): string {
  return n === 1 ? DELETE_TITLE : `Delete ${n} event types?`;
}

/** Success toast of a bulk delete. */
export function bulkDeletedToast(n: number): string {
  return `${eventTypesCount(n)} deleted`;
}

/** Success toast of a bulk On/Off. */
export function bulkToggledToast(n: number, on: boolean): string {
  return `${eventTypesCount(n)} turned ${on ? "on" : "off"}`;
}
