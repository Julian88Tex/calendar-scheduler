// Temporary review screenshots (deleted after the review).
import type { Page } from "@playwright/test";
import { test } from "../fixtures";

const OWNER = "owner@example.com";
const DIR = "/tmp/claude-0/-home-user-calendar-scheduler/c9812121-7c1c-586e-a5d4-c6110d4042e5/scratchpad/shots";

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test("review screenshots", async ({ page, api, seed, loginAs }) => {
  test.setTimeout(240_000);
  await api.reset();
  const seeded = (await seed("owner")) as { owner: { eventTypeIds: Record<string, string>; scheduleIds: Record<string, string> } };
  await api.setTime("2030-10-08T15:00:00Z");
  await loginAs(page, OWNER);
  await api.fakeCalendar({
    email: OWNER,
    events: [
      { start: "2030-10-08T20:00:00Z", end: "2030-10-08T21:00:00Z", title: "Dentist" },
      { start: "2030-10-09T07:00:00Z", end: "2030-10-10T07:00:00Z", title: "Offsite", allDay: true },
    ],
  });
  await page.setViewportSize({ width: 1366, height: 1000 });
  await open(page, "/app/availability");
  await page.screenshot({ path: `${DIR}/01-schedules.png`, fullPage: true });
  await page.getByRole("button", { name: /Working hours \(default\)/ }).click();
  await page.screenshot({ path: `${DIR}/02-dropdown.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Active on/ }).click();
  await page.screenshot({ path: `${DIR}/03-active-on.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Copy Monday times to other days" }).click();
  await page.screenshot({ path: `${DIR}/04-copy.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hours", exact: true }).click();
  await page.screenshot({ path: `${DIR}/05-hours-modal.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Schedule options" }).click();
  await page.screenshot({ path: `${DIR}/06-kebab.png` });
  await page.keyboard.press("Escape");
  await open(page, "/app/availability?view=calendar");
  await page.screenshot({ path: `${DIR}/07-calendar.png`, fullPage: true });
  await open(page, "/app/availability/advanced");
  await page.getByRole("button", { name: "Add a meeting limit" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/08-advanced.png`, fullPage: true });
  await open(page, `/app/availability/advanced/troubleshoot?eventType=${seeded.owner.eventTypeIds["30min"]}&date=2030-10-08`);
  await page.screenshot({ path: `${DIR}/09-troubleshoot.png`, fullPage: true });
  await open(page, `/app/availability/advanced/troubleshoot?date=2030-10-09`);
  await page.screenshot({ path: `${DIR}/10-troubleshoot-all.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/app/availability");
  await page.screenshot({ path: `${DIR}/11-phone-schedules.png`, fullPage: true });
  await open(page, `/app/availability/advanced/troubleshoot?eventType=${seeded.owner.eventTypeIds["30min"]}&date=2030-10-08`);
  await page.screenshot({ path: `${DIR}/12-phone-troubleshoot.png`, fullPage: true });
});
