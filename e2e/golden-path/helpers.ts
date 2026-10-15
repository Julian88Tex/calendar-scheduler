// Shared steps of the golden-path suite (golden-path-qa): the owner's real flows on the seeded account (Julian Joseph,
// julianjoseph, owner@example.com, America/Los_Angeles; the browser runs in America/New_York). Run it alone with
//
//   E2E_PORT=3499 PGLITE_DIR=.data/pglite-e2e-golden NEXT_DIST_DIR=.next-e2e-golden \
//     scripts/heavy.sh server npx playwright test e2e/golden-path
//
// and the "Waiting for Gmail" outbox spec with EMAIL_PROVIDER=gmail added (it skips itself otherwise).
import type { Page } from "@playwright/test";
import { expect, type OutboxEmail, type TestApi } from "../fixtures";

/** Monday, October 7, 2030 at 6:00am in Los Angeles (9:00am in New York, the browser zone). */
export const NOW = "2030-10-07T13:00:00Z";
export const OWNER = "owner@example.com";
export const SLOW = { timeout: 60_000 } as const;

export type Seeded = {
  owner: { userId: string; slug: string; email: string; eventTypeIds: Record<string, string>; scheduleIds: Record<string, string> };
  demoData?: { scheduledEventIds: string[]; inviteeIds: string[] };
};

/** Opens a page and waits for hydration (a click before hydration is lost in dev mode). */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, SLOW);
  await page.waitForLoadState("networkidle");
}

/** Collects uncaught page errors (asserted empty at the end of a flow). */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** True when the document is no wider than the viewport (no horizontal page scroll, GEN-04). */
export async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/** Opens an event type's booking page and picks a day; returns the list of start times. */
export async function openDay(page: Page, path: string, dayLabel: string) {
  await page.goto(path, SLOW);
  const day = page.getByRole("button", { name: dayLabel });
  await expect(day).toBeEnabled(SLOW);
  await day.click();
  return page.getByRole("list", { name: "Select a time" });
}

/** Fills the details form (the form refuses submissions within 2 seconds of rendering, BK-18). */
export async function fillDetails(page: Page, p: { name: string; email: string; answer?: string }): Promise<void> {
  await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
  await page.waitForTimeout(2100);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(p.name);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(p.email);
  await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill(p.answer ?? "Planning");
}

/** Schedules the details form and returns the invitee id of the confirmation page (/booking/{id}). */
export async function scheduleEvent(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Schedule Event" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible(SLOW);
  const id = /\/booking\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  expect(id, "invitee id in the confirmation URL").toBeTruthy();
  return id!;
}

/** Books `slug` on the day and time through the public pages; returns the invitee id. */
export async function book(page: Page, p: { slug: string; dayLabel: string; time: string; name: string; email: string; answer?: string }): Promise<string> {
  const times = await openDay(page, `/julianjoseph/${p.slug}`, p.dayLabel);
  await times.getByRole("button", { name: p.time, exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await fillDetails(page, p);
  return scheduleEvent(page);
}

/** The newest email of `template` to `to` (runs due jobs while waiting). */
export async function emailTo(api: TestApi, to: string, template: string, timeoutMs = 30_000): Promise<OutboxEmail> {
  return api.waitForEmail((e) => e.template === template && e.to.some((a) => a.toLowerCase().includes(to.toLowerCase())), { to, timeoutMs });
}

/** The path of the first link in an email that contains `part`. */
export function linkOf(email: OutboxEmail, part: string): string {
  const link = email.links.find((l) => l.includes(part));
  expect(link, `${part} link in ${email.template}`).toBeTruthy();
  const u = new URL(link!);
  return `${u.pathname}${u.search}`;
}
