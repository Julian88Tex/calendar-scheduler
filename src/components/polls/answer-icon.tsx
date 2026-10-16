// Answer glyphs of meeting polls (SPEC MP-08, MP-17; research B17): green check for Yes, amber tilde for If need be,
// an empty mark for No, "?" for a time added after the participant answered and a dash for no answer. Never color
// alone: each state has its own shape, and callers add text (legend, labels). Server and client safe.
import { Check, Minus } from "lucide-react";
import type { VoteChoice } from "@/lib/polls/types";
import { cn } from "@/lib/cn";

export type AnswerMark = VoteChoice | "unknown" | "none";

/** Circle glyph (lists, grids, legends). */
export function AnswerIcon({ value, size = 20, className, title }: { value: AnswerMark; size?: number; className?: string; title?: string }) {
  const box = { width: size, height: size };
  const label = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
  if (value === "yes") {
    return (
      <span {...label} style={box} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-success text-white", className)}>
        <Check strokeWidth={3} style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    );
  }
  if (value === "if_need_be") {
    return (
      <span
        {...label}
        style={{ ...box, fontSize: size * 0.85 }}
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full border-2 border-warning bg-warning-soft leading-none font-bold text-warning-text", className)}
      >
        <span className="-mt-[0.18em]">~</span>
      </span>
    );
  }
  if (value === "unknown") {
    return (
      <span {...label} style={{ ...box, fontSize: size * 0.6 }} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-mist font-bold text-ink-2", className)}>
        ?
      </span>
    );
  }
  if (value === "none") {
    return (
      <span {...label} style={box} className={cn("inline-flex shrink-0 items-center justify-center text-ink-3", className)}>
        <Minus style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  }
  return <span {...label} style={box} className={cn("inline-flex shrink-0 rounded-full border-2 border-line-medium bg-white", className)} />;
}

/** Square checkbox glyph of the Yes/No control (If need be off, Calendly look). */
export function CheckboxGlyph({ checked, disabled, className }: { checked: boolean; disabled?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors",
        checked ? "border-brand bg-brand text-white" : "border-line-medium bg-white",
        disabled && !checked && "border-line bg-pebble",
        className,
      )}
    >
      {checked && <Check strokeWidth={3} className="size-3.5" />}
    </span>
  );
}
