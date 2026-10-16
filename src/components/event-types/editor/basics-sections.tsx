// Primary editor sections: Event name and color (ET-15), Duration with up to 4 options (ET-16), Location (ET-17) and
// the Description rich text (ET-18). Client components rendered inside the editor's SectionCards.
"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { DurationSelect } from "@/components/ui/duration-select";
import { swatchFor } from "@/components/ui/event-colors";
import { FieldError, FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocationConfig } from "@/db/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";
import { DESCRIPTION_MAX, MAX_DURATIONS, MESSAGES, NAME_MAX } from "@/lib/event-types/constants";
import type { EditorConferencingOption } from "@/lib/event-types/types";
import { LocationEditor } from "../location-editor";
import { errorOf, errorsUnder, type SectionProps } from "./fields";

export function DetailsSection({ draft, update, errors, disabled }: SectionProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const swatch = swatchFor(draft.color);
  const colorName = swatch?.name ?? draft.color.toUpperCase();
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Event name" required htmlFor={`${base}-name`} error={errorOf(errors, "name")}>
        {(c) => (
          <div className="flex items-center gap-2.5">
            <Popover
              align="start"
              trigger={
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Event color: ${colorName}`}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white transition-colors hover:border-ink-2 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="size-6 rounded-full" style={{ backgroundColor: draft.color }} />
                </button>
              }
              className="w-[296px] p-4"
            >
              <p className="mb-3 text-label text-ink">Event color</p>
              <ColorPicker value={draft.color} onChange={(color) => update({ color })} disabled={disabled} />
            </Popover>
            <Input
              {...c}
              value={draft.name}
              maxLength={NAME_MAX}
              disabled={disabled}
              invalid={Boolean(errorOf(errors, "name"))}
              autoComplete="off"
              placeholder="30 Minute Meeting"
              onChange={(e) => update({ name: e.target.value })}
              className="flex-1"
            />
          </div>
        )}
      </FormField>
      {errorOf(errors, "color") && <FieldError error={errorOf(errors, "color")} />}
    </div>
  );
}

const ADD_CANDIDATES = [15, 30, 45, 60, 90, 120];

/** The next duration "+ Add duration option" proposes: the first common one not offered yet. */
export function nextDurationOption(durations: readonly number[]): number {
  const free = ADD_CANDIDATES.find((d) => !durations.includes(d));
  if (free) return free;
  const top = Math.max(...durations);
  return Math.min(720, top + 15);
}

let rowKeySeq = 0;
const nextRowKey = () => `d${++rowKeySeq}`;

export function DurationSection({ draft, update, errors, disabled, kind }: SectionProps & { kind: "solo" | "group" }) {
  const durations = draft.durations;
  const multiple = durations.length > 1;
  // Stable row keys that follow "Make default" and removals, so each DurationSelect keeps its own custom/unit state
  // (index keys would hand a custom row's state to the preset row that moved into its place).
  const [keys, setKeys] = useState<string[]>(() => durations.map(() => nextRowKey()));
  // Durations replaced from outside (a save, a reset) with another length: extend or trim the keys during render.
  if (keys.length !== durations.length) setKeys(durations.map((_, i) => keys[i] ?? nextRowKey()));
  const setAt = (i: number, minutes: number) => update({ durations: durations.map((d, j) => (j === i ? minutes : d)) });
  // ET-16: removing the default makes the next option the default (it moves to the front).
  const remove = (i: number) => {
    setKeys(keys.filter((_, j) => j !== i));
    update({ durations: durations.filter((_, j) => j !== i) });
  };
  const makeDefault = (i: number) => {
    setKeys([keys[i]!, ...keys.filter((_, j) => j !== i)]);
    update({ durations: [durations[i]!, ...durations.filter((_, j) => j !== i)] });
  };
  const add = () => {
    setKeys([...keys, nextRowKey()]);
    update({ durations: [...durations, nextDurationOption(durations)] });
  };
  const duplicates = durations.map((d, i) => durations.indexOf(d) !== i);
  const listError = errorOf(errors, "durations");
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Durations" className="flex flex-col gap-2">
        {durations.map((d, i) => {
          const rowError = duplicates[i] ? MESSAGES.durationDuplicate : errorOf(errors, `durations.${i}`);
          return (
            <li key={keys[i] ?? `row-${i}`} className="group flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <DurationSelect
                  value={d}
                  onChange={(m) => setAt(i, m)}
                  disabled={disabled}
                  aria-label={i === 0 ? "Duration" : `Duration option ${i + 1}`}
                  className="min-w-0 flex-1"
                />
                {multiple && i === 0 && (
                  <Badge variant="info" className="mt-2 shrink-0">
                    Default
                  </Badge>
                )}
                {i > 0 && (
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => makeDefault(i)}
                    className="mt-1 shrink-0 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                  >
                    Make default
                  </Button>
                )}
                {multiple && (
                  <IconButton
                    size="sm"
                    aria-label={i === 0 ? `Remove the default ${formatDuration(d)} option` : `Remove the ${formatDuration(d)} option`}
                    disabled={disabled}
                    onClick={() => remove(i)}
                    className="mt-1"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </IconButton>
                )}
              </div>
              {rowError && <FieldError error={rowError} />}
            </li>
          );
        })}
      </ul>
      {kind !== "group" && durations.length < MAX_DURATIONS && (
        <Button
          variant="tertiary"
          size="sm"
          disabled={disabled}
          leftIcon={<Plus aria-hidden="true" />}
          className="self-start"
          onClick={add}
        >
          Add duration option
        </Button>
      )}
      {multiple && <p className="text-body-sm text-ink-2">Invitees choose a duration on your booking page. The default is listed first.</p>}
      {listError && <FieldError error={listError} />}
    </div>
  );
}

export function LocationSection({
  draft,
  update,
  errors,
  disabled,
  userId,
  conferencing,
  kind,
}: SectionProps & { userId: string; conferencing: Record<string, EditorConferencingOption>; kind: "solo" | "group" }) {
  return (
    <LocationEditor
      value={draft.locations}
      onChange={(locations: LocationConfig[]) => update({ locations })}
      mode={kind === "group" ? "single" : "multiple"}
      userId={userId}
      disabled={disabled}
      conferencing={conferencing}
      errors={errorsUnder(errors, "locations")}
    />
  );
}

export function DescriptionSection({ draft, update, errors, disabled }: SectionProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const error = errorOf(errors, "descriptionHtml");
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${base}-label`} className="sr-only">
        Description
      </span>
      <RichTextEditor
        value={draft.descriptionHtml}
        onChange={({ html }) => update({ descriptionHtml: html })}
        placeholder="Write a summary and any details your invitee should know about the event."
        maxLength={DESCRIPTION_MAX}
        disabled={disabled}
        invalid={Boolean(error)}
        aria-labelledby={`${base}-label`}
        minHeight={140}
        className={cn(disabled && "opacity-80")}
      />
      {error && <FieldError error={error} />}
    </div>
  );
}
