// Settings > Personas: the host's personas as a row of chips (pick one to edit, "Add persona") and the picked one's
// editor: name, link name with the copyable link (the default persona's is the plain link), look (warm or classic),
// default switch, landing page words, favorites chips and the booking and confirmation lines. Empty text hides the
// line on the page (the greeting falls back to the host's name). "Save changes" and "Cancel" cover every persona.
"use client";

import { Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type * as React from "react";
import { FRIENDS_PERSONA, PERSONA_LIMITS, blankPersona, personaIdOf, type Persona } from "@/components/booking/lib/personas";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { savePersonasSettingsAction } from "@/lib/settings/actions";
import type { PersonaFormValue } from "@/lib/settings/personas";
import { useUnsavedChangesGuard } from "./use-unsaved-changes";

export type PersonasSettingsProps = {
  personas: Persona[];
  /** "{origin}/{handle}", null without a link. */
  baseUrl: string | null;
};

type TextKey = "greeting" | "note" | "signOff" | "favoritesHeading" | "chooseHeading" | "detailsIntro" | "confirmationNote";

const valuesOf = (personas: Persona[]): PersonaFormValue[] => personas.map((p) => ({ ...p, favorites: p.favorites.map((f) => ({ ...f })), originalId: p.id }));

/** A link id not used by another persona ("work", "work-2"). */
function freeId(base: string, taken: string[]): string {
  const root = personaIdOf(base) || "persona";
  let id = root;
  for (let n = 2; taken.includes(id); n++) id = `${root.slice(0, PERSONA_LIMITS.id - 3)}-${n}`;
  return id;
}

export function PersonasSettings({ personas, baseUrl }: PersonasSettingsProps) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => valuesOf(personas));
  const [list, setList] = useState(saved);
  const [current, setCurrent] = useState(() => Math.max(0, saved.findIndex((p) => p.isDefault)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  useUnsavedChangesGuard(dirty && !pending);

  const p = list[Math.min(current, list.length - 1)]!;
  const index = list.indexOf(p);
  const update = (patch: Partial<PersonaFormValue>) => setList(list.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  const text = (key: TextKey, placeholder?: string) => ({
    value: p[key],
    placeholder: placeholder ?? (p.id === FRIENDS_PERSONA.id ? FRIENDS_PERSONA[key] : ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update({ [key]: e.target.value }),
  });
  const setFavorite = (i: number, patch: Partial<{ emoji: string; label: string }>) => update({ favorites: p.favorites.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const link = baseUrl ? (p.isDefault ? baseUrl : `${baseUrl}?for=${p.id}`) : null;

  const add = () => {
    const id = freeId("New persona", list.map((x) => x.id));
    setList([...list, { ...blankPersona(id, "New persona"), originalId: null }]);
    setCurrent(list.length);
  };
  const remove = () => {
    const next = list.filter((_, i) => i !== index);
    if (p.isDefault) next[0] = { ...next[0]!, isDefault: true };
    setList(next);
    setCurrent(0);
  };
  const makeDefault = (on: boolean) => {
    if (!on) return;
    setList(list.map((x, i) => ({ ...x, isDefault: i === index })));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await savePersonasSettingsAction({ personas: list }).catch(() => null);
      if (!res || !res.ok) {
        setError(res && !res.ok ? res.error.message : "Couldn't save your changes. Try again.");
        return;
      }
      const values = valuesOf(res.data);
      setSaved(values);
      setList(values);
      setCurrent(Math.max(0, values.findIndex((x) => x.id === p.id)));
      router.refresh();
      toast.success("Changes saved");
    });
  };

  return (
    <form noValidate onSubmit={submit} aria-label="Personas" className="flex min-w-0 flex-col gap-6" data-testid="personas-settings">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your personas">
        {list.map((x, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === index}
            onClick={() => setCurrent(i)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-body-sm font-semibold transition-colors",
              i === index ? "border-primary bg-primary-soft text-primary-text" : "border-line bg-surface text-ink hover:bg-pebble",
            )}
          >
            {x.isDefault && <Star aria-label="Default" className="size-3.5 fill-current" />}
            {x.name || "Untitled"}
          </button>
        ))}
        {list.length < PERSONA_LIMITS.personas && (
          <Button type="button" variant="tertiary" size="sm" onClick={add}>
            <Plus aria-hidden="true" className="size-4" />
            Add persona
          </Button>
        )}
      </div>

      <Card padding="lg" className="flex flex-col gap-5" data-testid="persona-editor">
        <CardHeader
          title={p.name || "Untitled"}
          description="Pick which event types this persona sees, and what they're called for it, on each event type."
          actions={
            list.length > 1 && (
              <IconButton type="button" variant="ghost" aria-label={`Delete ${p.name || "persona"}`} onClick={remove}>
                <Trash2 aria-hidden="true" />
              </IconButton>
            )
          }
        />
        <FormField label="Name" hint="Only you see it.">
          {(c) => <Input {...c} value={p.name} onChange={(e) => update({ name: e.target.value })} maxLength={PERSONA_LIMITS.short} />}
        </FormField>
        <FormField label="Link name" hint={p.isDefault ? "The default persona uses your plain link." : "Changing it stops links you already shared from opening this persona."}>
          {(c) => <Input {...c} value={p.id} onChange={(e) => update({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} maxLength={PERSONA_LIMITS.id} />}
        </FormField>
        {link && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-pebble px-4 py-3">
            <a href={link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-body-md font-semibold text-primary-text hover:underline" data-testid="persona-link">
              {link}
            </a>
            <CopyButton value={link} size="sm" />
          </div>
        )}
        <FormField label="Look">
          {(c) => (
            <NativeSelect
              {...c}
              value={p.style}
              onChange={(e) => update({ style: e.target.value === "warm" ? "warm" : "classic" })}
              options={[
                { value: "classic", label: "Classic: your normal booking pages" },
                { value: "warm", label: "Warm: playful colors and friendly wording" },
              ]}
            />
          )}
        </FormField>
        <Switch label="Default persona (links without ?for= show it)" labelPosition="start" checked={p.isDefault} disabled={p.isDefault} onCheckedChange={makeDefault} />
      </Card>

      <Card padding="lg" className="flex flex-col gap-5">
        <CardHeader title="Landing page" description="Leave a field empty to leave it off the page." />
        <FormField label="Greeting" hint="Empty shows your name.">
          {(c) => <Input {...c} {...text("greeting")} maxLength={PERSONA_LIMITS.short} />}
        </FormField>
        <FormField label="Note" hint={p.style === "classic" ? "Empty shows your profile's welcome message." : undefined}>
          {(c) => <Textarea {...c} {...text("note")} rows={3} maxLength={PERSONA_LIMITS.long} showCount />}
        </FormField>
        {p.style === "warm" && (
          <>
            <FormField label="Sign-off" hint="Your first name follows it.">
              {(c) => <Input {...c} {...text("signOff")} maxLength={PERSONA_LIMITS.short} />}
            </FormField>
            <FormField label="Event list heading">{(c) => <Input {...c} {...text("chooseHeading")} maxLength={PERSONA_LIMITS.short} />}</FormField>
            <FormField label="Favorites heading">{(c) => <Input {...c} {...text("favoritesHeading")} maxLength={PERSONA_LIMITS.short} />}</FormField>
            <ul className="flex flex-col gap-2" aria-label="Favorites">
              {p.favorites.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input aria-label={`Emoji ${i + 1}`} value={f.emoji} onChange={(e) => setFavorite(i, { emoji: e.target.value })} maxLength={PERSONA_LIMITS.emoji} className="w-16 text-center" />
                  <Input aria-label={`Favorite ${i + 1}`} value={f.label} onChange={(e) => setFavorite(i, { label: e.target.value })} maxLength={PERSONA_LIMITS.short} className="min-w-0 flex-1" />
                  <IconButton type="button" variant="ghost" aria-label={`Remove ${f.label || "favorite"}`} onClick={() => update({ favorites: p.favorites.filter((_, j) => j !== i) })}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
            {p.favorites.length < PERSONA_LIMITS.favorites && (
              <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => update({ favorites: [...p.favorites, { emoji: "", label: "" }] })}>
                <Plus aria-hidden="true" className="size-4" />
                Add a favorite
              </Button>
            )}
          </>
        )}
      </Card>

      <Card padding="lg" className="flex flex-col gap-5">
        <CardHeader title="Booking and confirmation" />
        <FormField label="Line above the booking form">{(c) => <Input {...c} {...text("detailsIntro")} maxLength={PERSONA_LIMITS.medium} />}</FormField>
        <FormField label="Thank-you line on the confirmation">{(c) => <Input {...c} {...text("confirmationNote")} maxLength={PERSONA_LIMITS.medium} />}</FormField>
      </Card>

      {error && (
        <p role="alert" className="text-body-sm font-semibold text-danger-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={!dirty || pending}>
          Save changes
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || pending}
          onClick={() => {
            setList(saved);
            setCurrent(Math.max(0, saved.findIndex((x) => x.isDefault)));
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
