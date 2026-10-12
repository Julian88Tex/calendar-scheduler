// Enums used by more than one schema file. This is a leaf module (imports only drizzle) so that a column
// definition in one file never reads an enum from a file that is still being evaluated inside an import cycle.
// Each enum is re-exported by the file that owns it in ARCHITECTURE section 5.4; import them from there or from the
// schema barrel.
import { pgEnum } from "drizzle-orm/pg-core";

/** calendars.ts (also used by conferencing.ts) */
export const connectionStatus = pgEnum("connection_status", ["active", "needs_reauth", "error", "disconnected"]);

/** event-types.ts (also used by payments.ts) */
export const paymentProvider = pgEnum("payment_provider", ["stripe", "paypal"]);

/** event-types.ts (also used by routing.ts) */
export const permissionLevel = pgEnum("permission_level", ["view", "edit"]);

/** bookings.ts (also used by admin.ts) */
export const actorType = pgEnum("actor_type", ["user", "system", "api", "invitee"]);
