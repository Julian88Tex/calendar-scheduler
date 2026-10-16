// Readable device names for the "Active sessions" list (SPEC BR-10, AU-05): "Chrome on macOS", "Safari on iPhone".
// A small, dependency free parser for the browsers and systems people actually sign in with; anything else falls back
// to "Unknown browser" / "Unknown device". Client and server safe.
import type { DeviceKind } from "./schemas";

export type ParsedUserAgent = { browser: string | null; os: string | null; device: DeviceKind; label: string };

function browserOf(ua: string): string | null {
  // Order matters: Edge, Opera, Samsung Internet and others also announce Chrome and Safari.
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "Edge";
  if (/\b(?:OPR|Opera|OPT)\//.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bVivaldi\//.test(ua)) return "Vivaldi";
  if (/\bYaBrowser\//.test(ua)) return "Yandex Browser";
  if (/\b(?:Firefox|FxiOS)\//.test(ua)) return "Firefox";
  if (/\bCriOS\//.test(ua)) return "Chrome";
  if (/\bHeadlessChrome\//.test(ua)) return "Chrome";
  if (/\bChrome\//.test(ua) || /\bChromium\//.test(ua)) return "Chrome";
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua) || (/\bSafari\//.test(ua) && /\b(?:iPhone|iPad|Macintosh)\b/.test(ua))) return "Safari";
  if (/\bMSIE |\bTrident\//.test(ua)) return "Internet Explorer";
  return null;
}

function osOf(ua: string): { os: string | null; device: DeviceKind } {
  if (/\biPad\b/.test(ua)) return { os: "iPad", device: "tablet" };
  if (/\biPhone\b/.test(ua)) return { os: "iPhone", device: "mobile" };
  if (/\biPod\b/.test(ua)) return { os: "iPod", device: "mobile" };
  if (/\bAndroid\b/.test(ua)) return { os: "Android", device: /\bMobile\b/.test(ua) ? "mobile" : "tablet" };
  if (/\bCrOS\b/.test(ua)) return { os: "ChromeOS", device: "desktop" };
  if (/\bWindows Phone\b/.test(ua)) return { os: "Windows Phone", device: "mobile" };
  if (/\bWindows\b/.test(ua)) return { os: "Windows", device: "desktop" };
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return { os: "macOS", device: "desktop" };
  if (/\bLinux\b|\bX11\b/.test(ua)) return { os: "Linux", device: "desktop" };
  return { os: null, device: "desktop" };
}

/** Browser, operating system and device kind of a user agent string, with a display label. */
export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const ua = (userAgent ?? "").slice(0, 512);
  if (!ua.trim()) return { browser: null, os: null, device: "desktop", label: "Unknown device" };
  const browser = browserOf(ua);
  const { os, device } = osOf(ua);
  const label = browser && os ? `${browser} on ${os}` : (browser ?? (os ? `Unknown browser on ${os}` : "Unknown device"));
  return { browser, os, device, label };
}
