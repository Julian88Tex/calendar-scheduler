// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Button (ARCHITECTURE 20.2): variants primary, secondary, tertiary (link style), destructive, ghost; sizes sm, md, lg;
// pill radius; loading (spinner, disabled); asChild (renders the child element, e.g. a Link, with button styling).
// No hooks and no "use client": Button and buttonClassName() work in Server and Client Components alike.
import { cloneElement, isValidElement } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  /** Render the single child (for example a Next Link) with button styling instead of a <button>. */
  asChild?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-line bg-white text-ink hover:border-ink-2",
  tertiary: "text-primary-text underline-offset-2 hover:underline",
  destructive: "bg-danger text-white hover:opacity-90",
  ghost: "text-ink hover:bg-pebble",
};
const SIZES: Record<ButtonSize, string> = { sm: "h-8 px-3 text-body-sm", md: "h-10 px-4 text-body-md", lg: "h-12 px-6 text-body" };

export function buttonClassName(opts: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[opts.variant ?? "primary"],
    SIZES[opts.size ?? "md"],
    opts.fullWidth && "w-full",
    opts.className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  asChild = false,
  fullWidth,
  leftIcon,
  rightIcon,
  className,
  disabled,
  children,
  type,
  ...rest
}: ButtonProps) {
  const cls = buttonClassName({ variant, size, fullWidth, className });
  if (asChild && isValidElement<{ className?: string }>(children)) {
    return cloneElement(children, {
      ...(rest as Record<string, unknown>),
      className: cn(cls, children.props.className),
      "aria-disabled": disabled || loading || undefined,
    } as Partial<{ className?: string }>);
  }
  return (
    <button type={type ?? "button"} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
