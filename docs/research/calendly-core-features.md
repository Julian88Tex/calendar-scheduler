# Calendly core scheduling features: exhaustive inventory (2025-2026)

Research date: 2026-10-11. Scope: every core scheduling feature of Calendly, with settings, options, defaults,
limits and edge cases, so our clone can match it "as close as absolutely possible". Meeting Polls are covered only
as an entry point (section 13); a separate document should go deep on them.

How to read this document:

- Every fact carries an inline source. Most sources are current Calendly Help Center articles
  (`calendly.com/help/...`, all updated Aug to Sep 2026), plus Calendly Community answers by Calendly staff,
  Calendly blog posts, the public API reference, and a captured copy of Calendly's own booking-page
  translation strings (English locale) from urlscan.io.
- Items marked **(observed)** come from the owner's live account research in
  [calendly-account-observations.md](./calendly-account-observations.md) and
  [owner-reference.md](./owner-reference.md). Those are ground truth and win over anything else here.
- Items marked **(unverified)** come from product memory of the 2020-2024 UI or from third parties and were not
  re-confirmed against a 2026 Calendly page. Build them, but treat exact wording as adjustable.
- "Clone note" paragraphs are our implementation guidance, not Calendly facts.
- Calendly renamed things several times: "Event Types" home became "Scheduling" (May 2025); "Scheduled Events"
  became "Meetings" and then "Calendar"; "Workflows" are now called "Automations" in most 2026 articles. This
  document uses the current names and mentions the old ones.
- Plan gating: Calendly gates many features by plan (Free, Standard, Standard Plus, Teams, Teams Plus,
  Enterprise). Our clone is single-owner and self-hosted, so the clone should expose everything. Plan notes are kept
  only so we know which features Calendly considers "advanced".

---

## Table of contents

1. Information architecture (where things live)
2. Event types
3. Scheduling rules per event type (date range, notice, buffers, limits, increments, time zone, free/busy rules)
4. Availability (schedules, date-specific hours, holidays, troubleshooting)
5. Booking page and invitee experience
6. Cancellation, rescheduling, no-shows, blocking
7. Notifications and Automations (Workflows)
8. Calendar connections
9. Conferencing integrations
10. Scheduled events dashboard (Meetings / Calendar page)
11. Payments (core booking-flow parts)
12. Branding, links, account and privacy settings
13. Meeting polls and one-off meetings as entry points
14. Data model reference (API object shapes and enums)
15. Slot engine rules (consolidated, for our availability library)
16. Defaults and limits cheat sheet
17. Gaps, ambiguities and recommendations
18. Source index

---

## 1. Information architecture (where things live)

Left navigation in the current app (2026):

| Area | What it holds | Source |
|---|---|---|
| Scheduling (home) | Tabs: **Event Types**, **Single-use links**, **Meeting Polls**. "+ Create" button (event type kinds, plus "More ways to meet": One-off meeting, Meeting poll). "My Calendly" dropdown to switch between your page, team pages, other users (admins). | [Community: new homepage, May 2025](https://community.calendly.com/featured-tips-tricks-32/new-homepage-and-single-use-links-experience-3914?postid=12058), [How to organize event types](https://calendly.com/help/how-to-organize-and-manage-your-event-types) |
| Calendar (formerly Meetings, formerly Scheduled Events) | Timeline of upcoming and past meetings, filters, export, details panel. | [How to manage your meetings](https://calendly.com/help/how-to-manage-your-meetings), [Community rename thread](https://community.calendly.com/how-do-i-40/index6.html) |
| Availability | Schedules (weekly hours, date-specific hours), Calendar settings (connections), Holidays / Advanced (account-wide limits). | [Availability overview](https://calendly.com/help/availability-overview), [Account settings overview](https://calendly.com/help/account-settings-overview) |
| Contacts | Auto-created contact profiles, hover cards, book/share from a contact. | [Contacts overview](https://calendly.com/help/contacts-overview) |
| Automations (formerly Workflows) | Automated emails and texts; templates library. | [Automations overview](https://calendly.com/help/automations-overview) |
| Routing | Routing forms (out of scope for this doc beyond mentions). | [Routing forms best practices](https://calendly.com/help/how-to-prevent-scheduling-with-non-business-or-unwanted-email-domains) |
| Integrations & apps | Zoom, Google Meet, Teams, Webex, GoTo, Stripe, PayPal, etc. | [How to schedule with video conferencing](https://calendly.com/help/how-to-schedule-with-video-conferencing) |
| Settings | Profile (General, Login), Calendar (Calendar, Availability, Advanced), Branding, My link, Notifications, Privacy (Booking, Blocked people, Cookies), Admin. | [Account settings overview](https://calendly.com/help/account-settings-overview) |

Clone note: mirror this navigation. Keep URLs stable: `/{username}` (landing page), `/{username}/{event-slug}`
(booking page), `/{username}/{event-slug}/{ISO start}` (details form for a slot), `/cancellations/{invitee_id}`,
`/reschedulings/{invitee_id}` (observed, and documented in
[SMS article](https://calendly.com/help/how-to-send-text-messages-with-automations)).

---

## 2. Event types

### 2.1 Kinds

Calendly has four event type kinds plus several entry points that produce bookable links.
([Event types overview](https://calendly.com/help/event-types-overview),
[Group overview](https://calendly.com/help/group-event-type-overview),
[Multi-person options](https://calendly.com/help/multi-person-scheduling-options-for-your-organization))

| Kind | Hosts : invitees | Notes | Calendly plan |
|---|---|---|---|
| One-on-one | 1 host : 1 invitee (plus up to 10 guests) | The default. API `kind: "solo"`, `pooling_type: null`. | All plans |
| Group | 1 host : many invitees per slot | Seat limit 2 to 9,999; slot stays open until full; optional "Display remaining spots". API `kind: "group"`. | Standard+ |
| Collective | many hosts : 1 invitee | Only times when ALL hosts are free. Everyone is added to the event. API `pooling_type: "collective"`. | Standard+ |
| Round Robin | many hosts, 1 assigned : 1 invitee | Rotates the meeting to one host by distribution rules. API `pooling_type: "round_robin"`. | Teams+ |
| Multiple host pools ("schedule with multiple groups of hosts") | required hosts + one host from each rotating pool | Combines Collective (always-attending hosts) with one or more Round Robin pools. API `pooling_type: "multi_pool"`. | Teams+ |
| One-off meeting | 1 host (+ up to 9 extra hosts) | A one-time meeting with hand-picked slots, not an event type on the page. API `type: "AdhocEventType"`. | All plans |
| Meeting poll | host(s) + up to 40 voters | Invitees vote on proposed times, host books the winner. API `booking_method: "poll"`. | All plans |
| Managed event | admin template assigned to users | One-on-one or Group templates with locked/synced sections. | Teams+ (locking) |

Sources: [Multiple host pools](https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts),
[Create Event Type API (pooling_type multi_pool)](https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA),
[APIs.io event type schema](https://apis.io/schemas/calendly/calendly-event-type/),
[One-off meeting](https://calendly.com/help/how-to-create-a-one-off-meeting),
[One-off web vs mobile](https://calendly.com/help/one-off-meeting-features-web-vs-mobile),
[Meeting polls overview](https://calendly.com/help/meeting-polls-overview),
[Managed events overview](https://calendly.com/help/managed-events-overview).

Rules and edge cases:

- You cannot convert one kind into another (for example one-on-one to group). Create a new event type instead.
  ([How to customize your event types](https://calendly.com/help/how-to-customize-your-event-types))
- Event types can be personal (your page), shared (co-owned with org members, no team page, auto-generated URL like
  `calendly.com/d/abc123/15-minute-meeting`, not shown on landing pages), or team (on a team landing page, custom
  link, created by owners/admins/team managers).
  ([Shared event types overview](https://calendly.com/help/shared-event-types-overview),
  [Customize scheduling links](https://calendly.com/help/how-to-customize-your-scheduling-page-links),
  [Multi-person options table](https://calendly.com/help/multi-person-scheduling-options-for-your-organization))
- Every host of a Collective/Round Robin event must be a Calendly user with a seat; invitees never need accounts.
  ([Multi-person options](https://calendly.com/help/multi-person-scheduling-options-for-your-organization))

Clone note: for a single-owner app, implement One-on-one, Group, Collective and Round Robin with "hosts" being the
owner plus optional extra host accounts (teammates) the owner invites. Store `kind` (solo | group) and
`pooling_type` (null | collective | round_robin | multi_pool) exactly like the API so we can reason about
combinations.

### 2.2 Creation flow and primary settings

Create: Scheduling page, "+ Create", choose the kind; the editor opens on the right with a live booking page preview.
([How to set up an event type](https://calendly.com/help/how-to-set-up-an-event-type))

Primary settings (always visible) ([How to customize your event types](https://calendly.com/help/how-to-customize-your-event-types),
[Event type editor overview](https://calendly.com/help/event-type-editor-overview)):

| Setting | Details, defaults and limits |
|---|---|
| Event name | Title invitees see. Default slug is generated from the name with hyphens (for example "Student office hours" becomes `student-office-hours`) ([Zapier guide](https://zapier.com/blog/how-to-use-calendly/)). Shares/single-use link name max 55 chars ([Create Share API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share)). |
| Event color | Color dot on cards and landing page; API stores hex `^#[0-9a-fA-F]{6}$` ([APIs.io schema](https://apis.io/schemas/calendly/calendly-event-type/)). Observed colors `#8247f5` purple, `#17e885` green (observed). |
| Duration | Minutes, 1 to 720 (12 hours) ([Create Event Type API](https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA)). UI offers presets (15, 30, 45, 60 min) plus custom (minutes or hours) **(unverified for exact preset list)**. Default 30 min for a new event **(unverified)**. |
| Multiple durations | "+ Add duration option": preset or custom; up to **4** options; "Make default" on hover sets the one shown first. Not available for Group events or Managed events. Paid plans. Invitee switches with a duration dropdown next to the clock icon ("30 min") below the event name; slots recompute for the chosen length. ([Multiple durations](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type)) API: `duration_options` max 4 unique values each 1 to 720, and `duration` must be one of them. |
| Location | One or many location options (section 2.3). |
| Availability | Date range, minimum notice, schedule (section 3). |
| Host(s) | You by default; Collective: "+ Add co-host"; Round Robin: host pool editor (section 2.10). |

"More options" (bottom of editor) reveals ([How to customize your event types](https://calendly.com/help/how-to-customize-your-event-types)):

| Section | What it controls |
|---|---|
| Description | Rich-text details shown on the booking page. API exposes both `description_plain` and `description_html`. |
| Limits and buffers | Buffer before/after, meeting limits per day/week/month (section 3). |
| Free/busy rules | "Choose what this meeting takes priority over": meeting exceptions you can book over (section 3.8). |
| Booking page options | Event link (slug), start time increments, time zone display (section 3.6). |
| Invitee form | Name format, guests, autofill, custom questions (section 5.4). |
| Payment | Stripe or PayPal (section 11). |
| Notifications and automations | Calendar invitation or email confirmation, reminders, follow-ups, cancellation policy, attached automations (section 7). |
| Confirmation page | Calendly confirmation page with links, or redirect (section 5.7). |

Additional settings on the event card menu: Event language, Event permissions, Secret.
([How to customize your event types](https://calendly.com/help/how-to-customize-your-event-types))

Internal note: "Add / edit internal note", visible only to your team, never to invitees. API field `internal_note`.
([Organize event types](https://calendly.com/help/how-to-organize-and-manage-your-event-types),
[APIs.io schema](https://apis.io/schemas/calendly/calendly-event-type/))

Preview: "Preview" at the bottom of the editor opens the booking page; owners see a "Troubleshoot" control on it.
([Event type editor overview](https://calendly.com/help/event-type-editor-overview))

Event language: per event type "Change invitee language" with English default plus French, Spanish, German, Dutch,
Portuguese (Brazil), Italian, Ukrainian. Localizes the booking page and all notifications; user-entered text (name,
description, questions) is not translated.
([Change event type language](https://calendly.com/help/how-to-change-your-event-type-language))

### 2.3 Location options

Location kinds ([Set the location](https://calendly.com/help/how-to-set-the-location-for-your-event-type),
[Create Event Type API](https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA),
observed):

| UI option | API `kind` | Host configures | Invitee sees / provides |
|---|---|---|---|
| In-person | `physical` | Address (`location`, max 255) and additional notes (`additional_info`, max 255). | Address shown on booking page and in invite. (Observed: name can contain newline and notes, address in `additional_info`.) |
| Phone call, host calls invitee | `outbound_call` | Nothing. | Required "Phone number" field on the form ("Require the invitee's phone number to help reduce no-shows"). |
| Phone call, invitee calls host | `inbound_call` | Host phone number (required). | Text "You will call the Host. Phone number will be provided upon booking completion." ([booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/)) |
| Google Meet | `google_conference` | Requires Google Calendar as "Calendar to add events to". | Link generated at booking. |
| Zoom | `zoom_conference` | Zoom OAuth connection. | Link generated at booking. |
| Microsoft Teams | `microsoft_teams_conference` | Teams Conferencing connection (M365 Business or O365 Education). | Link generated at booking. |
| Webex | `webex_conference` | Webex connection. | Link generated at booking. |
| GoTo Meeting | `gotomeeting_conference` | GoTo connection. | Link generated at booking. |
| Custom | `custom` | Free text or a static link; choose to display it on the booking page or only after booking. | Text or link. API: `hide_location` (only respected for a single custom location). |
| Ask invitee | `ask_invitee` | Optional prompt. | Location question on the form; labels "Somewhere else" / "Location", placeholder "Any location". |

Multiple locations:

- "+ Add location" lets the invitee choose among several options (one-on-one, and Collective per the video
  conferencing article). Error if none chosen: "One location must be selected."
  ([Set the location](https://calendly.com/help/how-to-set-the-location-for-your-event-type),
  [Video conferencing](https://calendly.com/help/how-to-schedule-with-video-conferencing),
  [booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/))
- Observed: the owner's meal event offers 9 options (8 physical + ask_invitee); each option has a `position`.
- You cannot tie different days or times to different locations in one event type; create separate event types.
  ([Set the location](https://calendly.com/help/how-to-set-the-location-for-your-event-type),
  [Community: per-day locations](https://community.calendly.com/how-do-i-40/set-event-type-options-per-day-741))
- Round Robin: each host sets their own location (or apply one to all hosts); invitees cannot pick unless there is
  at least one always-attending host; "I will call my invitee" (outbound call) is greyed out for Round Robin.
  ([Round robin location options](https://calendly.com/help/round-robin-meeting-location-options))
- Collective with video: assign one host as the meeting organizer (whose Zoom/Meet creates the link).
  ([Shared collective](https://calendly.com/help/how-to-set-up-a-shared-collective-event-type))

Display rules:

- Before booking, conferencing kinds show "Web conferencing details provided upon confirmation." (observed and
  [booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/));
  after booking: "Web conferencing details to follow." on confirmation if not yet generated.
- After booking, the location is included in the confirmation page, the calendar event, and email/text
  notifications. ([Set the location](https://calendly.com/help/how-to-set-the-location-for-your-event-type))
- A booked meeting's settings (including location) are locked; to change, update the event type and reschedule to
  the same date and time. Group events lock language, location and duration once anyone books.
  ([Set the location](https://calendly.com/help/how-to-set-the-location-for-your-event-type),
  [Group overview](https://calendly.com/help/group-event-type-overview))
- Unsupported video tools: use Custom with a static link (display at booking or after), or a note like "I'll send
  the video conferencing details before our meeting."
  ([Other video conferencing options](https://calendly.com/help/how-to-use-other-video-conferencing-options))

Clone note: keep the API `kind` enum verbatim. Add our extra kinds `jitsi` and `custom_link` as internal variants
but render them like Calendly's custom/conference rows. Expose a stable join URL `/events/{id}/join` (observed:
Calendly redirects Meet links through `/events/{event_uuid}/google_meet`).

### 2.4 Event type list management (Scheduling page)

([Organize and manage event types](https://calendly.com/help/how-to-organize-and-manage-your-event-types))

- Sections in "My Calendly" view: Personal event types, Shared, Team event types (only the ones you host).
- Search bar (by name or link) and Filter menu (host, owner, access permissions).
- Reorder by drag and drop on desktop; the order is used both on the Scheduling page and on the landing page. API
  field `position` (observed: 0, 1, 2).
- Hover quick actions on each card: **Book meeting**, **Offer time slots**, **Share availability** (paid; emails
  your link from Gmail/Outlook), **Create single-use link**; plus **Copy link**.
- Card three-dots menu: View booking page, Edit, Edit permissions, Add to website, Add/edit internal note, Change
  invitee language, Make secret / Make public, Duplicate, Event statistics (team event types: CSV of recent meeting
  activity per member), Delete (scheduled meetings remain unaffected), On/Off toggle.
- Bulk edit: select cards, then Delete, Toggle on/off, Copy availability from (team event types).
- Off: invitees cannot book and the scheduling link refuses new bookings.
- Secret: hidden from landing page but bookable by direct link; slashed-eye icon on the card; desktop only.
  ([Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings))
- Mobile app: Home tab shows the first five event types; "See all"; favorites; copy link, single-use link, book,
  share, view booking page, edit, on/off, clone, delete.
- Admin-managed events show an "admin managed" icon on the card.
  ([Managed events overview](https://calendly.com/help/managed-events-overview))
- Edge case: a Round Robin event left behind after a downgrade cannot be deleted ("Your current subscription does not
  include round robin event types").

Event type permissions (personal and shared event types): "Can edit", "Can view", "Delete permission", "Transfer
ownership" (host stays the same). Viewers can view/share/duplicate, book on behalf, view meetings, add meeting notes;
editors can also change settings, disable, manage hosts, reschedule, cancel, mark no-show; owners can also delete.
([Edit event type permissions](https://calendly.com/help/how-to-edit-event-type-permissions),
[Understand event type permissions](https://calendly.com/help/understand-event-type-permissions))

### 2.5 Sharing an event type

| Feature | Behavior | Source |
|---|---|---|
| Copy link | Standard booking URL `calendly.com/{user}/{slug}`. | [Organize event types](https://calendly.com/help/how-to-organize-and-manage-your-event-types) |
| Add to website | Inline embed, pop-up widget (floating button), pop-up text (link). Landing page embed (all active event types) or booking page embed (one event type). Options: hide event details, hide cookie banner, colors (paid), button text. | [Fine-tune availability (embed box)](https://calendly.com/help/how-to-fine-tune-your-availability-settings), [Customize your embed](https://calendly.com/help/how-to-customize-your-embed) |
| Offer time slots | Pick a date range ("Offer availability"), a "Displayed time zone", per date "Edit times" or "Remove date", then "Copy to clipboard" and paste into an email. Invitee clicks a time to go to the form, or a link to see all times. | [Offer time slots in an email](https://calendly.com/help/how-to-offer-time-slots-in-an-email) |
| Share availability (paid) | Email composer that sends from your connected Gmail/Outlook; custom message; optional reminder if the invitee has not scheduled in 1, 3 or 7 days. Replies land in your mailbox. | [Share availability with Gmail or Outlook](https://calendly.com/help/how-to-share-your-availability-with-gmail-or-outlook-in-calendly) |
| Single-use link | See 2.6. | [Create a single-use link](https://calendly.com/help/how-to-create-a-single-use-link) |
| Book meeting | Host books directly for an invitee (see 2.7). | [Book meetings in real time](https://calendly.com/help/how-to-book-meetings-in-real-time) |
| Pre-filled link | URL parameters (section 5.5). | [Pre-fill invitee information](https://calendly.com/help/how-to-pre-fill-invitee-information-in-your-calendly-link) |

### 2.6 Single-use links (and the merged "Customize once and share")

([Create a single-use link](https://calendly.com/help/how-to-create-a-single-use-link),
[Blog: single-use links, Aug 2025](https://calendly.com/blog/one-time-calendly-link),
[Community: new homepage, May 2025](https://community.calendly.com/featured-tips-tricks-32/new-homepage-and-single-use-links-experience-3914?postid=12058),
[Create Share API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share))

- Built from an existing event type via the "1x" icon or "Create single-use link" on the card.
- Optional contact (pre-fills name and email on the booking page).
- One-on-one: override meeting name, duration (and duration options), location, and availability (custom hours and
  date range). Group, Round Robin, Collective: contact info only.
- Customize Once and Share was merged into single-use links in May 2025 (right-rail editor).
- "Save and copy link" (or "Create & Copy Link"); paid: "Share" sends it via Gmail/Outlook with optional 1/3/7 day
  reminder.
- Expires after one booking; created one at a time. Scheduling > Single-use links tab lists them with view, share,
  duplicate, edit, delete, and booked status. Booked meetings appear on the Calendar page.
- URL form: `calendly.com/d/{code}/{slug}` (for example `https://calendly.com/d/abcd-brv8/15-minute-meeting`).
- API override fields: `name` (max 55), `duration`, `duration_options` (max 4), `period_type`
  (`moving` | `available_moving` | `fixed` | `unlimited`), `max_booking_time` (days, required for moving types),
  `start_date`/`end_date` (required for fixed), `hide_location`, `location_configurations[]`, `availability_rule`
  {`timezone`, `rules[]`}. Anything omitted inherits from the event type. Single-use scheduling link API also has
  `max_event_count`.

### 2.7 Book meeting (host books on behalf of an invitee)

([Book meetings in real time](https://calendly.com/help/how-to-book-meetings-in-real-time))

- From the Scheduling page (card hover), Contacts page, extension or mobile app.
- Invitee details (name, email), "+ Add guests"; optionally customize meeting name, duration, location for this
  booking only (not for Group events).
- Pick an available time, or "Override available times" to book outside availability (not for Round Robin; cannot
  override another host's busy calendar). "Time zone display" dropdown to view in the invitee's zone.
- Answer invitee questions on the invitee's behalf; "Book meeting".
- Invitee still gets the event type's notifications, reminders and automations. If text reminders are used, the
  invitee receives a text with a confirmation link to opt in before texts are sent.
- API: invitee has `invitee_scheduled_by` (observed) and export has "Invitee scheduled by" and "Scheduling method"
  columns ([Salesforce import mapping](https://calendly.com/help/how-to-import-missing-data-from-calendly-into-salesforce)).

### 2.8 Group event types

([Group overview](https://calendly.com/help/group-event-type-overview))

- "Invitee limit" section: minimum 2, maximum 9,999 per time slot. Optional "Display remaining spots" shows a live
  count to invitees. API exposes `invitees_remaining` per slot and `invitees_counter{total, active, limit}` per
  scheduled event (observed).
- Changing the limit affects future bookings only; for an already booked slot use Calendar page, select meeting,
  "Edit invitee limit", Apply.
- Group events use email confirmations, not calendar invitations; each invitee gets their own .ics that does not
  update for others. You cannot switch a group event to calendar invitations.
  ([Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications))
- Guests ("Add guests") are not available on group events.
  ([Advanced booking form features](https://calendly.com/help/advanced-booking-form-features))
- Multiple durations are not available on group events.
- Automations work, but the "Event is canceled" trigger is not supported for group events. Text messages only for
  group events with 100 or fewer invitees. Host SMS shows "(multiple invitees)" when more than one booked.
  ([Send texts with automations](https://calendly.com/help/how-to-send-text-messages-with-automations),
  [Community: multiple invitees](https://community.calendly.com/how-do-i-40/how-to-print-all-booked-invitee-names-in-reminder-text-email-457))
- Once booked, language, location and duration are locked (grey box). Workaround: duplicate, cancel original, book
  invitees on the new one.
- Reschedule/cancel per invitee: "Reschedule invitee", "Remove invitee"; canceling the meeting removes it for all.
  ([Reschedule](https://calendly.com/help/how-to-reschedule-a-meeting),
  [Cancel](https://calendly.com/help/how-to-cancel-a-meeting))
- Troubleshoot code GROUP: "Group event has max attendees".
- Free/busy rules cannot book over full Group meetings.
  ([Free/busy rules](https://calendly.com/help/free-busy-rules-overview))
- No-show can be marked per invitee.
  ([Mark no-shows](https://calendly.com/help/how-to-mark-no-shows-for-meetings))

### 2.9 Collective event types

([Team collective](https://calendly.com/help/how-to-set-up-a-team-collective-event-type),
[Shared collective](https://calendly.com/help/how-to-set-up-a-shared-collective-event-type))

- Slots appear only when every host is available (each host's schedule, calendars, Calendly meetings, buffers).
- Hosts: "+ Add co-host"; you can remove yourself.
- Availability: set the schedule per host, or "Set the same hours for all hosts".
- Location: one or multiple for invitee choice; with video, one host is the organizer.
- The calendar event is created on one team member's calendar; other hosts are added as guests.
  ([Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications))
- Troubleshoot code HOST: "One or more hosts are unavailable for a Collective event type."

### 2.10 Round Robin event types

([Round Robin distribution overview](https://calendly.com/help/round-robin-distribution-overview),
[Team round robin](https://calendly.com/help/how-to-set-up-a-team-round-robin-event-type),
[Shared round robin](https://calendly.com/help/how-to-set-up-a-shared-round-robin-event-type),
[Community: RR explained](https://community.calendly.com/how-do-i-40/round-robin-scheduling-question-help-neeeded-764))

- Host pool editor: members ("+ Add", "X" to remove) and distribution method.
- **Optimize/Maximize for availability**: offers any time at least one host is free. If several are free, highest
  priority wins (priority "stars" next to each host). Ties: the host least recently scheduled for this event type;
  remaining ties: random.
- **Optimize for equal distribution**: tracks Round Robin meeting counts per host over the period all current hosts
  have been on the event; a host who is 3 or more meetings ahead of another has their availability hidden until the
  others catch up (example: Jim 3, Karen 0 hides Jim; at 3-1 Jim is back; at 4-1 hidden again). Adding or removing a
  host resets everyone to 0. Switching method takes effect immediately and ignores history.
- Troubleshoot codes ROUNDROBIN ("No host is available based on the distribution rules") and UNFAIR ("Scheduling at
  this time would distribute meetings unfairly between assigned hosts").
- A Round Robin slot can be booked multiple times concurrently as long as distinct hosts are free.
- Rescheduling preference (Hosts section): "Reassign host(s) through round robin" (default) or "Use same hosts as
  original meeting". Host-side reschedule prompts to keep the assignment or choose a specific host.
- Invitees never see the host pool; they learn the assigned host after booking.
- Locations: per host or same for all; outbound call not supported.
- Event statistics CSV shows distribution per host.
- The event type's "max per day" limit applies to the event total, not per host; per-host caps come from Host
  Meeting Limits (launched around Oct 2025).
  ([Community: max per host](https://community.calendly.com/how-do-i-40/maximum-number-of-bookings-per-host-round-robin-760),
  [Community: per user limits](https://community.calendly.com/how-do-i-40/limit-number-of-events-per-day-per-user-4545))

### 2.11 Multiple host pools

([Schedule with multiple groups of hosts](https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts))

- Start from Collective or Round Robin; "+ Add co-host" for always-attending hosts; "Create rotating host pool" for
  each Round Robin pool (each with its own name, members and distribution method).
- Rescheduling preference: reassign through Round Robin or keep original hosts. Rescheduling from the Calendar page
  skips host choice and uses Round Robin logic.
- If all hosts are in pools, locations are set per host in the first pool.

### 2.12 One-off meetings

([Create a one-off meeting](https://calendly.com/help/how-to-create-a-one-off-meeting),
[Web vs mobile](https://calendly.com/help/one-off-meeting-features-web-vs-mobile))

- "+ Create" > More ways to meet > One-off Meeting. Set time zone, duration, additional hosts (up to 9 additional,
  which makes it collective).
- Pick slots on a calendar picker that shows your schedule and external events; you may select over non-Calendly
  events, over buffers of Calendly events, and outside available hours. "+ Add times" selects all free times of a
  day. Past times show an "unavailable" banner. Slots must be within 3 months of each other. Buffers and meeting
  show as one block.
- Details: name, location, description/agenda, optional settings; "Share meeting link"; editable URL ending;
  "View live page"; "Copy Link"; "Add times to email".
- "Reserve Times": places placeholder holds on your (and co-hosts') calendars; "Clear reserved times" from
  Scheduling > Single-use links. Troubleshoot code RESERVED.
- Pending until booked (classic: Scheduled Events > Pending; now Single-use links tab).
  ([Community: pending one-offs](https://community.calendly.com/how-do-i-40/meeting-not-showing-1142))

### 2.13 Managed events (admin)

([Managed events overview](https://calendly.com/help/managed-events-overview),
[Create and assign managed events](https://calendly.com/help/how-to-create-and-assign-managed-events))

- One-on-one or Group templates created in Settings > Managed events and assigned to people or groups.
- Per-section editing permission: disabled means locked and synced from the admin; enabled means the user can edit
  and admin updates no longer sync. Re-locking overrides user edits on the next update.
- Managed Workflows/Automations can be attached and apply to all assignees.
  ([Managed workflow](https://calendly.com/help/how-to-create-a-managed-automation))

Clone note: optional for a single owner. Model "locked sections" as a JSON of section flags if we ever add it.

---

## 3. Scheduling rules per event type

All of these live in the event editor: date range and notice under Availability; buffers and limits under
"Limits and buffers"; increments and time zone under "Booking page options".
([Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings))

### 3.1 Date range ("how far in advance")

| Option | Meaning | API `period_type` |
|---|---|---|
| Number of days into the future: **calendar days** | Rolling window of N calendar days from today. Default UI example "60 days". | `moving` + `max_booking_time` (days) |
| Number of days into the future: **week days** (old UI: "business days") | Rolling window of N weekdays. Third-party docs describe `available_moving` as "shows actual available slots for N days", so it may count only days that have availability **(unverified)**. | `available_moving` |
| Within a date range | Fixed start and end dates. | `fixed` + `start_date`, `end_date` |
| Indefinitely into the future | No limit. | `unlimited` |

Sources: [Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings),
[Create Share API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share),
[Toolhouse docs on period types](https://docs.toolhouse.ai/toolhouse/integrations/calendly).

- Default for a new event type: 60 rolling days **(unverified as default, but shown as the dropdown example)**.
- Troubleshoot code RANGE: "The date is outside your availability window."
- Observed: the owner's account shows no short rolling limit (slots resumed after multi-week gaps) while the booking
  page showed nothing after about Oct 28 (two observations; treat window as configurable).

Clone note: evaluate the window in the host schedule's time zone, inclusive of today. For "week days" count
Monday to Friday. Offer an option to count only "days with availability" to cover the ambiguous API semantics.

### 3.2 Minimum scheduling notice

- "Prevent last-minute bookings": minimum time between booking and meeting start; set in Availability > Date-range
  notice dropdown (example "4 hours"). ([Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings))
- Default: **4 hours** ("We opt for a 4-hour minimum scheduling notice (Calendly's default setting)").
  ([Calendly blog, Nov 2022](https://calendly.com/blog/steal-this-workflow-reducing-time-to-hire-candidate-experience))
- Units: minutes, hours, days **(unverified exact unit list)**.
- Troubleshoot code TOOSOON. PAST for times in the past.

### 3.3 Buffers

([How to use buffers](https://calendly.com/help/how-to-use-buffers))

- "+ Set buffer time": before and/or after the meeting, per event type. Values include 5 and 10 minutes
  ([Community](https://community.calendly.com/how-do-i-40/what-is-the-status-of-the-start-meetings-5-min-late-feature-2619));
  the classic dropdown offered 0, 5, 10, 15, 30, 45 min, 1 hr, 1.5 hr, 2 hr, 2.5 hr, 3 hr **(unverified)**.
- The full window (before + meeting + after) is checked against connected calendars and Calendly meetings. A
  30-minute meeting with 15/15 buffers needs 60 free minutes.
- Buffers do not prevent booking at the edges of working hours: a buffer may extend outside availability (only the
  meeting itself must fit inside an availability interval; observed: last 120-minute start is `end - duration`).
- Buffers protect existing meetings: a buffer around an existing Calendly meeting blocks new bookings from
  overlapping it. Buffers stack: two 30-minute meetings each with 15/15 buffers keep 30 minutes blocked between
  them ("double buffers"). Advice: use only a before or an after buffer.
- Observed: buffers are enforced against external busy blocks (a busy block ending 21:45Z gave next start 22:00Z
  with a 15-minute before-buffer; a busy block starting 19:00Z gave last start 18:15Z for 30 min plus 15 after).
- External events have no buffers of their own; buffers belong to the event type being booked and to each existing
  Calendly meeting (API `buffered_start_time`/`buffered_end_time`, observed).
- Already booked meetings keep their buffers; you can adjust or remove buffers for booked meetings from the
  Meetings page.
- Google/Outlook sync option "Include buffers on this calendar" writes buffer blocks as separate calendar events;
  deleting a buffer event in the calendar removes it in Calendly.
  ([Connect Google Calendar](https://calendly.mom/help/how-to-connect-your-google-calendar),
  [Connect Office 365](https://calendly.com/help/how-to-connect-your-office-365-or-outlook-com-calendar))
- One-off meetings can be placed over buffers of existing Calendly events.
- Troubleshoot code BUFFER.

### 3.4 Meeting limits (frequency limits)

([How to set meeting limits](https://calendly.com/help/how-to-set-meeting-limits))

- **Per event type**: Limits and buffers > Meeting limits > "+ Set limit": maximum meetings per **day**, **week**,
  and/or **month** (older UI had only "Max number of events per day").
- **Across all event types (host meeting limit)**: Settings > Scheduling > Advanced availability > "+ Add a meeting
  limit": max per day/week/month for the user; autosaves. Admins can view but not edit other users' host limits.
- Whichever limit is reached first makes you unavailable.
- Troubleshoot codes: DAILY MAX, WEEKLY MAX, MONTHLY MAX (event type), MEETING LIMIT (host).
- When a meeting is canceled, the spot reappears (community request text implies canceled meetings do not count)
  **(unverified for exact counting rules: which time zone, week start, canceled exclusion)**.

Clone note: count active (non-canceled) meetings whose start falls in the period, periods computed in the host
schedule time zone, week starting on the user's configured week start (default Sunday for en-US). For group events
count scheduled events, not seats.

### 3.5 Start time increments

([Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings),
[Community: start times](https://community.calendly.com/asked-answered-79/how-do-i-control-the-specific-start-times-that-appear-on-my-calendly-4679),
[Community: 15 vs 30](https://community.calendly.com/how-do-i-40/15-min-appts-are-only-allowing-30-min-booking-times-on-the-booking-page-2567))

- Label: "Start time increments" (classic: "Show available start times in increments of"). Booking page options.
- Default **30 minutes** for new event types. Examples of values: 5, 10, 15, 20, 30, 45, 60 minutes **(exact list
  unverified)**. Observed: owner uses 15-minute increments with 30, 60 and 120 minute events.
- Independent of duration and buffers; changing duration does not change increments.
- Starts are anchored to the start of each availability interval: a schedule starting 9:05 with 30-minute
  increments yields 9:05, 9:35, 10:05 ([Community](https://community.calendly.com/how-do-i-40/what-is-the-status-of-the-start-meetings-5-min-late-feature-2619)).
- Increments longer than duration prevent back-to-back bookings within one event type (for example 15-minute
  event, 30-minute increments). For spacing across event types use buffers.
- No "dynamic" increments (starts do not shift to right after existing meetings).

### 3.6 Time zone display

([Time zones overview](https://calendly.com/help/time-zones-overview),
[Fine-tune availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings))

- Default: automatically detect and show times in the invitee's time zone (observed: a New York visitor saw
  "Eastern Time - US & Canada" on a Los Angeles host's page).
- Option: "Lock the timezone" (recommended for in-person events): all invitees see the event's time zone.
  Classic labels: "Automatically detect and show the times in my invitee's time zone" vs "Lock the timezone (best
  for in-person events)" **(unverified wording)**.
- Invitees can change the zone from the booking page dropdown (searchable, shows current local time next to each
  option, for example "Eastern Time - US & Canada (6:53pm)" observed).
- If the invitee's browser zone differs from the displayed one, the page asks: "Would you like to view times in
  {local zone} instead?" "These times are currently listed in {zone}."
  ([booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/))
- 12h/24h: an "am/pm | 24h" toggle inside the Time Zone dropdown; host cannot force a format for invitees.
  ([Community: 12h vs 24h toggle](https://community.calendly.com/how-do-i-40/request-to-explicitly-show-12h-vs-24hr-toggle-on-booking-page-for-clients-5350),
  [Community: force 12h](https://community.calendly.com/how-do-i-40/force-time-format-to-12h-am-pm-on-booking-page-for-everyone-3220?postid=10422))
- DST handled automatically; labels may lag.
  ([Troubleshoot](https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available))

### 3.7 Which hours apply ("Use the hours from")

- Availability section: "Schedule:" dropdown to pick a named schedule, or "Custom schedule" (hours that apply only
  to this event type). ([Set your availability](https://calendly.com/help/how-to-set-your-availability))
- Event type time zone: click the zone under the hours to change it.
  ([Time zones overview](https://calendly.com/help/time-zones-overview))
- Team/shared: "set hours by host" (each host's own schedule or a custom one) or "Set the same hours for all hosts";
  "Apply to/from event types" icon copies hours.
  ([Manage availability for users](https://calendly.com/help/how-to-manage-availability-for-your-users))
- API: `availability_setting: "host"` by default (observed); event type availability rules
  `{type: "wday"|"date", wday, date, intervals[{from,to}]}` with IANA `timezone`.

### 3.8 Free/busy rules (book over specific meetings)

([Free/busy rules overview](https://calendly.com/help/free-busy-rules-overview),
[Community: overlapping meetings](https://community.calendly.com/featured-tips-tricks-32/overlapping-meetings-2957),
[Community: allowing overlaps](https://community.calendly.com/asked-answered-79/allowing-overlapping-meetings-in-calendly-4972))

- Section title "Free/busy rules", subtitle "Choose what this meeting takes priority over". All plans.
- "+ Add meeting exception": match mode **Includes** (partial title) or **Matches exactly**; type a title; Calendly
  lists the detected future events ("x meetings") which become bookable-over for this event type.
- Works for events on connected online calendars checked for conflicts and for Calendly meetings (by title); not with
  the Outlook plug-in. Cannot book over full Group meetings.
- Booking over a Calendly meeting does not cancel it; the host gets an overlap alert in the "New Event" email with
  "View in Calendly" to reschedule the original.
- Off by default; the feature runs only while exceptions exist (remove with X).
- Rescheduling still obeys normal availability (no override).
- Troubleshoot codes EVENT/OVERLAP suggest Free/busy rules.

Clone note: store exceptions as `{mode: "includes"|"exact", text}`; at slot time, ignore busy intervals whose title
matches. Calendar events created by our app always block unless an exception matches them.

---

## 4. Availability

### 4.1 Schedules

([Set your availability](https://calendly.com/help/how-to-set-your-availability),
[Availability overview](https://calendly.com/help/availability-overview),
[Blog: refreshed availability, Oct 2023](https://calendly.com/blog/redesigned-nav-event-types),
[Blog: getting started with availability](https://calendly.com/blog/getting-started-availability))

- Multiple named schedules; one is the default (observed: "Working hours" `default: true` and "Block Off Work").
  "+ Create schedule" (name, Create). "Active on" dropdown assigns a schedule to event types.
- **List view** (weekly repeating): per weekday "+" to add a day / "x" to make it unavailable; multiple time blocks
  per day ("+" adds a block, for example a lunch break as 9:00-11:30 and 12:30-16:30).
- **Calendar view** (non-weekly): click or drag over dates; for one day choose "Edit date" or "Edit all
  [weekday]".
- Copy hours: "Copy times to..." other days **(unverified label)**; "Apply to/from event types" for team events.
- Time zone per schedule: dropdown at the bottom of List view, searchable, shows local time per option, autosaves.
  Each schedule has exactly one time zone.
- Zero-length intervals (for example 17:00-17:00) are allowed and mean no availability (observed).
- Account settings also have Calendar > Availability tab for account-level defaults.
  ([Account settings overview](https://calendly.com/help/account-settings-overview))

### 4.2 Date-specific hours (formerly "date overrides")

- In List view: "+ Hours", choose one or more dates, add/remove time blocks, Apply. Removing all blocks marks the
  date unavailable. ([Set your availability](https://calendly.com/help/how-to-set-your-availability))
- Can be set as far into the future as you want.
  ([Blog Oct 2023](https://calendly.com/blog/redesigned-nav-event-types))
- Use for travel: enter hours in local time of the trip on those dates; one schedule still has one time zone.
  ([Time zones overview](https://calendly.com/help/time-zones-overview))
- Date-specific hours cannot override an active holiday.
  ([Edit holidays](https://calendly.com/help/how-to-edit-holidays-within-calendly))
- API: `{type: "date", date: "YYYY-MM-DD", intervals: []}`; empty intervals means unavailable.

### 4.3 Holidays

([Edit holidays](https://calendly.com/help/how-to-edit-holidays-within-calendly),
[Community: holidays](https://community.calendly.com/how-do-i-40/calendly-does-not-cover-the-holidays-1213))

- Settings > Scheduling > Advanced availability > Holidays (older: Availability > Holidays tab). Choose a country;
  per holiday On/Off (On = unavailable). Applies to all event types.
- Supported countries: Australia, Brazil, Canada, France, Germany, Mexico, Netherlands, Spain, United Kingdom,
  United States.
- Different behavior per event type: turn off the global block, then block the day via that event type's custom
  hours. (Older UI had a per-event "observed holidays: Show" list with per-holiday allow toggles.)
- Missing holiday: add date-specific hours or an all-day busy event.
- Troubleshoot code HOLIDAY.

Clone note: ship holiday data for at least these 10 countries (date-holidays style rules), keyed by year, with
per-holiday toggles stored per user.

### 4.4 Troubleshoot availability

([Troubleshoot unavailable times](https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available))

Open the event type preview while logged in, select "Troubleshoot" (toolbar strings: "Troubleshoot Availability",
"Stop troubleshooting", "Edit event type", "Copy link"), pick a date, and every time shows a reason code:

| Group | Code | Meaning |
|---|---|---|
| Calendar sync | CALENDAR | A "Busy" calendar event blocks the time. |
| Calendar sync | NOCAL | Calendly cannot access your calendar. |
| Event type | DAILY MAX / WEEKLY MAX / MONTHLY MAX | Event type meeting limit reached. |
| Event type | DURATION | Not enough time for the event. |
| Event type | RANGE | Outside the date range. |
| Event type | TOOSOON | Violates minimum notice. |
| Calendly meetings | EVENT | Another Calendly event of this event type is booked. |
| Calendly meetings | GROUP | Group event is full. |
| Calendly meetings | OVERLAP | Another Calendly event is booked. |
| Availability | HOLIDAY | Date marked as a holiday. |
| Availability | MEETING LIMIT | Host meeting limit reached. |
| Team | HOST | A Collective host is unavailable. |
| Team | ROUNDROBIN | No host available per distribution rules. |
| Team | UNFAIR | Would distribute unfairly. |
| Edge | BUFFER | A buffer blocks the time. |
| Edge | PAST | Time is in the past. |
| Edge | RESERVED | A poll or pending one-off holds the time. |

FAQs from the same article:

- Calendly keeps blocking times for events it created even if you mark them "Free" in your calendar; cancel or
  reschedule in Calendly, or use Free/busy rules.
- All-day "Busy" events block the whole day (also observed).
- If no dates show at all, review the event type's Availability settings.

The logged-in owner also sees "You are logged in as {email}. This message is only visible to you." on their own
booking page ([booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/)).

Clone note: make the slot engine return a reason code per candidate slot (same code names) so the troubleshooter
is a thin UI over the engine.

### 4.5 Ways to block time

Busy event on a connected calendar (recommended), holidays, date-specific hours, custom hours on one event type.
([Blog: getting started with availability](https://calendly.com/blog/getting-started-availability),
[Scheduling FAQ](https://calendly.com/help/scheduling-faq))

---

## 5. Booking page and invitee experience

### 5.1 Landing (profile) page

(observed in [owner-reference.md](./owner-reference.md); [Customize links](https://calendly.com/help/how-to-customize-your-scheduling-page-links))

- URL `calendly.com/{my-link}` (Settings > My link). Old link stops working after a change, no redirect.
- Centered card: avatar, name, welcome message (Settings > Profile), then active, non-secret event types in a two
  column grid ordered by `position`, each with color circle, name, and a right triangle. "Cookie settings" link.
  "Powered by Calendly" corner ribbon unless branding is off.
- Logo (Settings > Branding) appears top-left of booking pages.
  ([Company admin guide](https://calendly.com/help/company-admin-guide))
- Team landing pages show the team avatar, team welcome message and team event types.
  ([Community: branding](https://community.calendly.com/how-do-i-40/customize-calendly-to-reflect-your-company-s-branding-683))
- Event type link label on landing page: "Schedule a Time" (string `event_types_landing_page.event_type_link`).

### 5.2 Event booking page layout

(observed screenshot `.reference/booking-30min.png`; [owner-reference.md](./owner-reference.md))

- Left panel: logo/avatar header, small avatar, host name, event name (large, bold), icon rows: clock + duration (or
  duration dropdown when multiple durations), location row (video icon + "Web conferencing details provided upon
  confirmation."), price row when paid, description. Bottom links: "Cookie settings", "Privacy Policy".
- Right panel: "Select a Date & Time", month navigation ("Go to previous month" disabled at the current month,
  "Go to next month"), weekday header Sun..Sat (week start follows locale), available days are bold blue on light
  blue circles, unavailable days plain, today has a dot under the number.
- "Time zone" label and dropdown under the calendar.
- Clicking a date widens the card into three columns: weekday/date heading ("Select a Time" / date in `%A, %B %-d`
  format) and a vertical list of time buttons; clicking a time splits it into the selected time (grey) and a blue
  **Next** button. Clicking Next goes to `/{user}/{slug}/{ISO start}?month=YYYY-MM&date=YYYY-MM-DD` (observed URL
  shape; [Community deep link](https://community.calendly.com/api-webhook-help-61/scheduling-api-payments-behavior-5440)).
- Back arrow returns to the calendar; landing page link appends `?back=1` (observed).
- URL gains `?month=YYYY-MM` while browsing months and `&date=YYYY-MM-DD` when a date is selected.
- A week view with "This Week", "Next Week", "N Weeks Out" exists in the booking bundle (used by some layouts)
  ([booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/)).
- **Mutual availability**: invitees who are Calendly users can "Show times you're free" by signing in; their own
  busy events are overlaid ("Here's how Calendly will show times you're available", "conflict", "Looks like you're
  free this date!"). Same highlight exists for meeting polls
  ([Blog: meeting polls](https://calendly.com/blog/meeting-polls)).
- reCAPTCHA can be required ("Confirm you're human").
- Embed responsive layouts: large (container >= 1100px), medium (650 to 1099px), small (< 650px), min width 320px.
  ([Embed layout and sizing](https://calendly.com/help/how-to-control-your-embed-layout-and-sizing))

Clone note: prefetch a whole month of slots per request (Calendly's own API caps availability queries at 7 days per
call, and a newer endpoint 31 days, per
[developer guide](https://developer.calendly.com/schedule-events-with-ai-agents)); render days in the invitee's zone.

### 5.3 Invitee details form ("Enter Details")

([Advanced booking form features](https://calendly.com/help/advanced-booking-form-features),
[Add or remove invitee questions](https://calendly.com/help/how-to-add-or-remove-invitee-questions),
[booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/))

Order on the page (top to bottom):

1. Name: one field "Name" (default) or two fields "First Name" + "Last Name" (Invitee form > Invitee details).
2. Email (required).
3. "Add Guests" button revealing "Guest Email(s)" with helper "Notify up to 10 additional guests of the scheduled
   event." Guests on by default; toggle "Invitee guests" off. Not available for group events. Guests receive the
   invite; host sees guest names on the Calendar page.
4. Location choice (radio list) when multiple locations, or phone number when location is outbound call.
5. Custom questions (up to **10** per event type), in configured order.
6. SMS reminder opt-in ("Send text messages to" phone input) when text reminders/automations exist, with consent text
   "By entering your phone number, you consent to receive messages for this event via SMS. Message and data rates
   may apply. Reply STOP to opt out." This field can never be required. Russia and Singapore are rejected.
7. Optional marketing consent checkbox "I'd like to subscribe to future emails."
8. Payment block when payment is required.
9. Terms line: "By proceeding, you confirm that you have read and agree to Calendly's Invitee Terms and Privacy
   Notice."
10. Button **Schedule Event** (or "Update Event" when rescheduling, with "Reason for change").

Custom question settings:

| Field | Options |
|---|---|
| Question text | Free text; can include a plain-text link (clickable links go in the description). ([Consent questions](https://calendly.com/help/how-to-collect-consent-from-invitees-with-custom-questions)) |
| Required | Checkbox; required must be answered to book. |
| Answer type | One line (`string`), Multiple lines (`text`), Radio buttons (`single_select`), Checkboxes (`multi_select`), Dropdown (`single_select` rendered as select), Phone number (`phone_number`). |
| Answer choices | For radio, checkboxes, dropdown. |
| "Other" option | `include_other` adds an "Other" free-text choice for select types. |
| On/Off | Per question `enabled` toggle (keep but hide). |
| Position | Order (`position`). |

Validation messages: "Can't be blank." (text), "One answer must be selected." (radio and dropdown), "At least one
answer must be checked." (checkboxes), phone: "This phone number format is not recognized. Please check the country
and number." Dropdown placeholder "Select...".

Other form behaviors:

- Autofill invitee name, email and text reminder phone from prior bookings: checkbox, **off** by default.
- Answers are stored on the meeting, shown on the Calendar page, included in notifications by default (Standard+ can
  exclude them), exported in CSV.
- Routing forms only route on radio buttons and dropdowns.
- Consent pattern: a Checkboxes question with a single option.
- Email verification (optional per event type): after "Schedule Event", "Verify your email" screen, "To complete your
  booking, enter the 6-digit code sent to {email}", "Remember this device", "Didn't get it? Resend code",
  "Continue". Required on every booking; unverified attempts create no booking and no notification.
  ([Require email verification](https://calendly.com/help/how-to-require-email-verification-for-event-types))
- Slot race: "Sorry, that time is no longer available." / "Please select a different time to book this event." with
  a "View Times" button.

### 5.4 URL parameters

Pre-fill ([Pre-fill invitee information](https://calendly.com/help/how-to-pre-fill-invitee-information-in-your-calendly-link),
[Pre-fill in an embed](https://calendly.com/help/how-to-pre-fill-invitee-information-in-an-embed),
[Community: dropdown prefill](https://community.calendly.com/api-webhook-help-61/scheduling-page-url-parameter-dropdown-not-working-773)):

| Param | Effect |
|---|---|
| `name` | Full name. |
| `first_name`, `last_name` | When the form uses two fields. |
| `email` | Email. |
| `location` | Location answer; also the phone number for outbound-call location. |
| `a1` ... `a10` | Answers to custom questions by order. Text for text types. Radio/checkbox by 1-based option index (`a3=2,3`). Dropdown requires the exact answer text. |
| `guests` | Comma-separated guest emails. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Stored as tracking on the invitee; also `salesforce_uuid`. |

- Cannot pre-fill "Other" free text or the SMS reminder number.
- Values are URL encoded (`%20` for spaces); join with `&`.

Display and navigation params:

| Param | Effect | Source |
|---|---|---|
| `month=YYYY-MM` | Open on a month. | observed, [Community](https://community.calendly.com/api-webhook-help-61/scheduling-api-payments-behavior-5440) |
| `date=YYYY-MM-DD` | Preselect a date (show its times). | same |
| `/{ISO datetime}` path segment | Open the details form for that exact slot. | same, observed |
| `hide_event_type_details=1` | Hide photo, name, duration, location, description on event pages. | [Customize your embed](https://calendly.com/help/how-to-customize-your-embed) |
| `hide_landing_page_details=1` | Same for landing/team pages. | same |
| `hide_gdpr_banner=1` | Hide the cookie banner. | same |
| `background_color`, `text_color`, `primary_color` (hex without #) | Colors; paid plans. `primary_color` drives buttons and links. | same |
| `back=1` | Show back navigation to the landing page. | observed |

### 5.5 Embeds and client events

([Advanced embed for developers](https://calendly.com/help/advanced-calendly-embed-for-developers),
[Customize your embed](https://calendly.com/help/how-to-customize-your-embed),
[nuxt-calendly types](https://github.com/madebyfabian/nuxt-calendly/blob/main/src/runtime/types/index.d.ts))

- `widget.js` and `widget.css`; `Calendly.initInlineWidget({url, parentElement, prefill, utm, pageSettings,
  resize})`, `Calendly.initPopupWidget`, `Calendly.initBadgeWidget({url, text, color, textColor})`.
- Prefill object: `name`, `firstName`, `lastName`, `email`, `smsReminderNumber`, `location`, `guests[]`,
  `customAnswers{a1..a10}`, `date`.
- Badge widget defaults bottom-right; button text default "Schedule", text auto black/white for contrast.
- `postMessage` events to the parent window: `calendly.profile_page_viewed`, `calendly.event_type_viewed`,
  `calendly.date_and_time_selected`, `calendly.event_scheduled` (payload has `event.uri` and `invitee.uri`). Plain
  iframes get no resize or events.
- Auto-resize (`data-resize="true"`): one per page; avoid dropdowns.

Clone note: ship a compatible `widget.js` so existing Calendly embeds can be repointed with a URL swap.

### 5.6 Confirmation page and redirect

([Add links to the confirmation page](https://calendly.com/help/how-to-add-links-to-the-event-confirmation-page),
[Redirect invitees](https://calendly.com/help/how-to-redirect-invitees-to-another-site-after-booking),
[booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/))

"After booking" options:

1. **Display confirmation page** (default). Shows "Confirmed" / "You are scheduled" / "You are scheduled with
   {name}.", the event name, host, time range plus full date in the invitee's zone (for example "19:00 - 19:45,
   Monday, August 19, 2025"), time zone name, location or "Web conferencing details to follow.", and "A calendar
   invitation has been sent to your email address." (or "A confirmation has been sent to your email address.";
   with payment "... and payment receipt ..."). Optional "schedule another event" link (editable link name, on/off)
   that returns to the same event type, plus any number of custom links ("+ Add new link": name and URL). Free
   plan pages also show a "Schedule your own meetings with Calendly for free" sign-up promo.
2. **Redirect to an external site** (paid): URL plus optional "Pass event details to your redirected page", which
   appends: `event_type_name`, `event_type_uuid`, `event_start_time`, `event_end_time` (invitee zone, ISO 8601),
   `guests`, `assigned_to`, `invitee_uuid`, `invitee_email`, `invitee_first_name`, `invitee_last_name`,
   `invitee_full_name`, `invitee_payment_amount`, `invitee_payment_currency`, `text_reminder_number`,
   `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `answer_1` ... `answer_10`.
   Page shows "You will be redirected to an external site." / "Redirecting".

Add to calendar: with email confirmations the invitee adds the .ics; the confirmation page and email offer "Add to
calendar" links for Google, Outlook, Office 365, and iCal/other **(unverified exact labels)**.

### 5.7 What the invitee receives

([Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications))

| | Calendar invitation | Email confirmation |
|---|---|---|
| Mechanism | Host's connected calendar creates the event and invites the invitee (and guests). | Calendly emails the invitee from notifications@calendly.com with an .ics attached. |
| Updates | Propagate (invitee is an event guest). | Static file, no updates. |
| Reply-to | Host's calendar email. | Host's Calendly login email, unless a no-reply address is set. |
| Title | Customizable for host and invitee calendar events (Standard+). Default pattern "Invitee Name and Host Name". | Subject customizable; host's calendar event title fixed. |
| Links | Must paste full URLs (no hyperlinks). | Hyperlinks allowed. |
| Required when | Google, Office 365, Outlook.com, Exchange connected. | Group events, iCloud, Outlook plug-in, or no calendar. |

- Calendly picks the type automatically; switch via the event type's notifications ("Switch to calendar invitation"
  / "Switch to email confirmation").
- Collective: one host's calendar holds the event; co-hosts are guests.
- Host always gets a booking notification email from notifications@calendly.com; cannot be turned off.
- Community confirmations on titles: [4757](https://community.calendly.com/how-do-i-40/event-title-changes-in-google-calendar-after-scheduling-4757),
  [4913](https://community.calendly.com/how-do-i-40/display-meeting-name-4913),
  [4969](https://community.calendly.com/asked-answered-79/customizing-booked-event-titles-to-show-invitee-names-in-calendly-4969).

### 5.8 Exact invitee-facing copy (English)

From Calendly's booking bundle ([urlscan capture](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/)):

| Key | String |
|---|---|
| select_date_and_time | Select a Date & Time |
| select_a_time | Select a Time |
| action.next / confirm | Next / Confirm |
| enter_details | Enter Details |
| event_guests | Add Guests; Guest Email(s); Notify up to 10 additional guests of the scheduled event. |
| schedule_event / update_event | Schedule Event / Update Event |
| scheduled / scheduled_with | You are scheduled / You are scheduled with %{name}. |
| confirmed_title | Confirmed |
| calendar_invitation_sent | A calendar invitation has been sent to your email address. |
| email_confirmation_message | A confirmation has been sent to your email address. |
| web_conference_preconfirmation / confirmation | Web conferencing details provided upon confirmation. / Web conferencing details to follow. |
| cancel_event | Cancel Event; Cancel Event?; Reason for canceling; Cancellation Confirmed; Your meeting with %{name} has been canceled.; This event will be canceled for %{invitee_name} and %{count} guests |
| reschedule | Reschedule Event; Former Time; Reason for change; Reschedule Confirmed; You are rescheduled; You are rescheduled with %{name}.; This event will be rescheduled for %{invitee_name} and %{count} guests |
| reconfirmation_title | Thanks for confirming you'll attend this event. |
| spot alert | Sorry, that time is no longer available. / Please select a different time to book this event. / View Times |
| badge | Powered by Calendly; Report abuse |
| date formats | `%A, %B %-d, %Y`; `%A, %B %-d`; `%b %-d`; "min", "hr" |

---

## 6. Cancellation, rescheduling, no-shows, blocking

### 6.1 Invitee cancel

- Links in the confirmation email, calendar invite and reminders when "Include cancel and reschedule links in email
  invitations and reminders (recommended)" is checked (default on). The checkbox is all-or-nothing for both links.
  ([Include cancel and reschedule links](https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees),
  [Community 1715](https://community.calendly.com/how-do-i-40/how-to-reschedule-a-canceled-event-1715))
- Cancel page: event summary, "Cancel Event?", "Reason for canceling" (optional text), "Cancel Event" button, then
  "Cancellation Confirmed", "Your meeting with {name} has been canceled." Guests are canceled too ("This event will be
  canceled for {invitee} and N guests").
- SMS reminders do not include links by default; add `https://calendly.com/cancellations/{{invitee_uuid}}` and
  `https://calendly.com/reschedulings/{{invitee_uuid}}`.
  ([SMS with automations](https://calendly.com/help/how-to-send-text-messages-with-automations))
- Disabling links does not fully prevent rescheduling (invitee can re-book via your page).
  ([Community: remove reschedule link](https://community.calendly.com/how-do-i-40/how-to-get-rid-of-a-reschedule-link-option-on-an-event-2696))

### 6.2 Invitee reschedule

- Reschedule link opens the booking page for the same event type showing "Former Time"; invitee picks a new time,
  sees prefilled answers, optional "Reason for change", "Update Event"; then "Reschedule Confirmed" / "You are
  rescheduled with {name}."
- Data model: reschedule = cancel old invitee + create new invitee; old gets `rescheduled: true` and `new_invitee`,
  new gets `old_invitee`; webhooks fire `invitee.canceled` then `invitee.created`.
  ([Developer: webhooks](https://developer.calendly.com/trigger-automations-with-other-apps-when-invitees-schedule-or-cancel-events),
  observed)
- Paid events: "You have previously paid for this event and will not be charged again."
- Round Robin reschedules reassign by default (see 2.10).
- Reschedule is only for upcoming, non-canceled bookings; canceled or past bookings use "Schedule invitee again".
- Rescheduling obeys availability; no override.
- There is no built-in cutoff (for example "no changes within 24 hours"): the cancellation policy is display only.
  ([Add a cancellation policy](https://calendly.com/help/how-to-add-a-cancellation-policy))

### 6.3 Cancellation policy

- Event type > Notifications and automations > Basic notifications > Calendar invitation/Email confirmation > Edit >
  "Cancellation policy" text area at the bottom, with the links checkbox. Shown to invitees, not enforced.
  ([Add a cancellation policy](https://calendly.com/help/how-to-add-a-cancellation-policy))
- Payment terms text (section 11) is also where refund policy goes.

Clone note: add an optional real cutoff (minimum notice for cancel/reschedule) as an extension, off by default.

### 6.4 Host cancel

([How to cancel a meeting](https://calendly.com/help/how-to-cancel-a-meeting))

- Calendar page > meeting > Cancel > optional cancellation message > "Yes, cancel". Invitee is emailed; the
  cancellation email includes a reschedule link unless links are disabled
  ([Community 3304](https://community.calendly.com/how-do-i-40/a-cancelled-meeting-was-rescheduled-yet-it-s-not-on-my-calendar-3304)).
- Group: canceling removes all invitees; "Remove invitee" for one.
- Deleting or declining the event in Google/Outlook cancels it in Calendly (if automatic sync is on).
- API cancellation record: `{canceled_by, reason, canceler_type: "host"|"invitee", created_at}` (observed).

### 6.5 Host reschedule and "request reschedule"

([How to reschedule a meeting](https://calendly.com/help/how-to-reschedule-a-meeting))

- Free plan: host goes to the booking page and picks a new time.
- Paid: **Reschedule meeting now** (host picks the new time) or **Share new times to meet** (cancels the current
  meeting and emails the invitee to choose a new time; custom message; optional reminder if not scheduled in 1, 3 or
  7 days). The second one is Calendly's "request reschedule".
- Host-side reschedule view can toggle "Switch to your invitee's time zone" / "Switch to my time zone".
- Moving the event in Google Calendar reschedules in Calendly and notifies the invitee. Observed implementation:
  the old event is canceled with reason "Rescheduled from connected calendar event" (`canceler_type: "host"`) and a
  new one is created reusing the same calendar event id.

### 6.6 Schedule invitee again / follow-up

- Canceled or past meetings: "Schedule invitee again" (books like a new meeting). The new Meetings page calls it
  "Book a follow-up meeting".
  ([Community 1715](https://community.calendly.com/how-do-i-40/how-to-reschedule-a-canceled-event-1715),
  [New Meetings page](https://calendly.com/help/introducing-the-new-meetings-page))

### 6.7 No-shows

([Mark no-shows](https://calendly.com/help/how-to-mark-no-shows-for-meetings))

- Calendar page > meeting Details > "Mark no-show" > confirm. Button appears only after the scheduled start.
- Undo allowed. Per invitee on group events. Included in CSV ("Marked as No-Show"). Web, mobile and extension.
- No-show invitees only receive no-show automations; other post-meeting automations (thank you, survey, follow-up)
  are skipped. Automation trigger "No-show marked".
  ([Automations overview](https://calendly.com/help/automations-overview))
- API: `POST /invitee_no_shows`, `DELETE /invitee_no_shows/{uuid}`; webhook `invitee_no_show.created/deleted`.

### 6.8 Blocking abusive invitees

([Block someone](https://calendly.com/help/how-to-block-someone-from-booking-with-you),
[Abuse prevention](https://calendly.com/help/abuse-prevention))

- From meeting details within 90 days of meeting creation: "Block invitee" (upcoming) / "Block attendee" (past),
  complete a short form. Upcoming non-group meetings with that source are canceled; future bookings prevented.
- Settings > Privacy > Blocked people: list and Unblock; or "Unblock attendee" from a past meeting.
- Other controls: secret events, single-use links, change the event link, limit date range, require email
  verification, routing forms that reject domains.

---

## 7. Notifications and Automations

### 7.1 Basic notifications (per event type)

([Set up basic notifications](https://calendly.com/help/how-to-set-up-basic-notifications),
[Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications),
[Hoops HR guide](https://help.hoopshr.com/en/articles/8867559-how-to-set-up-a-calendly-link-that-your-applicants-can-use-to-schedule-their-interview-with-you))

Event type > More options > "Notifications and automations" (older: "Notifications and workflows", "Communications"):

| Notification | Default | Notes |
|---|---|---|
| Calendar invitation or Email confirmation | On (type auto-picked) | Edit title/subject and body, cancellation policy, cancel/reschedule links checkbox. |
| Email reminders | Off; typical timing 24 hours before **(default timing unverified)** | Can be toggled and edited. |
| Text reminders | Off | Invitee opts in on the form. |
| Email follow-up | Off | Sent after the event. |
| Attached automations | none | Listed with toggles. |

- Toggle each via the three dots; Standard+ can customize subject, body and variables. Legacy Essentials: defaults
  only.
- Invitee answers are included by default and can be excluded (Standard+).
- Host notification emails for new, canceled and rescheduled meetings always go out.

Legacy default templates (variable names still used internally)
([calendar.com Calendly guide](https://www.calendar.com/calendly/)):

- Confirmation subject: `Confirmed: {{event_name}} with {{my_name}} on {{event_date}}`
- Confirmation body: `Hi {{invitee_full_name}}, Your {{event_name}} with {{my_name}} at {{event_time}} on
  {{event_date}} is scheduled. {{event_description}} {{questions_and_answers}}`
- Cancellation subject/body: `Canceled: {{event_name}} with {{my_name}} on {{event_date}}` / `Your {{event_name}}
  with {{my_name}} at {{event_time}} on {{event_date}} has been canceled.`
- Reminder: `This is a friendly reminder that {{event_name}} with {{my_name}} is at {{event_time}} on
  {{event_date}}.`
- Also `{{invitee_first_name}}`, `{{location}}`.

### 7.2 Automations (formerly Workflows)

([Automations overview](https://calendly.com/help/automations-overview),
[Create an automation](https://calendly.com/help/how-to-create-an-automation),
[Customize emails and texts](https://calendly.com/help/how-to-customize-emails-and-texts-for-workflows),
[Blog: Workflows](https://calendly.com/blog/workflows),
[Learn: Workflows](https://calendly.com/learn/calendly-workflows),
[Envato tutorial](https://business.tutsplus.com/tutorials/personalize-meeting-email-text-notifications-calendly--cms-37021))

Structure: **When this happens** (trigger + timing), **Do this** (one or more actions), **Automation name**,
**Which event types will this apply to?** Save.

Triggers and timing:

| Trigger | Timing options |
|---|---|
| New event is booked | Immediately, or N minutes/hours/days after booking |
| Before event starts | N minutes/hours/days before start |
| Event starts | Immediately, or N after start |
| Event is rescheduled | Immediately |
| Event ends | Immediately, or N after end |
| Event is canceled | Immediately (not supported for group events) |
| No-show marked | Immediately or after a delay **(unverified)** |

Actions: Send email to invitees; Send email to host; Send email to other (any email addresses, for example an
assistant); Send text to invitees; Send text to host; Send text to other (phone numbers). Hosts verify their phone
when setting up texts.

Templates (fully editable): Email reminder to invitee (1 day before), Email reminder to host, Email reminder to
someone else, Text reminder to invitee/host, Text booking confirmation to invitee/host, Text cancellation
notification to invitee/host, Cancellation notification to someone else, Send thank you email (for example 15 minutes
after end), Email additional resources (4 hours after end), Request follow-up meeting, Email your own feedback
survey, Text follow-up to invitee, Email invitees to reconfirm, Text invitee to reconfirm (1 hour before, includes a
confirm link; invitee sees "Thanks for confirming you'll attend this event."), Email no-shows to book a new time.
Reminder and reconfirmation templates have a checkbox to include cancel/reschedule links.

Variables (current UI labels): Event Name, Event Organizer Name, Event Date, Event Time, Invitees count, Answer 1-10,
Invitee First Name, Invitee Last Name, Invitee Full Name, Invitee Email, Invitee Phone Number (only with a text to
invitee action), Invitee UUID, UTM Source/Medium/Campaign/Content/Term, Location. Inserted via "+Variables"; rendered
as `{{...}}` tokens (legacy names in 7.1).

Links in emails: highlight text, link button, Destination: custom URL, "current event type", or a specific event
type. Texts take plain URLs only.

Rules and limits:

- Up to **50** automations per user or team across all event types.
- Automations are listed chronologically and cannot be reordered (use naming conventions).
- Edits apply only to meetings booked after the change; existing meetings keep the settings from booking time.
- Automations are per event type (not global).
- Emails send from notifications@calendly.com unless a Gmail or Outlook account is connected.
- If booked too close to the meeting, a "before" reminder whose time has passed is skipped.
- Managed Automations (admins) attach to managed events and apply to all assignees.
- Plans: Professional, Standard, Standard Plus, Teams, Teams Plus, Enterprise (not Free).

SMS specifics ([SMS with automations](https://calendly.com/help/how-to-send-text-messages-with-automations)):

- Twilio; toll-free long code; sender number cannot be chosen; replies not monitored; recipients can stop anytime.
- 180 characters per message with a live counter; variables that overflow are still sent; invitee answers are
  truncated to 40 characters.
- No SMS during trial; new accounts limited to built-in templates.
- Group events only with 100 or fewer invitees. No URL shorteners. Not delivered to Singapore, Russia, Iran.
- Opt-in required; the SMS number field cannot be required. Consent text cannot be edited (Enterprise can add a
  disclaimer).

Clone note: implement automations as rows `{trigger, offsetMinutes, direction, actions[], eventTypeIds[]}` with a
snapshot of the automation config stored on each booking at creation time (to match "edits apply to future
meetings only"), and schedule jobs into our DB jobs table.

---

## 8. Calendar connections

([Connect your calendar](https://calendly.com/help/connect-your-calendar-to-calendly),
[Manage multiple calendars](https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses),
[Google](https://calendly.mom/help/how-to-connect-your-google-calendar),
[Office 365](https://calendly.com/help/how-to-connect-your-office-365-or-outlook-com-calendar),
[Exchange](https://calendly.com/help/how-to-connect-your-microsoft-exchange-calendar),
[iCloud](https://calendly.com/help/icloud-overview),
[Outlook plug-in](https://calendly.com/help/outlook-plug-in-overview),
[Busy vs free](https://calendly.com/help/how-to-manage-busy-vs-free-calendar-settings))

| Provider | Notes |
|---|---|
| Google Calendar | OAuth. Signing up with Google may auto-connect it. |
| Office 365 / Outlook.com | OAuth (Microsoft). |
| Exchange | 2013, 2016, 2019 via EWS only (no ActiveSync, IMAP/POP; Amazon WorkMail unsupported; MFA accounts must use the Outlook plug-in). Only the primary calendar can be checked. |
| Outlook plug-in (Windows desktop) | Runs locally; computer and plug-in must be running; not compatible with Microsoft Store Outlook. |
| iCloud | No new connections since Aug 20, 2024; existing ones still work. |

Limits and selection:

- Free plan: 1 calendar connection; paid: up to **6** per user (any combination).
- **Calendars to check for conflicts**: multi-select sub-calendars per connection. Microsoft lets Calendly check up
  to 4 sub-calendars per connection and lists the first 10 it receives
  ([Community 1154](https://community.calendly.com/how-do-i-40/calendar-sync-failing-getting-double-booked-1154)).
  Shared calendars need read/write ("Can edit"); subscribed calendars (holiday feeds) generally cannot be checked.
- **Calendar to add events to**: exactly one destination for all event types (you cannot route event types to
  different calendars).
- Free/busy rules need the destination calendar also checked for conflicts.

Busy/free semantics:

- Only events marked Busy block. All-day events block the whole day if Busy (set them to Free to stay available).
- Outlook/Exchange default unavailable statuses: Busy, Tentative, Away/Out of Office, Working Elsewhere (Exchange
  reads Working Elsewhere as available). "What's considered unavailable?" dropdown lets you uncheck Tentative, OOF,
  Working Elsewhere (Busy is always unavailable).
- Calendly-created events always block even if set to Free.
- Overlapping busy blocks are returned separately; merge them (observed).

Sync settings (per connection):

- "Include buffers on this calendar" (Google, Outlook): buffer blocks become separate events; deleting one removes
  it in Calendly.
- Google: "Automatically sync cancellations and reschedules from this calendar to Calendly": decline/delete cancels;
  changing date/time reschedules. Outlook: decline/delete cancels. Invitee-side changes never affect the meeting.
- Bi-directional time/date sync with Google (community tips index).

Clone note: our CalDAV and ICS-feed connections map to "check for conflicts" (ICS read-only cannot be a destination).
Keep the 6-connection limit as a soft UI hint only.

---

## 9. Conferencing integrations

([Video conferencing](https://calendly.com/help/how-to-schedule-with-video-conferencing),
[Google Meet](https://calendly.com/help/calendly-google-meet),
[Microsoft Teams](https://calendly.com/help/calendly-microsoft-teams-conferencing),
[Integrations FAQ](https://calendly.com/help/integrations-faq),
[Company admin guide](https://calendly.com/help/company-admin-guide))

- Supported: Zoom, Google Meet, Microsoft Teams, GoTo Meeting, Webex. Each user connects their own (no admin
  install; Enterprise can connect Zoom org-wide per pricing page).
- Links are generated at booking time and inserted into the calendar invite and confirmation email; Zoom meetings
  also appear in the host's Zoom "Upcoming Meetings". Zoom options (PMI, passcode, dial-in) come from Zoom settings.
- Google Meet: requires Google Calendar as "Calendar to add events to", else error "You must configure your calendar
  connections to push events to a Google Calendar to host Google Meet web conferences on your events." Adds a US
  dial-in number by default.
- Teams: requires Microsoft 365 Business or Office 365 Education; may come with the O365 calendar connection;
  "Action required" means reconnect.
- Collective: one organizer host's account creates the link. Round Robin: assigned host's account.
- Missing link: video conferencing must have been the location at booking time; fix by rescheduling to the same time
  (regenerates) or sharing the link manually.
- Reschedules regenerate/update the meeting link (implied by "reschedule for the same date and time to generate a
  new link").

Clone note: Jitsi (no credentials) and custom links fill the gap for users without Zoom/Meet/Teams.

---

## 10. Scheduled events dashboard

### 10.1 Classic "Scheduled Events" page (2019-2024) **(unverified details, from product memory)**

- Tabs: **Upcoming**, **Pending** (one-off meetings and polls awaiting a booking,
  [Zapier guide](https://zapier.com/blog/how-to-use-calendly/)), **Past**, **Date Range** (custom range picker).
- "Filter" panel: Teams, Hosts, Event Types, Status (Active events, Canceled events), Tracking ID (UTM),
  Invitee Emails. "Export" button.
- Rows grouped by day: color dot, time range, invitee name, event type name, host count, "Details".
- Details panel: Reschedule, Cancel, Edit Event Type, Filter by Event Type, Schedule Invitee Again (canceled/past),
  Report this event; Email, Location, Invitee Time Zone, Questions and answers, Meeting host(s), "Add meeting notes",
  "Mark as No-Show", "Created {date} by {name}"; canceled meetings show who canceled and the reason; rescheduled
  badge.

### 10.2 Current "Calendar" page (formerly "Meetings", 2025-2026)

([How to manage your meetings](https://calendly.com/help/how-to-manage-your-meetings),
[Introducing the new Meetings page](https://calendly.com/help/introducing-the-new-meetings-page),
[Tracking and reporting](https://calendly.com/help/tracking-and-reporting))

- Single timeline grouped by date; upcoming and past on the same page; search and filters (date, team member, event
  type, status).
- Connected Google/Outlook events also appear, view-only, with a toggle to hide them.
- Right side panel: meeting details (location, host), invitees with editable contact details, questions and answers,
  internal meeting notes ("Notes" tab, host-only), timeline of actions and notifications, payment transaction link.
- Actions: Cancel, Reschedule (upcoming); Book a follow-up meeting; Mark no-show (past); Edit invitee limit (group);
  Block invitee/attendee; per-invitee Reschedule invitee / Remove invitee (group).
- Admin views: "My Calendly" or "All Users & Teams" (shared event types not included in that view).
  ([Salesforce import](https://calendly.com/help/how-to-import-missing-data-from-calendly-into-salesforce))

### 10.3 Export CSV

Filter, then Export (downloads or arrives by email). Columns
([Salesforce import mapping](https://calendly.com/help/how-to-import-missing-data-from-calendly-into-salesforce),
[Community: export columns](https://community.calendly.com/how-do-i-40/can-t-find-the-meeting-notes-on-the-past-meeting-excel-1315)):
User Name, Team, Invitee Name, Invitee First Name, Invitee Last Name, Invitee Email, Invitee Time Zone, Invitee
accepted marketing emails, Text Reminder Number, Event Type Name, Start Date & Time, End Date & Time, Location, Event
Created Date & Time, Canceled, Canceled By, Cancellation Reason, Question 1..N / Response 1..N, UTM Campaign, UTM
Source, UTM Medium, UTM Term, UTM Content, Salesforce UUID, Event Price, Payment Currency, Guest Email(s), Invitee
Reconfirmed, Marked as No-Show, Meeting Notes, Group, User Email, Event UUID, Invitee UUID, Invitee scheduled by,
Scheduling method.

---

## 11. Payments (core booking-flow parts)

([Calendly + Stripe](https://calendly.com/help/calendly-stripe),
[Calendly + PayPal](https://calendly.com/help/calendly-paypal),
[Payments FAQ](https://calendly.com/help/payments-faq))

- Payment section: "Require payment to book this meeting" (Stripe) / "Accept payments with PayPal"; processor;
  amount and currency (AUD, CAD, EUR, GBP, USD); coupon codes (Stripe only; a 100% coupon skips checkout; coupons
  cannot reduce below the processor minimum); payment terms and cancellation policy text.
- Stripe methods: cards, Apple Pay, Google Pay, Link, Affirm/Klarna. PayPal: wallet, Venmo (US), cards; PayPal
  Business required.
- Booking is confirmed only after payment succeeds; failed payment means no booking. Calendly does not refund, hold
  money, or compute tax. Reschedules are not charged again.
- Personal events use the host's processor account; team/shared events use the org owner's.
- Also: payment links, invoices, meeting packages ("Session N of M", sessions remaining).

---

## 12. Branding, links, account and privacy settings

- Profile (General): picture, name, welcome message, language (English, French, Spanish, German, Portuguese
  (Brazil)), date/time format, country, time zone. Login: email, password, Google/Microsoft/email login, 2FA.
  ([Account settings overview](https://calendly.com/help/account-settings-overview))
- Branding: logo upload (one per account), "Use Calendly branding" toggle (paid) removes "Powered by Calendly" from
  pages and the Calendly logo from invitee emails (uses your photo).
  ([Turn off Calendly branding](https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page))
- My link: landing page slug; event slugs in Booking page options; changed links do not redirect.
- Notifications settings: email preferences and SMS numbers for automations.
- Privacy: Booking (email verification per event type), Blocked people, Cookies (cookie banner / "Cookie settings"
  link; GDPR banner affects Google Analytics, Meta Pixel, PayPal, Stripe).

---

## 13. Meeting polls and one-off meetings as entry points

Meeting polls (summary; deep dive belongs in a separate document)
([Meeting polls overview](https://calendly.com/help/meeting-polls-overview),
[Set up a meeting poll](https://calendly.com/help/how-to-set-up-a-meeting-poll),
[Blog: meeting polls](https://calendly.com/blog/meeting-polls)):

- "+ Create" > More ways to meet > Meeting poll; time zone, duration, additional hosts; pick up to **40** times
  (overlapping allowed; "x/40 times selected"; Clear all); details (name, location, invitee language, description);
  optional settings "Show votes on page" and "Reserve times"; "Share meeting poll" with editable link.
- Up to 40 participants, no account needed; times shown in each voter's zone; Calendly users see mutual availability
  highlights. Voter copy: "Select all the times you're available to meet", "Share times", "Thanks for voting!",
  "You'll receive a calendar invitation when the host decides a final time from submitted votes."
- Host is notified as votes arrive; Meeting polls tab (classic: Scheduled Events > Pending > "View poll results");
  "Book" on a time, "+ Add Invitee", "Book Meeting" sends invites.
- Poll closes when booked, when all times pass, or when deleted. Votes are final; no new times after publishing;
  automations and rescheduling not supported. Free on all plans.

One-off meetings: see 2.12.

---

## 14. Data model reference (API object shapes)

Event type ([APIs.io schema](https://apis.io/schemas/calendly/calendly-event-type/), observed):
`uri, name, active, admin_managed, booking_method (instant|poll), color, created_at, updated_at, deleted_at,
custom_questions[{uuid, name, type (string|text|phone_number|single_select|multi_select), position, enabled,
required, answer_choices[], include_other}], description_plain, description_html, duration, duration_options[],
internal_note, is_paid, kind (solo|group), locale, locations[{kind, location, additional_info, phone_number,
position}], pooling_type (round_robin|collective|multi_pool|null), position, profile{type (User|Team), name, owner},
scheduling_url, secret, slug, type (StandardEventType|AdhocEventType)`.

Availability schedule (observed in [calendly-account-observations.md](./calendly-account-observations.md); same
rule shape as the `availability_rule` of the [Create Share API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share)):
`{name, default, timezone, rules[{type: wday|date, wday, date, intervals[{from: "HH:MM", to: "HH:MM"}]}]}`;
event type schedule adds `availability_setting` ("host" by default).

Scheduled event (observed): `uri, name, status (active|canceled), start_time, end_time, event_type,
location{type, status, join_url}, invitees_counter{total, active, limit}, event_memberships[{user, user_email,
user_name, buffered_start_time, buffered_end_time}], event_guests[], cancellation{canceled_by, reason,
canceler_type, created_at}, calendar_event{kind, external_id}, meeting_notes_plain, meeting_notes_html`.

Invitee (observed, [developer guide](https://developer.calendly.com/schedule-events-with-ai-agents)):
`uri, email, first_name, last_name, name, status, timezone, questions_and_answers[{question, answer, position}],
tracking{utm_*, salesforce_uuid}, text_reminder_number, rescheduled, old_invitee, new_invitee, cancel_url,
reschedule_url, cancellation, payment, no_show, reconfirmation, routing_form_submission, scheduling_method,
invitee_scheduled_by, event_guests`.

Busy time (observed): `{type: external|calendly, start_time, end_time, buffered_start_time, buffered_end_time,
event}`.

Webhooks: `invitee.created`, `invitee.canceled` (also fires for the old booking in a reschedule),
`invitee_no_show.created/deleted`, `routing_form_submission.created`; signed with `Calendly-Webhook-Signature`.
([Bollard API summary](https://bollardai.com/resources/calendly))

---

## 15. Slot engine rules (consolidated)

Derived from sections 3 and 4 plus observations. Use as the spec for our pure availability library.

1. Determine the candidate window: `[now + minimum_notice, window_end]` where window_end follows the date range
   (`moving`: today + N calendar days; `available_moving`: N weekdays; `fixed`: end of end_date; `unlimited`:
   none, but cap queries to the requested month). Window boundaries are computed in the schedule's time zone.
2. For each date (in the schedule's zone): take date-specific intervals if present, otherwise the weekday intervals.
   Drop the date entirely if an active holiday falls on it (holidays beat date-specific hours). Ignore zero-length
   intervals. Convert intervals to UTC per date (DST correct).
3. Candidate starts: for each interval, `start = interval.from + k * increment` for k >= 0 while
   `start + duration <= interval.to`. Duration is the selected duration option.
4. Remove candidates outside the window (RANGE, TOOSOON, PAST).
5. Build busy intervals: connected calendars' Busy events (statuses per "What's considered unavailable?", all-day
   busy blocks the whole local day), minus events matching Free/busy rule exceptions; plus our own active meetings
   expanded by their own buffers (`buffered_start/end`); plus reserved holds (one-off, polls). Merge overlaps.
6. Conflict test for a candidate: `[start - buffer_before, end + buffer_after)` must not overlap any busy interval.
   Our own meetings are already expanded by their buffers, so buffers stack. The buffers may extend outside the
   availability interval (only the meeting itself must fit).
7. Limits: drop candidates whose day/week/month already has the event type maximum (DAILY/WEEKLY/MONTHLY MAX) or
   the host maximum across event types (MEETING LIMIT). Count active meetings only.
8. Group: a slot already holding a booking of this group event type stays available while seats remain
   (`invitees_remaining > 0`), ignoring the self-overlap; other event types see it as busy once it has at least one
   invitee.
9. Collective: intersect per-host results (HOST). Round Robin: union with assignment by priority, least recently
   scheduled, random; equal distribution hides hosts 3+ meetings ahead (ROUNDROBIN, UNFAIR).
10. Return slots as UTC instants with `invitees_remaining`; the UI renders them in the invitee's zone and groups by
    the invitee's local date.
11. At booking time, recheck the exact slot inside a transaction (lock per host) and fail with "Sorry, that time is
    no longer available." if it no longer passes.

---

## 16. Defaults and limits cheat sheet

| Setting | Default | Limit / range | Source |
|---|---|---|---|
| Duration | 30 min **(unverified)** | 1-720 min | API |
| Duration options | 1 | max 4, not for group/managed | [Multiple durations](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type) |
| Date range | 60 rolling calendar days (example) | calendar/week days, fixed range, indefinite | [Fine-tune](https://calendly.com/help/how-to-fine-tune-your-availability-settings) |
| Minimum notice | 4 hours | minutes/hours/days | [Blog](https://calendly.com/blog/steal-this-workflow-reducing-time-to-hire-candidate-experience) |
| Start time increments | 30 min | 5-60 min options | [Community](https://community.calendly.com/asked-answered-79/how-do-i-control-the-specific-start-times-that-appear-on-my-calendly-4679) |
| Buffers | none | before and after, minute values | [Buffers](https://calendly.com/help/how-to-use-buffers) |
| Meeting limits | none | per day/week/month, per event type and per host | [Meeting limits](https://calendly.com/help/how-to-set-meeting-limits) |
| Time zone display | detect invitee zone | lock option | [Time zones](https://calendly.com/help/time-zones-overview) |
| Name field | single "Name" | or First + Last | [Booking form](https://calendly.com/help/advanced-booking-form-features) |
| Guests | on | max 10, not group | same |
| Custom questions | none (owner uses 1) | max 10 | [Questions](https://calendly.com/help/how-to-add-or-remove-invitee-questions) |
| Autofill from prior bookings | off | | [Booking form](https://calendly.com/help/advanced-booking-form-features) |
| Cancel/reschedule links | on | all-or-nothing | [Links](https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees) |
| Group seats | | 2-9,999 | [Group](https://calendly.com/help/group-event-type-overview) |
| Calendar connections | | 1 free, 6 paid | [Connect](https://calendly.com/help/connect-your-calendar-to-calendly) |
| Microsoft sub-calendars checked | | 4 of first 10 | [Community 1154](https://community.calendly.com/how-do-i-40/calendar-sync-failing-getting-double-booked-1154) |
| Automations | | 50 per user/team | [Automations](https://calendly.com/help/automations-overview) |
| SMS length | | 180 chars, answers cut to 40 | [SMS](https://calendly.com/help/how-to-send-text-messages-with-automations) |
| Round Robin equal distribution | | 3-meeting lead hides host | [RR](https://calendly.com/help/round-robin-distribution-overview) |
| One-off extra hosts | | 9 | [One-off web vs mobile](https://calendly.com/help/one-off-meeting-features-web-vs-mobile) |
| One-off slot spread | | within 3 months | [One-off mobile](https://help.calendly.com/hc/en-us/articles/1500000110162-How-to-set-up-a-one-off-meeting-using-the-mobile-app-iOS-only) |
| Poll | | 40 times, 40 participants | [Polls](https://calendly.com/help/meeting-polls-overview) |
| Share/single-use name | | 55 chars | [Shares API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share) |
| Location text / info | | 255 chars each | same |
| Block window | | within 90 days of creation | [Block](https://calendly.com/help/how-to-block-someone-from-booking-with-you) |
| Email verification code | | 6 digits | [Verification](https://calendly.com/help/how-to-require-email-verification-for-event-types) |
| Reminder nudges (share/request reschedule) | | 1, 3 or 7 days | [Reschedule](https://calendly.com/help/how-to-reschedule-a-meeting) |
| Embed min width | | 320px; layouts at 650/1100px | [Embed layout](https://calendly.com/help/how-to-control-your-embed-layout-and-sizing) |
| Event languages | English | +7 languages | [Language](https://calendly.com/help/how-to-change-your-event-type-language) |
| Holiday countries | | 10 | [Holidays](https://calendly.com/help/how-to-edit-holidays-within-calendly) |

---

## 17. Gaps, ambiguities and recommendations

1. **Exact dropdown values** for durations, increments, buffers and notice units were not visible in 2026 help
   text. Recommendation: offer Calendly's familiar presets in dropdowns plus a "custom" minutes input.
2. **"Week days" date range semantics** (weekdays vs days with availability) are ambiguous; support weekdays by
   default and document it.
3. **Meeting limit counting** (time zone, week start, canceled meetings, group seats) is not documented; use the
   rules in section 3.4 and expose them in the troubleshooter.
4. **Classic Scheduled Events filters** (section 10.1) are from product memory; the 2026 Calendar page has a
   simpler timeline. Recommendation: build the classic tabs (Upcoming, Pending, Past, Date Range) plus filters,
   because the owner asked for the familiar experience, and add the new side panel layout.
5. **No enforced cancel/reschedule cutoff** in Calendly. Our optional cutoff should be off by default.
6. **Add-to-calendar link labels** on confirmation (Google, Outlook, Office 365, iCal) are from memory; build all
   four plus a raw .ics download.
7. Calendly does not let you route event types to different destination calendars; our clone can allow a per event
   type override as an extension (default: account destination).
8. Calendly does not support Russia/Singapore SMS; with Twilio we inherit carrier rules anyway.
9. Our extras beyond Calendly (allowed by the project decisions): CalDAV and ICS-feed conflict calendars, Jitsi
   locations, DB email outbox when no mail provider is configured.

---

## 18. Source index

Calendly Help Center (calendly.com/help, accessed 2026-10-11):
[event-types-overview](https://calendly.com/help/event-types-overview),
[group-event-type-overview](https://calendly.com/help/group-event-type-overview),
[how-to-customize-your-event-types](https://calendly.com/help/how-to-customize-your-event-types),
[event-type-editor-overview](https://calendly.com/help/event-type-editor-overview),
[how-to-set-up-an-event-type](https://calendly.com/help/how-to-set-up-an-event-type),
[how-to-organize-and-manage-your-event-types](https://calendly.com/help/how-to-organize-and-manage-your-event-types),
[how-to-set-up-multiple-durations-for-an-event-type](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type),
[how-to-set-the-location-for-your-event-type](https://calendly.com/help/how-to-set-the-location-for-your-event-type),
[how-to-use-other-video-conferencing-options](https://calendly.com/help/how-to-use-other-video-conferencing-options),
[round-robin-meeting-location-options](https://calendly.com/help/round-robin-meeting-location-options),
[how-to-schedule-with-video-conferencing](https://calendly.com/help/how-to-schedule-with-video-conferencing),
[calendly-google-meet](https://calendly.com/help/calendly-google-meet),
[calendly-microsoft-teams-conferencing](https://calendly.com/help/calendly-microsoft-teams-conferencing),
[integrations-faq](https://calendly.com/help/integrations-faq),
[how-to-fine-tune-your-availability-settings](https://calendly.com/help/how-to-fine-tune-your-availability-settings),
[how-to-use-buffers](https://calendly.com/help/how-to-use-buffers),
[how-to-set-meeting-limits](https://calendly.com/help/how-to-set-meeting-limits),
[time-zones-overview](https://calendly.com/help/time-zones-overview),
[free-busy-rules-overview](https://calendly.com/help/free-busy-rules-overview),
[how-to-set-your-availability](https://calendly.com/help/how-to-set-your-availability),
[availability-overview](https://calendly.com/help/availability-overview),
[how-to-manage-availability-for-your-users](https://calendly.com/help/how-to-manage-availability-for-your-users),
[how-to-edit-holidays-within-calendly](https://calendly.com/help/how-to-edit-holidays-within-calendly),
[how-to-troubleshoot-unavailable-times-that-should-be-available](https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available),
[scheduling-faq](https://calendly.com/help/scheduling-faq),
[advanced-booking-form-features](https://calendly.com/help/advanced-booking-form-features),
[how-to-add-or-remove-invitee-questions](https://calendly.com/help/how-to-add-or-remove-invitee-questions),
[how-to-collect-consent-from-invitees-with-custom-questions](https://calendly.com/help/how-to-collect-consent-from-invitees-with-custom-questions),
[how-to-pre-fill-invitee-information-in-your-calendly-link](https://calendly.com/help/how-to-pre-fill-invitee-information-in-your-calendly-link),
[how-to-pre-fill-invitee-information-in-an-embed](https://calendly.com/help/how-to-pre-fill-invitee-information-in-an-embed),
[advanced-calendly-embed-for-developers](https://calendly.com/help/advanced-calendly-embed-for-developers),
[how-to-customize-your-embed](https://calendly.com/help/how-to-customize-your-embed),
[how-to-control-your-embed-layout-and-sizing](https://calendly.com/help/how-to-control-your-embed-layout-and-sizing),
[how-to-redirect-invitees-to-another-site-after-booking](https://calendly.com/help/how-to-redirect-invitees-to-another-site-after-booking),
[how-to-add-links-to-the-event-confirmation-page](https://calendly.com/help/how-to-add-links-to-the-event-confirmation-page),
[calendly-scheduling-notifications](https://calendly.com/help/calendly-scheduling-notifications),
[how-to-set-up-basic-notifications](https://calendly.com/help/how-to-set-up-basic-notifications),
[how-to-add-a-cancellation-policy](https://calendly.com/help/how-to-add-a-cancellation-policy),
[how-to-include-cancel-and-reschedule-links-for-invitees](https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees),
[how-to-reschedule-a-meeting](https://calendly.com/help/how-to-reschedule-a-meeting),
[how-to-cancel-a-meeting](https://calendly.com/help/how-to-cancel-a-meeting),
[how-to-mark-no-shows-for-meetings](https://calendly.com/help/how-to-mark-no-shows-for-meetings),
[how-to-block-someone-from-booking-with-you](https://calendly.com/help/how-to-block-someone-from-booking-with-you),
[how-to-require-email-verification-for-event-types](https://calendly.com/help/how-to-require-email-verification-for-event-types),
[abuse-prevention](https://calendly.com/help/abuse-prevention),
[automations-overview](https://calendly.com/help/automations-overview),
[how-to-create-an-automation](https://calendly.com/help/how-to-create-an-automation),
[how-to-customize-emails-and-texts-for-workflows](https://calendly.com/help/how-to-customize-emails-and-texts-for-workflows),
[how-to-send-text-messages-with-automations](https://calendly.com/help/how-to-send-text-messages-with-automations),
[how-to-create-a-managed-automation](https://calendly.com/help/how-to-create-a-managed-automation),
[connect-your-calendar-to-calendly](https://calendly.com/help/connect-your-calendar-to-calendly),
[how-to-manage-multiple-calendars-and-email-addresses](https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses),
[how-to-connect-your-office-365-or-outlook-com-calendar](https://calendly.com/help/how-to-connect-your-office-365-or-outlook-com-calendar),
[how-to-connect-your-microsoft-exchange-calendar](https://calendly.com/help/how-to-connect-your-microsoft-exchange-calendar),
[icloud-overview](https://calendly.com/help/icloud-overview),
[outlook-plug-in-overview](https://calendly.com/help/outlook-plug-in-overview),
[outlook-plug-in-faq](https://calendly.com/help/outlook-plug-in-faq),
[how-to-manage-busy-vs-free-calendar-settings](https://calendly.com/help/how-to-manage-busy-vs-free-calendar-settings),
[how-to-manage-your-meetings](https://calendly.com/help/how-to-manage-your-meetings),
[introducing-the-new-meetings-page](https://calendly.com/help/introducing-the-new-meetings-page),
[tracking-and-reporting](https://calendly.com/help/tracking-and-reporting),
[how-to-import-missing-data-from-calendly-into-salesforce](https://calendly.com/help/how-to-import-missing-data-from-calendly-into-salesforce),
[how-to-create-a-one-off-meeting](https://calendly.com/help/how-to-create-a-one-off-meeting),
[one-off-meeting-features-web-vs-mobile](https://calendly.com/help/one-off-meeting-features-web-vs-mobile),
[how-to-create-a-single-use-link](https://calendly.com/help/how-to-create-a-single-use-link),
[how-to-offer-time-slots-in-an-email](https://calendly.com/help/how-to-offer-time-slots-in-an-email),
[how-to-share-your-availability-with-gmail-or-outlook-in-calendly](https://calendly.com/help/how-to-share-your-availability-with-gmail-or-outlook-in-calendly),
[how-to-book-meetings-in-real-time](https://calendly.com/help/how-to-book-meetings-in-real-time),
[contacts-overview](https://calendly.com/help/contacts-overview),
[shared-event-types-overview](https://calendly.com/help/shared-event-types-overview),
[multi-person-scheduling-options-for-your-organization](https://calendly.com/help/multi-person-scheduling-options-for-your-organization),
[how-to-set-up-a-shared-collective-event-type](https://calendly.com/help/how-to-set-up-a-shared-collective-event-type),
[how-to-set-up-a-team-collective-event-type](https://calendly.com/help/how-to-set-up-a-team-collective-event-type),
[how-to-set-up-a-shared-round-robin-event-type](https://calendly.com/help/how-to-set-up-a-shared-round-robin-event-type),
[how-to-set-up-a-team-round-robin-event-type](https://calendly.com/help/how-to-set-up-a-team-round-robin-event-type),
[round-robin-distribution-overview](https://calendly.com/help/round-robin-distribution-overview),
[how-to-schedule-with-multiple-groups-of-hosts](https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts),
[managed-events-overview](https://calendly.com/help/managed-events-overview),
[how-to-create-and-assign-managed-events](https://calendly.com/help/how-to-create-and-assign-managed-events),
[how-to-edit-event-type-permissions](https://calendly.com/help/how-to-edit-event-type-permissions),
[understand-event-type-permissions](https://calendly.com/help/understand-event-type-permissions),
[how-to-change-your-event-type-language](https://calendly.com/help/how-to-change-your-event-type-language),
[how-to-customize-your-scheduling-page-links](https://calendly.com/help/how-to-customize-your-scheduling-page-links),
[account-settings-overview](https://calendly.com/help/account-settings-overview),
[how-to-turn-off-calendly-branding-on-your-scheduling-page](https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page),
[company-admin-guide](https://calendly.com/help/company-admin-guide),
[calendly-stripe](https://calendly.com/help/calendly-stripe),
[calendly-paypal](https://calendly.com/help/calendly-paypal),
[payments-faq](https://calendly.com/help/payments-faq),
[meeting-polls-overview](https://calendly.com/help/meeting-polls-overview),
[how-to-set-up-a-meeting-poll](https://calendly.com/help/how-to-set-up-a-meeting-poll).

Calendly blog and product pages:
[pricing](https://calendly.com/pricing),
[blog: refreshed navigation and availability (2023-10-30)](https://calendly.com/blog/redesigned-nav-event-types),
[blog: availability basics (2025-05-14)](https://calendly.com/blog/getting-started-availability),
[blog: Workflows (2024-06-25)](https://calendly.com/blog/workflows),
[blog: reminders (2024-06-25)](https://calendly.com/blog/guide-calendly-reminders),
[blog: single-use links (2025-08-08)](https://calendly.com/blog/one-time-calendly-link),
[blog: meeting polls (2023-11-01)](https://calendly.com/blog/meeting-polls),
[blog: recruiting workflow, 4-hour notice default (2022-11-10)](https://calendly.com/blog/steal-this-workflow-reducing-time-to-hire-candidate-experience),
[learn: workflows](https://calendly.com/learn/calendly-workflows).

Calendly Community (staff answers):
[start time increments](https://community.calendly.com/asked-answered-79/how-do-i-control-the-specific-start-times-that-appear-on-my-calendly-4679),
[5-minute offsets](https://community.calendly.com/how-do-i-40/what-is-the-status-of-the-start-meetings-5-min-late-feature-2619),
[overlapping meetings](https://community.calendly.com/featured-tips-tricks-32/overlapping-meetings-2957),
[allowing overlaps](https://community.calendly.com/asked-answered-79/allowing-overlapping-meetings-in-calendly-4972),
[RR explained](https://community.calendly.com/how-do-i-40/round-robin-scheduling-question-help-neeeded-764),
[RR max per host](https://community.calendly.com/how-do-i-40/maximum-number-of-bookings-per-host-round-robin-760),
[host meeting limits](https://community.calendly.com/how-do-i-40/limit-number-of-events-per-day-per-user-4545),
[12h/24h toggle](https://community.calendly.com/how-do-i-40/request-to-explicitly-show-12h-vs-24hr-toggle-on-booking-page-for-clients-5350),
[reschedule a canceled event](https://community.calendly.com/how-do-i-40/how-to-reschedule-a-canceled-event-1715),
[prevent cancel/reschedule](https://community.calendly.com/how-do-i-40/prevent-customers-cancelling-rescheduling-5147),
[calendar sync limits](https://community.calendly.com/how-do-i-40/calendar-sync-failing-getting-double-booked-1154),
[dropdown prefill](https://community.calendly.com/api-webhook-help-61/scheduling-page-url-parameter-dropdown-not-working-773),
[deep link to slot](https://community.calendly.com/api-webhook-help-61/scheduling-api-payments-behavior-5440),
[new homepage and single-use links](https://community.calendly.com/featured-tips-tricks-32/new-homepage-and-single-use-links-experience-3914?postid=12058),
[export columns](https://community.calendly.com/how-do-i-40/can-t-find-the-meeting-notes-on-the-past-meeting-excel-1315),
[calendar invite titles](https://community.calendly.com/how-do-i-40/event-title-changes-in-google-calendar-after-scheduling-4757).

API and technical:
[Create Share API](https://developer.calendly.com/api-docs/calendly-api/shares/create-share),
[developer guide: Scheduling API](https://developer.calendly.com/schedule-events-with-ai-agents),
[developer: webhooks](https://developer.calendly.com/trigger-automations-with-other-apps-when-invitees-schedule-or-cancel-events),
[APIs.io event type schema](https://apis.io/schemas/calendly/calendly-event-type/),
[Create Event Type reference mirror](https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA),
[Bollard API summary](https://bollardai.com/resources/calendly),
[nuxt-calendly embed types](https://github.com/madebyfabian/nuxt-calendly/blob/main/src/runtime/types/index.d.ts),
[urlscan capture of Calendly booking strings](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/).

Third-party guides used for corroboration:
[Zapier: how to use Calendly](https://zapier.com/blog/how-to-use-calendly/),
[calendar.com Calendly guide (legacy template variables)](https://www.calendar.com/calendly/),
[Envato Tuts+ workflows tutorial](https://business.tutsplus.com/tutorials/personalize-meeting-email-text-notifications-calendly--cms-37021),
[Hoops HR setup guide](https://help.hoopshr.com/en/articles/8867559-how-to-set-up-a-calendly-link-that-your-applicants-can-use-to-schedule-their-interview-with-you),
[Toolhouse period types](https://docs.toolhouse.ai/toolhouse/integrations/calendly).
