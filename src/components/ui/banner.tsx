// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Banner (ARCHITECTURE 20.2): info, success, warning, error; optionally dismissible.
"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type BannerVariant = "info" | "success" | "warning" | "error";

export type BannerProps = {
  variant?: BannerVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  /** Custom icon; false hides it. */
  icon?: React.ReactNode | false;
  className?: string;
};

const VARIANTS: Record<BannerVariant, string> = {
  info: "bg-[var(--info-soft)] text-ink",
  success: "bg-[var(--success-soft)] text-[var(--success-text)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  error: "bg-[var(--danger-soft)] text-danger-text",
};

export function Banner({ variant = "info", title, children, action, dismissible, onDismiss, icon, className }: BannerProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div role={variant === "error" || variant === "warning" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-[var(--radius-card)] px-4 py-3 text-body-md", VARIANTS[variant], className)}>
      {icon !== false && icon}
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action}
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            setHidden(true);
            onDismiss?.();
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
