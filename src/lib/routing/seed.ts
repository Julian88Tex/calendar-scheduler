// OWNER: routing-forms. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Demo data for `npm run db:seed -- --demo` (SPEC ADM-10): creates the ADM-10 demo routing form inside the seed transaction.
// Must be idempotent (the seed may run again). Foundation stub: no-op.
import type { DbOrTx } from "@/db";

export type SeedDemoContext = {
  ownerUserId: string;
  /** The owner's organization. */
  organizationId?: string;
  /** The seeded owner event types (30min, 60min, meal). */
  eventTypeIds: string[];
};

export async function seedDemo(tx: DbOrTx, ctx: SeedDemoContext): Promise<void> {
  void tx;
  void ctx;
}
