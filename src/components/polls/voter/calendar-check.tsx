// "Check my calendar" on the voter page (SPEC MP-13; research B5.7): Google Calendar (OAuth free/busy, the token is
// used once on the server and discarded; the result comes back on ?calendar=checked), the signed-in user's connected
// calendars, or a pasted ICS link. Options then show "Conflict" or "Free" and "Mark all free times as Yes" pre-fills
// answers. Nothing about the voter's calendar is stored server side (the result lives in a short-lived browser
// cookie). Client component.
"use client";

import { CalendarCheck2 } from "lucide-react";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { ProviderLogo } from "@/components/ui/provider-logo";
import type { VoterCalendarCheck } from "@/lib/polls/types";
import { relativeTime } from "../lib/format";
import { pt } from "../lib/t";
import { checkCalendar, clearCalendarCheck } from "./api";

export type CalendarCheckProps = {
  slug: string;
  embed: boolean;
  googleStartPath: string | null;
  account: boolean;
  check: VoterCalendarCheck | null;
  now: number;
  onChange: (check: VoterCalendarCheck | null) => void;
  /** Saves unsent answers before the OAuth round trip leaves the page. */
  onBeforeNavigate: () => void;
  onMarkFree: (() => void) | null;
};

function sourceLabel(source: VoterCalendarCheck["source"]): string {
  return source === "google" ? pt("voter.sourceGoogle") : source === "microsoft" ? pt("voter.sourceMicrosoft") : source === "ics" ? pt("voter.sourceIcs") : pt("voter.sourceAccount");
}

export function CalendarCheck(p: CalendarCheckProps) {
  const [open, setOpen] = useState(false);
  const [ics, setIcs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ics" | "account" | "clear" | null>(null);

  const run = async (kind: "ics" | "account") => {
    setError(null);
    if (kind === "ics" && !/^(https?|webcal):\/\//i.test(ics.trim())) {
      setError(pt("voter.icsHelp"));
      return;
    }
    setBusy(kind);
    try {
      const res = await checkCalendar(p.slug, kind === "ics" ? { icsUrl: ics.trim().replace(/^webcal:/i, "https:"), embed: p.embed } : { source: "account", embed: p.embed });
      if (!res.ok) {
        setError(res.fieldErrors?.icsUrl?.[0] ?? res.message);
        return;
      }
      p.onChange(res.check);
      setOpen(false);
      setIcs("");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      await clearCalendarCheck(p.slug, p.embed);
      p.onChange(null);
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("ics");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        aria-label={pt("voter.checkCalendar")}
        className="w-[min(340px,calc(100vw-32px))]"
        trigger={
          <Button type="button" variant="secondary" size="sm" leftIcon={<CalendarCheck2 aria-hidden="true" className="size-4" />}>
            {pt("voter.checkCalendar")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-body-md text-ink-2">{pt("voter.checkCalendarHint")}</p>
          {p.googleStartPath && (
            <Button
              type="button"
              variant="secondary"
              fullWidth
              leftIcon={<ProviderLogo provider="google" size={18} />}
              onClick={() => {
                p.onBeforeNavigate();
                window.location.assign(p.googleStartPath!);
              }}
            >
              {pt("voter.checkWithGoogle")}
            </Button>
          )}
          {p.account && (
            <Button type="button" variant="secondary" fullWidth loading={busy === "account"} onClick={() => void run("account")}>
              {pt("voter.checkWithAccount")}
            </Button>
          )}
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 border-t border-line pt-3">
            <FormField label={pt("voter.pasteIcs")} hint={pt("voter.icsHelp")} error={error}>
              {(control) => (
                <Input {...control} type="url" inputMode="url" value={ics} placeholder={pt("voter.icsPlaceholder")} onChange={(e) => setIcs(e.target.value)} invalid={Boolean(error)} />
              )}
            </FormField>
            <div>
              <Button type="submit" size="sm" loading={busy === "ics"}>
                {pt("voter.check")}
              </Button>
            </div>
          </form>
        </div>
      </Popover>
      {p.check && (
        <p className="flex flex-wrap items-center gap-x-2 text-body-sm text-ink-2" role="status">
          <span>{pt("voter.checkedVia", { source: sourceLabel(p.check.source), relative: relativeTime(p.check.checkedAt, p.now) })}</span>
          {p.onMarkFree && (
            <button type="button" onClick={p.onMarkFree} className="font-semibold text-brand-strong hover:underline">
              {pt("voter.markFreeAsYes")}
            </button>
          )}
          <button type="button" onClick={() => void clear()} disabled={busy === "clear"} className="font-semibold text-brand-strong hover:underline">
            {pt("voter.clearCheck")}
          </button>
        </p>
      )}
    </div>
  );
}
