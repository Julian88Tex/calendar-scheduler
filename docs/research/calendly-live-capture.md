# Calendly live capture (public booking flow, 2026-10-14)

Captured read-only from the owner's public page (`/julianjoseph` > In-Person Meal or Coffee > Oct 25 > 1:00pm > Next)
in a cloud browser at 1440x900, America/Los_Angeles. Network traffic was recorded as a HAR, trimmed to Calendly API
and document responses with cookies and auth headers removed, and analyzed with REA (`inspect-web-network-capture`).
Screenshots are in `.reference/live/*.png` (gitignored, contain the owner's photo: view them, never commit or embed).
No invitee data was entered and nothing was booked.

## Booking API shape (what Calendly's own booking SPA calls)

| Call | Purpose | Notes for Kairos |
|---|---|---|
| `GET /api/booking/profiles/{slug}` | name, avatar_url, logo_url, description (welcome message), timezone | profile page header |
| `GET /api/booking/profiles/{slug}/event_types` | name, slug, color, description, uuid | profile page list; only public, active types |
| `GET /api/booking/event_types/lookup?profile_slug&event_type_slug` | full public event type | see fields below |
| `GET /api/booking/event_types/{uuid}/calendar/range?timezone&diagnostics&range_start&range_end` | days with status and spots | `diagnostics=true` is the host-only Troubleshoot overlay on the booking page; returns `diagnostic_data` and `current_user.diagnostics.{available,enabled}` |

Event type lookup fields worth matching:
- `duration` 120, `duration_options` [] (multiple durations off), `kind_name` one_on_one, `booking_method` instant.
- `period_type` "moving" with `max_booking_time` 86400. The unit is minutes (86400 min = 60 days; `last_availability`
  is exactly 60 days out).
- `custom_fields`: `{name, format: "text", required, position, answer_choices, include_other}`. The owner's one question
  is a required multi-line text ("What would you like to discuss?").
- `location_configurations`: 8 `physical` entries (`location` is the display text, may contain a newline before notes,
  e.g. "The Reading Club - Embarcadero - $$$\n[Business Casual Dress Code]") then 1 `ask_invitee` (label
  "Somewhere else"). Addresses are not sent to the browser before booking.
- `invitee_name_format` "combined" (one Name field), `guests_allowed` true, `booking_autofill` true.
- `another_event_button_enabled` true with "Schedule another event" on the confirmation page.
- `sms_reminder_enabled` true: the details form shows "Send text messages to" with a phone field and SMS consent copy.
  SMS is out of scope (docs/SCOPE.md); this is listed as an open question for the owner.
- `confirmation_page_type` internal, `redirect_configuration` null.

Calendar range response: `days[]` of `{date, status: available|unavailable, spots[{status, start_time (ISO with
offset), invitees_remaining}]}`, plus `today` and `availability_timezone`. Start times in the capture are on 15 minute
increments.

## Visual parity checklist (Calendly vs Kairos booking pages)

Event page, calendar step (`04-time-selected.png`):
1. Back arrow is a circular outline button at the top left of the LEFT panel, level with the logo, on every step
   (calendar and details). Kairos puts it above "Enter Details" in the right panel.
2. Left panel: logo block on top, divider, then small avatar, host name (gray, semibold), event name (bold, ~26px),
   "2 hr" with a clock icon. With multiple locations the left panel lists NO locations (Kairos lists "In-person
   meeting" and "Somewhere else").
3. Today's date has a small dot under the number. Available days: light blue circle with bold blue number.
   Selected day: solid blue circle with white number. Unavailable days: plain gray number, no circle.
4. Selected time: the time button turns solid gray (#8292a2-ish) with white text and a blue "Next" button appears to
   its right, each half width. Other time buttons: blue outline, blue bold text, ~50px tall.
5. Time zone: "Time zone" label, then globe icon + "Pacific Time - US & Canada (2:18pm)" + caret.
6. Footer links at the bottom of the left panel: "Cookie settings" and "Privacy Policy" (Kairos shows "Report abuse").

Details step (`05-details-form.png`):
7. "Enter Details" heading with the Name label directly under it (tight spacing). Labels bold 14px; the required
   asterisk is a small dark "*", not red.
8. Inputs ~40px tall, 1px gray border, 8px radius. Multi-line answer textarea ~2 rows (56px) with resize handle.
9. "Add guests" (sentence case) is a pill with blue outline and blue text.
10. Location: plain radio rows (no bordered cards, no address line), radio then pin icon then label; long labels wrap
    under the label text. Last row "Somewhere else".
11. Left panel adds the time range "1:00pm - 3:00pm, Sunday, October 25, 2026" (calendar icon) and the time zone
    name (globe icon) under the duration.
12. Terms line: "By proceeding, you confirm that you have read and agree to {Brand}'s Participant Terms and Privacy
    Notice." with both names as blue bold links.
13. "Schedule Event" pill button ~40px tall, 14px semibold.
14. The card is ~1060px wide at 1440 viewport, left panel ~370px.

More reference shots (same folder): `d01-30min-calendar.png` (Google Meet event, opened directly), `d02-timezone-open.png`,
`d03-30min-details.png`, `d04-validation.png`, `d05-guests.png`, and phone width (390x844) `m01-profile.png` to
`m05-details.png`.

15. The back arrow only appears when the visitor came from the profile page (`?back=1`); opened directly, the event
    page has no back arrow and the logo is centered.
16. Google Meet event, left panel: video camera icon + "Web conferencing details provided upon confirmation."
    under the duration (gray semibold, wraps).
17. Time zone picker (popover anchored over the calendar): search input with magnifier ("Search..."), a header row
    "TIME ZONE" with an "am/pm [toggle] 24h" switch, region groups in caps ("US/CANADA", then others), each row the zone
    name (wrapping) with its current local time right-aligned, the selected row tinted light blue. The trigger button
    gets a gray pill background and an up caret while open.
18. Validation on submit: red 1px border on each empty required field and, below it, a red warning-triangle icon with
    "Can't be blank." (red text, 13px). Focus does not jump to a summary.
19. "Add guests" swaps into a "Guest email(s)" label with a ~80px textarea (blue 2px focus ring) and the helper text
    "Notify up to 10 additional guests of the scheduled event." beneath it.
20. Phone width: single column; the profile header (logo, avatar, name, event name, duration) stacks above the
    calendar; check the m0x shots for exact order and the full-width time buttons.
    Phone details seen in the shots: the calendar step is titled "Select a Day" (desktop: "Select a Date & Time"); a
    header bar holds the back arrow on the left and a small logo centered, then a divider, then the large avatar,
    host name, event name, duration and conferencing lines centered/left as shown; picking a day opens a separate
    "times" screen: weekday as the title ("Thursday"), the date under it ("October 15, 2026"), the time zone picker,
    a divider, "Select a Time", "Duration: 30 min", then full-width time buttons. Footer shows only "Cookie settings".
