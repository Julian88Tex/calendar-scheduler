// Meeting polls through the real Next.js runtime (SPEC MP-03, MP-12, MP-15, MP-18, MP-19, ADM-10): the seeded demo
// poll in the host list, creating a poll over the API, the redacted public JSON for an anonymous visitor, the Book
// dialog data and "Book meeting" on the demo poll, the invitee confirmations, and the booked public state. The voter
// and host pages are polls-ui's; this suite covers the polls-core routes they call.
import { test, expect } from "../fixtures";

type ListPage = { items: { id: string; slug: string; title: string; respondents: number; status: string }[] };

test("poll API: list, create, public view and booking the demo poll", async ({ page, api, seed, loginAs, playwright, baseURL }) => {
  await api.reset();
  await api.setTime("2030-10-07T15:00:00Z");
  await seed("owner", { demo: true });
  await loginAs(page, "owner@example.com");
  const host = page.context().request;
  const origin = { origin: baseURL! };

  const list = (await (await host.get("/api/polls?filter=open")).json()) as ListPage;
  const demo = list.items.find((p) => p.title === "Q4 roadmap review");
  expect(demo).toMatchObject({ status: "open", respondents: 3 });

  const created = await host.post("/api/polls", {
    headers: origin,
    data: {
      title: "Planning session",
      timezone: "America/Los_Angeles",
      defaultDurationMinutes: 30,
      options: [
        { start: "2030-10-09T17:00:00.000Z", end: "2030-10-09T17:30:00.000Z" },
        { start: "2030-10-10T17:00:00.000Z", end: "2030-10-10T17:30:00.000Z" },
      ],
      reserveTimes: true,
    },
  });
  expect(created.status()).toBe(201);
  const poll = (await created.json()) as { ok: boolean; pollId: string; slug: string; link: string };
  expect(poll.link).toBe(`${baseURL}/p/${poll.slug}`);
  const crossSite = await host.post("/api/polls", { headers: { origin: "https://evil.example" }, data: {} });
  expect(crossSite.status()).toBe(403);

  // An anonymous visitor sees the demo poll redacted (after_vote: nothing about others before voting, never emails).
  const anon = await playwright.request.newContext({ baseURL });
  const view = await anon.get(`/api/public/polls/${demo!.slug}`);
  expect(view.status()).toBe(200);
  const text = await view.text();
  expect(text).not.toContain("ana.lima@example.com");
  expect(text).not.toContain("Ana Lima");
  expect(JSON.parse(text)).toMatchObject({ poll: { title: "Q4 roadmap review", resultsVisibility: "after_vote", status: "open" }, canVote: true });
  expect((await anon.get("/api/public/polls/no-such-poll")).status()).toBe(404);
  expect((await anon.get(`/api/polls/${demo!.id}`)).status()).toBe(401);

  // Book the demo poll's best time with the default invitees.
  const results = (await (await host.get(`/api/polls/${demo!.id}`)).json()) as { ranking: string[]; options: { id: string; isBest: boolean }[] };
  const best = results.ranking[0]!;
  expect(results.options.find((o) => o.id === best)?.isBest).toBe(true);
  const preview = (await (await host.get(`/api/polls/${demo!.id}/options/${best}/booking-preview`)).json()) as {
    invitees: { participantId: string; email: string | null; checked: boolean }[];
    blocking: unknown[];
  };
  expect(preview.blocking).toEqual([]);
  const chosen = preview.invitees.filter((i) => i.checked).map((i) => ({ participantId: i.participantId, email: i.email }));
  expect(chosen).toHaveLength(3);
  const booked = await host.post(`/api/polls/${demo!.id}/book`, { headers: origin, data: { optionId: best, invitees: chosen } });
  expect(booked.status()).toBe(200);
  expect(await booked.json()).toMatchObject({ ok: true, mode: "booked" });

  await api.runJobs();
  const confirmation = await api.waitForEmail((e) => e.template === "lifecycle.invitee_confirmation", { to: "ana.lima@example.com" });
  expect(confirmation.hasIcs).toBe(true);
  const after = (await (await anon.get(`/api/public/polls/${demo!.slug}`)).json()) as {
    poll: { status: string };
    booked: { status: string; scheduledEventId: string | null; joinUrl: string | null; addToCalendar: unknown[] } | null;
  };
  expect(after.poll.status).toBe("booked");
  // Someone holding only the poll link learns the time, never the meeting's join link or calendar file (GEN-08).
  expect(after.booked).toMatchObject({ status: "active", scheduledEventId: null, joinUrl: null, addToCalendar: [] });
  expect((await anon.get(`/api/public/polls/${demo!.slug}/event.ics`)).status()).toBe(404);
  // The host sees the booked meeting on the voter page too ("View live page").
  const hostIcs = await host.get(`/api/public/polls/${demo!.slug}/event.ics`);
  expect(hostIcs.status()).toBe(200);
  expect(await hostIcs.text()).toContain("BEGIN:VCALENDAR");
  await anon.dispose();
});
