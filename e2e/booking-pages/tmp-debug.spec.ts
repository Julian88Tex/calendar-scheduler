import AxeBuilder from "@axe-core/playwright";
import { test } from "../fixtures";

test("debug axe", async ({ page, api, seed }) => {
  await api.reset();
  await api.setTime("2030-10-07T13:00:00Z");
  await seed("owner");
  await page.goto("/julianjoseph/30min?month=2030-10&date=2030-10-07", { timeout: 120_000 });
  await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm" }).click({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of r.violations) for (const n of v.nodes) console.log("VIOLATION", v.id, n.target.join(" "), n.failureSummary);
  await api.setTime(null);
});
