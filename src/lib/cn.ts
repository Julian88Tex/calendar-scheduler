// Class name helper (ARCHITECTURE section 20.2): clsx for conditionals, tailwind-merge to resolve conflicting
// Tailwind utilities ("px-2 px-4" -> "px-4"). Client and server safe.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
