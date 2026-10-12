// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CopyButton (ARCHITECTURE 20.2): copies a value, shows a copied state and a toast ("Link copied").
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
      className={className}
      aria-label={iconOnly ? label : undefined}
      onClick={async () => {
        if (await copy(value)) {
          if (toastMessage) toast.success(toastMessage);
          onCopied?.();
        }
      }}
      leftIcon={copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
    >
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  );
}
