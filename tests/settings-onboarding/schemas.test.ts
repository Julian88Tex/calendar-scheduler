// Pure settings logic (SPEC BR-01, BR-03, BR-08, GEN-02, AU-10): profile validation (name 1 to 100, welcome message
// up to 265 characters), live handle normalization and local checks, password confirmation, and readable device names
// for the sessions list.
import { describe, expect, it } from "vitest";
import {
  asDateFormat,
  asTimeFormat,
  HANDLE_MESSAGES,
  localHandleCheck,
  normalizeWelcomeMessage,
  PASSWORDS_DIFFER_MESSAGE,
  PasswordChangeInput,
  ProfileInput,
  sanitizeHandleInput,
  WELCOME_MESSAGE_MAX_LENGTH,
} from "@/lib/settings/schemas";
import { parseUserAgent } from "@/lib/settings/user-agent";

const validProfile = {
  name: "Julian Joseph",
  welcomeMessage: "Welcome!",
  timezone: "America/Los_Angeles",
  timeFormat: "12h",
  dateFormat: "MM/DD/YYYY",
};

describe("ProfileInput", () => {
  it("accepts a valid profile and trims the name and message", () => {
    const parsed = ProfileInput.parse({ ...validProfile, name: "  Julian  ", welcomeMessage: "  Hi there \r\n  " });
    expect(parsed.name).toBe("Julian");
    expect(parsed.welcomeMessage).toBe("Hi there");
  });

  it("allows an empty welcome message (no message on the landing page)", () => {
    expect(ProfileInput.parse({ ...validProfile, welcomeMessage: "   " }).welcomeMessage).toBe("");
  });

  it("limits the welcome message to 265 characters", () => {
    expect(ProfileInput.safeParse({ ...validProfile, welcomeMessage: "a".repeat(WELCOME_MESSAGE_MAX_LENGTH) }).success).toBe(true);
    const tooLong = ProfileInput.safeParse({ ...validProfile, welcomeMessage: "a".repeat(WELCOME_MESSAGE_MAX_LENGTH + 1) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.path).toEqual(["welcomeMessage"]);
    expect(tooLong.error?.issues[0]?.message).toBe("Use 265 characters or fewer.");
  });

  it("requires a name of at most 100 characters", () => {
    expect(ProfileInput.safeParse({ ...validProfile, name: "  " }).error?.issues[0]?.message).toBe("Enter your name.");
    expect(ProfileInput.safeParse({ ...validProfile, name: "x".repeat(101) }).error?.issues[0]?.message).toBe("Use 100 characters or fewer.");
  });

  it("rejects unknown zones and formats", () => {
    expect(ProfileInput.safeParse({ ...validProfile, timezone: "Mars/Base" }).error?.issues[0]?.path).toEqual(["timezone"]);
    expect(ProfileInput.safeParse({ ...validProfile, timeFormat: "13h" }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...validProfile, dateFormat: "YYYY-MM-DD" }).success).toBe(false);
  });

  it("accepts legacy zone aliases as given (GEN-06)", () => {
    expect(ProfileInput.parse({ ...validProfile, timezone: "Asia/Calcutta" }).timezone).toBe("Asia/Calcutta");
  });

  it("maps stored formats with safe defaults", () => {
    expect(asTimeFormat("24h")).toBe("24h");
    expect(asTimeFormat("weird")).toBe("12h");
    expect(asDateFormat("DD/MM/YYYY")).toBe("DD/MM/YYYY");
    expect(asDateFormat(null)).toBe("MM/DD/YYYY");
    expect(normalizeWelcomeMessage("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("handle input (GEN-02)", () => {
  it("normalizes while typing but keeps a trailing hyphen", () => {
    expect(sanitizeHandleInput("Julian Joseph")).toBe("julian-joseph");
    expect(sanitizeHandleInput("julian-")).toBe("julian-");
    expect(sanitizeHandleInput("  --Jülián__Jóseph!!  ")).toBe("julian-joseph-");
    expect(sanitizeHandleInput("a".repeat(80))).toHaveLength(50);
  });

  it("reports empty, invalid and reserved handles without the database", () => {
    expect(localHandleCheck("")?.status).toBe("empty");
    expect(localHandleCheck("julian-")?.status).toBe("invalid");
    expect(localHandleCheck("api")).toEqual({ slug: "api", status: "reserved", message: "This URL is not available." });
    expect(localHandleCheck(sanitizeHandleInput("Login"))?.status).toBe("reserved");
    expect(localHandleCheck("julian-joseph")).toBeNull();
    expect(HANDLE_MESSAGES.taken).toBe("This URL is taken");
  });
});

describe("PasswordChangeInput", () => {
  it("requires matching passwords that follow the rules", () => {
    expect(PasswordChangeInput.safeParse({ currentPassword: "old", newPassword: "password456", confirmPassword: "password456" }).success).toBe(true);
    const mismatch = PasswordChangeInput.safeParse({ newPassword: "password456", confirmPassword: "password457" });
    expect(mismatch.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["confirmPassword", PASSWORDS_DIFFER_MESSAGE]]);
    const weak = PasswordChangeInput.safeParse({ newPassword: "short", confirmPassword: "short" });
    expect(weak.error?.issues[0]?.path).toEqual(["newPassword"]);
  });
});

describe("parseUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Chrome on macOS", "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Edge on Windows", "desktop"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iPhone", "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1", "Chrome on iPad", "tablet"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Chrome on Android", "mobile"],
    ["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux", "desktop"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari on macOS", "desktop"],
  ])("%s", (ua, label, device) => {
    const parsed = parseUserAgent(ua);
    expect(parsed.label).toBe(label);
    expect(parsed.device).toBe(device);
  });

  it("falls back for missing or unknown agents", () => {
    expect(parseUserAgent(null).label).toBe("Unknown device");
    expect(parseUserAgent("curl/8.0").label).toBe("Unknown device");
    expect(parseUserAgent("SomeBot/1.0 (Windows NT 10.0)").label).toBe("Unknown browser on Windows");
  });
});
