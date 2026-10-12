// OWNER: foundation-ui.
//
// Pure helpers of ChipsInput (server and client safe): splitting typed or pasted text on commas, semicolons, spaces
// and new lines, de-duplicating (case-insensitive) and validating each value.

export const CHIP_SEPARATORS = /[\s,;]+/;

export type ChipsParseResult = {
  /** The new full list (existing values plus accepted new ones, in order). */
  values: string[];
  /** Values that were accepted from the input. */
  added: string[];
  /** The first rejected value and its message (the draft keeps the rejected text). */
  error: { value: string; message: string } | null;
  /** Text left in the input (rejected values and anything after them). */
  rest: string;
};

export function splitChips(raw: string): string[] {
  return raw
    .split(CHIP_SEPARATORS)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Adds the values in `raw` to `existing`. Duplicates (case-insensitive) are skipped silently; the first invalid value
 * stops processing and is returned in `error`; values beyond `max` produce "You can add up to {max}." (our choice).
 */
export function addChips(
  existing: readonly string[],
  raw: string,
  opts: { validate?: (value: string) => string | null; max?: number; normalize?: (value: string) => string } = {},
): ChipsParseResult {
  const parts = splitChips(raw);
  const values = [...existing];
  const seen = new Set(existing.map((v) => v.toLowerCase()));
  const added: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const value = opts.normalize ? opts.normalize(parts[i]!) : parts[i]!;
    if (seen.has(value.toLowerCase())) continue;
    const problem = opts.validate?.(value) ?? null;
    if (problem) return { values, added, error: { value, message: problem }, rest: parts.slice(i).join(", ") };
    if (opts.max !== undefined && values.length >= opts.max) {
      return { values, added, error: { value, message: `You can add up to ${opts.max}.` }, rest: parts.slice(i).join(", ") };
    }
    values.push(value);
    seen.add(value.toLowerCase());
    added.push(value);
  }
  return { values, added, error: null, rest: "" };
}

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

/** The common email validator for guest and invite chips ("Enter a valid email address."). */
export function validateEmailChip(value: string): string | null {
  return EMAIL.test(value) && value.length <= 254 ? null : `${value} is not a valid email address.`;
}
