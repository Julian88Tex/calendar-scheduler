// Pure reorder helpers of the Scheduling list (SPEC ET-07): moving one id inside an order, the result of dropping a
// dragged card before or after another one, where a pointer drag would land, the card that takes focus after a
// delete, and the screen reader announcements of the keyboard flow (Space lifts, the arrow keys move, Space drops,
// Escape cancels). Client and server safe.

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

/** A card's vertical extent on screen (client coordinates). */
export type RowBox = { id: string; top: number; bottom: number };

/**
 * Where a card dragged with the pointer lands when the pointer is at `y`: before the first other card whose vertical
 * middle is below the pointer, else after the last card; null when that would not change `order`. `boxes` lists the
 * cards in their screen order (the dragged card's own box is ignored, it follows the pointer).
 */
export function pointerDropTarget(
  order: readonly string[],
  boxes: readonly RowBox[],
  y: number,
  dragged: string,
): { id: string; position: "before" | "after" } | null {
  const others = boxes.filter((b) => b.id !== dragged && order.includes(b.id));
  const last = others[others.length - 1];
  if (!last) return null;
  const hit = others.find((b) => y < (b.top + b.bottom) / 2);
  const target = hit ? { id: hit.id, position: "before" as const } : { id: last.id, position: "after" as const };
  return sameOrder(dropOrder(order, dragged, target.id, target.position), order) ? null : target;
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

/**
 * The card that takes focus after `removed` cards leave the list `order` (GEN-05: focus never falls back to the page):
 * the first remaining card after the first removed one, else the closest one before it, else null (empty list).
 */
export function focusAfterRemoval(order: readonly string[], removed: ReadonlySet<string>): string | null {
  const first = order.findIndex((id) => removed.has(id));
  if (first < 0) return order.find((id) => !removed.has(id)) ?? null;
  const after = order.slice(first).find((id) => !removed.has(id));
  if (after) return after;
  for (let i = first - 1; i >= 0; i--) if (!removed.has(order[i]!)) return order[i]!;
  return null;
}

export const REORDER_HINT = "To reorder, press Space to pick up the event type, use the up and down arrow keys to move it, then press Space again to drop it. Press Escape to cancel. You can also drag the handle with a mouse or a finger.";

export const reorderAnnouncements = {
  lifted: (name: string, position: number, count: number) =>
    `Picked up ${name}. Position ${position} of ${count}. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`,
  moved: (name: string, position: number, count: number) => `${name} moved to position ${position} of ${count}.`,
  dropped: (name: string, position: number, count: number) => `${name} dropped at position ${position} of ${count}.`,
  canceled: (name: string, position: number) => `Reorder canceled. ${name} is back at position ${position}.`,
  failed: "The new order couldn't be saved. The previous order is back.",
} as const;
