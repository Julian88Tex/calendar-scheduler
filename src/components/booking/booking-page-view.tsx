// Server rendering of a resolved booking page (SPEC BK-03, BK-23, BK-25, BK-26, GEN-13): the public shell with branding
// and display parameters around the client flow, or the BK-23 state card; plus the page metadata (document title,
// Open Graph "{Host name} - {Event name}", noindex for secret, link, off and details pages).
import "server-only";
import type { Metadata } from "next";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { BookingFlow } from "./booking-flow";
import type { BookingPageResult } from "./server/booking-page";
import { descriptionOf } from "./server/booking-page";
import { StateCard } from "./state-card";

export function bookingMetadata(r: BookingPageResult | null): Metadata {
  if (!r) return { title: "This page isn't available", robots: { index: false, follow: false } };
  const m = r.meta;
  const description = r.state === "ok" ? (descriptionOf(r.props) ?? undefined) : undefined;
  return {
    title: r.state === "ok" ? m.title : r.state === "off" ? "This event type is not currently available" : "This page isn't available",
    description,
    robots: m.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title: m.ogTitle, description, images: m.ogImage ? [m.ogImage] : undefined },
  };
}

export function BookingPageView({ result }: { result: BookingPageResult }) {
  if (result.state !== "ok") {
    const s = result.shell;
    return (
      <PublicPageShell branding={s.branding} embed={s.embed.embed} showFooterLinks={false} hideGdprBanner={s.embed.hideGdprBanner}>
        <StateCard kind={result.state} hostName={s.hostName} ribbon={s.ribbon} embed={s.embed.embed} operatorEmail={s.operatorEmail} privacyUrl={s.privacyUrl} />
      </PublicPageShell>
    );
  }
  const p = result.props;
  return (
    <PublicPageShell branding={p.branding} embed={p.embed.embed} showFooterLinks={false} hideGdprBanner={p.embed.hideGdprBanner} operatorEmail={p.operatorEmail} privacyUrl={p.privacyUrl}>
      <BookingFlow {...p} />
    </PublicPageShell>
  );
}
