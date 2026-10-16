// "Filter" menu of the Scheduling toolbar (SPEC ET-06, walkthrough 5.1): Status (All, On, Off) and, when the list holds
// more than one kind, Kind. docs/SCOPE.md has one host and no team, so the Host, Owner and Permissions filters of
// multi-user accounts are not offered. Changes apply at once; "Clear filters" resets them. Client component.
"use client";

import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { RadioGroup } from "@/components/ui/radio-group";
import type { UiKind } from "@/lib/event-types/constants";
import { activeFilterCount, type KindFilter, type ListFilters, type StatusFilter } from "./list-filters";

export type FilterMenuProps = {
  filters: ListFilters;
  kinds: { kind: UiKind; label: string }[];
  onChange: (next: Partial<ListFilters>) => void;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export function FilterMenu({ filters, kinds, onChange }: FilterMenuProps) {
  const count = activeFilterCount(filters);
  return (
    <Popover
      align="end"
      aria-label="Filter event types"
      className="w-64"
      trigger={
        <Button variant="secondary" leftIcon={<ListFilter aria-hidden="true" />} aria-label={count ? `Filter, ${count} applied` : "Filter"}>
          Filter
          {count > 0 && (
            <span aria-hidden="true" className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] leading-none font-bold text-white">
              {count}
            </span>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <RadioGroup
          legend="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onValueChange={(v) => onChange({ status: v as StatusFilter })}
        />
        {kinds.length > 1 && (
          <RadioGroup
            legend="Kind"
            value={filters.kind}
            options={[{ value: "all", label: "All" }, ...kinds.map((k) => ({ value: k.kind, label: k.label }))]}
            onValueChange={(v) => onChange({ kind: v as KindFilter })}
          />
        )}
        <div className="border-t border-line pt-3">
          <Button variant="tertiary" size="sm" disabled={count === 0} onClick={() => onChange({ status: "all", kind: "all" })} className="-ml-3">
            Clear filters
          </Button>
        </div>
      </div>
    </Popover>
  );
}
