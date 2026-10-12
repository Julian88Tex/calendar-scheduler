// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ProgressBar (ARCHITECTURE 20.2).
import { cn } from "@/lib/cn";

export type ProgressBarProps = { value: number; max?: number; label?: string; className?: string };

export function ProgressBar({ value, max = 100, label = "Progress", className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-2 w-full rounded-full bg-mist", className)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
