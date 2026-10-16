// Inline field errors of the booking form (SPEC BK-09, GEN-05; docs/research/calendly-live-capture.md item 18): a
// filled red warning triangle with soft rounded corners (16x13) and a white "!", and the message in regular 14px red
// text under the field, announced with role="alert" and linked to the control through `id` (aria-describedby). Each
// error adds 19.5px to the form, as Calendly's do (so a field after two errors sits exactly 39px lower). Server and
// client safe.
import { cn } from "@/lib/cn";

export function BookingFieldError({ id, error, className }: { id?: string; error?: string | null; className?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className={cn("mt-0.5 -mb-[4.5px] flex items-start gap-1 text-[14px] leading-5 font-normal text-danger-text", className)}>
      <svg aria-hidden="true" viewBox="0 0 16 13" className="mt-[3px] h-[13px] w-4 shrink-0">
        {/* A 2.6px round-joined outline around the fill rounds the three corners (a blunt apex, like Calendly's). */}
        <path d="M8 1.4 14.1 11.7H1.9Z" className="fill-current stroke-current" strokeWidth={2.6} strokeLinejoin="round" />
        <path d="M8 4.8v2.4" className="fill-none stroke-white" strokeWidth={1.6} strokeLinecap="round" />
        <circle cx="8" cy="9.5" r=".75" className="fill-white" />
      </svg>
      <span>{error}</span>
    </p>
  );
}
