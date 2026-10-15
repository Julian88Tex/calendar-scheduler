// One poll card of the Meeting polls list (SPEC MP-26; research B13; Calendly list card look: white card, 1px #D4E0ED
// border, 8px radius, a 6px strip in the poll color on the left). Clicking the card outside its controls opens the
// results. Client component.
"use client";

import { CalendarCheck, Clock } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";
import { optionShortLabel } from "@/lib/polls/display";
import type { PollListItem } from "@/lib/polls/types";
import { formatDateShort } from "@/lib/time/format";
import { durationLabel, responsesLabel, shortWhen, timesLabel } from "../lib/format";
import { pt } from "../lib/t";
import { PollMenu } from "../poll-menu";
import { PollStatusBadge } from "../status-badge";
import type { ViewerPrefs } from "../types";

const INTERACTIVE = "a,button,input,label,[role=menuitem],[role=dialog],[data-no-card-click]";

export function PollCard({ item, viewer, onChanged }: { item: PollListItem; viewer: ViewerPrefs; onChanged: () => void }) {
  const router = useRouter();
  const href = `/app/polls/${item.id}` as Route;
  const titleId = `poll-title-${item.id}`;
  const zone = viewer.timezone;
  const active = item.status === "open" || item.status === "closed";
  const range =
    item.firstOption && item.lastOption
      ? (() => {
          const a = formatDateShort(item.firstOption, zone);
          const b = formatDateShort(item.lastOption, zone);
          return a === b ? a : pt("list.range", { first: a, last: b });
        })()
      : null;
  const progress = item.invited > 0 ? Math.min(1, item.respondents / Math.max(item.invited, item.respondents)) : null;

  const open = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const target = e.target as Element;
    if (!e.currentTarget.contains(target) || target.closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };

  return (
    <li aria-labelledby={titleId} data-testid="poll-card" data-poll-id={item.id}>
      <div
        onClick={open}
        className="group relative flex min-w-0 cursor-pointer overflow-hidden rounded-[var(--radius-card)] border border-line bg-white transition-[border-color,box-shadow] duration-100 hover:border-line-medium hover:shadow-[var(--shadow-next)]"
      >
        <span aria-hidden="true" className={cn("w-1.5 shrink-0", !active && item.status !== "booked" && "opacity-40 grayscale")} style={{ backgroundColor: item.color }} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={titleId} className="min-w-0 text-title-sm break-words text-ink sm:text-title-md">
                <Link href={href} className="rounded-[2px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {item.title}
                </Link>
              </h3>
              <PollStatusBadge status={item.status} />
              {item.role === "cohost" && <Badge variant="outline">{pt("list.cohostBadge")}</Badge>}
              {item.hasNew && (
                <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary-text" data-testid="poll-new">
                  <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
                  {pt("list.newDot")}
                </span>
              )}
            </div>
            <p className="text-body-md text-ink-2">
              {durationLabel(item.durationMinutes, { mixed: "mixed" })} · {timesLabel(item.optionCount)}
              {range && <> · {range}</>}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-body-md text-ink" data-testid="poll-responses">
                {responsesLabel(item.respondents, item.invited)}
              </span>
              {progress !== null && (
                <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-mist">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              )}
            </div>
            {item.booked ? (
              <p className="flex flex-wrap items-center gap-x-2 text-body-md text-ink-2">
                <CalendarCheck aria-hidden="true" className="size-4 text-success" />
                {item.booked.status === "canceled" ? pt("list.meetingCanceled") : pt("list.bookedFor", {
                      when: item.booked.allDayDate
                        ? optionShortLabel({ start: null, end: null, allDayDate: item.booked.allDayDate, durationMinutes: 0 }, zone)
                        : shortWhen(item.booked.start, zone, viewer.hour12),
                    })}
                {item.booked.status === "active" && (
                  <Link href={`/app/meetings?event=${item.booked.scheduledEventId}` as Route} className="font-semibold text-primary-text hover:underline">
                    {pt("list.viewMeeting")}
                  </Link>
                )}
              </p>
            ) : item.deadline && active ? (
              <p className="flex items-center gap-1.5 text-body-md text-ink-2">
                <Clock aria-hidden="true" className="size-4" />
                {item.status === "closed" ? pt("list.closed") : pt("list.closes", { when: shortWhen(item.deadline, zone, viewer.hour12) })}
              </p>
            ) : item.status === "closed" ? (
              <p className="text-body-md text-ink-2">{pt("list.closed")}</p>
            ) : null}
            {active && item.topOption && (
              <p className="text-body-md text-ink-2" data-testid="poll-top-time">
                {pt("list.topTime", {
                  when: optionShortLabel({ start: item.topOption.start, end: null, allDayDate: item.topOption.allDayDate, durationMinutes: 0 }, zone, { hour12: viewer.hour12 }),
                  count: item.topOption.yes,
                })}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1" data-no-card-click>
            {item.status !== "canceled" && <CopyButton value={item.link} size="sm" className="min-h-9 px-4" />}
            <Button asChild variant="secondary" size="sm" className="min-h-9 px-4 max-sm:hidden">
              <Link href={href}>{pt("list.viewResults")}</Link>
            </Button>
            <PollMenu
              poll={{
                id: item.id,
                title: item.title,
                status: item.status,
                canDelete: item.canDelete,
                respondents: item.respondents,
                deadline: item.deadline,
                meeting: item.booked
                  ? { start: item.booked.start, end: item.booked.allDayDate ? null : item.booked.end, allDayDate: item.booked.allDayDate, status: item.booked.status }
                  : null,
              }}
              zone={zone}
              hour12={viewer.hour12}
              hostName={viewer.name}
              onChanged={onChanged}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
