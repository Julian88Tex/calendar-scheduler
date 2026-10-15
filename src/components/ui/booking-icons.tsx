// OWNER: foundation-ui.
//
// Icons drawn like Calendly's booking page ones (docs/research/calendly-live-capture.md items 5, 11 and 16), where the
// lucide shapes differ: a globe with a narrow meridian and two latitude lines (lucide's Globe has one equator), a
// calendar 18px wide and 20px tall in a 22px box with a "1" on its page (lucide's Calendar1 is square), and a video
// camera with a square body (lucide's Video is flatter and wider). The globe and calendar set their stroke width on the
// inner group so a parent's [&_svg] stroke rule cannot thicken them. Decorative (aria-hidden). Server and client safe.
import type * as React from "react";

type IconProps = { className?: string; strokeWidth?: number; style?: React.CSSProperties };

/**
 * Globe: circle, a narrow meridian ellipse and two latitude lines (a 3x3 grid look). `radius` (in the 24 unit box,
 * default 10) lets the small time zone trigger fill its box like Calendly's 14px globe.
 */
export function GlobeIcon({ className, strokeWidth = 2, style, radius = 10 }: IconProps & { radius?: number }) {
  const lat = radius * 0.33;
  const half = Math.sqrt(radius * radius - lat * lat);
  const line = (y: number) => `M${(12 - half).toFixed(2)} ${y.toFixed(2)}H${(12 + half).toFixed(2)}`;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} style={style} fill="none">
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r={radius} />
        <ellipse cx="12" cy="12" rx={radius * 0.425} ry={radius} />
        <path d={`${line(12 - lat)}${line(12 + lat)}`} />
      </g>
    </svg>
  );
}

/** Calendar page with two rings and a "1": 18x20 inside a 22px box (the details row's time line). */
export function CalendarDayIcon({ className, strokeWidth = 1.8, style }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 22 22" className={className} style={style} fill="none">
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.8" y="3.8" width="16.4" height="16.4" rx="2" />
        <path d="M7.2 1.8v3.8M14.8 1.8v3.8M2.8 8.6h16.4" />
        <path d="M10 13.2l1.3-1v5" />
      </g>
    </svg>
  );
}

/**
 * Video camera: a square body with tight corners and a lens 8.7 units tall, centered 1.1 units above the box's middle
 * (in a 22px box: a 14x14 body and a 20px wide glyph, where Calendly draws it). Takes the stroke width from its props or
 * from a parent's [&_svg] rule, like the lucide icons it replaces.
 */
export function VideoCameraIcon({ className, strokeWidth = 2, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4.4" width="13.1" height="13" rx="1.4" />
      <path d="M15.1 9.3 21.6 6.55v8.7l-6.5-2.75" />
    </svg>
  );
}
