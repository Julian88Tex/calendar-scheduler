// OWNER: event-types-editor. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// LocationEditor (ARCHITECTURE section 25, SPEC VID-01..VID-06): edits LocationConfig[] for event types, one-off
// meetings, polls and the profile default location (VID-15, mode "single"). The final version offers every kind with
// its sub-options and connect prompts (conferencing.getConferencingOptions). Foundation stub: a kind select plus text
// inputs for physical, custom and phone kinds.
"use client";

import type { LocationConfig, LocationKind } from "@/db/types";
import { newId } from "@/lib/ids";
import { LOCATION_KIND_LABELS } from "./location-labels";
import { Button } from "../ui/button";
import { NativeSelect } from "../ui/native-select";

export type LocationEditorProps = {
  value: LocationConfig[];
  onChange: (value: LocationConfig[]) => void;
  /** "single": at most one location (profile default, polls). */
  mode: "multiple" | "single";
  /** Restrict the offered kinds (default: all). */
  allowedKinds?: LocationKind[];
  /** The user whose conferencing connections decide availability (connect prompts). */
  userId: string;
  disabled?: boolean;
};

const TEXT_KINDS: Partial<Record<LocationKind, string>> = {
  physical: "Address",
  custom: "Location",
  ask_invitee: "Prompt for the invitee",
};

export function LocationEditor({ value, onChange, mode, allowedKinds, userId: _userId, disabled }: LocationEditorProps) {
  const kinds = allowedKinds ?? (Object.keys(LOCATION_KIND_LABELS) as LocationKind[]);
  const update = (i: number, patch: Partial<LocationConfig>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i).map((l, j) => ({ ...l, position: j })));
  const canAdd = !disabled && (mode === "multiple" || value.length === 0);
  return (
    <div className="flex flex-col gap-3">
      {value.map((loc, i) => (
        <fieldset key={loc.id} className="flex flex-col gap-2 rounded border border-line p-3" disabled={disabled}>
          <legend className="sr-only">Location {i + 1}</legend>
          <NativeSelect
            aria-label="Location type"
            value={loc.kind}
            onChange={(e) => update(i, { kind: e.target.value as LocationKind })}
            options={kinds.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] }))}
          />
          {TEXT_KINDS[loc.kind] && (
            <input
              aria-label={TEXT_KINDS[loc.kind]}
              value={loc.location ?? ""}
              onChange={(e) => update(i, { location: e.target.value })}
              className="h-10 rounded border border-line px-3"
            />
          )}
          {loc.kind === "inbound_call" && (
            <input
              aria-label="Your phone number"
              type="tel"
              value={loc.phoneNumber ?? ""}
              onChange={(e) => update(i, { phoneNumber: e.target.value })}
              className="h-10 rounded border border-line px-3"
            />
          )}
          <Button variant="tertiary" size="sm" onClick={() => remove(i)}>
            Remove
          </Button>
        </fieldset>
      ))}
      {canAdd && (
        <Button variant="secondary" size="sm" onClick={() => onChange([...value, { id: newId(), kind: kinds[0] ?? "physical", position: value.length }])}>
          Add a location
        </Button>
      )}
    </div>
  );
}
