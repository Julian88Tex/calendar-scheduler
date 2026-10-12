// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Table primitives (ARCHITECTURE 20.2): semantic table elements with the app styling. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...rest }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-body-md", className)} {...rest} />
    </div>
  );
}
export function TableHeader(props: React.ComponentProps<"thead">) {
  return <thead {...props} />;
}
export function TableBody(props: React.ComponentProps<"tbody">) {
  return <tbody {...props} />;
}
export function TableRow({ className, ...rest }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line", className)} {...rest} />;
}
export function TableHead({ className, ...rest }: React.ComponentProps<"th">) {
  return <th scope="col" className={cn("px-3 py-2 text-left text-label text-ink-2", className)} {...rest} />;
}
export function TableCell({ className, ...rest }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2", className)} {...rest} />;
}
export function TableCaption({ className, ...rest }: React.ComponentProps<"caption">) {
  return <caption className={cn("sr-only", className)} {...rest} />;
}
