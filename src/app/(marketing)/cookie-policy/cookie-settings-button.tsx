// OWNER: marketing-site. Written for the single-owner deployment.
// "Open cookie settings" on /cookie-policy: the same Cookie settings dialog as the "Cookie settings" link at the bottom
// of booking and poll pages (src/components/public/cookie-settings-dialog.tsx). Client component.
"use client";

import { useState } from "react";
import { CookieSettingsDialog } from "@/components/public/cookie-settings-dialog";
import { Button } from "@/components/ui/button";

export function CookieSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        Open cookie settings
      </Button>
      <CookieSettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
