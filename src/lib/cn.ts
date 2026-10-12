// Class name helper (ARCHITECTURE section 20.2): clsx for conditionals, tailwind-merge to resolve conflicting
// Tailwind utilities ("px-2 px-4" -> "px-4"). Client and server safe.
//
// The design system defines custom font-size utilities in globals.css (text-headline-1, text-label, ...). Without
// registering them, tailwind-merge treats "text-label" as a text color and drops it when a real color such as
// "text-ink" follows, silently losing typography. They are registered as font sizes here.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export type { ClassValue };

export const FONT_SIZE_TOKENS = [
  "headline-1",
  "headline-2",
  "headline-3",
  "title-lg",
  "title-md",
  "title-sm",
  "body",
  "body-md",
  "body-sm",
  "label",
  "label-sm",
  "eyebrow",
] as const;

const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...FONT_SIZE_TOKENS] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
