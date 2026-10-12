// GEN-08 framing headers: next.config.ts headers() rules (compiled with Next's own path matcher) must agree with
// isEmbeddablePath() for every page type, and the deny and allow rules must never both match.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  ALLOW_FRAMING_HEADERS,
  DENY_FRAMING_HEADERS,
  isEmbeddablePath,
  nextHeaderRules,
  securityHeadersFor,
} from "@/lib/net/frame-policy";

const require = createRequire(import.meta.url);
// The exact compiler Next.js uses for routes-manifest.json header regexes.
const { buildCustomRoute } = require("next/dist/lib/build-custom-route.js") as {
  buildCustomRoute: (type: "header", route: Rule) => Rule & { regex: string };
};

type Rule = { source: string; headers: { key: string; value: string }[] };

const matcher = (rule: Rule) => {
  const re = new RegExp(buildCustomRoute("header", rule).regex);
  return (pathname: string) => re.test(pathname);
};

/** Applies rules like Next.js: every matching rule sets its headers, later rules override earlier keys. */
function headersFor(rules: Rule[], pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (matcher(rule)(pathname)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

const EMBEDDABLE = [
  "/julianjoseph",
  "/julianjoseph/30min",
  "/julianjoseph/30min/2026-10-13T18:00:00Z",
  "/sales-team",
  "/sales-team/demo",
  "/d/abcd-efgh",
  "/d/abcd-efgh/30min",
  "/d/abcd-efgh/30min/2026-10-13T18:00:00Z",
  "/booking/0b7c6a2e-1f6e-4c55-9d8e-5c8a0f2b1a11",
  "/p/k3j4h5g6f7",
  "/p/k3j4h5g6f7/unsubscribe",
  "/r/abc-def-ghi",
];
const NOT_EMBEDDABLE = [
  "/",
  "/app",
  "/app/scheduling",
  "/app/settings/profile",
  "/login",
  "/login/two-factor",
  "/signup",
  "/forgot-password",
  "/reset-password/token",
  "/verify-email/token",
  "/confirm-email/token",
  "/setup",
  "/onboarding",
  "/onboarding/calendar",
  "/invite/token",
  "/privacy",
  "/terms",
  "/cookie-policy",
  "/help",
  "/cancellations/0b7c6a2e",
  "/reschedulings/0b7c6a2e",
  "/reschedulings/0b7c6a2e/2026-10-13T18:00:00Z",
  "/reconfirm/0b7c6a2e",
  "/events/0b7c6a2e/join",
  "/payments/return",
  "/api/health",
  "/api/public/slots",
];

describe("frame policy", () => {
  it("classifies embeddable and non-embeddable pages (GEN-08)", () => {
    for (const p of EMBEDDABLE) expect(isEmbeddablePath(p), p).toBe(true);
    for (const p of NOT_EMBEDDABLE) expect(isEmbeddablePath(p), p).toBe(false);
  });

  it("securityHeadersFor always sends nosniff and the referrer policy", () => {
    for (const p of [...EMBEDDABLE, ...NOT_EMBEDDABLE]) {
      const keys = securityHeadersFor(p).map((h) => h.key);
      expect(keys).toContain("Referrer-Policy");
      expect(keys).toContain("X-Content-Type-Options");
    }
    expect(securityHeadersFor("/reschedulings/x")).toEqual(expect.arrayContaining([...DENY_FRAMING_HEADERS]));
    expect(securityHeadersFor("/julianjoseph")).toEqual(expect.arrayContaining([...ALLOW_FRAMING_HEADERS]));
  });

  it("next.config headers() rules, as Next.js matches them, agree with isEmbeddablePath", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    expect(rules).toEqual(nextHeaderRules());
    for (const p of [...EMBEDDABLE, ...NOT_EMBEDDABLE]) {
      const h = headersFor(rules, p);
      expect(h["referrer-policy"], p).toBe("strict-origin-when-cross-origin");
      expect(h["x-content-type-options"], p).toBe("nosniff");
      if (isEmbeddablePath(p)) {
        expect(h["content-security-policy"], p).toBe("frame-ancestors *");
        expect(h["x-frame-options"], p).toBeUndefined();
      } else {
        expect(h["content-security-policy"], p).toBe("frame-ancestors 'none'");
        expect(h["x-frame-options"], p).toBe("DENY");
      }
    }
  });

  it("the deny and allow rules are mutually exclusive", () => {
    const [, root, deny, allow] = nextHeaderRules();
    for (const p of [...EMBEDDABLE, ...NOT_EMBEDDABLE, "/julianjoseph/", "/app/"]) {
      const hits = [matcher(root)(p), matcher(deny)(p), matcher(allow)(p)].filter(Boolean).length;
      expect(hits, p).toBe(1);
    }
  });
});
