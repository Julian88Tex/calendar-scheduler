// Settings > Friends mode: the friends link with copy, the landing page words (greeting, note, sign-off), the favorites
// chips, the headings and the details and confirmation lines, and a friendly name and blurb per event type. Empty
// text shows the default on the page (shown as the placeholder). "Save changes", "Cancel" and "Reset to defaults".
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type * as React from "react";
import { DEFAULT_FRIENDS_CONTENT, FRIENDS_LIMITS, type FriendsContent } from "@/components/booking/lib/friends-content";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { resetFriendsSettingsAction, saveFriendsSettingsAction } from "@/lib/settings/actions";
import type { FriendsSettingsValues } from "@/lib/settings/friends";
import { useUnsavedChangesGuard } from "./use-unsaved-changes";

export type FriendsSettingsProps = {
  content: FriendsContent;
  /** The user's event types for friendly names. */
  eventTypes: { slug: string; name: string; active: boolean }[];
  /** "{origin}/{handle}?friends=1", null without a link. */
  friendsUrl: string | null;
};

type TextKey = "greeting" | "note" | "signOff" | "favoritesHeading" | "chooseHeading" | "detailsIntro" | "confirmationNote";

function valuesOf(content: FriendsContent, eventTypes: FriendsSettingsProps["eventTypes"]): FriendsSettingsValues {
  return {
    greeting: content.greeting,
    note: content.note,
    signOff: content.signOff,
    favoritesHeading: content.favoritesHeading,
    favorites: content.favorites.map((f) => ({ ...f })),
    chooseHeading: content.chooseHeading,
    detailsIntro: content.detailsIntro,
    confirmationNote: content.confirmationNote,
    events: Object.fromEntries(eventTypes.map((e) => [e.slug, { name: content.events[e.slug]?.name ?? "", blurb: content.events[e.slug]?.blurb ?? "" }])),
  };
}

export function FriendsSettings({ content, eventTypes, friendsUrl }: FriendsSettingsProps) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => valuesOf(content, eventTypes));
  const [v, setV] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  useUnsavedChangesGuard(dirty && !pending);

  const text = (key: TextKey) => ({
    value: v[key],
    placeholder: DEFAULT_FRIENDS_CONTENT[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [key]: e.target.value }),
  });
  const setFavorite = (i: number, patch: Partial<{ emoji: string; label: string }>) =>
    setV({ ...v, favorites: v.favorites.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const setEvent = (slug: string, patch: Partial<{ name: string; blurb: string }>) =>
    setV({ ...v, events: { ...v.events, [slug]: { ...(v.events[slug] ?? { name: "", blurb: "" }), ...patch } } });

  const apply = (next: FriendsContent) => {
    const values = valuesOf(next, eventTypes);
    setSaved(values);
    setV(values);
    router.refresh();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveFriendsSettingsAction(v).catch(() => null);
      if (!res || !res.ok) {
        setError(res && !res.ok ? res.error.message : "Couldn't save your changes. Try again.");
        return;
      }
      apply(res.data);
      toast.success("Changes saved");
    });
  };

  const reset = () => {
    setError(null);
    startTransition(async () => {
      const res = await resetFriendsSettingsAction().catch(() => null);
      if (!res || !res.ok) {
        setError("Couldn't reset. Try again.");
        return;
      }
      apply(res.data);
      toast.success("Friends mode reset to the default words");
    });
  };

  return (
    <form noValidate onSubmit={submit} aria-label="Friends mode" className="flex min-w-0 flex-col gap-6" data-testid="friends-settings">
      {friendsUrl && (
        <Card padding="lg">
          <CardHeader title="Your friends link" description="Your normal booking link in a warmer, personal style. Friends can switch to the business style with the toggle at the top." />
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-pebble px-4 py-3">
            <a href={friendsUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-body-md font-semibold text-primary-text hover:underline">
              {friendsUrl}
            </a>
            <CopyButton value={friendsUrl} size="sm" />
          </div>
        </Card>
      )}

      <Card padding="lg" className="flex flex-col gap-5">
        <CardHeader title="Landing page" description="Leave a field empty to use the default shown in it." />
        <FormField label="Greeting">{(c) => <Input {...c} {...text("greeting")} maxLength={FRIENDS_LIMITS.short} />}</FormField>
        <FormField label="Note">{(c) => <Textarea {...c} {...text("note")} rows={3} maxLength={FRIENDS_LIMITS.long} showCount />}</FormField>
        <FormField label="Sign-off" hint="Your first name follows it.">
          {(c) => <Input {...c} {...text("signOff")} maxLength={FRIENDS_LIMITS.short} />}
        </FormField>
        <FormField label="Event list heading">{(c) => <Input {...c} {...text("chooseHeading")} maxLength={FRIENDS_LIMITS.short} />}</FormField>
      </Card>

      <Card padding="lg" className="flex flex-col gap-5">
        <CardHeader title="Favorites" description={`Shown as small chips under your note. Up to ${FRIENDS_LIMITS.favorites}; remove them all to hide the row.`} />
        <FormField label="Heading">{(c) => <Input {...c} {...text("favoritesHeading")} maxLength={FRIENDS_LIMITS.short} />}</FormField>
        <ul className="flex flex-col gap-2" aria-label="Favorites">
          {v.favorites.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input aria-label={`Emoji ${i + 1}`} value={f.emoji} onChange={(e) => setFavorite(i, { emoji: e.target.value })} maxLength={FRIENDS_LIMITS.emoji} className="w-16 text-center" />
              <Input aria-label={`Favorite ${i + 1}`} value={f.label} onChange={(e) => setFavorite(i, { label: e.target.value })} maxLength={FRIENDS_LIMITS.short} className="min-w-0 flex-1" />
              <IconButton type="button" variant="ghost" aria-label={`Remove ${f.label || "favorite"}`} onClick={() => setV({ ...v, favorites: v.favorites.filter((_, j) => j !== i) })}>
                <Trash2 aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
        {v.favorites.length < FRIENDS_LIMITS.favorites && (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setV({ ...v, favorites: [...v.favorites, { emoji: "", label: "" }] })}>
            <Plus aria-hidden="true" className="size-4" />
            Add a favorite
          </Button>
        )}
      </Card>

      {eventTypes.length > 0 && (
        <Card padding="lg" className="flex flex-col gap-5">
          <CardHeader title="Event names" description="What friends see instead of the real name and description. Emails and your calendar keep the real name." />
          {eventTypes.map((et) => (
            <fieldset key={et.slug} className="flex min-w-0 flex-col gap-2 border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
              <legend className="text-label text-ink">
                {et.name} {!et.active && <span className="text-ink-2">(off)</span>}
              </legend>
              <Input aria-label={`Friendly name for ${et.name}`} placeholder={et.name} value={v.events[et.slug]?.name ?? ""} onChange={(e) => setEvent(et.slug, { name: e.target.value })} maxLength={FRIENDS_LIMITS.short} />
              <Input aria-label={`Friendly description for ${et.name}`} placeholder="Short description" value={v.events[et.slug]?.blurb ?? ""} onChange={(e) => setEvent(et.slug, { blurb: e.target.value })} maxLength={FRIENDS_LIMITS.short * 2} />
            </fieldset>
          ))}
        </Card>
      )}

      <Card padding="lg" className="flex flex-col gap-5">
        <CardHeader title="Booking and confirmation" />
        <FormField label="Line above the booking form">{(c) => <Input {...c} {...text("detailsIntro")} maxLength={FRIENDS_LIMITS.short * 2} />}</FormField>
        <FormField label="Thank-you line on the confirmation">{(c) => <Input {...c} {...text("confirmationNote")} maxLength={FRIENDS_LIMITS.short * 2} />}</FormField>
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
        <Button type="button" variant="secondary" disabled={!dirty || pending} onClick={() => setV(saved)}>
          Cancel
        </Button>
        <Button type="button" variant="tertiary" disabled={pending} onClick={reset} className="ml-auto">
          Reset to defaults
        </Button>
      </div>
    </form>
  );
}
