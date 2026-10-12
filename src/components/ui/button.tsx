// OWNER: foundation-ui.
//
// Button (ARCHITECTURE 20.2, SPEC GEN-03, walkthrough 1.4 and 1.5): Calendly classic pill buttons. Variants primary
// (#006BFF fill, hover #004EBA, pressed #004796), secondary (white fill, 1px border, hover #F4F8FF), tertiary (link
// style #004EBA text), destructive (#D53C00 fill) and ghost; sizes sm (32px), md (40px, the Calendly minimum) and lg
// (48px); `loading` shows a spinner, sets aria-busy and disables; `asChild` styles the single child (a Next Link).
// No hooks and no "use client": Button and buttonClassName() work in Server and Client Components alike.
import { cloneElement, isValidElement } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

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

const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-semibold " +
  "transition-[background-color,border-color,color,box-shadow] duration-100 ease-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-white hover:bg-primary-hover active:bg-primary-active " +
    "disabled:bg-mist disabled:text-ink-3 aria-disabled:bg-mist aria-disabled:text-ink-3",
  secondary:
    "border-ink-2 bg-white text-ink hover:bg-primary-soft active:bg-primary-soft-2 " +
    "disabled:border-line disabled:bg-white disabled:text-ink-3 aria-disabled:border-line aria-disabled:text-ink-3",
  tertiary:
    "border-transparent bg-transparent text-primary-text hover:bg-primary-soft active:bg-primary-soft-2 " +
    "disabled:bg-transparent disabled:text-ink-3 aria-disabled:text-ink-3",
  destructive:
    "border-transparent bg-danger text-white hover:bg-danger-text active:bg-danger-text " +
    "disabled:bg-mist disabled:text-ink-3 aria-disabled:bg-mist aria-disabled:text-ink-3",
  ghost:
    "border-transparent bg-transparent text-ink hover:bg-pebble active:bg-mist " +
    "disabled:bg-transparent disabled:text-ink-3 aria-disabled:text-ink-3",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 py-1 text-[14px] leading-5 [&_svg]:size-4",
  md: "min-h-10 px-4 py-2 text-[14px] leading-5 [&_svg]:size-4",
  lg: "min-h-12 px-6 py-3 text-[16px] leading-6 [&_svg]:size-5",
};

export function buttonClassName(opts: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}) {
  return cn(BASE, VARIANTS[opts.variant ?? "primary"], SIZES[opts.size ?? "md"], opts.fullWidth && "w-full", opts.className);
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
  if (asChild && isValidElement<{ className?: string; children?: React.ReactNode }>(children)) {
    const inert = disabled || loading;
    return cloneElement(children, {
      ...(rest as Record<string, unknown>),
      className: cn(cls, children.props.className),
      "aria-disabled": inert || undefined,
      "aria-busy": loading || undefined,
      tabIndex: inert ? -1 : undefined,
      children: (
        <>
          {loading ? <Spinner size="sm" inheritColor decorative /> : leftIcon}
          {children.props.children}
          {!loading && rightIcon}
        </>
      ),
    } as Partial<{ className?: string }>);
  }
  return (
    <button
      type={type ?? "button"}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" inheritColor decorative /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
