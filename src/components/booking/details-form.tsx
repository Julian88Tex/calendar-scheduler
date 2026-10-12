// The "Enter Details" form (SPEC BK-09 to BK-12, BK-14, BK-16, BK-18, VID-03, VID-06): Name (or First and Last Name),
// Email, "Add Guests" (chips, up to 10), the location choice with its phone or text input, custom questions in order,
// marketing consent, the terms sentence and "Schedule Event". Inline errors use the server's messages and keys; the
// hidden honeypot field `website` stays empty for people (BK-18). Phones get a sticky submit button (BK-30).
"use client";

import type * as React from "react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipsInput } from "@/components/ui/chips-input";
import { FieldError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { chosenLocation, isEmail, MAX_GUESTS, type FieldErrors, type FormContext, type FormValues } from "./lib/form";
import { locationInput, locationOption } from "./lib/locations";
import { bt } from "./lib/t";
import { LocationGlyph } from "./location-icon";
import { QuestionField } from "./question-field";

export type DetailsFormProps = {
  ctx: FormContext;
  values: FormValues;
  onChange: (update: (v: FormValues) => FormValues) => void;
  errors: FieldErrors;
  formError: string | null;
  submitting: boolean;
  onSubmit: () => void;
  collectMarketing: boolean;
  honeypotName: string;
  honeypotRef: React.RefObject<HTMLInputElement | null>;
  appName: string;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** BK-16: the remembered invitee name ("Not you?" clears it). */
  autofilledName: string | null;
  onNotYou: () => void;
  /** Preview mode (ET-29): the button is disabled with this note. */
  disabledNote?: string | null;
};

const TERMS = "%%terms%%";
const PRIVACY = "%%privacy%%";

/** The public pages' primary pill: every blue reads --primary-color (GEN-03). */
export const BRAND_BUTTON = "bg-brand text-white hover:bg-brand hover:brightness-90 active:bg-brand active:brightness-75";

function Req() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger-text">
      *
    </span>
  );
}

function TextField({
  id,
  label,
  required,
  error,
  hint,
  field,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  field: string;
  children: (a11y: { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined }) => React.ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={field}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
        {required && <Req />}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined })}
      {hint && (
        <p id={hintId} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

function LegalLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  const external = /^https?:\/\//.test(href);
  return (
    <a href={href} className="font-semibold text-brand-strong hover:underline" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

export function DetailsForm({ honeypotRef, ...p }: DetailsFormProps) {
  const base = `bf-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { ctx, values, errors, onChange } = p;
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => onChange((v) => ({ ...v, [key]: value }));
  const location = chosenLocation(ctx, values);
  const input = locationInput(location);
  const multiple = ctx.locations.length > 1;
  const locationErrorId = errors.location ? `${base}-location-error` : undefined;
  const termsParts = bt("details.terms", { appName: p.appName, terms: TERMS, privacy: PRIVACY }).split(/(%%terms%%|%%privacy%%)/);

  const locationValueField =
    input === "phone" ? (
      <TextField id={`${base}-location-phone`} label={bt("location.phoneLabel")} required error={errors["location.value"]} field="location.value">
        {(a) => (
          <div
            onChange={(e) => {
              const el = e.target as HTMLInputElement;
              if (el.type === "tel") onChange((v) => ({ ...v, phoneRaw: { ...v.phoneRaw, location: el.value } }));
            }}
          >
            <PhoneInput
              id={a.id}
              size="lg"
              value={values.locationValue || null}
              onChange={(e164) => set("locationValue", e164 ?? "")}
              invalid={Boolean(errors["location.value"])}
              required
              aria-describedby={a["aria-describedby"]}
              validationMessage={false}
            />
          </div>
        )}
      </TextField>
    ) : input === "text" ? (
      <TextField
        id={`${base}-location-text`}
        label={bt("location.label")}
        required
        error={errors["location.value"]}
        hint={location?.prompt ?? undefined}
        field="location.value"
      >
        {(a) => (
          <Input
            {...a}
            size="lg"
            required
            maxLength={1000}
            placeholder={bt("location.askPlaceholder")}
            value={values.locationValue}
            onChange={(e) => set("locationValue", e.target.value)}
          />
        )}
      </TextField>
    ) : null;

  return (
    <form
      noValidate
      aria-label={bt("details.title")}
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
      className="flex min-w-0 flex-col gap-5"
    >
      {p.formError && (
        <p role="alert" className="rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-[14px] font-semibold text-danger-text">
          {p.formError}
        </p>
      )}
      {p.autofilledName && (
        <p className="text-[14px] text-ink-2">
          {bt("details.autofilled", { name: p.autofilledName })}{" "}
          <button type="button" onClick={p.onNotYou} className="font-semibold text-brand-strong hover:underline">
            {bt("details.notYou")}
          </button>
        </p>
      )}

      {ctx.nameFormat === "first_last" ? (
        <div className="grid gap-5 min-[600px]:grid-cols-2">
          <TextField id={`${base}-first`} label={bt("details.firstName")} required error={errors.firstName} field="firstName">
            {(a) => <Input {...a} size="lg" required autoComplete="given-name" maxLength={300} value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />}
          </TextField>
          <TextField id={`${base}-last`} label={bt("details.lastName")} required error={errors.lastName} field="lastName">
            {(a) => <Input {...a} size="lg" required autoComplete="family-name" maxLength={300} value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />}
          </TextField>
        </div>
      ) : (
        <TextField id={`${base}-name`} label={bt("details.name")} required error={errors.name} field="name">
          {(a) => <Input {...a} size="lg" required autoComplete="name" maxLength={300} value={values.name} onChange={(e) => set("name", e.target.value)} />}
        </TextField>
      )}

      <TextField id={`${base}-email`} label={bt("details.email")} required error={errors.email} field="email">
        {(a) => (
          <Input {...a} size="lg" type="email" required autoComplete="email" inputMode="email" maxLength={320} value={values.email} onChange={(e) => set("email", e.target.value)} />
        )}
      </TextField>

      {ctx.allowGuests &&
        (values.showGuests ? (
          <TextField id={`${base}-guests`} label={bt("details.guestEmails")} error={errors.guests} hint={bt("details.guestsHint")} field="guests">
            {(a) => (
              <ChipsInput
                id={a.id}
                size="lg"
                lowercase
                max={MAX_GUESTS}
                value={values.guests}
                onChange={(g) => onChange((v) => ({ ...v, guests: g }))}
                validate={(g) => (isEmail(g) ? (g === values.email.trim().toLowerCase() ? bt("validation.guestIsInvitee") : null) : bt("validation.email"))}
                invalid={Boolean(errors.guests)}
                aria-describedby={a["aria-describedby"]}
                placeholder={bt("details.guestsPlaceholder")}
              />
            )}
          </TextField>
        ) : (
          <div data-field="guests">
            <Button type="button" variant="secondary" onClick={() => set("showGuests", true)}>
              {bt("details.addGuests")}
            </Button>
          </div>
        ))}

      {multiple && (
        <div className="flex min-w-0 flex-col gap-2" data-field="location">
          <span id={`${base}-location-legend`} className="text-label text-ink">
            {bt("location.label")}
            <Req />
          </span>
          <RadioGroup
            variant="cards"
            required
            aria-labelledby={`${base}-location-legend`}
            aria-describedby={locationErrorId}
            value={values.locationId ?? ""}
            onValueChange={(id) => onChange((v) => ({ ...v, locationId: id, locationValue: "", phoneRaw: { ...v.phoneRaw, location: "" } }))}
            options={ctx.locations.map((l) => {
              const o = locationOption(l);
              return {
                value: l.id,
                label: (
                  <span className="flex items-start gap-2">
                    <LocationGlyph icon={o.icon} className="mt-px size-4 shrink-0 text-navy" />
                    <span className="whitespace-pre-line">{o.label}</span>
                  </span>
                ),
                description: o.detail ? <span className="block pl-6 whitespace-pre-line">{o.detail}</span> : undefined,
              };
            })}
          />
          <FieldError id={locationErrorId} error={errors.location} />
        </div>
      )}
      {locationValueField}

      {ctx.questions.map((q) => (
        <QuestionField key={q.id} question={q} values={values} onChange={onChange} error={errors[`answers.${q.id}`]} />
      ))}

      {p.collectMarketing && <Checkbox label={bt("details.marketing")} checked={values.marketing} onCheckedChange={(on) => set("marketing", on)} />}

      {/* BK-18 honeypot: invisible to people and assistive technology, filled only by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`${base}-hp`}>Website</label>
        <input ref={honeypotRef} id={`${base}-hp`} type="text" name={p.honeypotName} tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <p className="text-[13px] leading-5 text-ink-2">
        {termsParts.map((part, i) =>
          part === TERMS ? (
            <LegalLink key={i} href={p.termsUrl}>
              {bt("details.termsOfUse")}
            </LegalLink>
          ) : part === PRIVACY ? (
            <LegalLink key={i} href={p.privacyUrl}>
              {bt("details.privacyNotice")}
            </LegalLink>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>

      <div className={cn("max-[599px]:sticky max-[599px]:bottom-0 max-[599px]:-mx-5 max-[599px]:border-t max-[599px]:border-line max-[599px]:bg-public-bg max-[599px]:px-5 max-[599px]:py-3")}>
        <Button type="submit" size="lg" loading={p.submitting} disabled={Boolean(p.disabledNote)} className={cn(BRAND_BUTTON, "max-[599px]:w-full")}>
          {bt("details.schedule")}
        </Button>
        {p.disabledNote && <p className="mt-2 text-[13px] text-ink-2">{p.disabledNote}</p>}
      </div>
    </form>
  );
}
