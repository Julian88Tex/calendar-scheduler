// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Accordion (ARCHITECTURE 20.2, Radix): Accordion, AccordionItem, AccordionTrigger, AccordionContent.
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
      <RadixAccordion.Trigger className={cn("flex flex-1 items-center justify-between py-3 text-left text-title-sm", className)} {...rest}>
        {children}
        <ChevronDown aria-hidden="true" className="size-4" />
      </RadixAccordion.Trigger>
    </RadixAccordion.Header>
  );
}

export function AccordionContent({ className, ...rest }: React.ComponentProps<typeof RadixAccordion.Content>) {
  return <RadixAccordion.Content className={cn("pb-4", className)} {...rest} />;
}
