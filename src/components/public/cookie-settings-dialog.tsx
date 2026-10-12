// OWNER: foundation-ui.
//
// CookieSettingsDialog (ARCHITECTURE 20.2, SPEC GEN-14): categories "Strictly necessary" (always on), "Analytics" and
// "Marketing" with switches, and the buttons "Accept all", "Reject non-essential" and "Confirm my choices". The
// choice is stored for 365 days (cookie-consent.ts) and broadcast to the page's trackers.
"use client";

import { useState } from "react";
import type * as React from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { readCookieCategories, writeCookieConsent, type CookieCategories } from "./cookie-consent";

export type CookieSettingsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function Category({ title, body, control }: { title: string; body: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-title-sm text-ink">{title}</p>
        <p className="mt-1 text-body-md text-ink-2">{body}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

export function CookieSettingsDialog({ open, onOpenChange }: CookieSettingsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cookie settings"
      description="Choose which cookies this page may use. Strictly necessary cookies keep the page working and are always on."
      size="md"
    >
      {open && <CookieSettingsBody onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function CookieSettingsBody({ onDone }: { onDone: () => void }) {
  const [choice, setChoice] = useState<CookieCategories>(() => readCookieCategories() ?? { analytics: false, marketing: false });
  const save = (c: CookieCategories) => {
    writeCookieConsent(c);
    onDone();
  };
  return (
    <div className="flex flex-col">
      <Category
        title="Strictly necessary"
        body="Required for scheduling: your session, security checks, your time format and this cookie choice."
        control={<span className="text-body-sm font-semibold text-success-text">Always on</span>}
      />
      <Category
        title="Analytics"
        body="Lets the host measure visits to this page (for example with Google Analytics)."
        control={<Switch aria-label="Analytics cookies" checked={choice.analytics} onCheckedChange={(v) => setChoice((c) => ({ ...c, analytics: v }))} showStateLabel />}
      />
      <Category
        title="Marketing"
        body="Lets the host measure bookings that come from their ads (for example with the Meta Pixel)."
        control={<Switch aria-label="Marketing cookies" checked={choice.marketing} onCheckedChange={(v) => setChoice((c) => ({ ...c, marketing: v }))} showStateLabel />}
      />
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => save({ analytics: false, marketing: false })}>
          Reject non-essential
        </Button>
        <Button variant="secondary" onClick={() => save(choice)}>
          Confirm my choices
        </Button>
        <Button onClick={() => save({ analytics: true, marketing: true })}>Accept all</Button>
      </div>
    </div>
  );
}
