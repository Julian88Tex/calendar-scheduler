// Notifications section (SPEC ET-25, NT-08, CR-05, CAL-12; docs/SCOPE.md priorities 5 and 6): the "Calendar invitation"
// or "Email confirmation" row (whichever applies; it cannot be turned off) whose Edit opens the template editor with
// the switch banner, the cancellation policy, "Include cancel and reschedule links..." and "Include invitee answers in
// notifications", then the reminder rows of the workflows module (EventTypeWorkflowsSection). Client component.
"use client";

import { CalendarCheck, Mail, MoreVertical, Pencil } from "lucide-react";
import { useId, useRef, useState } from "react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldError, FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Textarea } from "@/components/ui/textarea";
import { EventTypeWorkflowsSection } from "@/components/workflows/event-type-workflows-section";
import type { NotificationTemplates } from "@/db/types";
import { CANCELLATION_POLICY_MAX, TEMPLATE_TITLE_MAX } from "@/lib/event-types/constants";
import type { EventTypeDraft } from "@/lib/event-types/types";
import { TEMPLATE_VARIABLES } from "@/lib/template";
import type { EventTypeRemindersView } from "@/lib/workflows/types";
import { errorOf, type SectionProps } from "./fields";

/** NT-08 defaults ("Reset to default" restores them; values equal to the default are stored as "use the default"). */
export const TEMPLATE_DEFAULTS = {
  hostEventTitle: "{{invitee_full_name}} and {{my_name}}",
  inviteeEventTitle: "{{event_name}} with {{my_name}}",
  confirmationSubject: "Confirmed: {{event_name}} with {{my_name}} on {{event_date}}",
} as const;

const VARIABLES = TEMPLATE_VARIABLES.filter((v) => !v.smsOnly && v.key !== "reconfirm_url").map((v) => ({ key: v.key, label: v.label }));

export type NotificationMode = "calendar_invitation" | "email_confirmation";

/** The CAL-12 mode new bookings get with these settings. */
export function effectiveMode(type: EventTypeDraft["notificationType"], invitationsAvailable: boolean, kind: "solo" | "group"): NotificationMode {
  if (kind === "group" || type === "email_confirmation" || !invitationsAvailable) return "email_confirmation";
  return "calendar_invitation";
}

/** Drops template values equal to their default (NT-08 "Reset to default"). */
export function cleanTemplates(t: NotificationTemplates): NotificationTemplates {
  const out: NotificationTemplates = {};
  for (const [k, v] of Object.entries(t) as [keyof NotificationTemplates, string | undefined][]) {
    const value = v?.trim();
    if (!value) continue;
    if ((TEMPLATE_DEFAULTS as Record<string, string>)[k] === value) continue;
    out[k] = value;
  }
  return out;
}

function VariableInput({
  label,
  value,
  onChange,
  defaultValue,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
  error?: string | null;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`.slice(0, TEMPLATE_TITLE_MAX);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + token.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <FormField label={label} error={error}>
      {(c) => (
        <div className="flex flex-col gap-1.5">
          <Input {...c} ref={ref} value={value} maxLength={TEMPLATE_TITLE_MAX} invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="tertiary" size="sm">
                  + Variables
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                {VARIABLES.map((v) => (
                  <DropdownMenuItem key={v.key} onSelect={() => insert(v.key)}>
                    {v.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {value.trim() !== defaultValue && (
              <Button variant="tertiary" size="sm" onClick={() => onChange(defaultValue)}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </FormField>
  );
}

type DialogDraft = Pick<
  EventTypeDraft,
  "notificationType" | "notificationTemplates" | "includeCancelRescheduleLinks" | "includeAnswersInNotifications" | "cancellationPolicy"
>;

function NotificationDialog({
  initial,
  invitationsAvailable,
  kind,
  onCancel,
  onApply,
}: {
  initial: DialogDraft;
  invitationsAvailable: boolean;
  kind: "solo" | "group";
  onCancel: () => void;
  onApply: (d: DialogDraft) => void;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [d, setD] = useState<DialogDraft>(() => ({
    ...initial,
    notificationTemplates: {
      ...initial.notificationTemplates,
      hostEventTitle: initial.notificationTemplates.hostEventTitle ?? TEMPLATE_DEFAULTS.hostEventTitle,
      inviteeEventTitle: initial.notificationTemplates.inviteeEventTitle ?? TEMPLATE_DEFAULTS.inviteeEventTitle,
      confirmationSubject: initial.notificationTemplates.confirmationSubject ?? TEMPLATE_DEFAULTS.confirmationSubject,
    },
  }));
  const [error, setError] = useState<string | null>(null);
  const mode = effectiveMode(d.notificationType, invitationsAvailable, kind);
  const t = d.notificationTemplates;
  const setT = (patch: Partial<NotificationTemplates>) => setD({ ...d, notificationTemplates: { ...t, ...patch } });
  const canSwitchToInvitation = invitationsAvailable && kind !== "group";

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (d.cancellationPolicy.length > CANCELLATION_POLICY_MAX) {
      setError(`Use ${CANCELLATION_POLICY_MAX.toLocaleString("en-US")} characters or fewer.`);
      return;
    }
    onApply({ ...d, cancellationPolicy: d.cancellationPolicy.trim(), notificationTemplates: cleanTemplates(t) });
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && onCancel()}
      title={mode === "calendar_invitation" ? "Calendar invitation" : "Email confirmation"}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={`${base}-form`}>
            Save and close
          </Button>
        </>
      }
    >
      <form id={`${base}-form`} onSubmit={submit} noValidate className="flex flex-col gap-6">
        {mode === "calendar_invitation" ? (
          <Banner
            variant="info"
            title="Invitees receive a calendar invitation"
            action={
              <Button variant="secondary" size="sm" onClick={() => setD({ ...d, notificationType: "email_confirmation" })}>
                Switch to email confirmation
              </Button>
            }
          >
            Your connected calendar sends the invitation, so the meeting appears on the invitee&apos;s calendar right away.
          </Banner>
        ) : (
          <Banner
            variant="info"
            title="Invitees receive an email confirmation"
            action={
              <Button variant="secondary" size="sm" disabled={!canSwitchToInvitation} onClick={() => setD({ ...d, notificationType: "auto" })}>
                Switch to calendar invitation
              </Button>
            }
          >
            {canSwitchToInvitation
              ? "The confirmation email includes a calendar file invitees can add to their calendar."
              : kind === "group"
                ? "Group events always use email confirmations."
                : "Calendar invitations need a connected Google Calendar chosen as the calendar to add events to."}
          </Banner>
        )}

        {mode === "calendar_invitation" ? (
          <>
            <VariableInput
              label="Event title (host calendar)"
              value={t.hostEventTitle ?? ""}
              onChange={(hostEventTitle) => setT({ hostEventTitle })}
              defaultValue={TEMPLATE_DEFAULTS.hostEventTitle}
            />
            <VariableInput
              label="Event title (invitee calendar)"
              value={t.inviteeEventTitle ?? ""}
              onChange={(inviteeEventTitle) => setT({ inviteeEventTitle })}
              defaultValue={TEMPLATE_DEFAULTS.inviteeEventTitle}
            />
            <FormField label="Description" hint="Leave empty to use the default description with the meeting details.">
              {(c) => (
                <div className="flex flex-col gap-1.5">
                  <RichTextEditor
                    id={c.id}
                    aria-describedby={c["aria-describedby"]}
                    value={t.invitationDescription ?? ""}
                    onChange={({ html, text }) => setT({ invitationDescription: text.trim() ? html : "" })}
                    variables={VARIABLES}
                    minHeight={120}
                  />
                  {t.invitationDescription && (
                    <Button variant="tertiary" size="sm" className="self-start" onClick={() => setT({ invitationDescription: "" })}>
                      Reset to default
                    </Button>
                  )}
                </div>
              )}
            </FormField>
          </>
        ) : (
          <>
            <VariableInput
              label="Email subject"
              value={t.confirmationSubject ?? ""}
              onChange={(confirmationSubject) => setT({ confirmationSubject })}
              defaultValue={TEMPLATE_DEFAULTS.confirmationSubject}
            />
            <FormField label="Email body" hint="Leave empty to use the default confirmation with the meeting details.">
              {(c) => (
                <div className="flex flex-col gap-1.5">
                  <RichTextEditor
                    id={c.id}
                    aria-describedby={c["aria-describedby"]}
                    value={t.confirmationBody ?? ""}
                    onChange={({ html, text }) => setT({ confirmationBody: text.trim() ? html : "" })}
                    variables={VARIABLES}
                    minHeight={140}
                  />
                  {t.confirmationBody && (
                    <Button variant="tertiary" size="sm" className="self-start" onClick={() => setT({ confirmationBody: "" })}>
                      Reset to default
                    </Button>
                  )}
                </div>
              )}
            </FormField>
          </>
        )}

        <FormField label="Cancellation policy" hint="Shown on the cancel and reschedule pages and in confirmation emails." error={error}>
          {(c) => (
            <Textarea
              {...c}
              rows={3}
              autoResize
              showCount
              maxLength={CANCELLATION_POLICY_MAX}
              value={d.cancellationPolicy}
              invalid={Boolean(error)}
              placeholder="For example: Please cancel or reschedule at least 24 hours in advance."
              onChange={(e) => {
                setD({ ...d, cancellationPolicy: e.target.value });
                setError(null);
              }}
            />
          )}
        </FormField>
        <div className="flex flex-col gap-3">
          <Checkbox
            label="Include cancel and reschedule links in email invitations and reminders (recommended)"
            checked={d.includeCancelRescheduleLinks}
            onCheckedChange={(includeCancelRescheduleLinks) => setD({ ...d, includeCancelRescheduleLinks })}
          />
          <Checkbox
            label="Include invitee answers in notifications"
            checked={d.includeAnswersInNotifications}
            onCheckedChange={(includeAnswersInNotifications) => setD({ ...d, includeAnswersInNotifications })}
          />
        </div>
      </form>
    </Dialog>
  );
}

export function NotificationsSection({
  draft,
  update,
  errors,
  disabled,
  eventTypeId,
  invitationsAvailable,
  kind,
  remindersInitial,
}: SectionProps & {
  eventTypeId: string | null;
  invitationsAvailable: boolean;
  kind: "solo" | "group";
  remindersInitial: EventTypeRemindersView | null;
}) {
  const [open, setOpen] = useState(false);
  const mode = effectiveMode(draft.notificationType, invitationsAvailable, kind);
  const title = mode === "calendar_invitation" ? "Calendar invitation" : "Email confirmation";
  const description =
    mode === "calendar_invitation"
      ? "Invitees get a calendar invitation when they book."
      : "Invitees get an email confirmation with a calendar file when they book.";
  const notificationError = errorOf(errors, "notificationTemplates", true) ?? errorOf(errors, "cancellationPolicy");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5">
        <span className="mt-0.5 inline-flex shrink-0 text-primary-text [&_svg]:size-5">
          {mode === "calendar_invitation" ? <CalendarCheck aria-hidden="true" /> : <Mail aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="text-left text-title-sm text-ink hover:text-primary-text hover:underline disabled:pointer-events-none">
            {title}
          </button>
          <p className="text-body-md text-ink-2">{description}</p>
          {draft.cancellationPolicy && <p className="mt-0.5 text-body-sm text-ink-2">Cancellation policy added</p>}
          {!draft.includeCancelRescheduleLinks && <p className="mt-0.5 text-body-sm text-warning-text">Cancel and reschedule links are not included.</p>}
        </div>
        <span className="mt-0.5 shrink-0 text-body-sm font-semibold text-success-text">On</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`${title} options`} disabled={disabled} className="-mt-1">
              <MoreVertical aria-hidden="true" className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem icon={<Pencil aria-hidden="true" className="size-4" />} onSelect={() => setOpen(true)}>
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {notificationError && <FieldError error={notificationError} />}
      <EventTypeWorkflowsSection eventTypeId={eventTypeId} canEdit={!disabled} initial={remindersInitial} />
      {open && (
        <NotificationDialog
          initial={{
            notificationType: draft.notificationType,
            notificationTemplates: draft.notificationTemplates,
            includeCancelRescheduleLinks: draft.includeCancelRescheduleLinks,
            includeAnswersInNotifications: draft.includeAnswersInNotifications,
            cancellationPolicy: draft.cancellationPolicy,
          }}
          invitationsAvailable={invitationsAvailable}
          kind={kind}
          onCancel={() => setOpen(false)}
          onApply={(d) => {
            update(d);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
