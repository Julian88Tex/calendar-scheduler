// Personas section (lib/personas.ts in the booking components): which of the owner's personas see this event type on
// their landing page, and the name and description it has for each (empty keeps the real ones). Personas themselves are
// set up in Settings > Personas. Personal event types only. Client component.
"use client";

import Link from "next/link";
import { personaUrl, type Persona } from "@/components/booking/lib/personas";
import { PERSONA_LIMITS } from "@/components/booking/lib/persona-limits";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { htmlSummary } from "@/lib/event-types/draft";
import { errorOf, type SectionProps } from "./fields";

export function PersonasSection({ draft, update, errors, disabled, personas, publicUrl }: SectionProps & { personas: Persona[]; publicUrl?: string | null }) {
  const current = draft.personas ?? {};
  const realDescription = htmlSummary(draft.descriptionHtml) || "Short description";
  const set = (id: string, copy: { name: string; description: string } | null) => {
    const next = { ...current };
    if (copy) next[id] = copy;
    else delete next[id];
    update({ personas: next });
  };
  return (
    <div className="flex flex-col gap-5" data-testid="personas-section">
      <p className="text-body-sm text-ink-2">
        Choose who sees this event type, and what it&apos;s called for them. Emails and your calendar keep the real name.{" "}
        <Link href="/app/settings/personas" className="font-semibold text-primary-text hover:underline">
          Manage personas
        </Link>
      </p>
      {personas.map((p) => {
        const copy = current[p.id];
        return (
          <fieldset key={p.id} className="flex min-w-0 flex-col gap-2 border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
            <legend className="sr-only">{p.name}</legend>
            <Checkbox
              label={p.isDefault ? `${p.name} (default)` : p.name}
              checked={Boolean(copy)}
              disabled={disabled}
              onCheckedChange={(on) => set(p.id, on ? (copy ?? { name: "", description: "" }) : null)}
            />
            {copy && (
              <div className="flex flex-col gap-2 pl-7">
                <Input
                  aria-label={`Name for ${p.name}`}
                  placeholder={draft.name || "Event name"}
                  value={copy.name}
                  disabled={disabled}
                  maxLength={PERSONA_LIMITS.short}
                  invalid={Boolean(errorOf(errors, `personas.${p.id}.name`))}
                  onChange={(e) => set(p.id, { ...copy, name: e.target.value })}
                />
                <Input
                  aria-label={`Description for ${p.name}`}
                  placeholder={realDescription}
                  value={copy.description}
                  disabled={disabled}
                  maxLength={PERSONA_LIMITS.medium}
                  invalid={Boolean(errorOf(errors, `personas.${p.id}.description`))}
                  onChange={(e) => set(p.id, { ...copy, description: e.target.value })}
                />
                {publicUrl && (
                  <div className="flex min-w-0 items-center gap-2" data-testid={`persona-event-link-${p.id}`}>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-ink-2">{personaUrl(publicUrl, p)}</span>
                    <CopyButton value={personaUrl(publicUrl, p)} size="sm" label={`Copy link for ${p.name}`} />
                  </div>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

/** "Business, Friends" or "Hidden from every persona". */
export function personasSummary(draft: SectionProps["draft"], personas: Persona[]): string {
  const on = personas.filter((p) => draft.personas?.[p.id]).map((p) => p.name);
  return on.length > 0 ? on.join(", ") : "Hidden from every persona";
}
