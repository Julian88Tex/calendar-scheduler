// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// DropdownMenu (ARCHITECTURE 20.2, Radix): DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
// (icon, destructive, href), DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup and DropdownMenuSwitchItem
// (the kebab menu "On/Off" row, ET-05).
"use client";

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import type { Route } from "next";
import type * as React from "react";
import { cn } from "@/lib/cn";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuGroup = RadixMenu.Group;

export type DropdownMenuContentProps = React.ComponentProps<typeof RadixMenu.Content>;
export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...rest }: DropdownMenuContentProps) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 min-w-48 rounded-[var(--radius-card)] border border-line bg-white py-1 shadow-[var(--shadow-pop)]", className)}
        {...rest}
      />
    </RadixMenu.Portal>
  );
}

export type DropdownMenuItemProps = React.ComponentProps<typeof RadixMenu.Item> & {
  icon?: React.ReactNode;
  destructive?: boolean;
  /** Renders the item as a Next link. */
  href?: Route;
  shortcut?: string;
};
export function DropdownMenuItem({ icon, destructive, href, shortcut, className, children, asChild, ...rest }: DropdownMenuItemProps) {
  const cls = cn(
    "flex cursor-pointer items-center gap-2 px-3 py-2 text-body-md outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-pebble",
    destructive && "text-danger-text",
    className,
  );
  const content = (
    <>
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-body-sm text-ink-2">{shortcut}</span>}
    </>
  );
  if (asChild) {
    return (
      <RadixMenu.Item asChild className={cls} {...rest}>
        {children}
      </RadixMenu.Item>
    );
  }
  if (href) {
    return (
      <RadixMenu.Item asChild className={cls} {...rest}>
        <Link href={href}>{content}</Link>
      </RadixMenu.Item>
    );
  }
  return (
    <RadixMenu.Item className={cls} {...rest}>
      {content}
    </RadixMenu.Item>
  );
}

export function DropdownMenuSeparator({ className, ...rest }: React.ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-line", className)} {...rest} />;
}

export function DropdownMenuLabel({ className, ...rest }: React.ComponentProps<typeof RadixMenu.Label>) {
  return <RadixMenu.Label className={cn("px-3 py-1 text-eyebrow text-ink-2", className)} {...rest} />;
}

export type DropdownMenuSwitchItemProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
};
/** A menu row with an On/Off switch that does not close the menu. */
export function DropdownMenuSwitchItem({ checked, onCheckedChange, children, disabled, className }: DropdownMenuSwitchItemProps) {
  return (
    <RadixMenu.CheckboxItem
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      onSelect={(e) => e.preventDefault()}
      className={cn("flex cursor-pointer items-center justify-between gap-4 px-3 py-2 text-body-md outline-none data-[highlighted]:bg-pebble", className)}
    >
      <span>{children}</span>
      <span aria-hidden="true" className={cn("inline-flex h-5 w-9 rounded-full p-0.5", checked ? "bg-primary" : "bg-ink-3")}>
        <span className={cn("size-4 rounded-full bg-white", checked && "translate-x-4")} />
      </span>
    </RadixMenu.CheckboxItem>
  );
}
