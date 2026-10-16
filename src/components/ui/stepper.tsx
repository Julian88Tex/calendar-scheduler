// OWNER: foundation-ui.
//
// Stepper (ARCHITECTURE 20.2, walkthrough 3.3): the thin segmented onboarding progress bar with "Step 2 of 4"
// (SPEC AU-12). Server and client safe.
import { cn } from "@/lib/cn";

export type StepperProps = {
  /** Number of steps. */
  total: number;
  /** Current step, 1-based. */
  current: number;
  /** Optional step names (screen readers and tooltips). */
  labels?: string[];
  className?: string;
  /** Hide the "Step x of y" caption (the progressbar keeps it as its name). */
  hideCaption?: boolean;
};

export function Stepper({ total, current, labels, className, hideCaption }: StepperProps) {
  const step = Math.max(1, Math.min(total, current));
  const name = labels?.[step - 1];
  const text = `Step ${step} of ${total}`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-label={name ? `${text}: ${name}` : text}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={name ? `${text}: ${name}` : text}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            title={labels?.[i]}
            className={cn("h-1 flex-1 rounded-full transition-colors duration-200", i < step ? "bg-primary" : "bg-mist")}
          />
        ))}
      </div>
      {!hideCaption && <span className="text-body-sm font-semibold text-ink-2">{text}</span>}
    </div>
  );
}
