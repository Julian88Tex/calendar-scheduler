// "Copy times to..." (SPEC AV-05): the copy icon of a weekly hours row opens a checklist of the weekdays (the source
// day checked and disabled), "Select all" and "Apply". Applying replaces the checked days' intervals with the source
// day's intervals.
"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { dayOrder, WEEKDAY_NAMES } from "@/lib/availability/intervals";

export type CopyTimesPopoverProps = {
  /** Source weekday (0 = Sunday). */
  day: number;
  weekStart?: 0 | 1;
  onApply: (targets: number[]) => void;
  disabled?: boolean;
};

export function CopyTimesPopover({ day, weekStart = 0, onApply, disabled }: CopyTimesPopoverProps) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Set<number>>(new Set());
  const order = dayOrder(weekStart);
  const others = order.filter((d) => d !== day);
  const allChecked = others.every((d) => targets.has(d));

  const toggle = (d: number, on: boolean) =>
    setTargets((prev) => {
      const next = new Set(prev);
      if (on) next.add(d);
      else next.delete(d);
      return next;
    });

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setTargets(new Set());
      }}
      align="end"
      className="w-60 p-0"
      aria-label={`Copy ${WEEKDAY_NAMES[day]} times`}
      trigger={
        <IconButton aria-label={`Copy ${WEEKDAY_NAMES[day]} times to other days`} size="sm" disabled={disabled}>
          <Copy aria-hidden="true" />
        </IconButton>
      }
    >
      <div className="px-4 pt-4 pb-2">
        <p className="text-eyebrow text-ink-2">Copy times to...</p>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-3">
        <Checkbox
          label="Select all"
          checked={allChecked ? true : targets.size > 0 ? "indeterminate" : false}
          onCheckedChange={(on) => setTargets(on ? new Set(others) : new Set())}
        />
        <div className="h-px bg-line" aria-hidden="true" />
        {order.map((d) => (
          <Checkbox
            key={d}
            label={WEEKDAY_NAMES[d]}
            checked={d === day ? true : targets.has(d)}
            disabled={d === day}
            onCheckedChange={(on) => toggle(d, on)}
          />
        ))}
      </div>
      <div className="border-t border-line p-3">
        <Button
          fullWidth
          size="sm"
          disabled={targets.size === 0}
          onClick={() => {
            onApply([...targets]);
            setOpen(false);
          }}
        >
          Apply
        </Button>
      </div>
    </Popover>
  );
}
