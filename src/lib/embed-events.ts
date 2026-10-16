// Embed mode helpers (ARCHITECTURE section 17, SPEC BK-25, BK-26, API-13). Client and server safe.
//
// Public pages detect embed mode from `embed_type` / `embed_domain` and post Calendly-compatible events to the parent
// window: { event: "calendly.event_scheduled", payload: {...} }. Event names keep the `calendly.` prefix for drop-in
// compatibility with existing embed listeners (SPEC 0.4).

export const EMBED_EVENTS = [
  "calendly.profile_page_viewed",
  "calendly.event_type_viewed",
  "calendly.date_and_time_selected",
  "calendly.event_scheduled",
  "calendly.page_height",
] as const;
export type EmbedEventName = (typeof EMBED_EVENTS)[number];

export type EmbedType = "Inline" | "PopupWidget" | "PopupText";

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function getParam(sp: SearchParamsLike, key: string): string | undefined {
  if (!sp) return undefined;
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** True when the page was opened by the embed script (BK-25: embed_type or embed_domain present). */
export function isEmbedRequest(searchParams: SearchParamsLike): boolean {
  return Boolean(getParam(searchParams, "embed_type") || getParam(searchParams, "embed_domain"));
}

const HEX6 = /^[0-9a-fA-F]{6}$/;
const truthy = (v: string | undefined) => v === "1" || v === "true";

export type EmbedDisplayParams = {
  embed: boolean;
  embedType: EmbedType | null;
  embedDomain: string | null;
  /** "#rrggbb" or null (BK-26 params are passed without "#"). */
  backgroundColor: string | null;
  textColor: string | null;
  primaryColor: string | null;
  hideEventTypeDetails: boolean;
  hideLandingPageDetails: boolean;
  hideGdprBanner: boolean;
};

/** Parses BK-26 display parameters (invalid colors are ignored). */
export function embedDisplayParams(searchParams: SearchParamsLike): EmbedDisplayParams {
  const color = (key: string) => {
    const v = getParam(searchParams, key)?.replace(/^#/, "");
    return v && HEX6.test(v) ? `#${v.toLowerCase()}` : null;
  };
  const type = getParam(searchParams, "embed_type");
  return {
    embed: isEmbedRequest(searchParams),
    embedType: type === "Inline" || type === "PopupWidget" || type === "PopupText" ? type : null,
    embedDomain: getParam(searchParams, "embed_domain")?.slice(0, 253) ?? null,
    backgroundColor: color("background_color"),
    textColor: color("text_color"),
    primaryColor: color("primary_color"),
    hideEventTypeDetails: truthy(getParam(searchParams, "hide_event_type_details")),
    hideLandingPageDetails: truthy(getParam(searchParams, "hide_landing_page_details")),
    hideGdprBanner: truthy(getParam(searchParams, "hide_gdpr_banner")),
  };
}

/** True when running in a browser frame whose parent is another window. */
export function isInIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window;
  } catch {
    return true; // cross-origin access to window.parent can throw in old browsers: we are framed
  }
}

/** Posts an embed event to the parent window (no-op outside an iframe or on the server). */
export function postEmbedEvent(name: EmbedEventName, payload: Record<string, unknown> = {}): void {
  if (!isInIframe()) return;
  try {
    window.parent.postMessage({ event: name, payload }, "*");
  } catch {
    // ignore: the parent may be gone
  }
}

/** Reports the document height for `data-resize="true"` inline embeds. */
export function postPageHeight(height?: number): void {
  if (typeof document === "undefined") return;
  const h = height ?? Math.ceil(document.documentElement.scrollHeight);
  postEmbedEvent("calendly.page_height", { height: `${h}px` });
}
