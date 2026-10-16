// OWNER: foundation-ui.
//
// Tabs (ARCHITECTURE 20.2, walkthrough 1.5): underline-style in-page tabs built on Radix (Tabs, TabsList, TabsTrigger,
// TabsContent): 600 weight labels, #476788 inactive, #0A2540 with a 3px #006BFF underline when active, over a 1px
// #D4E0ED divider; the list scrolls horizontally on narrow screens. For tabs that are pages, use RouteTabs.
"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type TabsProps = React.ComponentProps<typeof RadixTabs.Root>;
export function Tabs({ className, ...rest }: TabsProps) {
  return <RadixTabs.Root className={cn("flex min-w-0 flex-col gap-6", className)} {...rest} />;
}

export type TabsListProps = React.ComponentProps<typeof RadixTabs.List>;
export function TabsList({ className, ...rest }: TabsListProps) {
  return (
    <RadixTabs.List
      className={cn("scrollbar-thin flex min-w-0 gap-6 overflow-x-auto border-b border-line [scrollbar-width:none]", className)}
      {...rest}
    />
  );
}

export type TabsTriggerProps = React.ComponentProps<typeof RadixTabs.Trigger> & { badge?: React.ReactNode };
export function TabsTrigger({ className, badge, children, ...rest }: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "relative -mb-px inline-flex shrink-0 items-center gap-2 border-b-[3px] border-transparent px-0.5 pt-1 pb-3 text-[14px] font-semibold whitespace-nowrap text-ink-2",
        "transition-colors duration-100 hover:text-ink data-[state=active]:border-primary data-[state=active]:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
      {badge}
    </RadixTabs.Trigger>
  );
}

export type TabsContentProps = React.ComponentProps<typeof RadixTabs.Content>;
export function TabsContent({ className, ...rest }: TabsContentProps) {
  return <RadixTabs.Content className={cn("min-w-0 focus-visible:outline-none", className)} {...rest} />;
}
