// OWNER: foundation-ui.
//
// Gallery: buttons and form controls.
"use client";

import { ExternalLink, MoreVertical, Plus, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup } from "@/components/ui/radio-group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Demo, GallerySection } from "./section";

export function ButtonsSection() {
  return (
    <GallerySection id="buttons" title="Buttons" description="Pill buttons (40px minimum height), icon buttons and link-style tertiary buttons.">
      <Demo label="Variants">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tertiary">Tertiary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="ghost">Ghost</Button>
      </Demo>
      <Demo label="Sizes and icons">
        <Button size="sm" leftIcon={<Plus aria-hidden="true" />}>
          Small
        </Button>
        <Button leftIcon={<Plus aria-hidden="true" />}>New event type</Button>
        <Button size="lg">Schedule Event</Button>
        <Button variant="secondary" rightIcon={<ExternalLink aria-hidden="true" />}>
          View booking page
        </Button>
        <Button asChild variant="tertiary">
          <Link href="/app/scheduling">Link styled as a button</Link>
        </Button>
      </Demo>
      <Demo label="States">
        <Button loading>Loading</Button>
        <Button variant="secondary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button fullWidth className="max-w-xs">
          Full width
        </Button>
      </Demo>
      <Demo label="Icon buttons">
        <IconButton aria-label="More actions">
          <MoreVertical aria-hidden="true" />
        </IconButton>
        <IconButton aria-label="Settings" variant="secondary">
          <Settings aria-hidden="true" />
        </IconButton>
        <IconButton aria-label="Add" variant="primary" size="lg">
          <Plus aria-hidden="true" />
        </IconButton>
        <IconButton aria-label="Delete" size="sm" loading>
          <Trash2 aria-hidden="true" />
        </IconButton>
      </Demo>
    </GallerySection>
  );
}

export function FormControlsSection() {
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("zoom");
  const [select, setSelect] = useState("30");
  const [combo, setCombo] = useState<string | null>("ana");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [switchOn, setSwitchOn] = useState(true);
  return (
    <GallerySection id="forms" title="Form controls" description="Inputs use 8px radius, a #D4E0ED border and the blue focus ring.">
      <div className="grid gap-6 lg:grid-cols-2">
        <FormField label="Name" required hint="As shown to invitees">
          {(control) => <Input {...control} placeholder="Jane Doe" autoComplete="name" />}
        </FormField>
        <FormField label="Email" error="Enter a valid email address">
          {(control) => <Input {...control} type="email" defaultValue="jane@" />}
        </FormField>
        <FormField label="Booking form input (46px)">{(control) => <Input {...control} size="lg" placeholder="Large" />}</FormField>
        <FormField label="Your link" hint="Static prefix addon">
          {(control) => <Input {...control} leftAddon="kairos.app/" defaultValue="julianjoseph" />}
        </FormField>
        <FormField label="Disabled">{(control) => <Input {...control} disabled defaultValue="Read only" />}</FormField>
        <FormField label="Welcome message" hint="Counter and auto-grow">
          {(control) => <Textarea {...control} maxLength={265} showCount autoResize defaultValue="Welcome to my scheduling page." />}
        </FormField>
        <FormField label="Duration (Select)">
          {(control) => (
            <Select
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              value={select}
              onValueChange={setSelect}
              options={[
                { label: "Short", options: [{ value: "15", label: "15 min" }, { value: "30", label: "30 min", description: "Default" }] },
                { label: "Long", options: [{ value: "60", label: "60 min" }, { value: "90", label: "90 min", disabled: true }] },
              ]}
            />
          )}
        </FormField>
        <FormField label="Host (Combobox)">
          {(control) => (
            <Combobox
              id={control.id}
              value={combo}
              onChange={setCombo}
              placeholder="Choose a host"
              searchPlaceholder="Search people"
              options={[
                { value: "ana", label: "Ana Lopez", description: "ana@example.com", group: "Team" },
                { value: "ben", label: "Ben Carter", description: "ben@example.com", group: "Team" },
                { value: "cy", label: "Cy Park", description: "Pending invitation", group: "Invited", disabled: true },
              ]}
            />
          )}
        </FormField>
        <FormField label="Country (NativeSelect)">
          {(control) => (
            <NativeSelect
              id={control.id}
              defaultValue="US"
              options={[
                { value: "US", label: "United States" },
                { value: "DE", label: "Germany" },
                { value: "IN", label: "India" },
              ]}
            />
          )}
        </FormField>
      </div>
      <Demo label="Checkbox, radio, switch, segmented">
        <div className="flex flex-col gap-3">
          <Checkbox label="Allow invitees to add guests" checked={checked} onCheckedChange={setChecked} />
          <Checkbox label="Select all" checked="indeterminate" />
          <Checkbox label="Send email confirmations" description="Invitees receive an email with an .ics file." defaultChecked />
          <Checkbox label="Disabled option" disabled />
        </div>
        <RadioGroup
          legend="Location"
          value={radio}
          onValueChange={setRadio}
          options={[
            { value: "zoom", label: "Zoom", description: "A unique meeting for every booking" },
            { value: "phone", label: "Phone call" },
            { value: "office", label: "In-person meeting", disabled: true },
          ]}
        />
        <RadioGroup
          legend="Cards"
          variant="cards"
          defaultValue="a"
          options={[
            { value: "a", label: "Shared (no team page)" },
            { value: "b", label: "Sales team" },
          ]}
        />
        <div className="flex flex-col gap-3">
          <Switch label="Active" checked={switchOn} onCheckedChange={setSwitchOn} showStateLabel />
          <Switch label="Small switch" size="sm" defaultChecked />
          <Switch label="Disabled" disabled />
          <SegmentedControl<"list" | "calendar">
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: "list", label: "List" },
              { value: "calendar", label: "Calendar" },
            ]}
          />
        </div>
      </Demo>
    </GallerySection>
  );
}
