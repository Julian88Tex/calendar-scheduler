// OWNER: foundation-ui.
//
// The SPEC ET-15 event color palette (plain data: import it from Server Components, actions and services; the
// ColorPicker client component reads it too), plus the custom hex validation used by the picker.

export type ColorSwatch = { name: string; value: string };

/** SPEC ET-15 palette, in order (new event types rotate through it starting with Princely plum). */
export const EVENT_COLORS: readonly ColorSwatch[] = [
  { name: "Rambunctious red", value: "#ff4f00" },
  { name: "Bubblegum pink", value: "#ff758e" },
  { name: "Proudly pink", value: "#e55cff" },
  { name: "Princely plum", value: "#8247f5" },
  { name: "Regal royal", value: "#0099ff" },
  { name: "Spritely sky", value: "#0ae8f0" },
  { name: "Loud lime", value: "#17e885" },
  { name: "Lively lemon", value: "#ccf000" },
  { name: "Yellin yellow", value: "#f8e436" },
  { name: "Outrageous orange", value: "#ffa600" },
];

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** SPEC ET-15 error copy for an invalid custom color. */
export const INVALID_COLOR_MESSAGE = "Enter a valid color like #8247F5";

/**
 * Validates a typed custom color. Accepts "#8247F5", "8247f5" and the 3-digit shorthand "#82f" (expanded), trimming
 * spaces; returns the normalized lowercase "#rrggbb" or the ET-15 error message.
 */
export function parseHexColor(input: string): { ok: true; value: string } | { ok: false; error: string } {
  let t = input.trim();
  if (!t.startsWith("#")) t = `#${t}`;
  if (/^#[0-9a-fA-F]{3}$/.test(t)) t = `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return HEX_COLOR_PATTERN.test(t) ? { ok: true, value: t.toLowerCase() } : { ok: false, error: INVALID_COLOR_MESSAGE };
}

/** The palette swatch for a color (case-insensitive), or null for custom colors. */
export function swatchFor(color: string | null | undefined): ColorSwatch | null {
  const v = (color ?? "").toLowerCase();
  return EVENT_COLORS.find((s) => s.value === v) ?? null;
}

/** The palette color at a rotation index, starting with Princely plum (ET-15 default rotation, our choice). */
export function rotatedEventColor(index: number): string {
  const start = EVENT_COLORS.findIndex((s) => s.name === "Princely plum");
  const n = EVENT_COLORS.length;
  return EVENT_COLORS[(((start + index) % n) + n) % n]!.value;
}
