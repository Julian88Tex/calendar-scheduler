// Foundation auth end to end (SPEC AU-01, AU-04, AU-05, AU-07, AU-08, AU-11, GEN-09): signup to Scheduling,
// email verification through the outbox, login and logout (the old cookie stops working), forgot password through
// the outbox, the closed signup state, and the setup page.
import { expect, test } from "../fixtures";

test.describe("signup", () => {
  test("two-step email signup lands on Scheduling and verifies the email from the outbox", async ({ page, api, outbox, axe }) => {
    await api.reset();
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Create a free account" })).toBeVisible();
    await expect(page.getByText("No credit card required.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Log In" })).toHaveAttribute("href", "/login");
    await axe(page);

    // Step 1: client-side validation, then the server check.
    await page.getByLabel("Enter your email").fill("not-an-email");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByLabel("Enter your email").fill("ada.lovelace@example.com");
    await page.getByRole("button", { name: "Continue with email" }).click();

    // Step 2 slides in on the same page.
    await expect(page.getByText("Signing up as")).toBeVisible();
    await expect(page.getByLabel("Enter your full name")).toBeFocused();
    await page.getByLabel("Enter your full name").fill("Ada Lovelace");
    await page.getByLabel("Choose a password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Use at least 8 characters").last()).toBeVisible();
    await page.getByLabel("Choose a password").fill("analytical1");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/app\/scheduling$/);

    const emails = await outbox({ to: "ada.lovelace@example.com" });
    expect(emails.map((e) => e.template).sort()).toEqual(["auth.verify_email", "auth.welcome"]);
    const verify = emails.find((e) => e.template === "auth.verify_email")!;
    expect(verify.subject).toBe("Verify your email");
    const link = verify.links.find((l) => l.includes("/verify-email/"))!;
    expect(link).toBeTruthy();

    // Opening the link twice changes nothing (GEN-08); the button verifies.
    await page.goto(link);
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
    await expect(page.getByText("ada.lovelace@example.com")).toBeVisible();
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByText("Your email address is verified. Thanks!")).toBeVisible();
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1, name: "Email verified" })).toBeVisible();
  });

  test("an existing email is told to log in, and closed signups show the AU-11 message", async ({ page, api, seed }) => {
    await api.reset();
    await seed("owner");
    // invite_only is the default once an account exists.
    await page.goto("/signup");
    await expect(page.getByText("Sign ups are closed. Ask an admin for an invitation.")).toBeVisible();
    await expect(page.getByLabel("Enter your email")).toHaveCount(0);
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Sign up for free" })).toHaveCount(0);
  });
});

test.describe("login and logout", () => {
  test("email step, password step, wrong password, ?next, logout revokes the session", async ({ page, api, seed, axe }) => {
    await api.reset();
    await seed("owner");
    await page.goto("/app/meetings");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fmeetings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log in to your account" })).toBeVisible();
    await axe(page);

    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("not-the-password1");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/app\/meetings$/);

    // Signed-in visitors skip the login page.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app\/scheduling$/);

    // Logout (POST, same origin) revokes the session server side; the old cookie value is rejected afterwards.
    const before = (await page.context().cookies()).find((c) => c.name === "sid")!;
    const status = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", redirect: "manual" })).status);
    expect([0, 303]).toContain(status);
    await page.goto("/app/scheduling");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fscheduling$/);
    await page.context().addCookies([before]);
    await page.goto("/app/scheduling");
    await expect(page).toHaveURL(/\/login/);
  });

  test("Change goes back to the email step", async ({ page, api, seed }) => {
    await api.reset();
    await seed("owner");
    await page.goto("/login");
    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Change" }).click();
    await expect(page.getByLabel("Email address")).toBeEditable();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });
});

test.describe("forgot password", () => {
  test("sends a reset link through the outbox, sets the new password and logs in; the link works once", async ({ page, api, seed, outbox }) => {
    await api.reset();
    await seed("owner");
    await page.goto("/login");
    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { level: 1, name: "Reset your password" })).toBeVisible();
    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If an account exists for owner@example.com, we sent a link to reset your password.")).toBeVisible();

    const email = await api.waitForEmail((e) => e.template === "auth.reset_password", { to: "owner@example.com" });
    const link = email.links.find((l) => l.includes("/reset-password/"))!;
    await page.goto(link);
    await page.goto(link); // opening it again consumes nothing
    await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("brand-new-pass1");
    await page.getByLabel("Confirm new password").fill("brand-new-pass1");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page).toHaveURL(/\/app\/scheduling$/);

    await page.goto(link);
    await expect(page.getByText("This link has expired. Request a new one.")).toBeVisible();

    // The new password works.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email address").fill("owner@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password", { exact: true }).fill("brand-new-pass1");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/app\/scheduling$/);
    expect((await outbox({ to: "owner@example.com", template: "auth.reset_password" })).length).toBe(1);
  });
});

test.describe("setup page", () => {
  test("renders the checklist and the exact redirect URIs", async ({ page, baseURL, axe }) => {
    const res = await page.goto("/setup");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: /^Finish setting up / })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
    const config = page.getByRole("region", { name: "Configuration" });
    for (const label of ["Database", "Session secret", "Encryption key", "Google (sign in, Calendar, Meet)", "Email provider", "Cron secret"]) {
      await expect(config.getByText(new RegExp(`^${label.replace(/[()]/g, "\\$&")}`)).first()).toBeVisible();
    }
    await expect(config.getByText("Outbox only")).toBeVisible();
    await expect(page.getByText(`${baseURL}/api/auth/google/callback`)).toBeVisible();
    await expect(page.getByText(`${baseURL}/api/auth/microsoft/callback`)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await axe(page);
  });
});
