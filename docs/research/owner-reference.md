# Owner reference: the owner's live Calendly page

The owner pointed us to their live Calendly page (https://calendly.com/julianjoseph) as the reference experience.
Two screenshots captured on 2026-10-11 are stored locally (git-ignored, they contain the owner's photo) at:

- `.reference/profile.png` (public profile page, 1920x1080)
- `.reference/booking-30min.png` (event booking page "30 Minute Virtual", 1920x1080)

Open them with the Read tool to see the exact look. Do not commit them and do not embed the owner's photo anywhere.

## What the owner uses today (use as seed/demo data and as the golden path)

Profile page (`/julianjoseph` in our app terms: `/{username}`):
- Centered white card (about 1060px wide) on a `#fafafa` page background, thin border, very subtle shadow.
- Round avatar (about 64px) centered at top, host name below in `#476788` semibold 16px.
- Welcome message centered, `#476788`, 14px, max width about 280px:
  "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar."
- Event types listed in a 2-column grid. Each item: top border divider `#d4e0ed`, colored filled circle (26px), event name in `#0a2540` bold 16px, and a small dark right-pointing triangle at the far right. Items are tall (about 220px rows) with whitespace below the title.
- Owner's event types:
  1. "30 Minute Virtual", slug `30min`, 30 min, color purple `#8247f5`, location: web conferencing ("Web conferencing details provided upon confirmation.")
  2. "60 Minute Virtual", slug `60min`, 60 min, color purple `#8247f5`, web conferencing
  3. "In-Person Meal or Coffee", slug `meal`, 2 hr, color green `#17e885`, in-person
- Footer link "Cookie settings" in blue `#004eba`.
- A diagonal "POWERED BY Calendly" ribbon in the top-right corner of the card (dark gray `#505960`). Our equivalent: an optional "Powered by <AppName>" ribbon that can be hidden in branding settings.

Event booking page (`/{username}/{eventSlug}`, URL gets `?month=2026-10` appended, and `?back=1` when coming from the profile):
- Single white card (about 800px wide) split into two columns by a vertical divider `#d4e0ed`.
- Left column: top section with a large company logo/avatar (about 120px round) and a horizontal divider below; then small avatar (64px), host name `#476788` semibold, event name `#0a2540` bold 28px, then icon rows (clock icon + "30 min"; video icon + "Web conferencing details provided upon confirmation.") in `#476788` semibold 14px. Bottom: "Cookie settings" and "Privacy Policy" links in blue.
- Right column: heading "Select a Date & Time" `#0a2540` bold 20px. Month navigation "< October 2026 >" centered (prev arrow gray when at current month, next arrow blue). Weekday header Sun..Sat (small, `#476788`). Days grid: unavailable days are plain gray-blue text `#476788`; AVAILABLE days are bold blue text (`#0060e6`-ish) on a light blue filled circle (`#f4f8ff` / `#e8f0fd`, about 44px). Today shows a small dot under the number. Leading/trailing days of other months are blank.
- Below the calendar: "Time zone" label (bold, `#0a2540`) and a dropdown button with a globe icon: "Eastern Time - US & Canada (6:53pm)" (friendly zone name + current local time) and a caret.
- After clicking a date (Calendly behavior), the card widens and a third column shows the weekday/date heading and a vertical list of time buttons (blue outline, blue text); clicking one splits it into a gray selected time and a blue "Next" button.
- Observed availability pattern in October 2026: Tue to Fri plus Sundays available, Mondays and Saturdays not, and nothing after about Oct 28 (rolling date range limit). Treat as a typical custom schedule with a rolling window.

## Color tokens observed (booking pages)
- Heading text: `#0a2540`
- Secondary text: `#476788`
- Link / primary blue on booking pages: `#004eba` (the app UI primary is Calendly blue `#006bff`)
- Available date circle background: `#f4f8ff` to `#e8f0fd`, text bold blue `#0060e6`
- Dividers and borders: `#d4e0ed`
- Page background: `#fafafa`; cards `#ffffff`
