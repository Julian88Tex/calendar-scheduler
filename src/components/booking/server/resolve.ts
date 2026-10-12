// Page resolvers of the public booking routes (SPEC BK-03, BK-08, BK-23, BK-27). Server only. Cached per request with
// primitive arguments, so generateMetadata and the page share one resolution.
//
//   resolveEventPage(handle, eventSlug, mode, start, query)   /{handle}/{eventSlug}[/{start}]
//   resolveCodePage(code, slug, mode, start, query)           /d/{code}/{slug}[/{start}]: a non-current slug answers a
//                                                              301 to the current one, keeping the start and the query
import "server-only";
import { cache } from "react";
import { resolveTargetByCode, resolveTargetBySlugs } from "@/lib/booking";
import { resolveBookingCode } from "@/lib/links";
import { parseStartParam } from "@/lib/url";
import { loadBookingPage, loadNewTypePreview, PREVIEW_SLUG, type BookingPageResult } from "./booking-page";

export type ResolvedPage = BookingPageResult | { state: "redirect"; location: string } | null;

/** Serializes Next searchParams to a stable query string (first value of each key, original order). */
export function queryOf(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") q.append(k, v[0]);
    } else if (typeof v === "string") q.append(k, v);
  }
  return q.toString();
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return null;
  }
}

export const resolveEventPage = cache(
  async (handleRaw: string, eventSlugRaw: string, mode: "calendar" | "details", startRaw: string | null, query: string): Promise<ResolvedPage> => {
    const handle = decode(handleRaw)?.toLowerCase();
    const eventSlug = decode(eventSlugRaw)?.toLowerCase();
    if (!handle || !eventSlug) return null;
    const sp = new URLSearchParams(query);
    if (eventSlug === PREVIEW_SLUG) return mode === "calendar" ? loadNewTypePreview(handle, sp) : null;
    let start: Date | null = null;
    if (mode === "details") {
      start = startRaw ? parseStartParam(startRaw) : null;
      if (!start) return null;
    }
    const target = await resolveTargetBySlugs(handle, eventSlug);
    if (!target) return null;
    return loadBookingPage({
      target,
      basePath: `/${encodeURIComponent(handle)}/${encodeURIComponent(target.eventType.slug)}`,
      landingPath: `/${encodeURIComponent(handle)}`,
      searchParams: sp,
      mode,
      start,
    });
  },
);

export const resolveCodePage = cache(
  async (codeRaw: string, slugRaw: string | null, mode: "calendar" | "details", startRaw: string | null, query: string): Promise<ResolvedPage> => {
    const code = decode(codeRaw);
    if (!code || code.length > 100) return null;
    const resolved = await resolveBookingCode(code);
    if (!resolved || resolved.status === "deleted") return null;
    const slug = slugRaw === null ? null : decode(slugRaw);
    const base = `/d/${encodeURIComponent(resolved.code)}/${encodeURIComponent(resolved.currentSlug)}`;
    let start: Date | null = null;
    if (mode === "details") {
      start = startRaw ? parseStartParam(startRaw) : null;
      if (!start) return null;
    }
    // BK-27: /d/{code} and /d/{code}/{oldSlug}[/{start}] answer with the canonical path (same start and query).
    if (slug !== resolved.currentSlug || code !== resolved.code) {
      const startPart = start ? `/${start.toISOString().replace(/\.\d{3}Z$/, "Z")}` : "";
      return { state: "redirect", location: `${base}${startPart}${query ? `?${query}` : ""}` };
    }
    const target = await resolveTargetByCode(code);
    if (!target) return null;
    return loadBookingPage({ target, basePath: base, landingPath: null, searchParams: new URLSearchParams(query), mode, start });
  },
);
