# Observations from the owner's live Calendly account (read-only API inspection, 2026-10-11)

The owner granted read-only access to their Calendly account for backend research. Nothing was changed.
No invitee personal data is recorded here, only object shapes and behaviors. Treat these as ground truth
for how Calendly models things; mirror them in our schema and behavior.

## Account
- User: slug `julianjoseph`, timezone `America/Los_Angeles`, `time_notation: "12h"`, locale `en`.
- Organization kind `single`, plan `standard`, stage `paid`. No routing forms.
- Booking page renders in the INVITEE's detected time zone (a New York scraper saw "Eastern Time - US & Canada"),
  even though the host's zone is Los Angeles.

## Event types (all `kind: "solo"`, `type: "StandardEventType"`, `booking_method: "instant"`, `pooling_type: null`)
| name | slug | duration | color | schedule | locations |
|---|---|---|---|---|---|
| 30 Minute Virtual | 30min | 30 | #8247f5 | "Working hours" (default) | google_conference |
| 60 Minute Virtual | 60min | 60 | #8247f5 | "Working hours" (default) | google_conference |
| In-Person Meal or Coffee | meal | 120 | #17e885 | "Block Off Work" | 8 x physical + ask_invitee |

Fields present on every event type: `active, admin_managed, booking_method, color, created_at, custom_questions[],
deleted_at, description_html, description_plain, duration, duration_options[], internal_note, is_paid, kind, locale,
locations[], name, pooling_type, position, profile{type,name,owner}, scheduling_url, secret, slug, type, updated_at, uri`.

- `position` orders event types on the profile page (0, 1, 2).
- Custom question shape: `{name, type, position, enabled, required, answer_choices[], include_other}`.
  All three use one required question "What would you like to discuss?" of type `text`.
- MULTIPLE LOCATIONS: the meal event offers 9 location options; the invitee picks one at booking. Each physical
  location has `location` (display name, can contain a newline and notes such as "[Business Casual Dress Code]")
  and `additional_info` (the street address). The last option is `ask_invitee` (invitee types their own location).
  Example names follow "Venue - Neighborhood - $$" patterns. Seed our demo with similar but generic data.
- Location kinds Calendly supports for this user (`locations-list_user_meeting_locations`):
  `physical, ask_invitee, custom, outbound_call (host calls invitee), inbound_call (invitee calls host),
  zoom_conference (connected), gotomeeting_conference, google_conference (connected),
  microsoft_teams_conference, webex_conference`.
  Location object fields: `{kind, location, additional_info, phone_number}`.

## Availability schedules
- Two named schedules, both `timezone: America/Los_Angeles`; one is `default: true` ("Working hours"),
  the other "Block Off Work" is selected only by the meal event type (per-event-type schedule choice).
- Rule shape: `{type: "wday", wday: "sunday".."saturday", intervals: [{from: "HH:MM", to: "HH:MM"}], date: null}`;
  date overrides use `{type: "date", date: "YYYY-MM-DD", intervals: [...]}` (empty intervals = unavailable).
- Working hours: Sun 14:00-19:00, Mon 12:00-17:00, Tue 11:00-23:00, Wed 11:00-23:00, Thu 11:00-20:00,
  Fri 11:00-17:00, Sat unavailable (empty intervals).
- Block Off Work: Sun 13:00-21:00, Mon 17:00-17:00 (zero-length interval, i.e. effectively unavailable; Calendly
  allows it, our engine must treat zero-length intervals as no availability), Tue-Thu 17:00-20:00, Fri 17:00-17:00,
  Sat missing.
- `event_types-list_event_type_availability_schedule` returns `availability_setting: "host"` plus the schedule used.

## Slot generation behavior (verified from available_times)
- Start time increments are 15 minutes for 30, 60 and 120 minute events (not equal to duration).
- A slot must fit entirely inside an availability interval: for the 120-minute meal event on Tue 17:00-20:00 PT,
  slots are 17:00, 17:15, ..., 18:00 PT (last start = end - duration).
- BUFFERS: scheduled events show `buffered_start_time = start - 15min` and `buffered_end_time = end + 15min`, so the
  30min event has 15 min buffer before and after. Buffers are enforced against EXTERNAL calendar busy blocks too:
  with a busy block ending 21:45Z the next offered start was 22:00Z, and with a busy block starting 19:00Z the last
  offered start before it was 18:15Z (18:15 + 30 + 15 = 19:00).
- ALL-DAY events on connected calendars block the whole day (a busy block 07:00Z to 07:00Z next day, i.e. a full
  Pacific day, removed every slot that Monday).
- Overlapping/duplicate busy blocks are returned separately (dedupe/merge in our engine).
- `invitees_remaining: 1` for solo events (group events would show remaining seats).
- Each available slot has a direct `scheduling_url` of the form `/{user}/{event_slug}/{ISO8601 UTC start}`, e.g.
  `/julianjoseph/30min/2026-10-13T18:00:00Z`; this path is the invitee details form for that slot. Mirror it.
- Calendar conflicts produced multi-week gaps (no slots Oct 28 to Nov 17) while slots resumed afterwards, so
  there is no short rolling-window limit on this account (date range is long or indefinite).

## Busy times API shape
`{type: "external" | "calendly", start_time, end_time, buffered_start_time, buffered_end_time, event}`;
external calendar blocks have null buffered times (buffers are applied by the event type being booked).

## Scheduled events and invitees
- Scheduled event fields: `uri, name, meeting_notes_plain, meeting_notes_html, status ("active"|"canceled"),
  start_time, end_time, event_type, location{type, status ("pushed"), join_url}, invitees_counter{total, active, limit},
  created_at, updated_at, event_memberships[{user, user_email, user_name, buffered_start_time, buffered_end_time}],
  event_guests[], cancellation{canceled_by, reason, canceler_type ("host"|"invitee"), created_at},
  calendar_event{kind ("google"), external_id}`.
- Google Meet join links are exposed as a STABLE redirect URL on the scheduling domain
  (`/events/{event_uuid}/google_meet`) that forwards to the real Meet URL. Mirror this: `/events/{id}/join`.
- HOST-SIDE CALENDAR SYNC: when the host moved the Google Calendar event, Calendly canceled the old scheduled event
  with `cancellation.reason = "Rescheduled from connected calendar event"`, `canceler_type: "host"`, and created a new
  scheduled event at the new time that reuses the same `calendar_event.external_id`. So Calendly watches the
  destination calendar event for changes (time moved or event deleted) and mirrors them. We should implement this
  (Google push notifications or periodic sync of the events we created: moved -> reschedule, deleted -> cancel).
- Invitee fields: `uri, email, first_name, last_name, name, status, questions_and_answers[{question, answer, position}],
  timezone (invitee's zone), event, created_at, updated_at, tracking{utm_campaign, utm_source, utm_medium,
  utm_content, utm_term, salesforce_uuid}, text_reminder_number, rescheduled (bool), old_invitee, new_invitee
  (links across a reschedule chain), cancel_url (/cancellations/{invitee_uuid}), reschedule_url
  (/reschedulings/{invitee_uuid}), routing_form_submission, cancellation, payment, no_show, reconfirmation,
  scheduling_method ("instant_book"), invitee_scheduled_by (user who booked on the invitee's behalf, if any)`.
- Reschedule chains: the new invitee points to `old_invitee`; the old one gets `new_invitee` and `rescheduled: true`.
