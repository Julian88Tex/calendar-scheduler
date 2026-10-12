// Account settings (SPEC BR-01 to BR-06, BR-08, BR-10, BR-14, AU-05, AU-10; docs/SCOPE.md item 14) on the seeded owner:
// Profile edits (name, welcome message, formats, zone) show on the landing page and leaving unsaved edits through an
// app link asks first; the picture is cropped, uploaded and removed; a 6 MB upload is refused; the logo shows on the
// landing and booking pages and the branding switch hides the Powered by ribbon; My Link checks availability live and
// the old URL is 404 after the change; Login and security changes the password (the new one logs in) and logs out
// another session; skipped settings pages are 404 and /onboarding goes to Scheduling; the phone layout has no
// horizontal scroll.
import { deflateSync } from "node:zlib";
import type { Browser, Page } from "@playwright/test";
import { E2E_SECRET_HEADER, e2eSecret, expect, test } from "../fixtures";

const OWNER = "owner@example.com";
const SLUG = "julianjoseph";

/** Navigates and waits until the client components hydrated (a click before hydration is lost in dev mode). */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.readyState === "complete");
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable RGB PNG of one color (with a stripe so the crop has something to show). */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const stripe = Math.floor(x / 20) % 2 === 0;
      row[1 + x * 3] = stripe ? rgb[0] : 255;
      row[2 + x * 3] = stripe ? rgb[1] : 255;
      row[3 + x * 3] = stripe ? rgb[2] : 255;
    }
    rows.push(row);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function signedInContext(browser: Browser, baseURL: string | undefined, email: string) {
  const context = await browser.newContext({ baseURL, timezoneId: "America/New_York", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const res = await context.request.post("/api/test/login", { headers: { [E2E_SECRET_HEADER]: e2eSecret() }, data: { email } });
  expect(res.ok()).toBe(true);
  return context;
}

test.describe("account settings", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, OWNER);
  });

  test("profile edits show on the landing page; settings navigation and skipped pages", async ({ page, axe }) => {
    // The first test of the run also compiles the pages in dev mode.
    test.setTimeout(180_000);
    const errors = trackPageErrors(page);

    await open(page, "/app/settings");
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
    const subNav = page.getByRole("navigation", { name: "Account settings" });
    await expect(subNav.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    for (const item of ["Branding", "My link", "Login and security"]) await expect(subNav.getByRole("link", { name: item })).toBeVisible();
    for (const item of ["Notifications", "Cookie settings", "Privacy", "Import from Calendly"]) await expect(subNav.getByRole("link", { name: item })).toHaveCount(0);
    const name = page.getByLabel("Name");
    await expect(name).toHaveValue("Julian Joseph");
    await expect(page.getByLabel("Welcome Message")).toHaveValue(/Welcome to my scheduling page/);
    await axe(page);

    await name.fill("Julian J. Joseph");
    const welcome = page.getByLabel("Welcome Message");
    await welcome.fill("Pick any open time below.");
    await expect(page.getByText("25/265")).toBeVisible();
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.getByRole("combobox", { name: "Time Format" }).click();
    await page.getByRole("option", { name: "24h" }).click();
    await page.getByRole("combobox", { name: "Date Format" }).click();
    await page.getByRole("option", { name: "DD/MM/YYYY" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved").first()).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("Julian J. Joseph");
    await expect(page.getByLabel("Welcome Message")).toHaveValue("Pick any open time below.");
    await expect(page.getByRole("combobox", { name: "Time Format" })).toHaveText("24h");
    await expect(page.getByRole("combobox", { name: "Date Format" })).toHaveText("DD/MM/YYYY");

    // Validation: an empty name is refused in the browser and focused.
    await page.getByLabel("Name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByLabel("Name")).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Julian J. Joseph");

    // Leaving with unsaved changes through a link in the app asks first; dismissing stays on the page.
    await page.getByLabel("Name").fill("Unsaved Name");
    const prompts: string[] = [];
    page.once("dialog", (d) => {
      prompts.push(d.message());
      void d.dismiss();
    });
    await subNav.getByRole("link", { name: "Branding" }).click();
    await expect.poll(() => prompts).toEqual(["You have unsaved changes. Leave this page without saving them?"]);
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);
    await expect(page.getByLabel("Name")).toHaveValue("Unsaved Name");
    page.once("dialog", (d) => void d.accept());
    await subNav.getByRole("link", { name: "Branding" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/branding$/);

    await open(page, `/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1, name: "Julian J. Joseph" })).toBeVisible();
    await expect(page.getByText("Pick any open time below.")).toBeVisible();

    // Skipped settings pages show the not-found page (inside the streamed dashboard shell, so the status can be 200)
    // and are not linked; the onboarding wizard goes to Scheduling.
    for (const path of ["/app/settings/notifications", "/app/settings/cookies", "/app/settings/privacy", "/app/settings/import"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" }), path).toBeVisible();
    }

    await open(page, "/onboarding");
    await expect(page).toHaveURL(/\/app\/scheduling$/);
    const confirm = await page.goto("/confirm-email/abc");
    expect(confirm?.status()).toBe(404);

    // The account menu opens the settings pages (keyboard: Escape closes it).
    await open(page, "/app/scheduling");
    await page.getByRole("button", { name: "Account menu" }).click();
    for (const item of ["Profile", "Branding", "My Link", "Login and security"]) await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Notifications" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Profile" })).toHaveCount(0);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Branding" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/branding$/);
    await expect(page.getByRole("heading", { name: "Branding", level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("picture: crop and upload, landing page avatar, 6 MB refused, remove", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "/app/settings/profile");
    await page.getByLabel("Upload picture").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: solidPng(400, 300, [130, 71, 245]) });
    const dialog = page.getByRole("dialog", { name: "Crop image" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Profile picture updated").first()).toBeVisible();
    const preview = page.getByRole("img", { name: "Current image" });
    await expect(preview).toHaveAttribute("src", /\/api\/files\//);
    const src = (await preview.getAttribute("src"))!;
    const file = await page.request.get(src);
    expect(file.headers()["content-type"]).toBe("image/png");

    await open(page, `/${SLUG}`);
    await expect(page.locator(`img[src="${src}"]`).first()).toBeVisible();

    // The server refuses files over 5 MB.
    const big = await page.request.post("/app/settings/profile/avatar", {
      headers: { origin: new URL(page.url()).origin },
      multipart: { file: { name: "big.png", mimeType: "image/png", buffer: Buffer.concat([solidPng(10, 10, [0, 0, 0]), Buffer.alloc(6 * 1024 * 1024)]) } },
    });
    expect(big.status()).toBe(413);
    expect(((await big.json()) as { fieldErrors: { file: string[] } }).fieldErrors.file).toEqual(["Images must be smaller than 5 MB."]);
    // And cross-site posts.
    const crossSite = await page.request.post("/app/settings/profile/avatar", {
      headers: { origin: "https://evil.example" },
      multipart: { file: { name: "x.png", mimeType: "image/png", buffer: solidPng(10, 10, [0, 0, 0]) } },
    });
    expect(crossSite.status()).toBe(403);

    await open(page, "/app/settings/profile");
    await page.getByRole("button", { name: "Remove" }).click();
    const confirmRemove = page.getByRole("alertdialog", { name: "Remove profile picture?" });
    await confirmRemove.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Profile picture removed").first()).toBeVisible();
    await expect(page.getByRole("img", { name: "Current image" })).toHaveCount(0);
    await expect(page.getByText("Upload picture", { exact: true })).toBeVisible();
  });

  test("branding: logo on the landing and booking pages, ribbon switch", async ({ page, axe }) => {
    test.setTimeout(120_000);
    await open(page, "/app/settings/branding");
    await expect(page.getByRole("heading", { name: "Branding", level: 1 })).toBeVisible();
    await expect(page.getByText("Your logo will appear on your booking pages and in notifications.")).toBeVisible();
    await expect(page.getByTestId("branding-preview-ribbon")).toBeVisible();
    await axe(page);

    await page.getByLabel("Upload logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: solidPng(1200, 400, [23, 232, 133]) });
    await expect(page.getByText("Logo updated").first()).toBeVisible();
    const logo = page.getByRole("img", { name: "Your logo" });
    await expect(logo).toHaveAttribute("src", /\/api\/files\//);
    const src = (await logo.getAttribute("src"))!;
    // Downsized to 880px wide in the browser (PNG IHDR width and height).
    const stored = await (await page.request.get(src)).body();
    expect([stored.readUInt32BE(16), stored.readUInt32BE(20)]).toEqual([880, 293]);
    await expect(page.getByTestId("branding-preview").locator(`img[src="${src}"]`)).toBeAttached();

    const toggle = page.getByRole("switch", { name: /Use .* branding/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Changes saved").first()).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("branding-preview-ribbon")).toHaveCount(0);

    await open(page, `/${SLUG}`);
    await expect(page.locator(`img[src="${src}"]`).first()).toBeVisible();
    await expect(page.getByTestId("powered-by-ribbon")).toHaveCount(0);
    await open(page, `/${SLUG}/30min`);
    await expect(page.locator(`img[src="${src}"]`).first()).toBeVisible();
    await expect(page.getByTestId("powered-by-ribbon")).toHaveCount(0);

    await open(page, "/app/settings/branding");
    await page.getByRole("switch", { name: /Use .* branding/ }).click();
    await expect(page.getByRole("switch", { name: /Use .* branding/ })).toBeChecked();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog", { name: "Remove logo?" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Logo removed").first()).toBeVisible();
    await open(page, `/${SLUG}`);
    await expect(page.getByTestId("powered-by-ribbon")).toBeVisible();
    await expect(page.locator(`img[src="${src}"]`)).toHaveCount(0);
  });

  test("My Link: live availability, the old URL is 404 after the change", async ({ page, axe }) => {
    test.setTimeout(120_000);
    await open(page, "/app/settings/link");
    await expect(page.getByRole("heading", { name: "My Link", level: 1 })).toBeVisible();
    await expect(page.getByText(/all of your copied links will no longer work/)).toBeVisible();
    const input = page.getByLabel("Your URL");
    await expect(input).toHaveValue(SLUG);
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();
    await axe(page);

    await input.fill("Help");
    await expect(input).toHaveValue("help");
    await expect(page.getByText("This URL is not available.")).toBeVisible();
    await expect(save).toBeDisabled();

    await input.fill("julian-");
    await expect(page.getByText(/starting and ending with a letter or number/)).toBeVisible();

    await input.fill("Julian Meets");
    await expect(input).toHaveValue("julian-meets");
    await expect(page.getByText("Available", { exact: true })).toBeVisible();
    await save.click();
    await expect(page.getByText("Changes saved").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /\/julian-meets$/ })).toBeVisible();

    const old = await page.goto(`/${SLUG}`);
    expect(old?.status()).toBe(404);
    const oldEvent = await page.goto(`/${SLUG}/30min`);
    expect(oldEvent?.status()).toBe(404);
    await open(page, "/julian-meets");
    await expect(page.getByRole("heading", { level: 1, name: "Julian Joseph" })).toBeVisible();
  });

  test("login and security: change password, log out another session", async ({ page, browser, baseURL, axe }) => {
    test.setTimeout(150_000);
    const phone = await signedInContext(browser, baseURL, OWNER);
    const phonePage = await phone.newPage();
    await phonePage.goto("/app/scheduling");
    await expect(phonePage).toHaveURL(/\/app\/scheduling$/);

    await open(page, "/app/settings/login");
    await expect(page.getByRole("heading", { name: "Login and security", level: 1 })).toBeVisible();
    await expect(page.getByText(OWNER)).toBeVisible();
    const list = page.getByRole("list", { name: "Active sessions" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").first()).toContainText("This device");
    await expect(list.getByText("Safari on iPhone")).toBeVisible();
    await axe(page);

    await list.getByRole("button", { name: "Log out of Safari on iPhone" }).click();
    await expect(page.getByText("Logged out of Safari on iPhone").first()).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("You aren't logged in anywhere else.")).toBeVisible();
    await phonePage.goto("/app/scheduling");
    await expect(phonePage).toHaveURL(/\/login/);
    await phone.close();

    await page.getByRole("button", { name: "Change password" }).click();
    const dialog = page.getByRole("dialog", { name: "Change password" });
    await dialog.getByRole("textbox", { name: "Current password" }).fill("wrong-password1");
    await dialog.getByRole("textbox", { name: "New password", exact: true }).fill("fresh-pass42");
    await dialog.getByRole("textbox", { name: "Confirm new password" }).fill("fresh-pass42");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("Your current password is incorrect.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Current password" }).fill("password123");
    await dialog.getByRole("textbox", { name: "Confirm new password" }).fill("fresh-pass43");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("Passwords don't match.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Confirm new password" }).fill("fresh-pass42");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed").first()).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // This session stays; the new password logs in from a fresh browser.
    await open(page, "/app/settings/login");
    await expect(page.getByRole("heading", { name: "Login and security", level: 1 })).toBeVisible();
    const fresh = await browser.newContext({ baseURL });
    const login = await fresh.newPage();
    await login.goto("/login");
    await login.getByLabel("Email address").fill(OWNER);
    await login.getByRole("button", { name: "Continue" }).click();
    await login.getByLabel("Password", { exact: true }).fill("fresh-pass42");
    await login.getByRole("button", { name: "Log In" }).click();
    await expect(login).toHaveURL(/\/app\/scheduling$/);
    await fresh.close();
  });

  test("phone layout: settings pages have no horizontal scroll", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/app/settings/profile", "/app/settings/branding", "/app/settings/link", "/app/settings/login"]) {
      await open(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
