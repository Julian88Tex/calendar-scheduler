// Keyset pagination (ARCHITECTURE section 21; GEN-07: dashboard lists paginate 25 to 50 items). Offset pagination for
// simple lists lives in src/db/helpers.ts (paginate/toPage).
//
//   const page = await paginate(
//     ({ limit, cursor }) =>
//       db.select().from(scheduledEvents)
//         .where(and(eq(scheduledEvents.organizerUserId, userId),
//                    cursor ? keysetAfter([scheduledEvents.startAt, scheduledEvents.id], [new Date(cursor.startAt), cursor.id], "asc") : undefined))
//         .orderBy(asc(scheduledEvents.startAt), asc(scheduledEvents.id))
//         .limit(limit),
//     { cursor: searchParams.cursor, limit: 25, cursorOf: (row) => ({ startAt: row.startAt.toISOString(), id: row.id }) },
//   );
//   // page.items, page.nextCursor (pass back as ?cursor=...)
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type CursorValue = string | number | boolean | null;
export type CursorData = Record<string, CursorValue>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Opaque URL-safe cursor from a small object (no secrets: cursors are visible to users). */
export function encodeCursor(data: CursorData): string {
  return toBase64Url(JSON.stringify(data));
}

/** The decoded cursor, or null when missing or malformed (invalid cursors restart from the first page). */
export function decodeCursor<T extends CursorData = CursorData>(cursor: string | null | undefined): T | null {
  if (!cursor || typeof cursor !== "string" || cursor.length > 2048) return null;
  try {
    const value = JSON.parse(fromBase64Url(cursor)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    for (const v of Object.values(value)) {
      if (v !== null && !["string", "number", "boolean"].includes(typeof v)) return null;
    }
    return value as T;
  } catch {
    return null;
  }
}

/**
 * Row value comparison for keyset pagination: (a, b) > ($a, $b) for ascending order, < for descending. Columns and
 * values must match the ORDER BY. Postgres compares row values lexicographically and can use a composite index.
 */
export function keysetAfter(columns: SQLWrapper[], values: unknown[], direction: "asc" | "desc" = "asc"): SQL {
  if (!columns.length || columns.length !== values.length) throw new Error("keysetAfter: columns and values differ");
  const op = direction === "asc" ? sql.raw(">") : sql.raw("<");
  return sql`(${sql.join(columns, sql`, `)}) ${op} (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

export type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };

/**
 * Runs `query` with limit + 1 to detect the next page and builds the cursor of the last item. `limit` is clamped to
 * 1..maxLimit (default 25, max 100).
 */
export async function paginate<T, C extends CursorData>(
  query: (args: { limit: number; cursor: C | null }) => Promise<T[]>,
  opts: { cursor?: string | null; limit?: number | string | null; maxLimit?: number; cursorOf: (row: T) => C },
): Promise<Page<T>> {
  const max = opts.maxLimit ?? 100;
  const raw = Number(opts.limit ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), max) : 25;
  const cursor = decodeCursor<C>(opts.cursor);
  const rows = await query({ limit: limit + 1, cursor });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  return { items, hasMore, nextCursor: hasMore && lastItem !== undefined ? encodeCursor(opts.cursorOf(lastItem)) : null };
}
