// OWNER: foundation-ui.
//
// ProviderLogo (ARCHITECTURE 20.2, SPEC CAL-21): inline SVG marks for the integrations hub, connection lists and
// location pickers (no network requests, crisp at any size). Simplified, recognizable marks drawn on a 32px grid.
// Server and client safe.
import type * as React from "react";
import type { ProviderLogoName } from "@/lib/integrations/catalog";
import { cn } from "@/lib/cn";

export type { ProviderLogoName };

export type ProviderLogoProps = {
  provider: ProviderLogoName;
  /** Pixels (default 32). */
  size?: number;
  /** Accessible name; omit for decorative logos next to a visible name. */
  title?: string;
  className?: string;
};

const Tile = ({ fill, children }: { fill: string; children: React.ReactNode }) => (
  <>
    <rect width="32" height="32" rx="7" fill={fill} />
    {children}
  </>
);

const MARKS: Record<ProviderLogoName, React.ReactNode> = {
  google: (
    <g transform="translate(4 4) scale(0.5)">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </g>
  ),
  microsoft: (
    <g>
      <rect x="4" y="4" width="11.5" height="11.5" fill="#F25022" />
      <rect x="16.5" y="4" width="11.5" height="11.5" fill="#7FBA00" />
      <rect x="4" y="16.5" width="11.5" height="11.5" fill="#00A4EF" />
      <rect x="16.5" y="16.5" width="11.5" height="11.5" fill="#FFB900" />
    </g>
  ),
  outlook: (
    <g>
      <rect x="11" y="6" width="18" height="20" rx="2.5" fill="#28A8EA" />
      <path d="M11 13l9 6 9-6v11.5a2.5 2.5 0 0 1-2.5 2.5h-14A2.5 2.5 0 0 1 11 24.5z" fill="#0078D4" />
      <rect x="3" y="9" width="15" height="15" rx="2.5" fill="#0364B8" />
      <ellipse cx="10.5" cy="16.5" rx="4" ry="4.6" fill="none" stroke="#fff" strokeWidth="2.2" />
    </g>
  ),
  apple: (
    <g>
      <path d="M9.5 24.5h13.8a5.7 5.7 0 0 0 .8-11.3 7.5 7.5 0 0 0-14.3-1.7A6.6 6.6 0 0 0 9.5 24.5z" fill="#3693F3" />
      <path d="M9.5 24.5h13.8a5.7 5.7 0 0 0 1.9-.3A6.6 6.6 0 0 1 12 20.6a6.6 6.6 0 0 0-2.5 3.9z" fill="#1A7BE0" opacity=".55" />
    </g>
  ),
  caldav: (
    <Tile fill="#E6F6F4">
      <rect x="7" y="9" width="18" height="16" rx="2.5" fill="none" stroke="#07857C" strokeWidth="2" />
      <path d="M7 13.5h18" stroke="#07857C" strokeWidth="2" />
      <path d="M12 7v4M20 7v4" stroke="#07857C" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.5 18h3M17.5 18h3M11.5 21.5h3" stroke="#07857C" strokeWidth="2" strokeLinecap="round" />
    </Tile>
  ),
  ics: (
    <Tile fill="#FFF6E6">
      <rect x="7" y="9" width="18" height="16" rx="2.5" fill="none" stroke="#AA5B00" strokeWidth="2" />
      <path d="M12 7v4M20 7v4" stroke="#AA5B00" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="20.5" r="1.6" fill="#AA5B00" />
      <path d="M12 16a4.5 4.5 0 0 1 4.5 4.5M12 13a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="#AA5B00" strokeWidth="1.8" strokeLinecap="round" />
    </Tile>
  ),
  zoom: (
    <Tile fill="#0B5CFF">
      <rect x="6.5" y="11" width="13.5" height="10" rx="2.5" fill="#fff" />
      <path d="M21 14.6l4.5-3.1v9l-4.5-3.1z" fill="#fff" />
    </Tile>
  ),
  meet: (
    <g>
      <path d="M4 11.5a2.5 2.5 0 0 1 2.5-2.5H19v6.5H4z" fill="#FBBC04" />
      <path d="M4 15.5h15V23H6.5A2.5 2.5 0 0 1 4 20.5z" fill="#34A853" />
      <path d="M19 9h-4.5v14H19a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z" fill="#188038" />
      <path d="M21 13.2l6-4.2v14l-6-4.2z" fill="#00832D" />
      <path d="M4 11.5V9h2.5z" fill="#EA4335" />
      <path d="M4 9h6v6.5H4z" fill="#4285F4" opacity=".9" />
    </g>
  ),
  teams: (
    <g>
      <circle cx="23" cy="9.5" r="3.5" fill="#7B83EB" />
      <rect x="18" y="14" width="11" height="11" rx="3" fill="#7B83EB" />
      <rect x="3" y="8" width="18" height="18" rx="2.5" fill="#4B53BC" />
      <path d="M8 12.5h8M12 12.5v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  jitsi: (
    <Tile fill="#1D76BA">
      <rect x="6.5" y="11" width="13" height="10" rx="2.5" fill="#fff" />
      <path d="M20.5 14.6l5-3.1v9l-5-3.1z" fill="#fff" />
      <circle cx="13" cy="16" r="2" fill="#1D76BA" />
    </Tile>
  ),
  webex: (
    <g>
      <circle cx="16" cy="16" r="13" fill="#00BCEB" />
      <path d="M8 13l2.8 8 2.6-6.5L16 21l2.6-6.5L21.2 21 24 13" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </g>
  ),
  gotomeeting: (
    <Tile fill="#F68D2E">
      <circle cx="16" cy="16" r="7" fill="none" stroke="#fff" strokeWidth="3" />
      <path d="M16 16h7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </Tile>
  ),
  stripe: (
    <Tile fill="#635BFF">
      <path
        d="M14.7 13.2c0-.8.7-1.1 1.8-1.1 1.6 0 3.6.5 5.2 1.4V8.9a13.7 13.7 0 0 0-5.2-1c-4.3 0-7.1 2.2-7.1 6 0 5.8 8 4.9 8 7.4 0 .9-.8 1.2-1.9 1.2-1.7 0-3.9-.7-5.6-1.7v4.7c1.9.8 3.8 1.2 5.6 1.2 4.4 0 7.4-2.2 7.4-6 0-6.3-8.2-5.2-8.2-7.5z"
        fill="#fff"
      />
    </Tile>
  ),
  paypal: (
    <Tile fill="#FFFFFF">
      <path d="M12.4 25.5H8.6L11.4 7h7.1c3.6 0 5.6 1.9 5 5.2-.7 4-3.5 5.6-7.2 5.6h-2.6z" fill="#003087" />
      <path d="M14.6 25.5h-3l2.3-14.3h5.6c2.6 0 3.9 1.4 3.4 3.8-.6 3-2.7 4.2-5.4 4.2h-1.9z" fill="#009CDE" />
    </Tile>
  ),
  twilio: (
    <g>
      <circle cx="16" cy="16" r="13" fill="#F22F46" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12.8" cy="12.8" r="2" fill="#fff" />
      <circle cx="19.2" cy="12.8" r="2" fill="#fff" />
      <circle cx="12.8" cy="19.2" r="2" fill="#fff" />
      <circle cx="19.2" cy="19.2" r="2" fill="#fff" />
    </g>
  ),
  webhook: (
    <Tile fill="#FBEAF0">
      <path d="M13.4 9.6a4.4 4.4 0 0 1 6.6 3.8 4.4 4.4 0 0 1-1 2.8l2.8 4.9" fill="none" stroke="#C73A63" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21.8 24.3a4.4 4.4 0 0 1-6.1-1.3H10" fill="none" stroke="#4B4B4B" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.2 22.3a4.4 4.4 0 0 1 1.5-6.1L12.5 11" fill="none" stroke="#4A90E2" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16.4" cy="13.4" r="1.9" fill="#C73A63" />
      <circle cx="22" cy="23" r="1.9" fill="#4B4B4B" />
      <circle cx="9.9" cy="23" r="1.9" fill="#4A90E2" />
    </Tile>
  ),
  email: (
    <Tile fill="#E6F0FF">
      <rect x="6.5" y="9.5" width="19" height="13" rx="2" fill="none" stroke="#006BFF" strokeWidth="2" />
      <path d="M7.5 11l8.5 6 8.5-6" fill="none" stroke="#006BFF" strokeWidth="2" strokeLinejoin="round" />
    </Tile>
  ),
  api: (
    <Tile fill="#0A2540">
      <path d="M12.5 9.5c-2 0-2.5 1-2.5 2.5v2c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v2c0 1.5.5 2.5 2.5 2.5M19.5 9.5c2 0 2.5 1 2.5 2.5v2c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v2c0 1.5-.5 2.5-2.5 2.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </Tile>
  ),
  embed: (
    <Tile fill="#EDF4FF">
      <path d="M12.5 11l-5 5 5 5M19.5 11l5 5-5 5" fill="none" stroke="#004EBA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 9.5l-3 13" stroke="#004EBA" strokeWidth="2" strokeLinecap="round" />
    </Tile>
  ),
  analytics: (
    <g>
      <rect x="20" y="4" width="8" height="24" rx="4" fill="#F9AB00" />
      <rect x="12" y="12" width="8" height="16" rx="4" fill="#E37400" />
      <circle cx="8" cy="24" r="4" fill="#E37400" />
    </g>
  ),
  meta: (
    <g>
      <path
        d="M6.6 21.8c0 1.6.9 2.6 2.1 2.6 1 0 1.8-.4 3.4-2.7l2.6-3.9-1.9-2.8c-1.4-2-2.6-3-4-3-2.4 0-4.2 3.6-4.2 6.8 0 1.2.3 2.3.9 3.1M25.4 21.8c0 1.6-.9 2.6-2.1 2.6-1 0-1.8-.4-3.4-2.7L15 14.6c-1.3-1.9-2.5-3.6-4.3-3.6M15 14.6c1.3-1.9 2.5-3.6 4.3-3.6 2.4 0 4.2 3.6 4.2 6.8 0 1.2-.3 2.3-.9 3.1"
        fill="none"
        stroke="#0081FB"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  ),
};

export function ProviderLogo({ provider, size = 32, title, className }: ProviderLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {title && <title>{title}</title>}
      {MARKS[provider] ?? (
        <Tile fill="#E7EDF6">
          <text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0A2540">
            {provider.slice(0, 2).toUpperCase()}
          </text>
        </Tile>
      )}
    </svg>
  );
}
