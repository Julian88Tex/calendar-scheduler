// Factories insert into every major table on PGlite, and the schema constraints behave as services expect.
import { describe, it } from "vitest";
import { useTestDb } from "../helpers/db";
import { runFactorySmoke } from "./_smoke";

describe("factories (PGlite)", () => {
  const t = useTestDb({ kind: "pglite" });
  it("smoke inserts per major table and core constraints", async () => {
    await runFactorySmoke(t.db);
  });
});
