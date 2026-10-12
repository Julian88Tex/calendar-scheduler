// OWNER: calendar-integrations.
//
// "+ Connect calendar account" modal (SPEC CAL-01, walkthrough 9.3). docs/SCOPE.md keeps Google Calendar only, so the
// modal offers one tile ("Google Calendar", "Gmail, G Suite"), which starts the connect_calendar OAuth flow. The tile
// is disabled with "Not configured on this server" when the Google OAuth client is missing, and at the account cap.
"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { googleConnectHref, ProviderTile } from "./shared";

export type ConnectCalendarDialogProps = {
  googleConfigured: boolean;
  /** Live connections (the cap blocks new ones). */
  count: number;
  maxAccounts: number;
  isAdmin: boolean;
  /** Where the OAuth flow returns. */
  next?: string;
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
};

export function ConnectCalendarDialog({ googleConfigured, count, maxAccounts, isAdmin, next, triggerLabel = "Connect calendar account", triggerVariant = "secondary" }: ConnectCalendarDialogProps) {
  const [open, setOpen] = useState(false);
  const atCap = count >= maxAccounts;
  const disabled = !googleConfigured || atCap;
  const tileClass = cn(
    "flex w-full items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white p-4 text-left transition-[border-color,box-shadow] duration-100",
    disabled ? "cursor-not-allowed opacity-70" : "hover:border-primary hover:shadow-[var(--shadow-next)] focus-visible:border-primary",
  );
  const body = (
    <>
      <ProviderTile provider="google" size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-title-sm text-ink">Google Calendar</span>
        <span className="text-body-md text-ink-2">Gmail, G Suite</span>
      </span>
      {!googleConfigured ? <Badge variant="neutral">Not configured on this server</Badge> : <ChevronRight aria-hidden="true" className="size-5 text-ink-2" />}
    </>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Connect calendar account"
      description="Connect your calendar to auto-check for busy times and add new events as they are scheduled."
      trigger={
        <Button variant={triggerVariant} leftIcon={<Plus aria-hidden="true" />}>
          {triggerLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pt-2">
        {disabled ? (
          <div aria-disabled="true" className={tileClass}>
            {body}
          </div>
        ) : (
          // A full page navigation: the OAuth start route redirects to Google.
          <a href={googleConnectHref({ next })} className={tileClass} data-testid="connect-google">
            {body}
          </a>
        )}
        {atCap && <p className="text-body-md text-danger-text">You can connect up to {maxAccounts} calendar accounts. Disconnect one to add another.</p>}
        {!googleConfigured && (
          <p className="text-body-md text-ink-2">
            {isAdmin
              ? "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server environment to connect Google Calendar. docs/GOOGLE_SETUP.md explains how to create the OAuth client."
              : "Google Calendar isn't set up on this server yet. Ask your administrator to configure it."}
          </p>
        )}
        <p className="text-body-sm text-ink-2">
          We only use your calendar to check for busy times and to add, update and remove the events you schedule here.
        </p>
      </div>
    </Dialog>
  );
}
