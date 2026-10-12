// OWNER: foundation-ui.
//
// CopyButton (ARCHITECTURE 20.2, walkthrough 5.1): copies a value, switches its label to "Copied" for 2 seconds and
// toasts "Link copied"; shows an error toast when the clipboard is unavailable.
"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/client/use-copy";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { toast } from "./toast";

export type CopyButtonProps = {
  value: string;
  /** Default "Copy link". */
  label?: string;
  /** Default "Copied". */
  copiedLabel?: string;
  /** Toast text (default "Link copied"); null disables the toast. */
  toastMessage?: string | null;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon only (the label becomes the accessible name). */
  iconOnly?: boolean;
  onCopied?: () => void;
  className?: string;
};

export function CopyButton({ value, label = "Copy link", copiedLabel = "Copied", toastMessage = "Link copied", variant = "secondary", size = "md", iconOnly, onCopied, className }: CopyButtonProps) {
  const { copied, copy } = useCopy();
  return (
    <Button
      variant={variant}
      size={size}
      className={iconOnly ? `${className ?? ""} aspect-square px-0` : className}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      onClick={async () => {
        if (await copy(value)) {
          if (toastMessage) toast.success(toastMessage);
          onCopied?.();
        } else {
          toast.error("Couldn't copy. Select the text and copy it manually.");
        }
      }}
      leftIcon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    >
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  );
}
