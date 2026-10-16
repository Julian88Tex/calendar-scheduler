// Same smoke run as factories.test.ts, on real Postgres (npm run test:pg).
import { describe, it } from "vitest";
import { useTestDb } from "../helpers/db";
import { runFactorySmoke } from "./_smoke";

describe.runIf(process.env.TEST_DATABASE_URL)("factories (real Postgres)", () => {
  const t = useTestDb({ kind: "postgres" });
  it("smoke inserts per major table and core constraints", async () => {
    await runFactorySmoke(t.db);
  });
});
