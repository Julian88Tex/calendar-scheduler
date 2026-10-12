// The Troubleshoot details sheet (SPEC BK-24): one start time with its status, every reason, the code meaning and fix
// hint (Appendix B), the blocking events (titles are only ever the owner's own, GEN-08) and a link to the setting.
"use client";

import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { TroubleshootEntry } from "@/lib/booking/types";
import { formatDateLong, formatTimeRange } from "@/lib/time/format";
import { reasonLabel } from "@/lib/slots/reasons";
import { ADVANCED_SETTINGS_PATH, scheduleHref } from "@/lib/availability/links";
import type { TroubleshootDay } from "@/lib/availability/types";
import { blockerTitle, blockerWhen, fixTarget, statusHint, type CandidateView } from "@/lib/availability/troubleshoot-view";

export type CandidateSheetProps = {
  view: CandidateView;
  entry: TroubleshootEntry;
  day: TroubleshootDay;
  onOpenChange: (open: boolean) => void;
};

export function CandidateSheet({ view, entry, day, onOpenChange }: CandidateSheetProps) {
  const hint = statusHint(view.status);
  const target = fixTarget(view.status);
  const et = entry.eventType;
  const link: { href: Route; label: string } | null =
    target === "event_type"
      ? { href: `/app/event-types/${et.id}` as Route, label: "Edit event type" }
      : target === "availability"
        ? et.scheduleId && !day.scheduleNames[et.scheduleId]
          ? // Custom hours live in the event type editor.
            { href: `/app/event-types/${et.id}` as Route, label: "Edit custom hours" }
          : { href: scheduleHref(et.scheduleId), label: "Edit availability" }
        : target === "limits"
          ? { href: ADVANCED_SETTINGS_PATH as Route, label: "Edit meeting limits" }
          : target === "calendar"
            ? { href: "/app/availability/calendar-settings" as Route, label: "Calendar settings" }
            : null;
  const blockers = view.candidate.blockers;

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={`${view.timeLabel} · ${et.name}`}
      description={`${formatDateLong(view.start, day.zone)}, ${formatTimeRange(view.start, view.end, day.zone, "en", day.hour12)}`}
      size="md"
      footer={
        <>
          {link && (
            <Button asChild variant="secondary">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          {view.status === "available" ? (
            <Badge variant="success">Available</Badge>
          ) : (
            view.codes.length > 0 &&
            view.codes.map((c) => (
              <span key={c} className="inline-flex items-center rounded-full border border-dashed border-ink-3 bg-pebble px-2 py-0.5 text-[11px] leading-4 font-bold tracking-[0.04em] text-ink uppercase">
                {reasonLabel(c)}
              </span>
            ))
          )}
          {view.status === "outside_hours" && (
            <span className="inline-flex items-center rounded-full border border-dashed border-line-medium px-2 py-0.5 text-[11px] leading-4 font-bold tracking-[0.04em] text-ink-2 uppercase">
              Outside hours
            </span>
          )}
        </div>

        {view.status === "available" ? (
          <p className="text-body-md text-ink">Invitees can book this time on your booking page.</p>
        ) : (
          <section aria-labelledby="sheet-why">
            <h3 id="sheet-why" className="text-eyebrow text-ink-2">
              Why this time is unavailable
            </h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-body-md text-ink">
              {view.reasons.map((r) => (
                <li key={r} className="break-words">
                  {r}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hint && (
          <section aria-labelledby="sheet-fix" className="rounded-[var(--radius-card)] bg-pebble p-4">
            <h3 id="sheet-fix" className="text-eyebrow text-ink-2">
              How to fix it
            </h3>
            <p className="mt-1 text-body-md text-ink">{hint.meaning}.</p>
            <p className="mt-1 text-body-md font-semibold text-ink">{hint.fix}.</p>
          </section>
        )}

        {blockers.length > 0 && (
          <section aria-labelledby="sheet-blockers">
            <h3 id="sheet-blockers" className="text-eyebrow text-ink-2">
              Blocking {blockers.length === 1 ? "event" : "events"}
            </h3>
            <ul className="mt-2 flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {blockers.map((b, i) => {
                return (
                  <li key={`${b.start}-${i}`} className="flex flex-col gap-0.5 px-4 py-3">
                    <span className="text-body-md font-semibold break-words text-ink">{blockerTitle(b)}</span>
                    <span className="text-body-sm text-ink-2">
                      {blockerWhen(b, day)} ·{" "}
                      {b.source === "calendar" ? "Calendar event" : b.source === "reserved" ? "Held" : "Meeting"}
                      {b.code ? ` · ${reasonLabel(b.code)}` : ""}
                    </span>
                    {b.core && (b.core.start !== b.start || b.core.end !== b.end) && (
                      <span className="text-body-sm text-ink-2">
                        Blocks {formatTimeRange(b.start, b.end, day.zone, "en", day.hour12)} with its buffers
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
