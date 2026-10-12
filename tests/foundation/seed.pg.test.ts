// The seed on real Postgres (npm run test:pg): owner, team and --demo scenarios apply and re-apply without duplicates
// (the CLI and CI run them on PGlite; deployments with a local Postgres use postgres.js).
import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventTypes, invitees, scheduledEvents, teams, users } from "@/db/schema";
import { runSeed } from "../../scripts/seed-scenarios.ts";
import { useTestDb } from "../helpers/db";

describe.runIf(process.env.TEST_DATABASE_URL)("seed (real Postgres)", () => {
  const t = useTestDb({ kind: "postgres" });
  const total = async () => ({
    users: (await t.db.select({ n: count() }).from(users))[0]?.n,
    eventTypes: (await t.db.select({ n: count() }).from(eventTypes))[0]?.n,
    teams: (await t.db.select({ n: count() }).from(teams))[0]?.n,
    meetings: (await t.db.select({ n: count() }).from(scheduledEvents))[0]?.n,
    invitees: (await t.db.select({ n: count() }).from(invitees))[0]?.n,
  });

  it("seeds the team scenario with demo data idempotently", async () => {
    const first = await runSeed(t.db, { scenario: "team", demo: true });
    expect(first.owner?.slug).toBe("julianjoseph");
    expect(first.team?.slug).toBe("sales");
    const after = await total();
    expect(after).toEqual({ users: 3, eventTypes: 7, teams: 1, meetings: 3, invitees: 3 });
    const again = await runSeed(t.db, { scenario: "team", demo: true });
    expect(again.owner).toEqual(first.owner);
    expect(again.team).toEqual(first.team);
    expect(await total()).toEqual(after);
  });
});
