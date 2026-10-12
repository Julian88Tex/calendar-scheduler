// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Stepper (ARCHITECTURE 20.2): the segmented onboarding progress bar ("Step 2 of 4", AU-12).
import { cn } from "@/lib/cn";

export type StepperProps = {
  /** Number of steps. */
  total: number;
  /** Current step, 1-based. */
  current: number;
  /** Optional step names (screen readers and tooltips). */
  labels?: string[];
  className?: string;
};

export function Stepper({ total, current, labels, className }: StepperProps) {
  const text = `Step ${current} of ${total}`;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex gap-1" role="progressbar" aria-label={text} aria-valuemin={1} aria-valuemax={total} aria-valuenow={current}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} title={labels?.[i]} className={cn("h-1 flex-1 rounded-full", i < current ? "bg-primary" : "bg-mist")} />
        ))}
      </div>
      <span className="text-body-sm text-ink-2">{text}</span>
    </div>
  );
}
