// OWNER: foundation-ui.
//
// Banner (ARCHITECTURE 20.2): info, success, warning, error notices with a default icon per variant, optional title,
// actions and a dismiss button. Warnings and errors use role="alert"; info and success use role="status".
"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
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
  /** Accessible name of the dismiss button (default "Dismiss"). */
  dismissLabel?: string;
  /**
   * Live region role. Default: "alert" for warning and error, "status" for info and success. Persistent page banners
   * (the dashboard shell) pass "status" or "none" so they are not announced as urgent on every page.
   */
  role?: "alert" | "status" | "none";
};

const VARIANTS: Record<BannerVariant, string> = {
  info: "border-primary-soft-2 bg-info-soft text-ink",
  success: "border-success-soft bg-success-soft text-success-text",
  warning: "border-warning-soft bg-warning-soft text-warning-text",
  error: "border-danger-soft bg-danger-soft text-danger-text",
};
const ICON_COLORS: Record<BannerVariant, string> = {
  info: "text-primary-text",
  success: "text-success-text",
  warning: "text-warning-text",
  error: "text-danger-text",
};
const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertCircle } as const;

export function Banner({ variant = "info", title, children, action, dismissible, onDismiss, icon, className, dismissLabel = "Dismiss", role }: BannerProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const DefaultIcon = ICONS[variant];
  const iconNode = icon === false ? null : (icon ?? <DefaultIcon aria-hidden="true" className="size-5" />);
  return (
    <div
      role={role === "none" ? undefined : (role ?? (variant === "error" || variant === "warning" ? "alert" : "status"))}
      className={cn("flex min-w-0 items-start gap-3 rounded-[var(--radius-card)] border px-4 py-3 text-[14px] leading-5", VARIANTS[variant], className)}
    >
      {iconNode && <span className={cn("mt-px inline-flex shrink-0 [&_svg]:size-5", ICON_COLORS[variant])}>{iconNode}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {dismissible && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={() => {
            setHidden(true);
            onDismiss?.();
          }}
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-80 hover:bg-black/5 hover:opacity-100"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
