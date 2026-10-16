// Booking calendar loading state on refresh (owner report, October 15): days load after the page, so every refresh
// used to show an empty calendar with a spinner. A month loaded in the last few minutes is now kept in sessionStorage
// and shown at once while the fresh request runs. The slots request is held open by the test, so "shown at once"
// means "shown before the server has answered", not "shown after a fast answer".
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../fixtures";

// Same clock and seed as booking.spec.ts: Monday 2030-10-07 has times, Saturday 2030-10-12 does not.
const NOW = "2030-10-07T13:00:00Z";
const OPEN_DAY = "Monday, October 7 - Times available";
const CLOSED_DAY = "Saturday, October 12 - No times available";

/** Holds every slots request until `release()` is called; `count()` is the number of requests seen. */
async function holdSlots(page: Page) {
  const held: Route[] = [];
  let open = false;
  let seen = 0;
  await page.route("**/api/public/slots?**", async (route) => {
    seen += 1;
    if (open) await route.continue();
    else held.push(route);
  });
  return {
    count: () => seen,
    release: async () => {
      open = true;
      await Promise.all(held.splice(0).map((r) => r.continue()));
    },
  };
}

test.describe("booking calendar refresh", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("first visit: the grid is dimmed with a spinner and no day is clickable until days arrive", async ({ page }) => {
    const slots = await holdSlots(page);
    await page.goto("/julianjoseph/30min?month=2030-10", { timeout: 60_000 });
    await expect.poll(slots.count, { timeout: 60_000 }).toBeGreaterThan(0);

    const grid = page.getByRole("table", { name: "Select a Day" });
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(grid).toHaveCSS("opacity", "0.4");
    await expect(grid.getByRole("button", { name: /Times available$/ })).toHaveCount(0);

    await slots.release();
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled();
    await expect(page.getByRole("button", { name: CLOSED_DAY })).toBeDisabled();
    await expect(grid).toHaveCSS("opacity", "1");
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
  });

  test("refresh: the last loaded month shows at once while the fresh request is still pending", async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) hydrationErrors.push(m.text());
    });
    await page.goto("/julianjoseph/30min?month=2030-10", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });

    const slots = await holdSlots(page);
    await page.reload();
    await expect.poll(slots.count, { timeout: 30_000 }).toBeGreaterThan(0);
    // The server has not answered yet, so these days can only come from the cached month.
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled();
    await expect(page.getByRole("button", { name: CLOSED_DAY })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Select a Day" })).toHaveCSS("opacity", "1");

    // The fresh answer still replaces the cached one: picking a day and a time works as before.
    await slots.release();
    await page.getByRole("button", { name: OPEN_DAY }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button").first()).toHaveText("3:00pm");
    expect(hydrationErrors).toEqual([]);
  });

  test("a cached month older than five minutes is not shown", async ({ page }) => {
    await page.goto("/julianjoseph/30min?month=2030-10", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });
    // Age every cached entry by six minutes.
    await page.evaluate(() => {
      for (const k of Object.keys(sessionStorage)) {
        if (!k.startsWith("kairos.slots:")) continue;
        const v = JSON.parse(sessionStorage.getItem(k)!) as { at: number };
        sessionStorage.setItem(k, JSON.stringify({ ...v, at: v.at - 6 * 60 * 1000 }));
      }
    });

    const slots = await holdSlots(page);
    await page.reload();
    await expect.poll(slots.count, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Times available$/ })).toHaveCount(0);
    await slots.release();
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled();
  });

  test("a month cached for another time zone is not reused", async ({ page }) => {
    await page.goto("/julianjoseph/30min?month=2030-10", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });
    // Move every cached month to a Paris key: the New York visitor must not see it.
    const moved = await page.evaluate(() => {
      let n = 0;
      for (const k of Object.keys(sessionStorage)) {
        if (!k.startsWith("kairos.slots:") || !k.includes("|America/New_York|")) continue;
        sessionStorage.setItem(k.replace("|America/New_York|", "|Europe/Paris|"), sessionStorage.getItem(k)!);
        sessionStorage.removeItem(k);
        n += 1;
      }
      return n;
    });
    expect(moved).toBeGreaterThan(0);

    const slots = await holdSlots(page);
    await page.reload();
    await expect.poll(slots.count, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Times available$/ })).toHaveCount(0);
    await slots.release();
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled();
  });

  test("the shown days come from the cache, then the fresh answer replaces them", async ({ page }) => {
    await page.goto("/julianjoseph/30min?month=2030-10", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });
    // Drop October 7 from the cached month only.
    await page.evaluate(() => {
      for (const k of Object.keys(sessionStorage)) {
        if (!k.startsWith("kairos.slots:")) continue;
        const v = JSON.parse(sessionStorage.getItem(k)!) as { at: number; data: { days: Record<string, unknown[]> } };
        if (v.data.days["2030-10-07"]) v.data.days["2030-10-07"] = [];
        sessionStorage.setItem(k, JSON.stringify(v));
      }
    });

    const slots = await holdSlots(page);
    await page.reload();
    await expect.poll(slots.count, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Monday, October 7 - No times available" })).toBeDisabled();
    await slots.release();
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled();
  });
});
