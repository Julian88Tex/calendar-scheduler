// OWNER: foundation-ui.
//
// Accordion (ARCHITECTURE 20.2, Radix): Accordion, AccordionItem, AccordionTrigger, AccordionContent. Rows divided by
// #D4E0ED hairlines, bold triggers with a rotating chevron; keyboard navigation between headers is built in.
"use client";

import * as RadixAccordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export const Accordion = RadixAccordion.Root;

export function AccordionItem({ className, ...rest }: React.ComponentProps<typeof RadixAccordion.Item>) {
  return <RadixAccordion.Item className={cn("border-b border-line", className)} {...rest} />;
}

export function AccordionTrigger({ className, children, ...rest }: React.ComponentProps<typeof RadixAccordion.Trigger>) {
  return (
    <RadixAccordion.Header className="flex">
      <RadixAccordion.Trigger
        className={cn(
          "group flex flex-1 items-center justify-between gap-3 py-4 text-left text-title-sm text-ink transition-colors hover:text-primary-text",
          className,
        )}
        {...rest}
      >
        {children}
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-ink-2 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </RadixAccordion.Trigger>
    </RadixAccordion.Header>
  );
}

export function AccordionContent({ className, ...rest }: React.ComponentProps<typeof RadixAccordion.Content>) {
  return <RadixAccordion.Content className={cn("pb-4 text-body-md text-ink", className)} {...rest} />;
}
