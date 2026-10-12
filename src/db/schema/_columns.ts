// Column helpers shared by every schema file (ARCHITECTURE section 5.4).
// Plain Node constraint: relative imports only, drizzle packages only.
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** `id uuid primary key default gen_random_uuid()` */
export const pk = () => uuid("id").primaryKey().defaultRandom();

/** timestamptz column (UTC instants). */
export const ts = (name: string) => timestamp(name, { withTimezone: true });

/** `created_at timestamptz not null default now()` (audit column, the only allowed use of the DB clock). */
export const createdAt = () => ts("created_at").notNull().defaultNow();

/** `updated_at timestamptz not null default now()`, refreshed by Drizzle on every update. */
export const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Soft delete marker (null = live row). */
export const deletedAt = () => ts("deleted_at");

/**
 * `bytea` column. postgres.js returns a Buffer, PGlite a Uint8Array; both are normalized to Buffer.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (value: Buffer) => value,
  fromDriver: (value: Buffer | Uint8Array | string) => {
    if (typeof value === "string") {
      return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
    }
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});
