// The "Enter Details" form (SPEC BK-09 to BK-12, BK-14, BK-16, BK-18, VID-03, VID-06; live capture
// docs/research/calendly-live-capture.md items 7 to 13, 18 and 19): Name (or First and Last Name), Email, "Add guests"
// (a blue outline pill that opens the "Guest email(s)" box, up to 10), the location choice as plain radio rows with
// its phone or text input, custom questions in order, marketing consent, the terms sentence and "Schedule Event". The
// fields sit in a 400px column with Calendly's spacing; inline errors use the server's messages and keys; the hidden
// honeypot field `website` stays empty for people (BK-18). On phones the button stays in the page flow, as on Calendly.
"use client";

import type * as React from "react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipsInput } from "@/components/ui/chips-input";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { BOOKING_FIELD, BOOKING_FIELD_BOX, BookingFieldError, BookingLegalNotice, BRAND_BUTTON, FIELD_LABEL, RequiredMark } from "./form-parts";
import { runOnLabel } from "./lib/display";
import { chosenLocation, isEmail, MAX_GUESTS, type FieldErrors, type FormContext, type FormValues } from "./lib/form";
import { locationInput, locationOption } from "./lib/locations";
import { bt } from "./lib/t";
import { LocationGlyph } from "./location-icon";
import { QuestionField } from "./question-field";

export { BRAND_BUTTON } from "./form-parts";

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
  /** BK-18: container of the Cloudflare Turnstile widget (only when the instance requires it). */
  turnstileRef?: React.RefObject<HTMLDivElement | null>;
  appName: string;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** BK-16: the remembered invitee name ("Not you?" clears it). */
  autofilledName: string | null;
  onNotYou: () => void;
  /** Preview mode (ET-29): the button is disabled with this note. */
  disabledNote?: string | null;
};

function TextField({
  id,
  label,
  required,
  error,
  hint,
  field,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  field: string;
  className?: string;
  children: (a11y: { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined }) => React.ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} data-field={field}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined })}
      {hint && (
        <p id={hintId} className="mt-[10px] text-[14px] leading-5 text-public-text">
          {hint}
        </p>
      )}
      <BookingFieldError id={errorId} error={error} />
    </div>
  );
}

export function DetailsForm({ honeypotRef, turnstileRef, ...p }: DetailsFormProps) {
  const base = `bf-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { ctx, values, errors, onChange } = p;
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => onChange((v) => ({ ...v, [key]: value }));
  const location = chosenLocation(ctx, values);
  const input = locationInput(location);
  const multiple = ctx.locations.length > 1;
  const locationErrorId = errors.location ? `${base}-location-error` : undefined;
  // BK-10: an 11th guest is refused with "You can add up to 10 guests." (the chips keep the first 10).
  const [guestLimit, setGuestLimit] = useState(false);
  const changeGuests = (g: string[]) => {
    const over = g.length > MAX_GUESTS;
    setGuestLimit(over);
    onChange((v) => ({ ...v, guests: over ? g.slice(0, MAX_GUESTS) : g }));
  };

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
            required
            maxLength={1000}
            placeholder={bt("location.askPlaceholder")}
            value={values.locationValue}
            onChange={(e) => set("locationValue", e.target.value)}
            className={BOOKING_FIELD}
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
      className="flex w-full min-w-0 flex-col gap-[26px] min-[600px]:max-w-[400px]"
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
        <div className="grid gap-[26px] min-[600px]:grid-cols-2 min-[600px]:gap-x-4">
          <TextField id={`${base}-first`} label={bt("details.firstName")} required error={errors.firstName} field="firstName">
            {(a) => <Input {...a} required autoComplete="given-name" maxLength={300} value={values.firstName} onChange={(e) => set("firstName", e.target.value)} className={BOOKING_FIELD} />}
          </TextField>
          <TextField id={`${base}-last`} label={bt("details.lastName")} required error={errors.lastName} field="lastName">
            {(a) => <Input {...a} required autoComplete="family-name" maxLength={300} value={values.lastName} onChange={(e) => set("lastName", e.target.value)} className={BOOKING_FIELD} />}
          </TextField>
        </div>
      ) : (
        <TextField id={`${base}-name`} label={bt("details.name")} required error={errors.name} field="name">
          {(a) => <Input {...a} required autoComplete="name" maxLength={300} value={values.name} onChange={(e) => set("name", e.target.value)} className={BOOKING_FIELD} />}
        </TextField>
      )}

      <TextField id={`${base}-email`} label={bt("details.email")} required error={errors.email} field="email">
        {(a) => (
          <Input {...a} type="email" required autoComplete="email" inputMode="email" maxLength={320} value={values.email} onChange={(e) => set("email", e.target.value)} className={BOOKING_FIELD} />
        )}
      </TextField>

      {ctx.allowGuests &&
        (values.showGuests ? (
          <TextField
            id={`${base}-guests`}
            label={bt("details.guestEmails")}
            error={errors.guests ?? (guestLimit ? bt("validation.tooManyGuests") : undefined)}
            hint={bt("details.guestsHint")}
            field="guests"
          >
            {(a) => (
              <ChipsInput
                id={a.id}
                lowercase
                value={values.guests}
                onChange={changeGuests}
                validate={(g) => (isEmail(g) ? (g === values.email.trim().toLowerCase() ? bt("validation.guestIsInvitee") : null) : bt("validation.email"))}
                invalid={Boolean(errors.guests) || guestLimit}
                aria-describedby={a["aria-describedby"]}
                boxClassName={cn(BOOKING_FIELD_BOX, "min-h-[84px] content-start items-start")}
              />
            )}
          </TextField>
        ) : (
          // 14px under the email field and 23px above the next label, as captured.
          <div data-field="guests" className="-mt-3 -mb-[3px]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                set("showGuests", true);
                // The button goes away: keep keyboard focus in the form, on the new guests input (GEN-05).
                window.setTimeout(() => document.getElementById(`${base}-guests`)?.focus(), 0);
              }}
              className="border-brand bg-public-bg text-brand-strong hover:bg-brand-soft active:bg-brand-hover max-[599px]:w-full"
            >
              {bt("details.addGuests")}
            </Button>
          </div>
        ))}

      {multiple && (
        <div className="flex min-w-0 flex-col gap-0.5" data-field="location">
          <span id={`${base}-location-legend`} className={FIELD_LABEL}>
            {bt("location.label")}
            <RequiredMark />
          </span>
          <RadioGroup
            variant="list"
            required
            aria-labelledby={`${base}-location-legend`}
            aria-describedby={locationErrorId}
            value={values.locationId ?? ""}
            onValueChange={(id) => onChange((v) => ({ ...v, locationId: id, locationValue: "", phoneRaw: { ...v.phoneRaw, location: "" } }))}
            options={ctx.locations.map((l) => {
              const o = locationOption(l);
              // Venue names only: like Calendly, the radio list shows no address before booking.
              return {
                value: l.id,
                label: (
                  <span className="flex items-start gap-2.5">
                    <LocationGlyph icon={o.icon} className="mt-[6px] size-[14px] shrink-0 text-navy" />
                    <span>{runOnLabel(o.label)}</span>
                  </span>
                ),
              };
            })}
          />
          <BookingFieldError id={locationErrorId} error={errors.location} />
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

      <div className="flex flex-col gap-5">
        <BookingLegalNotice appName={p.appName} termsUrl={p.termsUrl} privacyUrl={p.privacyUrl} />

        {/* Empty unless Cloudflare asks for a click ("interaction-only"). */}
        {turnstileRef && <div ref={turnstileRef} data-testid="turnstile" className="empty:hidden" />}

        <div>
          <Button type="submit" loading={p.submitting} disabled={Boolean(p.disabledNote)} className={cn(BRAND_BUTTON, "max-[599px]:w-full max-[599px]:text-[16px]")}>
            {bt("details.schedule")}
          </Button>
          {p.disabledNote && <p className="mt-2 text-[13px] text-ink-2">{p.disabledNote}</p>}
        </div>
      </div>
    </form>
  );
}
