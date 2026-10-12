// OWNER: foundation-ui.
//
// BookingCard and its side-panel pieces (SPEC BK-03, BK-06, GEN-03, GEN-04, walkthrough 11.2 and 11.10; owner
// reference .reference/booking-30min.png): the two-column booking card. Desktop (1000px and up): 95% wide, max 800px,
// min height 550px (700px on tall screens, as observed), a 50% (min 300px) details panel with a #D4E0ED vertical divider; when a date is chosen
// (`expanded`) the card widens to min 900px / max 1060px with a 0.22s ease-out transition, the details panel shrinks
// to 35% and the `times` column appears on the right. Tablet (600 to 999px): details on top (content 440px wide),
// calendar below, times below the calendar. Phone (below 600px): full-bleed card, one column, `mobileView="times"`
// shows the separate times view instead of the calendar. Every blue reads --primary-color. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";
import { PoweredByRibbon } from "./powered-by-ribbon";

export type BookingCardProps = {
  /** The details panel (BookingBrandHeader, BookingSideSection with host, title and detail rows, footer links). */
  side?: React.ReactNode;
  /** The main panel: "Select a Date & Time" with the calendar and time zone, or the details form. */
  children: React.ReactNode;
  /** The slot list column, shown while `expanded`. */
  times?: React.ReactNode;
  /** A date is selected: widen the card and show `times`. */
  expanded?: boolean;
  /** Powered by ribbon (default true; false when branding hides it, BR-06). */
  ribbon?: boolean;
  ribbonHref?: string;
  /** Phone layout: the calendar ("main", default) or the separate times view ("times"). */
  mobileView?: "main" | "times";
  /** Embed (BK-25): no border, 20px radius, soft shadow. */
  embed?: boolean;
  /** hide_event_type_details=1 (BK-26): no details panel, single column calendar. */
  hideSide?: boolean;
  className?: string;
};

export function BookingCard({ side, children, times, expanded = false, ribbon = true, ribbonHref, mobileView = "main", embed, hideSide, className }: BookingCardProps) {
  const showSide = Boolean(side) && !hideSide;
  const showTimes = expanded && Boolean(times);
  return (
    <div
      data-booking-card=""
      data-expanded={showTimes || undefined}
      className={cn(
        "relative mx-auto w-full bg-public-bg text-public-text",
        "transition-[max-width,min-width,width] duration-[220ms] ease-out",
        embed
          ? "rounded-[20px] shadow-[var(--shadow-embed)]"
          : "min-[600px]:rounded-[var(--radius-card)] min-[600px]:border min-[600px]:border-line min-[600px]:shadow-[var(--shadow-card)]",
        "min-[600px]:max-w-[800px] min-[1000px]:w-[95%] min-[1000px]:min-h-[550px] min-[1000px]:[@media(min-height:860px)]:min-h-[700px]",
        !showSide && "min-[600px]:max-w-[480px]",
        showTimes && (showSide ? "min-[1000px]:max-w-[1060px] min-[1000px]:min-w-[900px]" : "min-[600px]:max-w-[740px]"),
        className,
      )}
    >
      {ribbon && <PoweredByRibbon href={ribbonHref} />}
      <div className={cn("flex min-h-[inherit] flex-col", showSide && "min-[1000px]:flex-row")}>
        {showSide && (
          <aside
            aria-label="Event details"
            className={cn(
              "flex min-w-0 flex-col border-line max-[999px]:border-b min-[1000px]:min-w-[300px] min-[1000px]:border-r",
              "transition-[width] duration-[220ms] ease-out min-[1000px]:w-1/2",
              showTimes && "min-[1000px]:w-[35%]",
              mobileView === "times" && "max-[599px]:hidden",
            )}
          >
            {side}
          </aside>
        )}
        <div className={cn("flex min-w-0 flex-1 flex-col", showTimes && "min-[1000px]:flex-row")}>
          <section className={cn("min-w-0 flex-1", showTimes && mobileView === "times" && "max-[599px]:hidden")}>{children}</section>
          {showTimes && (
            <section
              aria-label="Available times"
              className={cn(
                "min-w-0 animate-fade-in max-[999px]:border-t max-[999px]:border-line min-[1000px]:w-[260px] min-[1000px]:shrink-0",
                mobileView === "main" && "max-[599px]:hidden",
              )}
            >
              {times}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Top of the details panel: a large logo or host avatar (about 120px) with a divider below (observed). */
export function BookingBrandHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex justify-center border-b border-line px-6 pt-[26px] pb-[26px]", className)}>{children}</div>;
}

/** Padded section of the details panel (30px left, 10px right on desktop, centered on tablet and phone). */
export function BookingSideSection({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col px-6 pt-6 pb-6 max-[999px]:items-center max-[999px]:text-center min-[600px]:max-[999px]:mx-auto min-[600px]:max-[999px]:w-full min-[600px]:max-[999px]:max-w-[440px] min-[1000px]:pr-2.5 min-[1000px]:pl-[30px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Host name above the event name (#476788, 16px bold, 24px line height). */
export function BookingHostName({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[16px] leading-6 font-bold text-ink-2", className)}>{children}</p>;
}

/** The event name (h1, 28px bold, 32px line height; 26px on phones). */
export function BookingEventTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h1 className={cn("mt-0.5 text-[26px] leading-8 font-bold break-words text-public-text min-[600px]:text-[28px]", className)}>{children}</h1>;
}

/** A details row: 20px navy (#0B3558) icon and 14px semibold #476788 text (clock + "30 min", video + location...). */
export function BookingDetailRow({ icon, children, className }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2 text-left text-[14px] leading-[21px] font-semibold text-ink-2", className)}>
      <span aria-hidden="true" className="mt-px inline-flex shrink-0 text-navy [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** Stack of detail rows (12px apart, 24px below the title). */
export function BookingDetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex flex-col gap-3 max-[999px]:items-center", className)}>{children}</div>;
}

/** Bottom of the details panel: the footer links pushed to the bottom (desktop) with the classic spacing. */
export function BookingSideFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-auto px-6 pt-8 pb-7 max-[999px]:flex max-[999px]:justify-center min-[1000px]:pl-[31px]", className)}>{children}</div>;
}

/** The main panel heading ("Select a Date & Time", "Enter Details": 22px bold) with the panel padding. */
export function BookingPanelHeading({ children, className, as: Tag = "h2" }: { children: React.ReactNode; className?: string; as?: "h1" | "h2" }) {
  return <Tag className={cn("text-[20px] leading-7 font-bold text-public-text min-[600px]:text-[22px]", className)}>{children}</Tag>;
}

/** Padding of the main panel content (32px sides on desktop, 20px for the calendar grid). */
export function BookingMainSection({ children, className, tight }: { children: React.ReactNode; className?: string; tight?: boolean }) {
  return <div className={cn("min-w-0 pt-7 pb-6", tight ? "px-3 min-[600px]:px-5" : "px-5 min-[600px]:px-8", className)}>{children}</div>;
}
