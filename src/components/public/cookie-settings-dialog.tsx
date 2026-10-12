// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CookieSettingsDialog (ARCHITECTURE 20.2, SPEC GEN-14): strictly necessary (always on) and analytics (optional).
"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { readCookieConsent, writeCookieConsent } from "./cookie-consent";

export type CookieSettingsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function CookieSettingsDialog({ open, onOpenChange }: CookieSettingsDialogProps) {
  const [analytics, setAnalytics] = useState(() => readCookieConsent() === "granted");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cookie settings"
      footer={
        <Button
          onClick={() => {
            writeCookieConsent(analytics ? "granted" : "denied");
            onOpenChange(false);
          }}
        >
          Save settings
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Checkbox checked disabled label="Strictly necessary" description="Required for the page to work." />
        <Checkbox checked={analytics} onCheckedChange={setAnalytics} label="Analytics" description="Helps the host understand how this page is used." />
      </div>
    </Dialog>
  );
}
