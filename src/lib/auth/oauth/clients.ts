// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// arctic clients (ARCHITECTURE section 18.4): Google, Microsoft Entra ID (tenant MICROSOFT_TENANT, default "common") and
// Zoom, or null when the provider is not configured. Redirect URIs come from appUrl() (never VERCEL_URL), one per
// provider, shared by every intent.
import "server-only";
import { Google, MicrosoftEntraId, Zoom } from "arctic";
import { getEnv, microsoftTenant } from "@/lib/env";
import { appUrl } from "@/lib/url";

export const GOOGLE_REDIRECT_PATH = "/api/auth/google/callback";
export const MICROSOFT_REDIRECT_PATH = "/api/auth/microsoft/callback";
export const ZOOM_REDIRECT_PATH = "/api/integrations/zoom/callback";

export function googleRedirectUri(): string {
  return `${appUrl()}${GOOGLE_REDIRECT_PATH}`;
}
export function microsoftRedirectUri(): string {
  return `${appUrl()}${MICROSOFT_REDIRECT_PATH}`;
}
export function zoomRedirectUri(): string {
  return `${appUrl()}${ZOOM_REDIRECT_PATH}`;
}

export function getGoogleClient(): Google | null {
  const e = getEnv();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return null;
  return new Google(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, googleRedirectUri());
}

export function getMicrosoftClient(): MicrosoftEntraId | null {
  const e = getEnv();
  if (!e.MICROSOFT_CLIENT_ID || !e.MICROSOFT_CLIENT_SECRET) return null;
  return new MicrosoftEntraId(microsoftTenant(), e.MICROSOFT_CLIENT_ID, e.MICROSOFT_CLIENT_SECRET, microsoftRedirectUri());
}

export function getZoomClient(): Zoom | null {
  const e = getEnv();
  if (!e.ZOOM_CLIENT_ID || !e.ZOOM_CLIENT_SECRET) return null;
  return new Zoom(e.ZOOM_CLIENT_ID, e.ZOOM_CLIENT_SECRET, zoomRedirectUri());
}
