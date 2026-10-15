// Small display helpers of the booking pages (docs/research/calendly-live-capture.md items 10 and 20). Pure and client
// safe; dates are local "YYYY-MM-DD" strings, so no time zone math happens here.
//
//   weekdayTitle(date)       "Thursday": the phone times view title
//   longDate(date)           "October 15, 2026": the line under it
//   runOnLabel(label)        a location label whose stored newline before the notes runs on as a space, so long
//                            labels wrap like Calendly's ("The Reading Club - $$$ [Business Casual Dress Code]")

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function weekdayTitle(date: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(utcDate(date));
}

export function longDate(date: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utcDate(date));
}

export function runOnLabel(label: string): string {
  return label.replace(/\s*\n\s*/g, " ").trim();
}
