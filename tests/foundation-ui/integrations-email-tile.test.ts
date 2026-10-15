// The Email delivery tile of the integrations hub links to the email outbox page (docs/QA_REPORT.md, "Found outside
// these paths" item 6) for those who may open it; the other kept tiles keep their catalog detail pages, and the hub
// renders the link.
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMAIL_OUTBOX_HREF, hubTileHref } from "@/app/(dashboard)/app/integrations/email-tile";
import { IntegrationsHub } from "@/app/(dashboard)/app/_shell/integrations-hub";
import { INTEGRATIONS } from "@/lib/integrations/catalog";

const root = path.resolve(__dirname, "../..");

describe("integrations hub: Email delivery tile", () => {
  it("links to the email outbox page for those who may open it, else stays status only", () => {
    expect(EMAIL_OUTBOX_HREF).toBe("/app/settings/email-outbox");
    const email = INTEGRATIONS.find((t) => t.id === "email")!;
    expect(hubTileHref("email", email.href, true)).toBe("/app/settings/email-outbox");
    expect(hubTileHref("email", email.href, false)).toBeNull();
    const google = INTEGRATIONS.find((t) => t.id === "google-calendar")!;
    expect(hubTileHref("google-calendar", google.href, false)).toBe(google.href);
    expect(hubTileHref("google-calendar", google.href, true)).toBe(google.href);
  });

  it("is wired into the integrations page with the outbox access rule", () => {
    const src = fs.readFileSync(path.join(root, "src/app/(dashboard)/app/integrations/page.tsx"), "utf8");
    expect(src).toContain("href: hubTileHref(t.id, t.href, canSeeEmailOutbox(actor))");
  });

  it("renders the tile as a link to the outbox", () => {
    const email = INTEGRATIONS.find((t) => t.id === "email")!;
    const html = renderToStaticMarkup(
      createElement(IntegrationsHub, {
        tiles: [{ id: "email", name: email.name, description: email.description, href: hubTileHref("email", email.href, true), status: "connected", logo: email.logo, note: "Sending from owner@gmail.com (Gmail)" }],
        initialQuery: "",
        initialCategory: "all",
      }),
    );
    expect(html).toMatch(/<a [^>]*href="\/app\/settings\/email-outbox"[^>]*>[\s\S]*Email delivery[\s\S]*<\/a>/);
  });
});
