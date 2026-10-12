// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Avatar (image or initials on --mist) and AvatarGroup (overlapping stack with "+n") (ARCHITECTURE 20.2).
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
  const px = typeof size === "number" ? size : PX[size];
  const style: React.CSSProperties = { width: px, height: px, fontSize: Math.max(10, Math.round(px * 0.4)) };
  const radius = shape === "circle" ? "rounded-full" : "rounded";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? name ?? ""} width={px} height={px} style={style} className={cn("object-cover", radius, className)} />;
  }
  return (
    <span role="img" aria-label={alt ?? name ?? "Avatar"} style={style} className={cn("inline-flex items-center justify-center bg-mist font-semibold text-ink-2", radius, className)}>
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
  return (
    <span className={cn("inline-flex -space-x-2", className)}>
      {shown.map((u, i) => (
        <Avatar key={i} src={u.src} name={u.name} size={size} className="ring-2 ring-white" />
      ))}
      {rest > 0 && <span className="inline-flex items-center rounded-full bg-mist px-1.5 text-body-sm ring-2 ring-white">+{rest}</span>}
    </span>
  );
}
