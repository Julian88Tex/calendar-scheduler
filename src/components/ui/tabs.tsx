// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Tabs (ARCHITECTURE 20.2): underline-style in-page tabs built on Radix (Tabs, TabsList, TabsTrigger, TabsContent).
// For tabs that are pages, use RouteTabs.
"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type TabsProps = React.ComponentProps<typeof RadixTabs.Root>;
export function Tabs({ className, ...rest }: TabsProps) {
  return <RadixTabs.Root className={cn("flex flex-col gap-4", className)} {...rest} />;
}

export type TabsListProps = React.ComponentProps<typeof RadixTabs.List>;
export function TabsList({ className, ...rest }: TabsListProps) {
  return <RadixTabs.List className={cn("flex gap-6 border-b border-line", className)} {...rest} />;
}

export type TabsTriggerProps = React.ComponentProps<typeof RadixTabs.Trigger> & { badge?: React.ReactNode };
export function TabsTrigger({ className, badge, children, ...rest }: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={cn("-mb-px border-b-2 border-transparent pb-2 text-body-md text-ink-2 data-[state=active]:border-primary data-[state=active]:text-ink", className)}
      {...rest}
    >
      {children}
      {badge}
    </RadixTabs.Trigger>
  );
}

export type TabsContentProps = React.ComponentProps<typeof RadixTabs.Content>;
export function TabsContent(props: TabsContentProps) {
  return <RadixTabs.Content {...props} />;
}
