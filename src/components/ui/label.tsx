// OWNER: foundation-ui.
//
// Label (ARCHITECTURE 20.2): 14px semibold #0A2540 with the required asterisk (the asterisk is decorative; the control
// carries `required` / aria-required). Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type LabelProps = React.ComponentProps<"label"> & { required?: boolean };

export function Label({ required, className, children, ...rest }: LabelProps) {
  return (
    <label className={cn("text-label text-ink", className)} {...rest}>
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger-text">
          *
        </span>
      )}
    </label>
  );
}
