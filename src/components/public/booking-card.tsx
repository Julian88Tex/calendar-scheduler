// OWNER: foundation-ui.
//
// BookingCard and its side-panel pieces (SPEC BK-03, BK-06, GEN-03, GEN-04, walkthrough 11.2 and 11.10; owner
// reference .reference/booking-30min.png and the live capture in docs/research/calendly-live-capture.md): the
// two-column booking card. Desktop (1000px and up): 95% wide, max 800px, 550px tall (700px on tall screens, as observed,
// borders included), a 50% (min 300px) details panel with a #D4E0ED vertical divider; when a date is chosen
// (`expanded`) the card widens to min 900px / max 1060px with a 0.22s ease-out transition, the details panel shrinks
// to 35% and the 306px `times` column appears on the right; the details step keeps that width (`wide`). Tablet (600 to
// 999px): details on top (content 440px wide), calendar below, times below the calendar. Phone (below 600px): a
// full-bleed card at least the viewport height (less the canvas Calendly leaves below it), one column,
// `mobileView="times"` shows the separate times view instead of the calendar, and `phoneFooter` (the footer links) sits
// at the card's bottom. Every blue reads --primary-color. Server and client safe.
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
  /** The details step: the widened card (1060px, 35% details panel) without a times column. */
  wide?: boolean;
  /** Powered by ribbon (default true; false when branding hides it, BR-06). */
  ribbon?: boolean;
  ribbonHref?: string;
  /** Phone layout: the calendar ("main", default) or the separate times view ("times"). */
  mobileView?: "main" | "times";
  /** Phones only (below 600px): content pinned to the bottom of the card, for example the footer links. */
  phoneFooter?: React.ReactNode;
  /** Embed (BK-25): no border, 20px radius, soft shadow. */
  embed?: boolean;
  /** hide_event_type_details=1 (BK-26): no details panel, single column calendar. */
  hideSide?: boolean;
  className?: string;
};

export function BookingCard({
  side,
  children,
  times,
  expanded = false,
  wide = false,
  ribbon = true,
  ribbonHref,
  mobileView = "main",
  phoneFooter,
  embed,
  hideSide,
  className,
}: BookingCardProps) {
  const showSide = Boolean(side) && !hideSide;
  const showTimes = expanded && Boolean(times);
  const widened = showTimes || wide;
  return (
    <div
      data-booking-card=""
      data-expanded={showTimes || undefined}
      className={cn(
        "relative mx-auto w-full bg-public-bg text-public-text",
        "transition-[max-width,min-width,width] duration-[220ms] ease-out",
        // The inner wrapper inherits the min height: with the 1px border the bordered card is 550 / 700px overall.
        embed
          ? "rounded-[20px] shadow-[var(--shadow-embed)] min-[1000px]:min-h-[550px] min-[1000px]:[@media(min-height:860px)]:min-h-[700px]"
          : "min-[600px]:rounded-[var(--radius-card)] min-[600px]:border min-[600px]:border-line min-[600px]:shadow-[var(--shadow-card)] min-[1000px]:min-h-[548px] min-[1000px]:[@media(min-height:860px)]:min-h-[698px]",
        // Phones: the white card runs to about 80px above the viewport bottom, as Calendly's does.
        !embed && phoneFooter !== undefined && "max-[599px]:min-h-[calc(100dvh-80px)]",
        "min-[600px]:max-w-[800px] min-[1000px]:w-[95%]",
        !showSide && "min-[600px]:max-w-[480px]",
        widened && (showSide ? "min-[1000px]:max-w-[1060px] min-[1000px]:min-w-[900px]" : showTimes && "min-[600px]:max-w-[740px]"),
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
              widened && "min-[1000px]:w-[35%]",
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
                "min-w-0 animate-fade-in min-[600px]:max-[999px]:border-t min-[600px]:max-[999px]:border-line min-[1000px]:w-[306px] min-[1000px]:shrink-0",
                mobileView === "main" && "max-[599px]:hidden",
              )}
            >
              {times}
            </section>
          )}
        </div>
        {phoneFooter !== undefined && <div className="mt-auto min-[600px]:hidden">{phoneFooter}</div>}
      </div>
    </div>
  );
}

/**
 * Top of the details panel: a large logo or host avatar (about 120px) with a divider below (observed); on phones a
 * short bar with a 40px logo (87px tall, level with the back button).
 */
export function BookingBrandHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex justify-center border-b border-line px-6 pt-[26px] pb-[26px] max-[599px]:pt-[25px] max-[599px]:pb-[22px]", className)}>{children}</div>;
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

/**
 * Host name above the event name (#476788, 16px, 24px line height). Weight 650: Figtree's 600 reads as medium next to
 * Calendly's semibold (about 6% less ink in the live capture).
 */
export function BookingHostName({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[16px] leading-6 font-[650] text-ink-2", className)}>{children}</p>;
}

/**
 * The event name (h1, 27px bold, 32px line height; 26px on phones): Calendly's 28px glyphs in Figtree's metrics, with
 * 0.2px tracking on wider screens so the line runs as wide as Calendly's.
 */
export function BookingEventTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1 className={cn("text-[26px] leading-8 font-bold break-words text-public-text min-[600px]:text-[27px] min-[600px]:tracking-[0.2px]", className)}>
      {children}
    </h1>
  );
}

/**
 * A details row: a navy (#0B3558) icon drawn 20px with a heavy stroke, centered on the 14px bold #476788 text (clock +
 * "30 min", video + "Web conferencing details provided upon confirmation." over two lines...). The icon box starts 1px
 * left of the panel padding and the text is raised 2px from the icon's center, where Calendly draws them (Figtree sets
 * its glyphs lower in the line box than Proxima Nova). `iconClassName` restyles one icon (the calendar icon of the
 * chosen time is #476788 like its text).
 */
export function BookingDetailRow({
  icon,
  children,
  className,
  iconClassName,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-[7px] text-left text-[14px] leading-[21px] font-bold text-ink-2", className)}>
      <span aria-hidden="true" className={cn("-ml-px inline-flex shrink-0 text-navy [&_svg]:size-[22px] [&_svg]:[stroke-width:2.2]", iconClassName)}>
        {icon}
      </span>
      <div className="relative -top-0.5 min-w-0 break-words">{children}</div>
    </div>
  );
}

/**
 * Stack of detail rows (12px apart, 25px below the title). Rows share one left edge: on tablets and phones the list is
 * a centered block of left-aligned rows under the centered title, like Calendly's phone layout.
 */
export function BookingDetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-[25px] flex flex-col gap-3 max-[999px]:items-start max-[999px]:self-center max-[999px]:text-left", className)}>{children}</div>;
}

/** Bottom of the details panel: the footer links pushed to the bottom (desktop) with the classic spacing. */
export function BookingSideFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-auto px-6 pt-8 pb-[26px] max-[999px]:flex max-[999px]:justify-center min-[1000px]:pl-[31px]", className)}>{children}</div>;
}

/**
 * The main panel heading ("Select a Date & Time", "Enter Details": 21px bold on desktop with 0.4px tracking, which
 * gives Figtree the width of Calendly's line; 22px on phones).
 */
export function BookingPanelHeading({ children, className, as: Tag = "h2" }: { children: React.ReactNode; className?: string; as?: "h1" | "h2" }) {
  return <Tag className={cn("text-[22px] leading-7 font-bold text-public-text min-[600px]:text-[21px] min-[600px]:tracking-[0.4px]", className)}>{children}</Tag>;
}

/**
 * Padding of the main panel content (32px sides on desktop, 20px for the calendar grid). The 29px top puts the heading
 * glyphs where Calendly's sit (Figtree draws them about 1px lower in the line box).
 */
export function BookingMainSection({ children, className, tight }: { children: React.ReactNode; className?: string; tight?: boolean }) {
  return <div className={cn("min-w-0 pt-[29px] pb-6", tight ? "px-3 min-[600px]:px-5" : "px-5 min-[600px]:px-8", className)}>{children}</div>;
}
