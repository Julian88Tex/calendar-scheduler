// Google Search Console verification (src/lib/site-verification.ts, docs/GOOGLE_VERIFICATION.md): with a token the
// root layout's metadata carries verification.google, which Next renders as
// <meta name="google-site-verification" content="TOKEN"> on every page; without one (the default) nothing is added and
// the rest of the root metadata stays as it was. The tag is rendered with Next's own metadata resolver and elements.
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../foundation-auth/_request")).nextHeadersMock);

const { createMetadataElements } = await import("next/dist/lib/metadata/metadata-elements");
const { resolveVerification } = await import("next/dist/lib/metadata/resolvers/resolve-basics");

type RootMetadata = (typeof import("@/app/layout"))["metadata"];

/** The root layout's metadata with @/lib/site-verification replaced by `token`. */
async function layoutMetadata(token: string | null): Promise<RootMetadata> {
  vi.resetModules();
  vi.doMock("@/lib/site-verification", () => ({ GOOGLE_SITE_VERIFICATION: token }));
  return (await import("@/app/layout")).metadata;
}

/** The head tags Next renders for the metadata's verification field. */
function verificationTags(metadata: RootMetadata): string {
  const verification = resolveVerification(metadata.verification);
  const elements = createMetadataElements({ verification } as never);
  return renderToStaticMarkup(createElement(Fragment, null, ...elements));
}

afterEach(() => {
  vi.doUnmock("@/lib/site-verification");
  vi.resetModules();
});

describe("Google site verification meta tag", () => {
  it("renders <meta name=google-site-verification> with the token when it is set", async () => {
    const metadata = await layoutMetadata("abc123-Search_Console_token");
    expect(metadata.verification).toEqual({ google: "abc123-Search_Console_token" });
    expect(verificationTags(metadata)).toBe('<meta name="google-site-verification" content="abc123-Search_Console_token"/>');
    expect(metadata).toMatchObject({ applicationName: "Kairos", title: { default: "Kairos", template: "%s - Kairos" } });
  });

  it("adds nothing while the token is null (the default)", async () => {
    const metadata = await layoutMetadata(null);
    expect(metadata.verification).toBeUndefined();
    expect(verificationTags(metadata)).toBe("");
    expect(metadata).toMatchObject({ applicationName: "Kairos", description: "Scheduling made simple with Kairos." });
  });

  it("holds null or just the token (the content value, not the whole <meta> tag)", async () => {
    const { GOOGLE_SITE_VERIFICATION: token } = await vi.importActual<typeof import("@/lib/site-verification")>("@/lib/site-verification");
    if (token !== null) expect(token).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
    else expect(token).toBeNull();
  });
});
