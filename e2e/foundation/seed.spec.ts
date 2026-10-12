// Seed through the test API (SPEC ADM-10, ARCHITECTURE section 24.2): the "team" scenario with demo data returns the
// seeded ids, re-seeding keeps them, and the seeded handles and event types resolve on the public routes.
import { expect, test } from "../fixtures";

type Seeded = {
  ok: boolean;
  owner: { userId: string; slug: string; eventTypeIds: Record<string, string> };
  team: { teamId: string; slug: string; memberIds: Record<string, string>; eventTypeIds: Record<string, string> };
  demoData: { scheduledEventIds: string[]; inviteeIds: string[]; contactIds: string[] };
};

test("seeds the team scenario with demo data idempotently and the public routes resolve", async ({ api, request }) => {
  await api.reset();
  const first = (await api.seed("team", { demo: true })) as unknown as Seeded;
  expect(first.ok).toBe(true);
  expect(first.owner.slug).toBe("julianjoseph");
  expect(Object.keys(first.owner.eventTypeIds)).toEqual(["30min", "60min", "meal"]);
  expect(first.team.slug).toBe("sales");
  expect(Object.keys(first.team.eventTypeIds)).toEqual(["intro", "demo"]);
  expect(first.demoData.scheduledEventIds).toHaveLength(3);
  expect(first.demoData.contactIds).toHaveLength(2);

  const again = (await api.seed("team", { demo: true })) as unknown as Seeded;
  expect(again.owner).toEqual(first.owner);
  expect(again.team).toEqual(first.team);
  expect(again.demoData.scheduledEventIds.sort()).toEqual([...first.demoData.scheduledEventIds].sort());

  for (const path of ["/julianjoseph", "/julianjoseph/30min", "/julianjoseph/60min", "/julianjoseph/meal", "/sales", "/sales/intro", "/sales/demo"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  for (const path of ["/julianjoseph/nope", "/nobody-here"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const join = await request.get(`/events/${first.demoData.scheduledEventIds[0]}/join`, { maxRedirects: 0 });
  expect(join.status()).toBe(200);

  // Seeded accounts can sign in through the test API.
  for (const email of ["owner@example.com", "member1@example.com", "member2@example.com"]) {
    expect((await api.call("POST", "/api/test/login", { email })).status(), email).toBe(200);
  }
});
