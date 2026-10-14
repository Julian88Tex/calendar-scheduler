// Step 2 of the poll wizard, "Meeting details" (SPEC MP-03, MP-04, MP-27; research B3.2, B3.3): Meeting name, Location
// (one location: Google Meet or in person, the kinds docs/SCOPE.md builds; conferencing links are created when a time
// is booked), Description/Instructions, "Optional settings" (Show votes on page, Reserve times) and the collapsed
// "More settings" with the Doodle-depth options and the MP-04 defaults. Client component.
"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { LocationEditor } from "@/components/event-types/location-editor";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DatePicker } from "@/components/ui/date-picker";
import { FieldError, FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup } from "@/components/ui/radio-group";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { MAX_DESCRIPTION_LENGTH, MAX_POLL_OPTIONS, MAX_TITLE_LENGTH, MAX_VOTES_PER_OPTION_LIMIT } from "@/lib/polls/constants";
import type { LocationKind } from "@/db/types";
import { friendlyZoneName } from "@/lib/time/zones";
import { localDateOf } from "@/lib/time/luxon";
import type { DetailsState, ReminderRow, SettingsState } from "../lib/settings";
import { pt } from "../lib/t";

const POLL_LOCATION_KINDS: LocationKind[] = ["google_conference", "physical"];

export type DetailsFormProps = {
  value: DetailsState;
  onChange: (next: DetailsState) => void;
  zone: string;
  hour12: boolean;
  weekStart: 0 | 1;
  userId: string;
  optionCount: number;
  errors: Record<string, string[]>;
  /** A scheduled meeting exists: its location can't change here. */
  locationLocked: boolean;
  /** A booked poll: only the fields a booked poll may change are editable. */
  booked: boolean;
  titleRef?: React.RefObject<HTMLInputElement | null>;
};

function SettingRow({ title, hint, checked, onChange, disabled, children, testId }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: React.ReactNode; testId?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 py-3" data-testid={testId}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={`${id}-t`} className="text-label text-ink">
            {title}
          </p>
          {hint && (
            <p id={`${id}-h`} className="mt-0.5 text-body-sm text-ink-2">
              {hint}
            </p>
          )}
        </div>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-labelledby={`${id}-t`} aria-describedby={hint ? `${id}-h` : undefined} className="mt-0.5" />
      </div>
      {checked && children}
    </div>
  );
}

function first(errors: Record<string, string[]>, ...keys: string[]): string | null {
  for (const k of keys) if (errors[k]?.[0]) return errors[k]![0]!;
  return null;
}

export function DetailsForm(p: DetailsFormProps) {
  const [moreOpen, setMoreOpen] = useState(() => Object.keys(p.errors).some((k) => k !== "title" && k !== "location" && k !== "descriptionHtml"));
  const v = p.value;
  const s = v.settings;
  const set = (patch: Partial<DetailsState>) => p.onChange({ ...v, ...patch });
  const setS = (patch: Partial<SettingsState>) => p.onChange({ ...v, settings: { ...s, ...patch } });
  const today = localDateOf(new Date(), p.zone);
  const lockedForBooked = p.booked;

  const setReminder = (i: number, patch: Partial<ReminderRow>) => setS({ reminders: s.reminders.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="flex flex-col gap-5" data-testid="poll-details">
      <FormField label={pt("details.name")} required error={first(p.errors, "title")}>
        {(control) => (
          <Input
            {...control}
            ref={p.titleRef}
            value={v.title}
            maxLength={MAX_TITLE_LENGTH}
            placeholder={pt("details.namePlaceholder")}
            onChange={(e) => set({ title: e.target.value })}
            invalid={Boolean(first(p.errors, "title"))}
            data-testid="poll-title"
          />
        )}
      </FormField>

      <div className="flex flex-col gap-1.5">
        <p className="text-label text-ink">{pt("details.location")}</p>
        <LocationEditor
          value={v.location ? [v.location] : []}
          onChange={(list) => set({ location: list[0] ?? null })}
          mode="single"
          allowedKinds={POLL_LOCATION_KINDS}
          userId={p.userId}
          disabled={p.locationLocked}
          label={pt("details.location")}
          errors={p.errors.location ? { "": p.errors.location } : undefined}
        />
        <p className="text-body-sm text-ink-2">{p.locationLocked ? "The location of a scheduled meeting can't be changed here." : pt("details.locationHint")}</p>
      </div>

      <FormField label={pt("details.description")} error={first(p.errors, "descriptionHtml")}>
        {(control) => (
          <RichTextEditor
            id={control.id}
            aria-describedby={control["aria-describedby"]}
            value={v.descriptionHtml}
            onChange={(r) => set({ descriptionHtml: r.text.trim() ? r.html : "" })}
            placeholder={pt("details.descriptionPlaceholder")}
            maxLength={MAX_DESCRIPTION_LENGTH}
            minHeight={96}
            aria-label={pt("details.description")}
          />
        )}
      </FormField>

      <section aria-labelledby="poll-optional" className="flex flex-col">
        <h3 id="poll-optional" className="text-title-sm text-ink">
          {pt("details.optional")}
        </h3>
        <div className="divide-y divide-line">
          <SettingRow
            title={pt("details.showVotes")}
            hint={pt("details.showVotesHint")}
            checked={s.resultsVisibility !== "host_only"}
            onChange={(on) => setS({ resultsVisibility: on ? "everyone" : "host_only" })}
            testId="setting-show-votes"
          />
          <SettingRow title={pt("details.reserveTimes")} hint={pt("details.reserveTimesHint")} checked={s.reserveTimes} onChange={(on) => setS({ reserveTimes: on })} disabled={lockedForBooked} testId="setting-reserve" />
        </div>
      </section>

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-white px-4 py-3 text-left hover:border-line-medium" data-testid="more-settings">
            <span>
              <span className="block text-title-sm text-ink">{pt("details.more")}</span>
              <span className="block text-body-sm text-ink-2">{pt("details.moreHint")}</span>
            </span>
            <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 text-ink-2 transition-transform", moreOpen && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white px-4">
          <div className="py-3">
            <RadioGroup
              legend={<span className="text-label text-ink">{pt("details.visibility")}</span>}
              value={s.resultsVisibility}
              onValueChange={(val) => setS({ resultsVisibility: val as SettingsState["resultsVisibility"] })}
              options={[
                { value: "host_only", label: pt("details.visibilityHostOnly"), description: pt("details.visibilityHostOnlyHint") },
                { value: "counts_only", label: pt("details.visibilityCounts"), description: pt("details.visibilityCountsHint") },
                { value: "after_vote", label: pt("details.visibilityAfterVote"), description: pt("details.visibilityAfterVoteHint") },
                { value: "everyone", label: pt("details.visibilityEveryone"), description: pt("details.visibilityEveryoneHint") },
              ]}
            />
            <FieldError error={first(p.errors, "resultsVisibility")} />
          </div>
          <SettingRow title={pt("details.ifNeedBe")} hint={pt("details.ifNeedBeHint")} checked={s.allowIfNeedBe} onChange={(on) => setS({ allowIfNeedBe: on })} disabled={lockedForBooked} testId="setting-if-need-be" />
          {first(p.errors, "allowIfNeedBe") && <FieldError error={first(p.errors, "allowIfNeedBe")} />}
          <SettingRow title={pt("details.hideInvitees")} hint={pt("details.hideInviteesHint")} checked={s.hideInvitees} onChange={(on) => setS({ hideInvitees: on })} disabled={lockedForBooked} testId="setting-hide-invitees" />
          <SettingRow
            title={pt("details.requireEmail")}
            hint={pt("details.requireEmailHint")}
            checked={s.requireEmail || s.verifyEmail}
            onChange={(on) => setS({ requireEmail: on, verifyEmail: on ? s.verifyEmail : false })}
            disabled={lockedForBooked}
          />
          <SettingRow title={pt("details.verifyEmail")} hint={pt("details.verifyEmailHint")} checked={s.verifyEmail} onChange={(on) => setS({ verifyEmail: on, requireEmail: on ? true : s.requireEmail })} disabled={lockedForBooked} />
          <SettingRow title={pt("details.allowComments")} hint={pt("details.allowCommentsHint")} checked={s.allowComments} onChange={(on) => setS({ allowComments: on })} />
          <SettingRow
            title={pt("details.deadlineSet")}
            hint={pt("details.deadlineHint", { zone: friendlyZoneName(p.zone) })}
            checked={s.deadline.enabled}
            onChange={(on) => setS({ deadline: { ...s.deadline, enabled: on } })}
            disabled={lockedForBooked}
            testId="setting-deadline"
          >
            <div className="flex flex-wrap gap-2">
              <DatePicker value={s.deadline.date} onChange={(date) => setS({ deadline: { ...s.deadline, date } })} min={today} weekStart={p.weekStart} aria-label={pt("details.deadlineDate")} invalid={Boolean(first(p.errors, "deadline"))} />
              <TimeInput value={s.deadline.minutes} onChange={(minutes) => setS({ deadline: { ...s.deadline, minutes } })} hour12={p.hour12} aria-label={pt("details.deadlineTime")} className="w-[150px]" invalid={Boolean(first(p.errors, "deadline"))} />
            </div>
            <FieldError error={first(p.errors, "deadline")} />
          </SettingRow>
          <SettingRow title={pt("details.maxVotes")} hint={pt("details.maxVotesHint")} checked={s.maxVotes.enabled} onChange={(on) => setS({ maxVotes: { ...s.maxVotes, enabled: on } })} disabled={lockedForBooked}>
            <label className="flex items-center gap-2 text-body-md text-ink">
              <Input
                type="number"
                min={1}
                max={MAX_VOTES_PER_OPTION_LIMIT}
                value={String(s.maxVotes.value)}
                onChange={(e) => setS({ maxVotes: { ...s.maxVotes, value: Number(e.target.value) || 1 } })}
                className="w-24"
                aria-label={pt("details.maxVotesLabel")}
                invalid={Boolean(first(p.errors, "maxVotesPerOption"))}
              />
              {pt("details.maxVotesLabel")}
            </label>
            <FieldError error={first(p.errors, "maxVotesPerOption")} />
          </SettingRow>
          <SettingRow title={pt("details.maxChoices")} hint={pt("details.maxChoicesHint")} checked={s.maxChoices.enabled} onChange={(on) => setS({ maxChoices: { ...s.maxChoices, enabled: on } })} disabled={lockedForBooked}>
            <label className="flex items-center gap-2 text-body-md text-ink">
              <Input
                type="number"
                min={1}
                max={Math.max(1, Math.min(MAX_POLL_OPTIONS, p.optionCount))}
                value={String(s.maxChoices.value)}
                onChange={(e) => setS({ maxChoices: { ...s.maxChoices, value: Number(e.target.value) || 1 } })}
                className="w-24"
                aria-label={pt("details.maxChoicesLabel")}
                invalid={Boolean(first(p.errors, "maxChoicesPerParticipant"))}
              />
              {pt("details.maxChoicesLabel")}
            </label>
            <FieldError error={first(p.errors, "maxChoicesPerParticipant")} />
          </SettingRow>
          <div className="py-3">
            <RadioGroup
              legend={<span className="text-label text-ink">{pt("details.timeZoneMode")}</span>}
              value={s.timeZoneMode}
              onValueChange={(val) => setS({ timeZoneMode: val as SettingsState["timeZoneMode"] })}
              options={[
                { value: "auto", label: pt("details.timeZoneAuto"), description: pt("details.timeZoneAutoHint") },
                { value: "fixed", label: pt("details.timeZoneFixed", { zone: friendlyZoneName(p.zone) }), description: pt("details.timeZoneFixedHint") },
              ]}
            />
          </div>
          <div className="py-3">
            <FormField label={pt("details.notify")}>
              {(control) => (
                <Select
                  id={control.id}
                  value={s.notifyMode}
                  onValueChange={(val) => setS({ notifyMode: val as SettingsState["notifyMode"] })}
                  options={[
                    { value: "instant", label: pt("details.notifyInstant") },
                    { value: "daily_digest", label: pt("details.notifyDigest") },
                    { value: "off", label: pt("details.notifyOff") },
                  ]}
                  className="max-w-[260px]"
                />
              )}
            </FormField>
          </div>
          <div className="flex flex-col gap-2 py-3">
            <FormField label={pt("details.reminders")} hint={s.reminderMode === "smart" ? pt("details.remindersSmartHint") : undefined}>
              {(control) => (
                <Select
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  value={s.reminderMode}
                  onValueChange={(val) => setS({ reminderMode: val as SettingsState["reminderMode"] })}
                  options={[
                    { value: "smart", label: pt("details.remindersSmart") },
                    { value: "custom", label: pt("details.remindersCustom") },
                    { value: "off", label: pt("details.remindersOff") },
                  ]}
                  className="max-w-[260px]"
                />
              )}
            </FormField>
            {s.reminderMode === "custom" && (
              <div className="flex flex-col gap-2">
                {s.reminders.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input type="number" min={1} max={365} value={String(r.amount)} onChange={(e) => setReminder(i, { amount: Number(e.target.value) || 1 })} className="w-20" aria-label={pt("details.reminderAmount")} />
                    <NativeSelect
                      aria-label={pt("details.reminderUnit")}
                      value={r.unit}
                      onChange={(e) => setReminder(i, { unit: e.target.value as ReminderRow["unit"] })}
                      options={[
                        { value: "hours", label: pt("details.reminderHours") },
                        { value: "days", label: pt("details.reminderDays") },
                      ]}
                      className="w-28"
                    />
                    <NativeSelect
                      aria-label={pt("details.reminders")}
                      value={r.kind}
                      onChange={(e) => setReminder(i, { kind: e.target.value as ReminderRow["kind"] })}
                      options={[
                        { value: "after_invite", label: pt("details.reminderAfterInvite") },
                        { value: "before_deadline", label: pt("details.reminderBeforeDeadline") },
                      ]}
                      className="w-[200px]"
                    />
                    {s.reminders.length > 1 && (
                      <IconButton aria-label={pt("details.reminderRemove")} size="sm" onClick={() => setS({ reminders: s.reminders.filter((_, j) => j !== i) })}>
                        <X aria-hidden="true" />
                      </IconButton>
                    )}
                  </div>
                ))}
                {s.reminders.length < 3 ? (
                  <div>
                    <Button variant="tertiary" size="sm" leftIcon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setS({ reminders: [...s.reminders, { kind: "after_invite", amount: 2, unit: "days" }] })}>
                      {pt("details.reminderAdd")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-body-sm text-ink-2">{pt("details.remindersMax")}</p>
                )}
                <FieldError error={first(p.errors, "reminderOffsets")} />
              </div>
            )}
          </div>
          <SettingRow title={pt("details.autoBook")} hint={pt("details.autoBookHint")} checked={s.autoBook} onChange={(on) => setS({ autoBook: on })} disabled={lockedForBooked} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
