// OWNER: foundation-ui.
//
// EventTypeList (SPEC BK-01, BK-02; owner reference .reference/profile.png and the live capture): the landing page grid
// of event types. Two columns (one under 650px) with a 40px gutter; each item has a #D4E0ED top border, a 26px filled
// color circle, the event name (#0A2540, bold 16px), an optional two-line description and a small dark right-pointing
// triangle (8x16, centered on the circle, as measured on the owner's page) at the far right. Desktop items are 180px
// tall with 40px between rows (a 220px pitch); phone rows are 102px apart. The whole item links to its booking page
// (with ?back=1); on hover it fills #E7EDF6 and the circle gains a 2px white ring, as on Calendly. Server and client
// safe.
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { HEX_COLOR_PATTERN } from "../ui/event-colors";

/** The event color when it is a "#rrggbb" hex (anything else could smuggle CSS into the style attribute). */
export function eventDotColor(color: string | null | undefined): string {
  return color && HEX_COLOR_PATTERN.test(color) ? color : "#8247f5";
}

export type EventTypeListItem = {
  id: string;
  name: string;
  /** Event color (#8247f5). */
  color: string;
  /** Booking page link, usually "/{slug}/{eventSlug}?back=1". */
  href: string;
  /** Plain-text description excerpt (clamped to two lines). */
  description?: string | null;
  /** Extra line under the name ("30 min", "Group"), optional. */
  meta?: string | null;
};

export type EventTypeListProps = {
  items: EventTypeListItem[];
  className?: string;
  /** Accessible name of the list (default "Event types"). */
  "aria-label"?: string;
};

export function EventTypeList({ items, className, ...aria }: EventTypeListProps) {
  return (
    <ul aria-label={aria["aria-label"] ?? "Event types"} className={cn("grid grid-cols-1 gap-x-10 min-[650px]:grid-cols-2 min-[650px]:gap-y-10", className)}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0 border-t border-line">
          <Link
            href={item.href as Route}
            className="group flex h-full min-h-[101px] w-full min-w-0 items-start gap-3 pt-[26px] pr-[11px] pb-8 pl-[13px] transition-colors duration-100 hover:bg-mist focus-visible:outline-offset-[-2px] min-[650px]:min-h-[179px] min-[650px]:pr-[21px] min-[650px]:pl-[23px]"
          >
            <span
              aria-hidden="true"
              className="mt-px size-[26px] shrink-0 rounded-full transition-shadow duration-100 group-hover:shadow-[0_0_0_2px_var(--public-bg)]"
              style={{ backgroundColor: eventDotColor(item.color) }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-[3px]">
              <span className="text-[16px] leading-5 font-bold break-words text-public-text">{item.name}</span>
              {item.meta && <span className="text-[14px] leading-5 text-ink-2">{item.meta}</span>}
              {item.description && <span className="line-clamp-2 text-[14px] leading-5 text-pretty text-ink-2">{item.description}</span>}
            </span>
            <svg aria-hidden="true" viewBox="0 0 8 16" className="mt-[6px] h-4 w-2 shrink-0 fill-public-text">
              <path d="M0 0l8 8-8 8z" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
