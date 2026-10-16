// OWNER: foundation-ui.
//
// Table primitives (ARCHITECTURE 20.2): semantic table elements with the app styling (hairline rows, 12px semibold
// #476788 headers, row hover). The wrapper scrolls horizontally inside its own container (GEN-04). Server and client
// safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...rest }: React.ComponentProps<"table">) {
  return (
    <div className="scrollbar-thin w-full min-w-0 overflow-x-auto">
      <table className={cn("w-full border-collapse text-[14px] leading-5 text-ink", className)} {...rest} />
    </div>
  );
}
export function TableHeader({ className, ...rest }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line", className)} {...rest} />;
}
export function TableBody({ className, ...rest }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child]:border-b-0", className)} {...rest} />;
}
export function TableRow({ className, ...rest }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line transition-colors duration-100", className)} {...rest} />;
}
export function TableHead({ className, ...rest }: React.ComponentProps<"th">) {
  return <th scope="col" className={cn("h-10 px-4 text-left align-middle text-[12px] font-semibold whitespace-nowrap text-ink-2", className)} {...rest} />;
}
export function TableCell({ className, ...rest }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...rest} />;
}
export function TableCaption({ className, ...rest }: React.ComponentProps<"caption">) {
  return <caption className={cn("sr-only", className)} {...rest} />;
}
