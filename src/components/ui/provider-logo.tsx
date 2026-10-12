// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ProviderLogo (ARCHITECTURE 20.2): inline SVG logos for integrations. Foundation stub: a lettered tile per provider.
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

export function ProviderLogo({ provider, size = 32, title, className }: ProviderLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="6" fill="#e7edf6" />
      <text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0a2540">
        {provider.slice(0, 2).toUpperCase()}
      </text>
    </svg>
  );
}
