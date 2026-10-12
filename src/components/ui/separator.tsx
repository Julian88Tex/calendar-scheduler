// OWNER: foundation-ui.
//
// Separator (ARCHITECTURE 20.2): a #D4E0ED horizontal or vertical rule (decorative by default), optionally with a
// centered label ("or" between sign-in options). Server and client safe.
import { cn } from "@/lib/cn";

export type SeparatorProps = { orientation?: "horizontal" | "vertical"; decorative?: boolean; className?: string; label?: string };

export function Separator({ orientation = "horizontal", decorative = true, className, label }: SeparatorProps) {
  if (label) {
    return (
      <div className={cn("flex items-center gap-3 text-body-md text-ink-2", className)} role={decorative ? "none" : "separator"}>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <span>{label}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn("shrink-0 bg-line", orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch", className)}
    />
  );
}
