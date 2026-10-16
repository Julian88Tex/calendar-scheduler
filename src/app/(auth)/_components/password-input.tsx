// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Password input with a show and hide toggle (eye icon button inside the field, aria-pressed, keyboard reachable).
"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type PasswordInputProps = Omit<InputProps, "type" | "leftAddon" | "rightAddon">;

export function PasswordInput({ className, id, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...rest} id={id} type={visible ? "text" : "password"} className={cn("pr-12", className)} spellCheck={false} autoCapitalize="none" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={id}
        className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
      </button>
    </div>
  );
}
