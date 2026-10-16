// "Copy link" pill of an event type card (SPEC ET-04, walkthrough 5.1): secondary pill with Calendly's link icon that
// copies the booking URL, reads "Copied" for 2 seconds and toasts "Link copied". The visible label stays the button's
// name; `aria-describedby` points at the card's event name so screen readers hear which link it copies. Client
// component.
"use client";

import { Check, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useCopy } from "@/lib/client/use-copy";
import { cn } from "@/lib/cn";

export function CopyLinkButton({ url, describedBy, className }: { url: string; describedBy?: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-describedby={describedBy}
      className={cn("min-h-9 px-4 max-sm:min-h-10", className)}
      leftIcon={copied ? <Check aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
      onClick={async () => {
        if (await copy(url)) toast.success("Link copied");
        else toast.error("Couldn't copy. Select the text and copy it manually.");
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
