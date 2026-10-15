// Inline field errors of the booking form (SPEC BK-09, GEN-05; docs/research/calendly-live-capture.md item 18): a filled
// red warning triangle with a white "!" and the message in regular 14px red text under the field, announced with
// role="alert" and linked to the control through `id` (aria-describedby). Server and client safe.
import { cn } from "@/lib/cn";

export function BookingFieldError({ id, error, className }: { id?: string; error?: string | null; className?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className={cn("mt-0.5 -mb-1 flex items-start gap-[5px] text-[14px] leading-5 font-normal text-danger-text", className)}>
      <svg aria-hidden="true" viewBox="0 0 16 14" className="mt-[2px] h-[13px] w-[15px] shrink-0">
        <path d="M8 .9 15.3 13.2H.7Z" className="fill-current stroke-current" strokeWidth={1.2} strokeLinejoin="round" />
        <path d="M8 5.1v3.6" className="fill-none stroke-white" strokeWidth={1.7} strokeLinecap="round" />
        <circle cx="8" cy="10.9" r=".95" className="fill-white" />
      </svg>
      <span>{error}</span>
    </p>
  );
}
