// "Links for" on the Scheduling page (owner request, October 16): which persona the page's public links open as. The
// landing link, "View landing page", each card's link, Copy link and Share all follow it (?for={id}, the default
// persona keeps the plain link), so the host copies the right link for, say, Friends. Shown once the host has more
// than one persona; the choice is remembered on this device. Client component.
"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

export type LinkPersona = { id: string; name: string; isDefault: boolean };

const KEY = "scheduling.linkPersona";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The chosen persona (the default one until the host picks another) and its setter. */
export function useLinkPersona(personas: LinkPersona[]): [LinkPersona | null, (id: string) => void] {
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
  const fallback = personas.find((p) => p.isDefault) ?? personas[0] ?? null;
  const chosen = personas.find((p) => p.id === stored) ?? fallback;
  const set = (id: string) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      // Private mode: the choice lasts until the page reloads.
    }
    listeners.forEach((l) => l());
  };
  return [chosen, set];
}

export function PersonaLinkPicker({ personas, value, onChange }: { personas: LinkPersona[]; value: LinkPersona | null; onChange: (id: string) => void }) {
  if (personas.length < 2) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Links for" data-testid="link-persona">
      <span className="text-body-md font-semibold text-ink-2" aria-hidden="true">
        Links for
      </span>
      {personas.map((p) => {
        const on = value?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(p.id)}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-body-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-sm:h-10",
              on ? "border-primary bg-primary-soft text-primary-text" : "border-line bg-surface text-ink hover:bg-pebble",
            )}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
