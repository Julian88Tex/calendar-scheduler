// OWNER: foundation-ui.
//
// ProgressBar (ARCHITECTURE 20.2): a labelled progressbar with a #006BFF fill on a #E7EDF6 track. Server and client
// safe.
import { cn } from "@/lib/cn";

export type ProgressBarProps = { value: number; max?: number; label?: string; className?: string; showValue?: boolean };

export function ProgressBar({ value, max = 100, label = "Progress", className, showValue }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
        aria-valuetext={`${Math.round(pct)}%`}
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-mist"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {showValue && <span className="shrink-0 text-body-sm font-semibold text-ink-2">{Math.round(pct)}%</span>}
    </div>
  );
}
