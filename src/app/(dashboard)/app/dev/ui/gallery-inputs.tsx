// OWNER: foundation-ui.
//
// Gallery: phone, rich text, chips, colors, uploads, search and copy.
"use client";

import { useState } from "react";
import { ChipsInput } from "@/components/ui/chips-input";
import { validateEmailChip } from "@/components/ui/chips-input-utils";
import { ColorPicker } from "@/components/ui/color-picker";
import { CopyButton } from "@/components/ui/copy-button";
import { FileUpload } from "@/components/ui/file-upload";
import { FormField } from "@/components/ui/form-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { RichTextEditor, type RichTextValue } from "@/components/ui/rich-text-editor";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toast";
import { Demo, GallerySection } from "./section";

const VARIABLES = [
  { key: "event_name", label: "Event name" },
  { key: "invitee_full_name", label: "Invitee full name" },
  { key: "event_date", label: "Event date" },
  { key: "event_time", label: "Event time" },
];

export function InputsSection() {
  const [phone, setPhone] = useState<string | null>("+14155550132");
  const [rich, setRich] = useState<RichTextValue>({
    html: '<p>Hi <span data-variable="invitee_full_name" class="variable">{{invitee_full_name}}</span>, thanks for booking <strong>{{event_name}}</strong>.</p>',
    text: "",
  });
  const [guests, setGuests] = useState<string[]>(["ana@example.com"]);
  const [color, setColor] = useState("#8247f5");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  return (
    <GallerySection id="inputs" title="Rich inputs" description="Phone numbers in E.164, rich text with variable chips, email chips, colors and image uploads.">
      <div className="grid gap-6 lg:grid-cols-2">
        <FormField label="Phone number" hint={`E.164 value: ${phone ?? "incomplete"}`}>
          {(control) => <PhoneInput id={control.id} aria-describedby={control["aria-describedby"]} value={phone} onChange={setPhone} />}
        </FormField>
        <FormField label="Guest emails" hint="Comma, space or Enter separated (up to 10).">
          {(control) => (
            <ChipsInput id={control.id} aria-describedby={control["aria-describedby"]} value={guests} onChange={setGuests} validate={validateEmailChip} max={10} lowercase placeholder="Add guest emails" />
          )}
        </FormField>
        <div className="flex flex-col gap-2 lg:col-span-2">
          <span id="rte-label" className="text-label">
            Email body (RichTextEditor)
          </span>
          <RichTextEditor aria-labelledby="rte-label" value={rich.html} onChange={setRich} variables={VARIABLES} maxLength={500} placeholder="Write a message" />
          <details className="text-body-sm text-ink-2">
            <summary className="cursor-pointer font-semibold">Output</summary>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-input)] bg-cloud p-3 whitespace-pre-wrap">{rich.html}</pre>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-input)] bg-cloud p-3 whitespace-pre-wrap">{rich.text}</pre>
          </details>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-label">Event color (ColorPicker)</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-label">Uploads (FileUpload)</span>
          <FileUpload
            label="Upload picture"
            hint="JPG, PNG, GIF or WebP. Max 5 MB. Cropped to a square."
            value={avatar}
            outputSize={256}
            onFile={(file) => {
              setAvatar(URL.createObjectURL(file));
              toast.success("Picture updated", { description: `${file.name}, ${Math.round(file.size / 1024)} KB` });
            }}
            onRemove={() => setAvatar(null)}
          />
          <FileUpload
            label="Upload logo"
            crop="free"
            hint="Free crop, resized to 800px at most."
            value={logo}
            outputSize={800}
            onFile={(file) => setLogo(URL.createObjectURL(file))}
            onRemove={() => setLogo(null)}
          />
        </div>
      </div>
      <Demo label="Search and copy">
        <SearchInput className="max-w-sm" placeholder="Search event types" aria-label="Search event types" value={search} onValueChange={setSearch} />
        <CopyButton value="https://kairos.example/julianjoseph/30min" />
        <CopyButton value="https://kairos.example/julianjoseph" iconOnly label="Copy link to landing page" size="sm" />
      </Demo>
    </GallerySection>
  );
}
