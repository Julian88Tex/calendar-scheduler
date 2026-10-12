// Time zone mismatch banner (SPEC GEN-23): a browser in Asia/Kolkata with a New York profile sees the banner with
// friendly zone names; "Update time zone" sets the profile zone (the banner stays gone after a reload, and a New York
// browser now sees the reverse mismatch); "Dismiss" hides it for that browser zone across reloads.
import { expect, test } from "../fixtures";

test.use({ timezoneId: "Asia/Kolkata" });

test.describe("time zone mismatch banner", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await seed("team");
  });

  test("Update time zone changes the profile zone", async ({ page, browser, loginAs }) => {
    // member1@example.com is seeded in America/New_York.
    await loginAs(page, "member1@example.com");
    await page.goto("/app/scheduling");
    const message = page.getByRole("status").filter({ hasText: /Your computer's time zone \(India, Sri Lanka Time\) is different from your profile's \(Eastern Time - US & Canada\)\. Update your profile\?/ });
    await expect(message).toBeVisible();

    await message.getByRole("button", { name: "Update time zone" }).click();
    await expect(page.getByText("Time zone updated").first()).toBeVisible();
    await expect(message).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/Your computer's time zone/)).toHaveCount(0);

    // The profile now says India: a New York browser sees the reverse mismatch.
    const ny = await browser.newContext({ timezoneId: "America/New_York", locale: "en-US" });
    try {
      const nyPage = await ny.newPage();
      await loginAs(nyPage, "member1@example.com");
      await nyPage.goto("/app/scheduling");
      await expect(
        nyPage.getByText("Your computer's time zone (Eastern Time - US & Canada) is different from your profile's (India, Sri Lanka Time). Update your profile?"),
      ).toBeVisible();
    } finally {
      await ny.close();
    }
  });

  test("Dismiss hides the banner for this browser zone", async ({ page, loginAs }) => {
    // member2@example.com is seeded in America/Chicago.
    await loginAs(page, "member2@example.com");
    await page.goto("/app/scheduling");
    const message = page.getByRole("status").filter({ hasText: /is different from your profile's \(Central Time - US & Canada\)/ });
    await expect(message).toBeVisible();
    await message.getByRole("button", { name: "Dismiss" }).click();
    await expect(message).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/Your computer's time zone/)).toHaveCount(0);
  });
});
