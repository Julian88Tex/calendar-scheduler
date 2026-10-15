// Small shared helpers: env, url, brand, ids, validation, html, pagination, template, embed events, logger,
// integrations catalog (ARCHITECTURE section 21).
import { asc, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { users } from "@/db/schema";
import { APP_NAME, appName, toAppNameSlug } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { embedDisplayParams, isEmbedRequest, postEmbedEvent } from "@/lib/embed-events";
import { adminEmails, env, features, getFeatures, isVercel, microsoftTenant, parseEnv, SETUP_TOKEN_MIN_LENGTH } from "@/lib/env";
import { autolink, escapeHtml, plainToHtml, richTextToPlain, sanitizeRichText } from "@/lib/html";
import { CODE_ALPHABET, isUuid, jitsiRoom, newId, pollSlug, randomString, routingSlug, shortCode } from "@/lib/ids";
import { INTEGRATIONS, emailTransportLabel, filterIntegrations, integrationStatus } from "@/lib/integrations/catalog";
import { log, redactValue } from "@/lib/logger";
import { decodeCursor, encodeCursor, keysetAfter, paginate, type Page } from "@/lib/pagination";
import { listTemplateVariables, renderTemplate, templateVariablesIn } from "@/lib/template";
import {
  absoluteUrl,
  appUrl,
  inviteeUrls,
  joinUrl,
  parseStartParam,
  publicBookingPath,
  publicBookingUrl,
  safeNextPath,
  startParam,
} from "@/lib/url";
import {
  zE164,
  zEmail,
  zHandle,
  zHexColor,
  zLocationConfig,
  zMinuteRange,
  zPassword,
  zSlug,
  zTimeZone,
  zUrlHttps,
  zWeeklyHours,
} from "@/lib/validation";
import { useTestDb } from "../helpers/db";
import { createUser } from "../factories";

const e = process.env as Record<string, string | undefined>;
afterEach(() => {
  for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "RESEND_API_KEY", "SMTP_HOST", "ADMIN_EMAILS", "SMTP_PORT", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]) delete e[k];
  e.APP_URL = "http://localhost:3000";
  vi.restoreAllMocks();
});

describe("env", () => {
  it("parses optional values, ignores empty strings and warns about invalid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseEnv({
      APP_URL: "https://kairos.example.com/",
      SMTP_PORT: "not-a-port",
      SIGNUP_POLICY: "sometimes",
      ADMIN_EMAILS: "A@x.com, b@y.com",
      MIGRATE_ON_PREVIEW: "1",
      GOOGLE_CLIENT_ID: "",
    });
    expect(parsed.APP_URL).toBe("https://kairos.example.com");
    expect(parsed.SMTP_PORT).toBeUndefined();
    expect(parsed.SIGNUP_POLICY).toBeUndefined();
    expect(parsed.ADMIN_EMAILS).toEqual(["a@x.com", "b@y.com"]);
    expect(parsed.MIGRATE_ON_PREVIEW).toBe(true);
    expect("GOOGLE_CLIENT_ID" in parsed).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("parses the owner bootstrap and email provider variables", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = "t".repeat(SETUP_TOKEN_MIN_LENGTH);
    expect(parseEnv({ SETUP_TOKEN: ` ${token} `, OWNER_EMAIL: " Owner@Example.COM ", EMAIL_PROVIDER: " Gmail " })).toMatchObject({
      SETUP_TOKEN: token,
      OWNER_EMAIL: "owner@example.com",
      EMAIL_PROVIDER: "gmail",
    });
    const invalid = parseEnv({ SETUP_TOKEN: token.slice(1), OWNER_EMAIL: "not-an-email", EMAIL_PROVIDER: "carrier-pigeon" });
    expect([invalid.SETUP_TOKEN, invalid.OWNER_EMAIL, invalid.EMAIL_PROVIDER]).toEqual([undefined, undefined, undefined]);
    for (const p of ["gmail", "resend", "smtp", "outbox"]) expect(parseEnv({ EMAIL_PROVIDER: p.toUpperCase() }).EMAIL_PROVIDER).toBe(p);
    expect(SETUP_TOKEN_MIN_LENGTH).toBe(24);
  });

  it("derives features live from process.env", () => {
    expect(features.googleOAuth).toBe(false);
    expect(features.email).toBe("outbox");
    e.GOOGLE_CLIENT_ID = "id";
    e.GOOGLE_CLIENT_SECRET = "secret";
    e.SMTP_HOST = "smtp.example.com";
    expect(features.googleOAuth).toBe(true);
    expect(features.email).toBe("smtp");
    e.RESEND_API_KEY = "re_x";
    expect(features.email).toBe("resend");
    expect(features.sms).toBe(false);
    e.TWILIO_ACCOUNT_SID = "AC";
    e.TWILIO_AUTH_TOKEN = "t";
    e.TWILIO_FROM_NUMBER = "+15550000000";
    expect(getFeatures().sms).toBe(true);
    e.STRIPE_SECRET_KEY = "sk";
    expect(features.stripe).toBe(true);
    expect(features.stripeInline).toBe(false);
    e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk";
    expect(features.stripeInline).toBe(true);
    e.ADMIN_EMAILS = "Boss@Example.com";
    expect(adminEmails()).toEqual(["boss@example.com"]);
    expect(env.ADMIN_EMAILS).toEqual(["boss@example.com"]);
    expect(microsoftTenant()).toBe("common");
    expect(isVercel()).toBe(false);
    e.VERCEL = "1";
    expect(isVercel()).toBe(true);
  });
});

describe("url", () => {
  it("appUrl precedence: APP_URL, production domain, branch, deployment, localhost", () => {
    e.APP_URL = "https://app.example.com/";
    expect(appUrl()).toBe("https://app.example.com");
    delete e.APP_URL;
    e.VERCEL_ENV = "production";
    e.VERCEL_PROJECT_PRODUCTION_URL = "kairos.example.com";
    e.VERCEL_BRANCH_URL = "kairos-git-x.vercel.app";
    expect(appUrl()).toBe("https://kairos.example.com");
    e.VERCEL_ENV = "preview";
    expect(appUrl()).toBe("https://kairos-git-x.vercel.app");
    delete e.VERCEL_BRANCH_URL;
    e.VERCEL_URL = "kairos-abc.vercel.app";
    expect(appUrl()).toBe("https://kairos-abc.vercel.app");
    delete e.VERCEL_URL;
    expect(appUrl()).toBe("http://localhost:3000");
  });

  it("builds public and capability URLs (SPEC 0.6)", () => {
    expect(startParam(new Date("2026-10-13T18:00:00.000Z"))).toBe("2026-10-13T18:00:00Z");
    expect(parseStartParam("2026-10-13T18:00:00Z")?.toISOString()).toBe("2026-10-13T18:00:00.000Z");
    expect(parseStartParam("2026-10-13T14:00:00-04:00")?.toISOString()).toBe("2026-10-13T18:00:00.000Z");
    expect(parseStartParam("tomorrow")).toBeNull();
    expect(publicBookingPath({ handle: "julianjoseph" })).toBe("/julianjoseph");
    expect(publicBookingPath({ handle: "julianjoseph", eventSlug: "30min", start: "2026-10-13T18:00:00Z" })).toBe(
      "/julianjoseph/30min/2026-10-13T18:00:00Z",
    );
    expect(publicBookingPath({ code: "abcd-efgh", eventSlug: "30min", query: { month: "2026-10", empty: "" } })).toBe(
      "/d/abcd-efgh/30min?month=2026-10",
    );
    expect(publicBookingUrl({ handle: "x", eventSlug: "y" })).toBe("http://localhost:3000/x/y");
    const id = "11111111-2222-4333-8444-555555555555";
    expect(inviteeUrls(id)).toEqual({
      confirmation: `http://localhost:3000/booking/${id}`,
      cancel: `http://localhost:3000/cancellations/${id}`,
      reschedule: `http://localhost:3000/reschedulings/${id}`,
      reconfirm: `http://localhost:3000/reconfirm/${id}`,
      ics: `http://localhost:3000/booking/${id}/event.ics`,
    });
    expect(joinUrl(id)).toBe(`http://localhost:3000/events/${id}/join`);
    expect(absoluteUrl("p/abc")).toBe("http://localhost:3000/p/abc");
  });

  it("safeNextPath keeps only same-site relative paths (AU-04)", () => {
    expect(safeNextPath("/app/meetings?tab=past")).toBe("/app/meetings?tab=past");
    expect(safeNextPath("/app/x#h")).toBe("/app/x#h");
    for (const bad of ["https://evil.example/app", "//evil.example", "/\\evil.example", "javascript:alert(1)", "app", "", null, "%2F%2Fevil.example", "/a\nb"]) {
      expect(safeNextPath(bad as string | null), String(bad)).toBe("/app/scheduling");
    }
  });
});

describe("brand and ids", () => {
  it("app name and slug", () => {
    expect(APP_NAME).toBe("Kairos");
    expect(appName()).toBe("Kairos");
    expect(toAppNameSlug("Acme Scheduling!")).toBe("acme-scheduling");
    expect(toAppNameSlug("!!!")).toBe("kairos");
  });

  it("generates ids and codes in the documented shapes", () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(shortCode()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`));
    expect(pollSlug()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{10}$`));
    expect(routingSlug()).toMatch(/^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{3}$/);
    expect(jitsiRoom()).toMatch(/^kairos-[a-z0-9]{20}$/);
    expect(shortCode()).not.toMatch(/[01ilo]/);
    expect(new Set(Array.from({ length: 200 }, () => shortCode())).size).toBe(200);
    expect(randomString(5, "ab")).toMatch(/^[ab]{5}$/);
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4");
  });
});

describe("validation", () => {
  it("zod helpers accept good values and reject bad ones with user-facing messages", () => {
    expect(zTimeZone.parse("Asia/Calcutta")).toBe("Asia/Calcutta");
    expect(zTimeZone.parse("UTC")).toBe("UTC");
    expect(zTimeZone.safeParse("Mars/Base").success).toBe(false);
    expect(zEmail.parse("  Jane@Example.com ")).toBe("Jane@Example.com");
    expect(zEmail.safeParse("nope").success).toBe(false);
    expect(zHexColor.parse("#8247F5")).toBe("#8247f5");
    expect(zHexColor.safeParse("8247f5").success).toBe(false);
    expect(zSlug.parse("30MIN")).toBe("30min");
    expect(zHandle.safeParse("a".repeat(51)).success).toBe(false);
    expect(zE164.parse("+14155550123")).toBe("+14155550123");
    expect(zE164.safeParse("4155550123").success).toBe(false);
    expect(zMinuteRange.safeParse({ start: 540, end: 1020 }).success).toBe(true);
    expect(zMinuteRange.safeParse({ start: 600, end: 540 }).success).toBe(false);
    expect(zMinuteRange.safeParse({ start: 0, end: 1441 }).success).toBe(false);
    const day = [{ start: 540, end: 1020 }];
    expect(zWeeklyHours.safeParse([[], day, day, day, day, day, []]).success).toBe(true);
    expect(zWeeklyHours.safeParse([[], day]).success).toBe(false);
    expect(zWeeklyHours.safeParse([[], [{ start: 540, end: 700 }, { start: 600, end: 800 }], [], [], [], [], []]).success).toBe(false);
    expect(zUrlHttps.safeParse("https://example.com/x").success).toBe(true);
    expect(zUrlHttps.safeParse("http://example.com").success).toBe(false);
    expect(zPassword.safeParse("abcdefg1").success).toBe(true);
    expect(zPassword.safeParse("abcdefgh").success).toBe(false);
    expect(zPassword.safeParse("1234567").success).toBe(false);
    const loc = { id: newId(), kind: "physical", position: 0, location: "Main St 1" };
    expect(zLocationConfig.safeParse(loc).success).toBe(true);
    expect(zLocationConfig.safeParse({ ...loc, location: "" }).success).toBe(false);
    expect(zLocationConfig.safeParse({ ...loc, kind: "teleport" }).success).toBe(false);
  });
});

describe("html", () => {
  it("sanitizes rich text: scripts, handlers and javascript: links are removed; links get rel and target", () => {
    const dirty =
      '<p onclick="x()">Hi <strong>there</strong><script>alert(1)</script><img src=x onerror=alert(1)></p>' +
      '<a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a><iframe src="https://x"></iframe>' +
      '<span data-variable="event_name" class="variable evil">{{event_name}}</span><b>b</b>';
    const clean = sanitizeRichText(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:|iframe|<img/i);
    expect(clean).toContain("<strong>there</strong>");
    expect(clean).toContain('<a href="https://ok.example" rel="noopener noreferrer nofollow" target="_blank">ok</a>');
    expect(clean).toContain('<span data-variable="event_name" class="variable">');
    expect(clean).toContain("<strong>b</strong>");
    expect(sanitizeRichText(null)).toBe("");
  });

  it("converts rich text to plain text and plain text to HTML", () => {
    expect(richTextToPlain("<p>Hello <b>you</b></p><ul><li>One</li><li>Two</li></ul><p>See <a href=\"https://x.example\">site</a> &amp; more</p>")).toBe(
      "Hello you\n- One\n- Two\n\nSee site (https://x.example) & more",
    );
    expect(richTextToPlain("a<br>b")).toBe("a\nb");
    expect(autolink("Visit https://example.com/path. Mail me@example.com <b>")).toBe(
      'Visit <a href="https://example.com/path" rel="noopener noreferrer nofollow" target="_blank">https://example.com/path</a>. Mail <a href="mailto:me@example.com" rel="noopener noreferrer nofollow" target="_blank">me@example.com</a> &lt;b&gt;',
    );
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(plainToHtml("a\nb\n\nc")).toBe("<p>a<br>b</p><p>c</p>");
  });
});

describe("pagination", () => {
  const t = useTestDb();

  it("encodes and decodes cursors, rejecting junk", () => {
    const c = encodeCursor({ startAt: "2026-10-14T14:00:00.000Z", id: "abc", n: 3 });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual({ startAt: "2026-10-14T14:00:00.000Z", id: "abc", n: 3 });
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(encodeCursor({ a: "ü" }))).toEqual({ a: "ü" });
    expect(decodeCursor(Buffer.from('{"a":{"b":1}}').toString("base64url"))).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("paginates a real query with keyset row comparisons", async () => {
    for (let i = 0; i < 7; i++) await createUser(t.db, { name: `Page ${i}` });
    const all = await t.db.select({ id: users.id, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt), asc(users.id));
    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const page: Page<{ id: string; createdAt: Date }> = await paginate<{ id: string; createdAt: Date }, { createdAt: string; id: string }>(
        ({ limit, cursor: c }) =>
          t.db
            .select({ id: users.id, createdAt: users.createdAt })
            .from(users)
            .where(c ? keysetAfter([users.createdAt, users.id], [new Date(c.createdAt), c.id]) : sql`true`)
            .orderBy(asc(users.createdAt), asc(users.id))
            .limit(limit),
        { cursor, limit: 3, cursorOf: (r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }) },
      );
      pages.push(page.items.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pages.flat()).toEqual(all.map((r) => r.id));
    expect(pages[0]).toHaveLength(3);
    expect(() => keysetAfter([users.id], [])).toThrow();
  });
});

describe("template", () => {
  it("renders {{var}} tokens, unknown as empty, with optional HTML escaping and the host_name alias", () => {
    const ctx = { invitee_first_name: "Ana", event_time: "9:00am", my_name: "Jo <Host>" };
    expect(renderTemplate("Hi {{invitee_first_name}}, see you at {{ event_time }}!", ctx)).toBe("Hi Ana, see you at 9:00am!");
    expect(renderTemplate("{{unknown}}x{{INVITEE_FIRST_NAME}}", ctx)).toBe("xAna");
    expect(renderTemplate("<p>{{host_name}}</p>", ctx, { escape: "html" })).toBe("<p>Jo &lt;Host&gt;</p>");
    expect(renderTemplate("", ctx)).toBe("");
    expect(templateVariablesIn("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]);
    const vars = listTemplateVariables();
    expect(vars.find((v) => v.key === "invitee_phone_number")?.smsOnly).toBe(true);
    expect(vars.filter((v) => v.key.startsWith("answer_"))).toHaveLength(10);
    expect(vars.find((v) => v.key === "my_name")?.label).toBe("Event Organizer Name");
  });
});

describe("embed events", () => {
  it("detects embed mode and parses BK-26 display params", () => {
    expect(isEmbedRequest(new URLSearchParams("embed_type=Inline"))).toBe(true);
    expect(isEmbedRequest({ embed_domain: "example.com" })).toBe(true);
    expect(isEmbedRequest({})).toBe(false);
    expect(
      embedDisplayParams(new URLSearchParams("embed_type=PopupWidget&primary_color=00A2FF&text_color=zzz&hide_gdpr_banner=1&hide_event_type_details=true")),
    ).toMatchObject({
      embed: true,
      embedType: "PopupWidget",
      primaryColor: "#00a2ff",
      textColor: null,
      hideGdprBanner: true,
      hideEventTypeDetails: true,
      hideLandingPageDetails: false,
    });
    expect(() => postEmbedEvent("calendly.event_scheduled", {})).not.toThrow(); // no window: no-op
  });
});

describe("logger", () => {
  it("redacts secrets and masks emails", () => {
    const out = redactValue({
      accessTokenEnc: "v1.a.b.c",
      password: "hunter2",
      authorization: "Bearer abc",
      nested: { refresh_token: "r", note: "mail jane.doe@example.com", ok: 1 },
      error: new Error("failed for bob@example.com"),
      code: "forbidden",
      when: new Date("2026-01-01T00:00:00Z"),
    }) as Record<string, unknown>;
    expect(out.accessTokenEnc).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).refresh_token).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).note).toBe("mail j***@example.com");
    expect((out.error as Record<string, unknown>).message).toBe("failed for b***@example.com");
    expect(out.code).toBe("forbidden");
    expect(out.when).toBe("2026-01-01T00:00:00.000Z");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.child({ jobId: "j1" }).error("job.failed", { token: "secret" });
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "error", event: "job.failed", jobId: "j1", token: "[redacted]" });
  });
});

describe("integrations catalog (CAL-21)", () => {
  const flags = { googleOAuth: false, microsoftOAuth: false, zoom: false, stripe: false, sms: false, email: "outbox" as const };
  it("lists every CAL-21 tile and marks env-dependent ones not configured", () => {
    const names = INTEGRATIONS.map((t) => t.name);
    for (const n of ["Google Calendar", "Outlook Calendar", "iCloud Calendar", "CalDAV", "ICS feed", "Google Meet", "Microsoft Teams", "Zoom", "Jitsi Meet", "Stripe", "Twilio SMS", "Email delivery", "Webhooks", "API and personal access tokens", "Embed", "Google Analytics", "Meta Pixel"]) {
      expect(names).toContain(n);
    }
    const zoom = INTEGRATIONS.find((t) => t.id === "zoom")!;
    expect(integrationStatus(zoom, flags)).toBe("not_configured");
    expect(integrationStatus(zoom, { ...flags, zoom: true })).toBe("available");
    expect(integrationStatus(zoom, { ...flags, zoom: true }, new Set(["zoom"]))).toBe("connected");
    expect(integrationStatus(INTEGRATIONS.find((t) => t.id === "jitsi")!, flags)).toBe("available");
    expect(filterIntegrations("gmail").map((t) => t.id)).toEqual(["google-calendar", "email"]);
    expect(filterIntegrations("", "payments").map((t) => t.id)).toEqual(["stripe"]);
  });

  it("the Email delivery tile is connected whenever something but the outbox sends, Gmail included", () => {
    const tile = INTEGRATIONS.find((t) => t.id === "email")!;
    expect(integrationStatus(tile, flags)).toBe("available");
    for (const email of ["gmail", "resend", "smtp"] as const) expect(integrationStatus(tile, { ...flags, email }), email).toBe("connected");
    expect(emailTransportLabel("gmail")).toBe("Sending from the owner's Gmail");
    expect(emailTransportLabel("outbox")).toBe("Stored in the outbox (no email provider configured)");
  });
});
