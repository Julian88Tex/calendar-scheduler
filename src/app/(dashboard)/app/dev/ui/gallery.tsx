// OWNER: foundation-ui.
//
// Client side of the UI kit gallery: a section index and every component family with its states.
"use client";

import { PageHeader } from "@/components/ui/page-header";
import { ButtonsSection, FormControlsSection } from "./gallery-controls";
import { DataSection } from "./gallery-data";
import { InputsSection } from "./gallery-inputs";
import { NavigationSection } from "./gallery-navigation";
import { OverlaysSection } from "./gallery-overlays";
import { PublicSection } from "./gallery-public";
import { TimeSection } from "./gallery-time";

const SECTIONS = [
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Form controls" },
  { id: "time", label: "Time and dates" },
  { id: "inputs", label: "Rich inputs" },
  { id: "navigation", label: "Navigation" },
  { id: "overlays", label: "Overlays" },
  { id: "data", label: "Data display" },
  { id: "public", label: "Public pages" },
];

export function DevGallery() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="UI kit" description="Every component of the design system (ARCHITECTURE 20.2) with its states, in the Calendly classic theme." />
      <nav aria-label="Gallery sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-primary-text hover:bg-primary-soft">
            {s.label}
          </a>
        ))}
      </nav>
      <ButtonsSection />
      <FormControlsSection />
      <TimeSection />
      <InputsSection />
      <NavigationSection />
      <OverlaysSection />
      <DataSection />
      <PublicSection />
    </div>
  );
}
