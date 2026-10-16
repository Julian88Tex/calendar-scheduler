// Confirmation page section (SPEC ET-26, BK-21): "After booking" (display the confirmation page, or redirect to an
// external site with "Pass event details to your redirected page"), the built-in "Schedule another event" link (name
// and status) and up to 5 custom links. Client component.
"use client";

import { Plus, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { LINK_NAME_MAX, MAX_CONFIRMATION_LINKS, URL_MAX } from "@/lib/event-types/constants";
import { errorOf, FieldGroup, type SectionProps } from "./fields";

export function ConfirmationSection({ draft, update, errors, disabled }: SectionProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const links = draft.confirmationLinks;
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) =>
    update({ confirmationLinks: links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  // The links only apply to the confirmation page, but a link with an error stays visible after switching to a
  // redirect so the error can be fixed (or the link removed) instead of blocking the save from a hidden field.
  const linkErrors = Object.keys(errors).some((k) => k === "scheduleAnotherLabel" || k === "confirmationLinks" || k.startsWith("confirmationLinks."));
  const showLinks = draft.afterBooking === "confirmation_page" || linkErrors;
  return (
    <div className="flex flex-col gap-7">
      <FieldGroup title="After booking">
        <RadioGroup
          aria-label="After booking"
          value={draft.afterBooking}
          disabled={disabled}
          onValueChange={(v) => update({ afterBooking: v === "redirect" ? "redirect" : "confirmation_page" })}
          options={[
            { value: "confirmation_page", label: "Display confirmation page" },
            { value: "redirect", label: "Redirect to an external site" },
          ]}
        />
        {draft.afterBooking === "redirect" && (
          <div className="flex flex-col gap-3 pl-7">
            <FormField label="Redirect URL" required error={errorOf(errors, "redirectUrl")}>
              {(c) => (
                <Input
                  {...c}
                  type="url"
                  inputMode="url"
                  value={draft.redirectUrl}
                  maxLength={URL_MAX}
                  disabled={disabled}
                  invalid={Boolean(errorOf(errors, "redirectUrl"))}
                  placeholder="https://example.com/thanks"
                  onChange={(e) => update({ redirectUrl: e.target.value })}
                />
              )}
            </FormField>
            <Checkbox
              label="Pass event details to your redirected page"
              description="Adds the invitee's name, email, the event time and answers to the URL."
              checked={draft.redirectPassDetails}
              disabled={disabled}
              onCheckedChange={(redirectPassDetails) => update({ redirectPassDetails })}
            />
          </div>
        )}
      </FieldGroup>

      {showLinks && (
        <FieldGroup title="Confirmation page links" hint="Links shown to invitees after they book.">
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body-md font-semibold text-ink">Schedule another event</span>
              <Switch
                checked={draft.scheduleAnotherEnabled}
                disabled={disabled}
                showStateLabel
                aria-label="Schedule another event link status"
                onCheckedChange={(scheduleAnotherEnabled) => update({ scheduleAnotherEnabled })}
              />
            </div>
            <FormField label="Link name" error={errorOf(errors, "scheduleAnotherLabel")}>
              {(c) => (
                <Input
                  {...c}
                  value={draft.scheduleAnotherLabel}
                  maxLength={LINK_NAME_MAX}
                  disabled={disabled}
                  invalid={Boolean(errorOf(errors, "scheduleAnotherLabel"))}
                  onChange={(e) => update({ scheduleAnotherLabel: e.target.value })}
                />
              )}
            </FormField>
          </div>
          {links.length > 0 && (
            <ul aria-label="Custom links" className="flex flex-col gap-3">
              {links.map((l, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span id={`${base}-link-${i}`} className="text-body-md font-semibold text-ink">
                      Link {i + 1}
                    </span>
                    <IconButton size="sm" aria-label={`Remove link ${i + 1}`} disabled={disabled} onClick={() => update({ confirmationLinks: links.filter((_, j) => j !== i) })}>
                      <X aria-hidden="true" className="size-4" />
                    </IconButton>
                  </div>
                  <FormField label="Link name" error={errorOf(errors, `confirmationLinks.${i}.label`)}>
                    {(c) => (
                      <Input
                        {...c}
                        value={l.label}
                        maxLength={LINK_NAME_MAX}
                        disabled={disabled}
                        invalid={Boolean(errorOf(errors, `confirmationLinks.${i}.label`))}
                        onChange={(e) => setLink(i, { label: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField label="URL" error={errorOf(errors, `confirmationLinks.${i}.url`)}>
                    {(c) => (
                      <Input
                        {...c}
                        type="url"
                        inputMode="url"
                        value={l.url}
                        maxLength={URL_MAX}
                        disabled={disabled}
                        invalid={Boolean(errorOf(errors, `confirmationLinks.${i}.url`))}
                        placeholder="https://"
                        onChange={(e) => setLink(i, { url: e.target.value })}
                      />
                    )}
                  </FormField>
                </li>
              ))}
            </ul>
          )}
          {links.length < MAX_CONFIRMATION_LINKS && (
            <Button
              variant="tertiary"
              size="sm"
              disabled={disabled}
              leftIcon={<Plus aria-hidden="true" />}
              className="self-start"
              onClick={() => update({ confirmationLinks: [...links, { label: "", url: "" }] })}
            >
              Add new link
            </Button>
          )}
          {errorOf(errors, "confirmationLinks") && <FieldError error={errorOf(errors, "confirmationLinks")} />}
        </FieldGroup>
      )}
    </div>
  );
}
