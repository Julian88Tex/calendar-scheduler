"use client";

// The Look choice of a persona (Settings > Personas): one card per look, each with a small picture of what invitees
// see (page, card, text and accent colors, a time button and the Confirm button), so the host can tell Classic from Warm
// before saving. The colors are the light public tokens of globals.css (:root and [data-tone="friends"]); a radio group
// rather than a select so both previews show at once.
import { Check } from "lucide-react";
import type * as React from "react";
import type { PersonaStyle } from "@/components/booking/lib/personas";
import { cn } from "@/lib/cn";

type Look = {
  value: PersonaStyle;
  label: string;
  description: string;
  colors: {
    canvas: string;
    card: string;
    line: string;
    ink: string;
    ink2: string;
    primary: string;
    primaryText: string;
    soft: string;
  };
  radius: { card: number; slot: number };
  swatches: { name: string; color: string }[];
};

export const PERSONA_LOOKS: Look[] = [
  {
    value: "classic",
    label: "Classic",
    description:
      "Your normal booking pages and emails: white cards and your brand blue.",
    colors: {
      canvas: "#fafafa",
      card: "#ffffff",
      line: "#d4e0ed",
      ink: "#0a2540",
      ink2: "#476788",
      primary: "#006bff",
      primaryText: "#004eba",
      soft: "#f4f8ff",
    },
    radius: { card: 8, slot: 4 },
    swatches: [
      { name: "White", color: "#ffffff" },
      { name: "Navy", color: "#0a2540" },
      { name: "Blue", color: "#006bff" },
      { name: "Ice", color: "#e6f0ff" },
    ],
  },
  {
    value: "warm",
    label: "Warm",
    description:
      "Cream and terracotta, rounder cards and friendly wording on pages and emails.",
    colors: {
      canvas: "#fbf3e8",
      card: "#fffaf3",
      line: "#ecdccb",
      ink: "#3d2a1e",
      ink2: "#7a5a45",
      primary: "#b5482a",
      primaryText: "#9c3d22",
      soft: "#fbeee6",
    },
    radius: { card: 16, slot: 9999 },
    swatches: [
      { name: "Cream", color: "#fbf3e8" },
      { name: "Espresso", color: "#3d2a1e" },
      { name: "Terracotta", color: "#b5482a" },
      { name: "Peach", color: "#f7dccd" },
    ],
  },
];

function Preview({ look }: { look: Look }) {
  const c = look.colors;
  const slot: React.CSSProperties = {
    borderRadius: look.radius.slot,
    border: `1px solid ${c.primary}`,
    color: c.primaryText,
  };
  return (
    <div
      aria-hidden="true"
      className="rounded-md p-3"
      style={{ background: c.canvas }}
      data-testid={`look-preview-${look.value}`}
    >
      <div
        className="flex flex-col gap-2 p-3"
        style={{
          background: c.card,
          border: `1px solid ${c.line}`,
          borderRadius: look.radius.card,
        }}
      >
        <span className="text-body-sm font-bold" style={{ color: c.ink }}>
          Pick a time
        </span>
        <span className="text-label-sm" style={{ color: c.ink2 }}>
          Tuesday, October 20
        </span>
        <div className="flex gap-1.5">
          <span
            className="px-2.5 py-1 text-label-sm font-semibold"
            style={slot}
          >
            10:00am
          </span>
          <span
            className="px-2.5 py-1 text-label-sm font-semibold"
            style={{ ...slot, background: c.soft }}
          >
            2:30pm
          </span>
        </div>
        <span
          className="self-start rounded-full px-3 py-1 text-label-sm font-semibold text-white"
          style={{ background: c.primary }}
        >
          Confirm
        </span>
      </div>
    </div>
  );
}

export function PersonaLookPicker({
  value,
  onChange,
}: {
  value: PersonaStyle;
  onChange: (v: PersonaStyle) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-body-sm font-semibold text-ink">Look</legend>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="persona-look">
        {PERSONA_LOOKS.map((look) => {
          const selected = value === look.value;
          return (
            <label
              key={look.value}
              className={cn(
                "relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-card)] border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
                selected
                  ? "border-primary bg-primary-soft"
                  : "border-line bg-surface hover:bg-pebble",
              )}
            >
              <input
                type="radio"
                name="persona-look"
                value={look.value}
                checked={selected}
                onChange={() => onChange(look.value)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-body-md font-bold text-ink">
                  {look.label}
                </span>
                {selected && (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-on-primary">
                    <Check aria-hidden="true" className="size-3.5" />
                  </span>
                )}
              </span>
              <Preview look={look} />
              <span
                className="flex flex-wrap gap-x-3 gap-y-1"
                aria-label={`${look.label} colors`}
              >
                {look.swatches.map((s) => (
                  <span
                    key={s.name}
                    className="inline-flex items-center gap-1.5 text-label-sm text-ink-2"
                  >
                    <span
                      className="size-3.5 rounded-full border border-line"
                      style={{ background: s.color }}
                    />
                    {s.name}
                  </span>
                ))}
              </span>
              <span className="text-body-sm text-ink-2">
                {look.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
