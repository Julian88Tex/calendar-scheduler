// i18n core (SPEC GEN-10, ARCHITECTURE section 19): per-key English fallback, interpolation, merged namespace objects,
// locale resolution, and zone names from the zones namespace (then Intl's localized names). The German catalog is
// mocked (owned by the localization module).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/messages/de/index", () => ({
  default: {
    common: { footer: { privacyPolicy: "Datenschutzerklärung", poweredBy: "Bereitgestellt von {appName}" } },
    zones: { "Europe/Berlin": "Mitteleuropäische Zeit (Katalog)" },
  },
}));

const i18n = await import("@/lib/i18n");
const { EN_CATALOG, NAMESPACES } = await import("@/lib/i18n/catalog");
const { formatZoneLabel } = await import("@/lib/time/format");
const { TIME_ZONES, ZONE_NAMES_EN } = await import("@/lib/time/zones");
const zonesEn = (await import("@/lib/i18n/messages/en/zones")).default;
const common = (await import("@/lib/i18n/messages/en/common")).default;

describe("getT", () => {
  it("falls back to English per key and then to the key itself", () => {
    const de = i18n.getT("de", "common");
    expect(de("footer.privacyPolicy")).toBe("Datenschutzerklärung");
    expect(de("footer.cookieSettings")).toBe("Cookie settings");
    expect(de("footer.poweredBy", { appName: "Kairos" })).toBe("Bereitgestellt von Kairos");
    expect(de("does.not.exist")).toBe("does.not.exist");
    expect(i18n.getT("fr", "common")("footer.privacyPolicy")).toBe("Privacy Policy");
    expect(i18n.getT(null, "common")("actions.next")).toBe("Next");
    expect(i18n.getT("de-AT", "common")("footer.privacyPolicy")).toBe("Datenschutzerklärung");
  });

  it("interpolates placeholders and leaves unknown ones", () => {
    expect(i18n.interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(i18n.getT("en", "common")("errors.rateLimited", { minutes: 5 })).toBe("Too many attempts. Try again in 5 minutes.");
  });

  it("looks up whole keys first (zone ids)", () => {
    expect(i18n.getT("en", "zones")("America/New_York")).toBe("Eastern Time - US & Canada");
    expect(i18n.getT("de", "zones")("Europe/Berlin")).toBe("Mitteleuropäische Zeit (Katalog)");
    expect(i18n.hasTranslation("de", "zones", "Europe/Berlin")).toBe(true);
    expect(i18n.hasTranslation("de", "zones", "Asia/Tokyo")).toBe(false);
  });
});

describe("getMessages", () => {
  it("merges the locale over English per key (for client components)", () => {
    const de = i18n.getMessages("de", "common");
    expect(de.footer.privacyPolicy).toBe("Datenschutzerklärung");
    expect(de.footer.reportAbuse).toBe("Report abuse");
    expect(de.cookies.acceptAll).toBe("Accept all");
    expect(i18n.getMessages("uk", "payments")).toEqual(EN_CATALOG.payments);
    // English is returned as is.
    expect(i18n.getMessages("en", "common")).toBe(EN_CATALOG.common);
  });
});

describe("locales", () => {
  it("resolves tags to supported locales and Intl tags", () => {
    expect(i18n.resolveLocale("pt-BR")).toBe("pt");
    expect(i18n.resolveLocale("fr-CA,fr;q=0.9")).toBe("fr");
    expect(i18n.resolveLocale("zz, de;q=0.8")).toBe("de");
    expect(i18n.resolveLocale("zz")).toBe("en");
    expect(i18n.intlLocale("pt")).toBe("pt-BR");
    expect(i18n.intlLocale("uk")).toBe("uk-UA");
    expect(i18n.LOCALES).toEqual(["en", "fr", "es", "de", "nl", "pt", "it", "uk"]);
    expect(Object.keys(i18n.LOCALE_LABELS)).toEqual([...i18n.LOCALES]);
  });

  it("the catalog has every namespace", () => {
    expect([...NAMESPACES].sort()).toEqual(
      ["booking", "common", "lifecycle", "lifecycle-pages", "payments", "poll-emails", "polls", "routing", "workflows", "zones"].sort(),
    );
  });
});

describe("zones namespace", () => {
  it("names every zone of the picker exactly like src/lib/time/zones.ts", () => {
    expect(Object.keys(zonesEn).sort()).toEqual(TIME_ZONES.map((z) => z.id).sort());
    expect(zonesEn).toEqual(ZONE_NAMES_EN);
    for (const id of Object.keys(zonesEn)) expect(id).not.toContain(".");
  });

  it("formatZoneLabel uses the zones namespace of the locale, then Intl's localized names", () => {
    expect(i18n.zoneLabel("America/New_York", "en")).toBe("Eastern Time - US & Canada");
    expect(i18n.zoneLabel("Europe/Berlin", "de")).toBe("Mitteleuropäische Zeit (Katalog)");
    expect(formatZoneLabel("Europe/Paris", "de", i18n.zoneNames("de"))).toBe("Mitteleuropäische Zeit (Katalog)");
    // Not in the German catalog: Intl's German name, not the English one.
    expect(i18n.zoneLabel("Asia/Tokyo", "de")).toMatch(/Japan/);
    expect(i18n.zoneLabel("Asia/Tokyo", "de")).not.toBe("Japan, Korea Time");
    expect(i18n.zoneLabel("Europe/Rome", "fr")).toMatch(/Europe centrale/i);
    expect(i18n.zoneNames("en")).toBe(EN_CATALOG.zones);
    expect(i18n.zoneNames("es")).toEqual({});
  });
});

describe("common namespace", () => {
  it("carries the shared invitee-facing copy", () => {
    expect(common.footer).toMatchObject({ cookieSettings: "Cookie settings", privacyPolicy: "Privacy Policy", reportAbuse: "Report abuse" });
    expect(common.cookies).toMatchObject({ acceptAll: "Accept all", rejectAll: "Reject non-essential", save: "Confirm my choices" });
    expect(common.errors).toMatchObject({ pageNotFoundTitle: "Page not found", required: "Can't be blank", invalidEmail: "Invalid email" });
    expect(common.location.conferencingToFollow).toBe("Web conferencing details to follow.");
    expect(common.location.conferencingOnConfirmation).toBe("Web conferencing details provided upon confirmation.");
    const all = JSON.stringify(common);
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});
