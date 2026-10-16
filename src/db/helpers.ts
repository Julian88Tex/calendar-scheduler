// Database helpers shared by every module (ARCHITECTURE sections 3 and 5): driver-neutral result access, Postgres
// error inspection, transactions and advisory locks, simple offset pagination.
// No "server-only" import here: the seed, scripts and tests load src/db/** directly.
//
// Drizzle gotcha (verified): in a select WITHOUT joins, drizzle renders every column inside sql`...` fields
// unqualified ("id", not "event_types"."id"). A correlated subquery such as
//   sql`exists (select 1 from ${eventTypeHosts} where ${eventTypeHosts.eventTypeId} = ${eventTypes.id})`
// therefore compares event_type_hosts.event_type_id with event_type_hosts.id (silently wrong). Compare with a value
// parameter instead (`= ${eventTypeId}`), add a join, or run a second query.
import { is, sql } from "drizzle-orm";
import { PgTransaction, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

/** db.execute() returns an array (RowList) on postgres.js but { rows, fields, ... } on PGlite. */
export const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

/** First row of a raw db.execute() result, or null. */
export const firstRow = <T>(res: unknown): T | null => rowsOf<T>(res)[0] ?? null;

/** SQLSTATE of a driver error. Drizzle 0.45 wraps driver errors in DrizzleQueryError (original on `.cause`). */
export function pgCode(e: unknown): string | undefined {
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Constraint name of a driver error (`constraint_name` on postgres.js, `constraint` on PGlite). */
export function pgConstraint(e: unknown): string | undefined {
  const cause = (e as { cause?: Record<string, unknown> } | null)?.cause;
  const own = e as Record<string, unknown> | null;
  const value = cause?.constraint_name ?? cause?.constraint ?? own?.constraint_name ?? own?.constraint;
  return typeof value === "string" ? value : undefined;
}

export const PG_ERRORS = {
  uniqueViolation: "23505",
  exclusionViolation: "23P01",
  foreignKeyViolation: "23503",
  restrictViolation: "23001", // ON DELETE RESTRICT (scheduled_events and scheduled_event_hosts keep their users)
  checkViolation: "23514",
  notNullViolation: "23502",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
  lockNotAvailable: "55P03",
  undefinedTable: "42P01",
} as const;

/** True for a unique violation, optionally of one named constraint or index. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  if (pgCode(e) !== PG_ERRORS.uniqueViolation) return false;
  return constraint ? pgConstraint(e) === constraint : true;
}

/** True for a foreign key (or ON DELETE RESTRICT) violation, optionally of one named constraint. */
export function isForeignKeyViolation(e: unknown, constraint?: string): boolean {
  const code = pgCode(e);
  if (code !== PG_ERRORS.foreignKeyViolation && code !== PG_ERRORS.restrictViolation) return false;
  return constraint ? pgConstraint(e) === constraint : true;
}

/** True when the value is a transaction handle rather than the top-level database. */
export function isTransaction(dbOrTx: unknown): boolean {
  return is(dbOrTx, PgTransaction);
}

/**
 * Runs `fn` inside a transaction. When `dbOrTx` already is a transaction the function joins it (no savepoint), so
 * services can accept `DB | Tx` and compose.
 */
export async function withTx<TDb extends AnyPgDatabase, T>(
  dbOrTx: TDb,
  fn: (tx: TDb) => Promise<T>,
  config?: Parameters<TDb["transaction"]>[1],
): Promise<T> {
  if (isTransaction(dbOrTx)) return fn(dbOrTx);
  return dbOrTx.transaction((tx) => fn(tx as unknown as TDb), config) as Promise<T>;
}

/**
 * Takes transaction advisory locks (pg_advisory_xact_lock(hashtextextended(key, 0))) for every key, deduplicated and in
 * ascending order so concurrent callers never deadlock. Released automatically at COMMIT or ROLLBACK, which makes them
 * safe behind PgBouncer transaction pooling (never use session level advisory locks).
 */
export async function advisoryXactLock(tx: AnyPgDatabase, ...keys: string[]): Promise<void> {
  const sorted = [...new Set(keys)].sort();
  for (const key of sorted) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

/** Non-blocking variant: true when every lock was acquired (locks taken before a failure stay held until COMMIT). */
export async function tryAdvisoryXactLock(tx: AnyPgDatabase, ...keys: string[]): Promise<boolean> {
  const sorted = [...new Set(keys)].sort();
  for (const key of sorted) {
    const row = firstRow<{ ok: boolean }>(
      await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as ok`),
    );
    if (!row?.ok) return false;
  }
  return true;
}

/** Offset pagination for dashboard lists (25 to 50 items, GEN-07). Keyset cursors live in src/lib/pagination.ts. */
export function paginate(opts: { page?: number | string | null; pageSize?: number | string | null; maxPageSize?: number } = {}) {
  const max = opts.maxPageSize ?? 100;
  const rawSize = Number(opts.pageSize ?? 25);
  const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(Math.trunc(rawSize), 1), max) : 25;
  const rawPage = Number(opts.page ?? 1);
  const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;
  // limit fetches one extra row so callers can tell whether another page exists (see toPage).
  return { page, pageSize, limit: pageSize + 1, offset: (page - 1) * pageSize };
}

/** Trims the extra row fetched by paginate() and reports whether more rows exist. */
export function toPage<T>(rows: T[], pageSize: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
