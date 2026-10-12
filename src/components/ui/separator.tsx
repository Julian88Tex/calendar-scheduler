// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Separator (ARCHITECTURE 20.2): a horizontal or vertical rule (decorative by default).
import { cn } from "@/lib/cn";

export type SeparatorProps = { orientation?: "horizontal" | "vertical"; decorative?: boolean; className?: string; label?: string };

export function Separator({ orientation = "horizontal", decorative = true, className, label }: SeparatorProps) {
  if (label) {
    return (
      <div className={cn("flex items-center gap-3 text-body-sm text-ink-2", className)} role={decorative ? "none" : "separator"}>
        <span className="h-px flex-1 bg-line" />
        {label}
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn("bg-line", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
    />
  );
}
