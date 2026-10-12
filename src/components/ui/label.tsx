// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Label (ARCHITECTURE 20.2) with the required asterisk.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type LabelProps = React.ComponentProps<"label"> & { required?: boolean };

export function Label({ required, className, children, ...rest }: LabelProps) {
  return (
    <label className={cn("text-label text-ink", className)} {...rest}>
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      )}
    </label>
  );
}
