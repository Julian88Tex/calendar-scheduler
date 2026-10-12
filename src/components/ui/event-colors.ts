// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// The SPEC ET-15 event color palette (plain data: import it from Server Components, actions and services; the
// ColorPicker client component reads it too).

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
