// Pure reorder helpers of the Scheduling list (SPEC ET-07): moving one id inside an order, the result of dropping a
// dragged card before or after another one, and the screen reader announcements of the keyboard flow (Space lifts,
// the arrow keys move, Space drops, Escape cancels). Client and server safe.

/** A copy of `order` with `id` moved to index `to` (clamped); unchanged when `id` is missing. */
export function moveId(order: readonly string[], id: string, to: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const target = Math.max(0, Math.min(order.length - 1, to));
  if (target === from) return [...order];
  const next = order.filter((x) => x !== id);
  next.splice(target, 0, id);
  return next;
}

/** The order after dropping `dragged` before or after `over` (mouse drag and drop). */
export function dropOrder(order: readonly string[], dragged: string, over: string, position: "before" | "after"): string[] {
  if (dragged === over || !order.includes(dragged) || !order.includes(over)) return [...order];
  const rest = order.filter((x) => x !== dragged);
  const at = rest.indexOf(over) + (position === "after" ? 1 : 0);
  rest.splice(at, 0, dragged);
  return rest;
}

/** True when both orders list the same ids in the same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Applies an id order to items (items missing from the order keep their relative order at the end). */
export function applyOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export const REORDER_HINT = "To reorder, press Space to pick up the event type, use the up and down arrow keys to move it, then press Space again to drop it. Press Escape to cancel. You can also drag it with a mouse.";

export const reorderAnnouncements = {
  lifted: (name: string, position: number, count: number) =>
    `Picked up ${name}. Position ${position} of ${count}. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`,
  moved: (name: string, position: number, count: number) => `${name} moved to position ${position} of ${count}.`,
  dropped: (name: string, position: number, count: number) => `${name} dropped at position ${position} of ${count}.`,
  canceled: (name: string, position: number) => `Reorder canceled. ${name} is back at position ${position}.`,
  failed: "The new order couldn't be saved. The previous order is back.",
} as const;
