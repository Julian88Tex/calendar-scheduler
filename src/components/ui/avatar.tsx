// OWNER: foundation-ui.
//
// Avatar (image, or initials on --mist when there is no photo or it fails to load) and AvatarGroup (overlapping stack
// with a "+n" circle, SPEC BK-03) (ARCHITECTURE 20.2). Client component (image error fallback); usable from Server
// Components with serializable props.
"use client";

import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
const PX: Record<AvatarSize, number> = { xs: 20, sm: 24, md: 32, lg: 48, xl: 64 };

export type AvatarProps = {
  src?: string | null;
  name?: string | null;
  /** Alt text (default: the name). Decorative avatars next to a visible name pass alt="". */
  alt?: string;
  size?: AvatarSize | number;
  shape?: "circle" | "square";
  className?: string;
};

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function Avatar({ src, name, alt, size = "md", shape = "circle", className }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const px = typeof size === "number" ? size : PX[size];
  const style: React.CSSProperties = { width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.38)) };
  const radius = shape === "circle" ? "rounded-full" : "rounded-[var(--radius-card)]";
  const label = alt ?? name ?? "";
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={label}
        width={px}
        height={px}
        style={style}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={cn("shrink-0 bg-mist object-cover", radius, className)}
      />
    );
  }
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={style}
      className={cn("inline-flex shrink-0 items-center justify-center bg-mist leading-none font-semibold text-ink-2 select-none", radius, className)}
    >
      {initialsOf(name)}
    </span>
  );
}

export type AvatarGroupProps = {
  users: { name: string | null; src?: string | null }[];
  /** Avatars shown before "+n" (default 3). */
  max?: number;
  size?: AvatarSize;
  className?: string;
};

export function AvatarGroup({ users, max = 3, size = "sm", className }: AvatarGroupProps) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  const px = PX[size];
  return (
    <span className={cn("inline-flex items-center", className)} role="group" aria-label={users.map((u) => u.name ?? "").filter(Boolean).join(", ") || undefined}>
      {shown.map((u, i) => (
        <Avatar key={i} src={u.src} name={u.name} alt="" size={size} className={cn("ring-2 ring-white", i > 0 && "-ml-[25%]")} />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          style={{ width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.34)) }}
          className="-ml-[25%] inline-flex shrink-0 items-center justify-center rounded-full bg-mist leading-none font-semibold text-ink ring-2 ring-white"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
