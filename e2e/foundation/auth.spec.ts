// Foundation auth smoke (SPEC AU-01, AU-04, AU-11, ADM-10): the minimal login and signup forms work end to end with
// the seeded owner and createUserAccount, before foundation-auth replaces them with the full pages.
import { expect, test } from "../fixtures";

test.describe("login and signup (foundation stubs)", () => {
  test("the seeded owner logs in and lands on ?next", async ({ page, api, seed }) => {
    await api.reset();
    await seed("owner");
    await page.goto("/app/meetings");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fmeetings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log in to your account" })).toBeVisible();

    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByLabel("Password").fill("not-the-password1");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Incorrect email or password.");

    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/app\/meetings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();

    // Signed-in users skip the login page.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app\/scheduling$/);
  });

  test("the first signup creates an account and opens onboarding; later signups follow the policy", async ({ page, api }) => {
    await api.reset();
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Create a free account" })).toBeVisible();
    await page.getByLabel("Enter your email").fill("first.user@example.com");
    await page.getByLabel("Enter your full name").fill("First User");
    await page.getByLabel("Choose a password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();

    await page.getByLabel("Enter your email").fill("first.user@example.com");
    await page.getByLabel("Enter your full name").fill("First User");
    await page.getByLabel("Choose a password").fill("longenough1");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/app/scheduling");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

    // The instance now has an account, so the default invite_only policy closes signups (AU-11).
    await page.context().clearCookies();
    await page.goto("/signup");
    await page.getByLabel("Enter your email").fill("second.user@example.com");
    await page.getByLabel("Enter your full name").fill("Second User");
    await page.getByLabel("Choose a password").fill("longenough1");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Sign ups are closed. Ask an admin for an invitation.");
  });
});
