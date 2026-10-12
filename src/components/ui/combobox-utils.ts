// OWNER: foundation-ui.
//
// Pure helpers of Combobox and TimeZoneSelect (server and client safe): accent and case insensitive matching where
// every word of the query must appear in the label, value, description, group or keywords.

export type MatchableOption = { value: string; label: string; description?: string; group?: string; keywords?: string[] };

/** Lowercase, strip diacritics, collapse separators ("São_Paulo" -> "sao paulo"). */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_/\-.,()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function optionMatches(option: MatchableOption, query: string): boolean {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalizeSearchText(
    [option.label, option.value, option.description ?? "", option.group ?? "", ...(option.keywords ?? [])].join(" "),
  );
  return words.every((w) => hay.includes(w));
}

export function filterOptions<T extends MatchableOption>(options: readonly T[], query: string): T[] {
  if (!query.trim()) return [...options];
  return options.filter((o) => optionMatches(o, query));
}

/** Groups options by `group`, preserving first-seen group order (options without a group come first). */
export function groupOptions<T extends { group?: string }>(options: readonly T[]): { group: string | null; options: T[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, T[]>();
  for (const o of options) {
    const key = o.group ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(o);
  }
  return order.map((group) => ({ group, options: map.get(group)! }));
}
