// Settings > Profile form (SPEC BR-01, BR-03, BR-04; walkthrough 18 "Profile"; docs/SCOPE.md item 14): Name, Welcome
// Message (265 character counter, shown on the landing page), Date Format, Time Format and Time Zone, with "Save
// changes" and "Cancel" (back to the saved values). Validation runs in the browser with the action's schema and again
// on the server; field errors are linked to their inputs and the first invalid field gets focus. Leaving the page
// with unsaved changes (a link in the app, a reload or closing the tab) asks first. Values saved elsewhere while the
// page is open (the time zone banner) replace the fields the user has not edited, so a later save never reverts them.
"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { toast } from "@/components/ui/toast";
import { saveProfileAction } from "@/lib/settings/actions";
import {
  DATE_FORMAT_OPTIONS,
  followExternalSave,
  NAME_MAX_LENGTH,
  ProfileInput,
  TIME_FORMAT_OPTIONS,
  WELCOME_MESSAGE_MAX_LENGTH,
  type DateFormatSetting,
  type ProfileFormValues,
  type TimeFormatSetting,
} from "@/lib/settings/schemas";
import { useUnsavedChangesGuard } from "./use-unsaved-changes";

export type ProfileFormProps = { initial: ProfileFormValues };

type Errors = Partial<Record<keyof ProfileFormValues | "_form", string[]>>;

const FIELD_ORDER: (keyof ProfileFormValues)[] = ["name", "welcomeMessage", "dateFormat", "timeFormat", "timezone"];

function sameValues(a: ProfileFormValues, b: ProfileFormValues): boolean {
  return FIELD_ORDER.every((k) => a[k] === b[k]);
}

function errorsFrom(fieldErrors: Record<string, string[]> | undefined): Errors {
  const out: Errors = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const k = (FIELD_ORDER as string[]).includes(key) ? (key as keyof ProfileFormValues) : "_form";
    out[k] = [...(out[k] ?? []), ...messages];
  }
  return out;
}

export function ProfileForm({ initial }: ProfileFormProps) {
  const router = useRouter();
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    name: `${base}-name`,
    welcomeMessage: `${base}-welcome`,
    dateFormat: `${base}-date-format`,
    timeFormat: `${base}-time-format`,
    timezone: `${base}-timezone`,
  } satisfies Record<keyof ProfileFormValues, string>;
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  // A refresh after a change made elsewhere passes new initial values (adjusting state while rendering, React docs).
  const [lastInitial, setLastInitial] = useState(initial);
  if (!sameValues(lastInitial, initial)) {
    setLastInitial(initial);
    setSaved(initial);
    setValues(followExternalSave(values, saved, initial));
  }
  const dirty = !sameValues(values, saved);

  useUnsavedChangesGuard(dirty && !pending);

  const set = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const focusFirstError = (errs: Errors) => {
    const first = FIELD_ORDER.find((k) => errs[k]?.length);
    if (!first) return;
    requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ProfileInput.safeParse(values);
    if (!parsed.success) {
      const errs: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_form") as keyof Errors;
        errs[key] = [...(errs[key] ?? []), issue.message];
      }
      setErrors(errs);
      focusFirstError(errs);
      return;
    }
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof saveProfileAction>>;
      try {
        res = await saveProfileAction(parsed.data);
      } catch {
        toast.error("Couldn't save your changes. Try again.");
        return;
      }
      if (!res.ok) {
        const errs = errorsFrom(res.error.fieldErrors);
        setErrors(errs);
        focusFirstError(errs);
        if (!Object.keys(errs).some((k) => k !== "_form")) toast.error(res.error.message);
        return;
      }
      setSaved(res.data);
      setValues(res.data);
      setErrors({});
      toast.success("Changes saved");
      router.refresh();
    });
  };

  const hour12 = values.timeFormat !== "24h";

  return (
    <form ref={formRef} noValidate onSubmit={submit} aria-label="Profile" className="flex min-w-0 flex-col gap-6">
      <FormField label="Name" htmlFor={ids.name} error={errors.name} required>
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            value={values.name}
            invalid={Boolean(errors.name?.length)}
            onChange={(e) => set("name", e.target.value)}
            className="max-w-[440px]"
          />
        )}
      </FormField>

      <FormField
        label="Welcome Message"
        htmlFor={ids.welcomeMessage}
        hint="Shown on your landing page, above your event types. Leave it empty to show no message."
        error={errors.welcomeMessage}
      >
        {(control) => (
          <div className="w-full max-w-[560px]">
            <Textarea
              {...control}
              name="welcomeMessage"
              rows={4}
              showCount
              maxLength={WELCOME_MESSAGE_MAX_LENGTH}
              value={values.welcomeMessage}
              invalid={Boolean(errors.welcomeMessage?.length)}
              onChange={(e) => set("welcomeMessage", e.target.value)}
            />
          </div>
        )}
      </FormField>

      <div className="grid max-w-[560px] grid-cols-1 gap-6 sm:grid-cols-2">
        <FormField label="Date Format" htmlFor={ids.dateFormat} error={errors.dateFormat}>
          {(control) => (
            <Select
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              invalid={Boolean(errors.dateFormat?.length)}
              value={values.dateFormat}
              onValueChange={(v) => set("dateFormat", v as DateFormatSetting)}
              options={DATE_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              className="w-full"
            />
          )}
        </FormField>
        <FormField label="Time Format" htmlFor={ids.timeFormat} error={errors.timeFormat}>
          {(control) => (
            <Select
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              invalid={Boolean(errors.timeFormat?.length)}
              value={values.timeFormat}
              onValueChange={(v) => set("timeFormat", v as TimeFormatSetting)}
              options={TIME_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              className="w-full"
            />
          )}
        </FormField>
      </div>

      <FormField
        label="Time Zone"
        htmlFor={ids.timezone}
        hint="Times in the app and in your notification emails use this time zone."
        error={errors.timezone}
      >
        {(control) => (
          <TimeZoneSelect
            id={control.id}
            aria-label="Time Zone"
            aria-describedby={control["aria-describedby"]}
            value={values.timezone}
            hour12={hour12}
            onChange={(zone) => set("timezone", zone)}
            className="w-full max-w-[440px]"
          />
        )}
      </FormField>

      {errors._form?.length ? (
        <p role="alert" className="text-body-sm font-semibold text-danger-text">
          {errors._form[0]}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || pending}
          onClick={() => {
            setValues(saved);
            setErrors({});
          }}
        >
          Cancel
        </Button>
        <span aria-live="polite" className="text-body-sm text-ink-2">
          {dirty && !pending ? "You have unsaved changes." : ""}
        </span>
      </div>
    </form>
  );
}
