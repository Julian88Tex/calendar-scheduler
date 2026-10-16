// Personas (owner requests, October 16): the public pages speak to one of the owner's personas, picked only by the
// link (?for={id}); links without it show the default persona. Out of the box the owner has "Business" (the default,
// the plain pages) and "Friends" (warm voice and theme, light and dark); the old /friends link opens the friends one.
// Success means: the friends landing shows the persona's note, favorites and the friendly event names, a friend books
// through the same flow with for=friends kept on every step and gets the friends confirmation and the usual email,
// persona pages other than the default are never indexed, there is no style switch anywhere, the plain link is the
// unchanged business page, Settings > Personas adds a persona with its own link and words, each event type picks the
// personas it is shown to and its name for each, and contrast passes axe in both modes.
// PERSONA_SHOTS=<dir> saves screenshots of every step.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z";
const OPEN_DAY = "Monday, October 7 - Times available";
const SHOTS = process.env.PERSONA_SHOTS;
const SLOW = { timeout: 60_000 };

type Seeded = { owner: { eventTypeIds: Record<string, string> } };

async function openSettled(page: Page, url: string) {
  await page.goto(url, SLOW);
  await page.waitForLoadState("networkidle");
}

test.describe("personas", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    seeded = (await seed("owner")) as Seeded;
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test.setTimeout(180_000);

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: a friend books a quick catch-up from the old /friends link`, async ({ page, axe, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/friends", SLOW);
      await expect(page).toHaveURL(/\/julianjoseph\?for=friends$/);
      const shell = page.locator("[data-public-shell]");
      await expect(shell).toHaveAttribute("data-tone", "friends");
      await expect(shell).toHaveAttribute("data-public-auto", "");
      await expect(shell).toHaveCSS("background-color", scheme === "dark" ? "rgb(20, 18, 17)" : "rgb(251, 243, 232)");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByTestId("tone-toggle")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1, name: /Hey, friend!/ })).toBeVisible();
      await expect(page.getByTestId("persona-hello")).toContainText("Can't wait to see you,");
      await expect(page.getByTestId("persona-favorites")).toContainText("Things I love doing");
      await expect(page.getByTestId("persona-favorites")).toContainText("Pizza");
      await expect(page.getByRole("link", { name: /Grab pizza \(or coffee\)/ })).toBeVisible();
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-1-landing.png`, fullPage: true });

      await page.getByRole("link", { name: /Quick video catch-up/ }).click();
      await expect(page).toHaveURL(/\/julianjoseph\/30min\?.*for=friends/);
      await expect(page.getByRole("heading", { name: "When works for you?" })).toBeVisible(SLOW);
      const day = page.getByRole("button", { name: OPEN_DAY });
      await expect(day).toBeEnabled(SLOW);
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-2-calendar.png` });

      await day.click();
      await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm" }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page).toHaveURL(/\/julianjoseph\/30min\/2030-10-07T19:00:00Z\?.*for=friends/);
      await expect(page.getByRole("heading", { name: "Almost there!" })).toBeVisible(SLOW);
      await expect(page.getByTestId("persona-details-intro")).toBeVisible();
      const email = `friend-${scheme}@example.com`;
      await page.getByLabel("Name").fill(`Friend ${scheme}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel(/What's new with you\?/).fill("Just want to catch up!");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-3-details.png`, fullPage: true });

      await page.getByRole("button", { name: "Lock it in" }).click();
      await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}\?.*for=friends/, SLOW);
      await expect(page.getByRole("heading", { level: 1, name: "It's a date!" })).toBeVisible();
      await expect(page.getByTestId("persona-thanks")).toBeVisible();
      await expect(page.getByText("You and Julian are all set.")).toBeVisible();
      await expect(page.getByText(/Powered by/)).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: "Quick video catch-up" })).toBeVisible();
      await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/julianjoseph?for=friends");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-4-confirmed.png`, fullPage: true });

      await expect.poll(async () => (await api.outbox({ to: email })).length, { timeout: 30_000 }).toBeGreaterThan(0);
    });
  }

  test("the plain link is the default (business) persona: classic, indexable, no switch", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/julianjoseph", SLOW);
    const shell = page.locator("[data-public-shell]");
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    await expect(shell).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /30 Minute Virtual/ })).toBeVisible();
    await expect(page.getByTestId("tone-toggle")).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/business-landing.png`, fullPage: true });
    await page.goto("/julianjoseph/30min", SLOW);
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible(SLOW);
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    // An unknown persona falls back to the default one.
    await page.goto("/julianjoseph?for=nobody", SLOW);
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    await expect(page.getByRole("link", { name: /30 Minute Virtual/ })).toBeVisible();
  });

  test("a new persona from Settings, with its event types and names set on each event type", async ({ page, loginAs, axe }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await loginAs(page, "owner@example.com");
    await openSettled(page, "/app/settings/personas");
    const form = page.getByTestId("personas-settings");
    await expect(form.getByRole("group", { name: "Your personas" }).getByRole("button", { name: /Business/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("persona-link")).toHaveText(/\/julianjoseph$/);
    await form.getByRole("button", { name: "Add persona" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Work");
    await page.getByLabel("Link name").fill("work");
    await expect(page.getByTestId("persona-link")).toHaveText(/\/julianjoseph\?for=work$/);
    await page.getByLabel("Greeting").fill("Hello, team");
    await page.getByLabel("Note").fill("Grab any slot for a project chat.");
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-personas.png`, fullPage: true });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    // The 30 minute type: renamed for Work, hidden from Friends.
    await openSettled(page, `/app/event-types/${seeded.owner.eventTypeIds["30min"]}`);
    const more = page.getByRole("button", { name: "More options" }).first();
    if (await more.isVisible()) await more.click();
    const trigger = page.getByRole("button", { name: /^Personas/ }).first();
    await trigger.click();
    const section = page.getByTestId("personas-section");
    await expect(section.getByRole("checkbox", { name: "Business (default)" })).toBeChecked();
    await expect(section.getByRole("checkbox", { name: "Work" })).toBeChecked();
    await expect(section.getByLabel("Name for Friends")).toHaveValue("Quick video catch-up");
    await section.getByLabel("Name for Work").fill("Project sync");
    await section.getByRole("checkbox", { name: "Friends" }).click();
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/event-type-personas.png`, fullPage: true });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved").first()).toBeVisible(SLOW);

    await page.goto("/julianjoseph?for=work", SLOW);
    await expect(page.getByRole("heading", { level: 1, name: "Hello, team" })).toBeVisible();
    await expect(page.getByText("Grab any slot for a project chat.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator("[data-public-shell]")).not.toHaveAttribute("data-tone", "friends");
    await expect(page.getByRole("link", { name: /Project sync/ })).toHaveAttribute("href", /\/julianjoseph\/30min\?.*for=work/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/work-landing.png`, fullPage: true });
    await page.getByRole("link", { name: /Project sync/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Project sync" })).toBeVisible(SLOW);

    await page.goto("/julianjoseph?for=friends", SLOW);
    await expect(page.getByRole("link", { name: /Grab pizza/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Quick video catch-up/ })).toHaveCount(0);
    await page.goto("/julianjoseph", SLOW);
    await expect(page.getByRole("link", { name: /30 Minute Virtual/ })).toBeVisible();

    // The old settings page now opens Personas.
    await page.goto("/app/settings/friends", SLOW);
    await expect(page).toHaveURL(/\/app\/settings\/personas$/);
  });

  test("unknown event slugs are 404 for a persona and on the old link", async ({ page }) => {
    expect((await page.goto("/julianjoseph/not-a-real-event?for=friends", SLOW))?.status()).toBe(404);
    expect((await page.goto("/friends/not-a-real-event", SLOW))?.status()).toBe(404);
  });
});
