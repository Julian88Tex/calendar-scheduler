// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Left panel of /signup (SPEC AU-01, walkthrough 3.1): a decorative illustration of a booking page (month grid with
// available days, the selected day, time slots) and a "New event scheduled" notification, drawn with design tokens so
// it follows the theme. Hidden below 768px by the page. Purely decorative (aria-hidden); the product name comes from
// NEXT_PUBLIC_APP_NAME.
import { CalendarCheck2, Check, Clock, Video } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";

// Days of a sample month (1 to 30) starting on a Wednesday; available weekdays from the 7th, the 15th selected.
const LEADING_BLANKS = 3;
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);
const SELECTED = 15;
const isAvailable = (d: number) => {
  const weekday = (LEADING_BLANKS + d - 1) % 7;
  return d >= 7 && weekday !== 0 && weekday !== 6;
};
const SLOTS = ["9:00am", "9:30am", "10:00am", "11:30am"];

export function SignupIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[460px] select-none">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-embed)]">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-mist text-label text-ink">JD</span>
          <div className="min-w-0">
            <p className="text-body-sm text-ink-2">Jordan Diaz</p>
            <p className="text-title-sm text-ink">30 Minute Meeting</p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1 text-body-sm text-ink-2">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              30 min
            </span>
            <span className="inline-flex items-center gap-1">
              <Video className="size-3.5" />
              Web conferencing
            </span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-4">
          <div>
            <p className="mb-2 text-label-sm text-ink">Select a Date &amp; Time</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-2">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={`${d}${i}`} className="py-0.5 font-semibold">
                  {d}
                </span>
              ))}
              {Array.from({ length: LEADING_BLANKS }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {DAYS.map((d) => (
                <span
                  key={d}
                  className={cn(
                    "mx-auto inline-flex size-6 items-center justify-center rounded-full text-[10px]",
                    d === SELECTED
                      ? "bg-primary font-bold text-white"
                      : isAvailable(d)
                        ? "bg-primary-soft-2 font-bold text-primary-text"
                        : "text-ink-2",
                  )}
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
          <div className="flex w-[104px] flex-col gap-1.5 pt-6">
            {SLOTS.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "rounded-[var(--radius-slot)] border py-1.5 text-center text-[11px] font-bold",
                  i === 1 ? "border-ink-2 bg-ink-2 text-white" : "border-primary/50 text-primary-text",
                )}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -right-4 -bottom-8 flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-white px-4 py-3 shadow-[var(--shadow-pop)] lg:-right-10">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-success-soft text-success-text">
          <CalendarCheck2 className="size-5" />
        </span>
        <div>
          <p className="text-label-sm text-ink">New event scheduled</p>
          <p className="text-body-sm text-ink-2">Thu, Oct 15, 9:30am</p>
        </div>
      </div>
    </div>
  );
}

export function SignupPitch() {
  return (
    <div className="max-w-[460px]">
      <p className="text-eyebrow text-primary-text">{APP_NAME}</p>
      <h2 className="mt-3 text-headline-2 text-ink">Easy scheduling ahead</h2>
      <ul className="mt-6 flex flex-col gap-3 text-body text-ink">
        {[
          "Share your link and let people book time with you",
          "Connect your calendar so you are never double booked",
          "Remind invitees by email before every meeting",
        ].map((t) => (
          <li key={t} className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-white">
              <Check aria-hidden="true" className="size-3.5" />
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
