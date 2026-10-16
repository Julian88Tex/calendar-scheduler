// Setup checklist (SPEC GEN-09, ADM-03), auth email templates (AU-01, AU-07, AU-08, AU-10, GEN-11) and the sealed
// OAuth state cookie (ARCHITECTURE 18.4).
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginMethodCodeTemplate, resetPasswordTemplate, verifyEmailTemplate, welcomeTemplate } from "@/lib/auth/emails";
import { backgroundStatus, configurationChecklist, instanceHasAccount, oauthRedirectUris } from "@/lib/auth/flows/setup-status";
import { checkOAuthState, sealOAuthState, unsealOAuthState } from "@/lib/auth/oauth/state";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";

const env = process.env as Record<string, string | undefined>;
const touched = [
  "RESEND_API_KEY",
  "SMTP_HOST",
  "EMAIL_PROVIDER",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CRON_SECRET",
  "SETUP_TOKEN",
  "OWNER_EMAIL",
  "ENCRYPTION_KEY",
  "VERCEL",
  "APP_URL",
];
const saved = Object.fromEntries(touched.map((k) => [k, env[k]]));
afterEach(() => {
  for (const k of touched) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  resetFakeTime();
});

/** A row of a fresh instance's checklist (no account yet, so the owner bootstrap row is listed). */
const item = (id: string) => configurationChecklist({ instanceHasAccount: false }).find((i) => i.id === id)!;

describe("configuration checklist (GEN-09, ADM-03)", () => {
  it("lists every GEN-09 entry with gray Not configured by default", () => {
    for (const k of touched) delete env[k];
    const ids = configurationChecklist({ instanceHasAccount: false }).map((i) => i.id);
    expect(ids).toEqual(["database", "session_secret", "encryption_key", "google", "microsoft", "email", "cron_secret", "owner_bootstrap"]);
    expect(item("owner_bootstrap")).toMatchObject({ status: "off", value: "Not configured", envVars: ["SETUP_TOKEN", "OWNER_EMAIL"] });
    expect(item("google")).toMatchObject({ status: "off", value: "Not configured", envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] });
    expect(item("cron_secret").status).toBe("off");
  });

  it("turns green when variables are set; email goes through the owner's Gmail without Resend or SMTP", () => {
    for (const k of touched) delete env[k];
    expect(item("email")).toMatchObject({ status: "off", value: "Outbox only" });
    expect(item("email").hint).toContain("send them from Gmail");
    env.GOOGLE_CLIENT_ID = "id";
    env.GOOGLE_CLIENT_SECRET = "secret";
    env.CRON_SECRET = "c";
    env.ENCRYPTION_KEY = "k";
    env.RESEND_API_KEY = "re_123";
    expect(item("google")).toMatchObject({ status: "ok", value: "Configured", label: "Google (sign in, Calendar, Meet, Gmail sending)" });
    expect(item("cron_secret").status).toBe("ok");
    expect(item("encryption_key").status).toBe("ok");
    expect(item("email")).toMatchObject({ status: "ok", value: "Resend", envVars: expect.arrayContaining(["EMAIL_PROVIDER", "RESEND_API_KEY", "SMTP_HOST"]) });
    delete env.RESEND_API_KEY;
    expect(item("email")).toMatchObject({ status: "ok", value: "Owner's Gmail" });
    expect(item("email").hint).toContain("Gmail sending");
    env.SMTP_HOST = "smtp.example.com";
    expect(item("email").value).toBe("SMTP");
    env.EMAIL_PROVIDER = "gmail";
    expect(item("email")).toMatchObject({ status: "ok", value: "Owner's Gmail (EMAIL_PROVIDER=gmail)" });
    env.EMAIL_PROVIDER = "outbox";
    expect(item("email")).toMatchObject({ status: "off", value: "Outbox only" });
    delete env.GOOGLE_CLIENT_ID;
    env.EMAIL_PROVIDER = "gmail";
    expect(item("email").status).toBe("warning");
  });

  it("shows whether the owner bootstrap is enabled and limited to OWNER_EMAIL, never the address itself", () => {
    for (const k of touched) delete env[k];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env.OWNER_EMAIL = "owner@example.com";
    expect(item("owner_bootstrap")).toMatchObject({ status: "off", value: "Not configured" });
    expect(item("owner_bootstrap").hint).toContain("Only OWNER_EMAIL becomes instance admin");
    env.SETUP_TOKEN = "short";
    expect(item("owner_bootstrap").status).toBe("off");
    env.SETUP_TOKEN = "s".repeat(24);
    expect(item("owner_bootstrap")).toMatchObject({ status: "ok", value: "Enabled for OWNER_EMAIL" });
    delete env.OWNER_EMAIL;
    expect(item("owner_bootstrap")).toMatchObject({ status: "ok", value: "Enabled" });
    env.OWNER_EMAIL = "not-an-email";
    expect(item("owner_bootstrap")).toMatchObject({ status: "warning", value: "OWNER_EMAIL is not a valid email address" });
    env.OWNER_EMAIL = "owner@example.com";
    expect(JSON.stringify(configurationChecklist({ instanceHasAccount: false }))).not.toContain("owner@example.com");
    vi.restoreAllMocks();
  });

  it("lists the owner bootstrap only while the instance is known to have no account", () => {
    for (const k of touched) delete env[k];
    env.SETUP_TOKEN = "s".repeat(24);
    env.OWNER_EMAIL = "owner@example.com";
    expect(item("owner_bootstrap")).toMatchObject({ status: "ok", value: "Enabled for OWNER_EMAIL" });
    for (const instanceHasAccount of [true, null, undefined]) {
      const items = configurationChecklist({ instanceHasAccount });
      expect(items.map((i) => i.id), String(instanceHasAccount)).toEqual(["database", "session_secret", "encryption_key", "google", "microsoft", "email", "cron_secret"]);
      const text = JSON.stringify(items);
      for (const hidden of ["OWNER_EMAIL", "owner@example.com", "SETUP_TOKEN", "/api/setup/bootstrap", "Owner bootstrap"]) expect(text).not.toContain(hidden);
    }
    expect(configurationChecklist().some((i) => i.id === "owner_bootstrap")).toBe(false);
  });

  it("flags the missing database on Vercel and skips database reads in setup mode", async () => {
    env.VERCEL = "1";
    expect(item("database")).toMatchObject({ status: "warning", value: "Required: connect a Postgres database" });
    expect(await backgroundStatus()).toBeNull();
    // No database means no account yet: the setup page shows the owner bootstrap row without touching the database.
    expect(await instanceHasAccount()).toBe(false);
  });

  it("builds the exact redirect URIs from APP_URL", () => {
    env.APP_URL = "https://cal.example.com/";
    expect(oauthRedirectUris().map((u) => u.uri)).toEqual([
      "https://cal.example.com/api/auth/google/callback",
      "https://cal.example.com/api/auth/microsoft/callback",
    ]);
    expect(oauthRedirectUris().map((u) => u.provider)).toEqual(["Google (sign in, Calendar, Meet, Gmail sending)", "Microsoft (sign in)"]);
  });
});

describe("auth email templates", () => {
  const DASHES = new RegExp("[\\u2013\\u2014]");
  it("verify, reset, code and welcome emails carry their links, expiry and no dashes", () => {
    const verify = verifyEmailTemplate({ name: "Ada Lovelace", url: "https://x.example/verify-email/tok", email: "ada@example.com" });
    expect(verify.subject).toBe("Verify your email");
    expect(verify.html).toContain('href="https://x.example/verify-email/tok"');
    expect(verify.html).toContain("Verify email");
    expect(verify.text).toContain("Hi Ada,");
    expect(verify.text).toContain("expires in 24 hours");

    const reset = resetPasswordTemplate({ name: "Ada", url: "https://x.example/reset-password/tok" });
    expect(reset.subject).toBe("Reset your Kairos password");
    expect(reset.text).toContain("https://x.example/reset-password/tok");
    expect(reset.text).toContain("expires in 60 minutes and can only be used once");

    const code = loginMethodCodeTemplate({ name: "Ada", code: "123456" });
    expect(code.subject).toContain("123456");
    expect(code.text).toContain("123456");

    const welcome = welcomeTemplate({ name: "Ada", url: "https://x.example/app/scheduling", bookingUrl: "https://x.example/ada" });
    expect(welcome.subject).toBe("Welcome to Kairos");
    expect(welcome.text).toContain("x.example/ada");

    for (const m of [verify, reset, code, welcome]) {
      expect(DASHES.test(m.html)).toBe(false);
      expect(DASHES.test(m.text)).toBe(false);
    }
  });

  it("escapes names", () => {
    const m = verifyEmailTemplate({ name: "<script>x</script>", url: "https://x.example/v" });
    expect(m.html).not.toContain("<script>x</script>");
  });
});

describe("sealed OAuth state", () => {
  const base = {
    provider: "google" as const,
    state: "abc",
    codeVerifier: "verifier",
    intent: "login" as const,
    returnTo: "/app/meetings",
    invitationToken: null,
    data: {},
    userId: null,
  };

  it("round-trips, detects tampering, mismatches and expiry", async () => {
    setFakeNow("2033-01-01T00:00:00Z");
    const sealed = await sealOAuthState(base);
    const opened = await unsealOAuthState(sealed);
    expect(opened).toMatchObject({ ...base, v: 1 });
    expect(checkOAuthState(opened, { provider: "google", state: "abc" }).ok).toBe(true);
    expect(checkOAuthState(opened, { provider: "google", state: "abd" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(checkOAuthState(opened, { provider: "microsoft", state: "abc" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(checkOAuthState(null, { provider: "google", state: "abc" })).toMatchObject({ ok: false, reason: "missing" });
    const tampered = `${sealed.slice(0, -3)}${sealed.endsWith("A") ? "B" : "A"}aa`;
    expect(await unsealOAuthState(tampered)).toBeNull();
    expect(await unsealOAuthState("garbage")).toBeNull();
    setFakeNow("2033-01-01T00:10:01Z");
    expect(checkOAuthState(opened, { provider: "google", state: "abc" })).toMatchObject({ ok: false, reason: "expired" });
  });
});
