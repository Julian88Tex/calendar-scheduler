// OWNER: foundation-ui.
//
// Gallery: tabs, disclosures, section cards, pagination and progress.
"use client";

import { Clock, MapPin } from "lucide-react";
import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Pagination } from "@/components/ui/pagination";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RouteTabs } from "@/components/ui/route-tabs";
import { SectionCard } from "@/components/ui/section-card";
import { Stepper } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Demo, GallerySection } from "./section";

export function NavigationSection() {
  const [page, setPage] = useState(2);
  const [step, setStep] = useState(2);
  const [open, setOpen] = useState(true);
  return (
    <GallerySection id="navigation" title="Navigation and disclosure" description="Underline tabs, route tabs, accordions, collapsible editor sections, pagination and progress.">
      <Demo label="Tabs" className="w-full">
        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList aria-label="Meetings">
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
            <TabsTrigger value="range" badge={<Badge size="sm" variant="info">New</Badge>}>
              Date Range
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="text-body-md text-ink-2">
            Upcoming meetings appear here.
          </TabsContent>
          <TabsContent value="past" className="text-body-md text-ink-2">
            Past meetings appear here.
          </TabsContent>
          <TabsContent value="range" className="text-body-md text-ink-2">
            Pick a date range.
          </TabsContent>
        </Tabs>
      </Demo>
      <Demo label="Route tabs (links)" className="w-full">
        <RouteTabs
          aria-label="Gallery route tabs"
          className="w-full"
          tabs={[
            { href: "/app/dev/ui", label: "UI kit", exact: true },
            { href: "/app/scheduling", label: "Scheduling" },
            { href: "/app/availability", label: "Availability" },
          ]}
        />
      </Demo>
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo label="Section cards (event type editor)" className="w-full">
          <div className="flex w-full flex-col gap-3">
            <SectionCard title="Duration" icon={<Clock aria-hidden="true" />} summary="30 min" open={open} onOpenChange={setOpen}>
              <p className="text-body-md text-ink-2">Choose how long the meeting lasts.</p>
            </SectionCard>
            <SectionCard title="Location" icon={<MapPin aria-hidden="true" />} summary="Zoom, Phone call" badge={<Badge size="sm">2</Badge>}>
              <p className="text-body-md text-ink-2">Where the meeting happens.</p>
            </SectionCard>
            <SectionCard title="Limits and buffers" summary="Locked by your admin" locked>
              <p className="text-body-md text-ink-2">Read only.</p>
            </SectionCard>
          </div>
        </Demo>
        <Demo label="Accordion and collapsible" className="w-full">
          <div className="flex w-full flex-col gap-4">
            <Accordion type="single" collapsible defaultValue="a" className="w-full">
              <AccordionItem value="a">
                <AccordionTrigger>How do invitees book?</AccordionTrigger>
                <AccordionContent>They pick a day, a time and fill in the form.</AccordionContent>
              </AccordionItem>
              <AccordionItem value="b">
                <AccordionTrigger>Can I hide the branding?</AccordionTrigger>
                <AccordionContent>Yes, in Settings, Branding.</AccordionContent>
              </AccordionItem>
            </Accordion>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="tertiary">More options</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 text-body-md text-ink-2">Extra settings appear here.</CollapsibleContent>
            </Collapsible>
          </div>
        </Demo>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo label="Pagination" className="w-full">
          <Pagination className="w-full" page={page} pageSize={25} total={120} onPageChange={setPage} />
          <Pagination className="w-full" page={1} pageSize={25} hasNext onPageChange={() => undefined} aria-label="Keyset pagination" />
        </Demo>
        <Demo label="Stepper and progress" className="w-full">
          <div className="flex w-full flex-col gap-4">
            <Stepper total={4} current={step} labels={["Your URL", "Calendar", "Availability", "Use case"]} />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={step <= 1} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              <Button size="sm" disabled={step >= 4} onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            </div>
            <ProgressBar value={34} max={40} label="Times selected" showValue />
          </div>
        </Demo>
      </div>
    </GallerySection>
  );
}
