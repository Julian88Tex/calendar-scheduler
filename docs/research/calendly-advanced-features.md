# Calendly advanced and account-level features (research inventory, Oct 2026)

Purpose: an exhaustive inventory of Calendly's ADVANCED and account-level features, with settings, defaults and
nuances, plus a field-by-field model of the Calendly API v2 objects. This feeds our DB schema (src/db/schema/*)
and our public API design. Core scheduling settings (buffers, minimum notice, increments, limits, date ranges,
reminders, workflows) are covered in depth by other research docs; they are referenced here only where an
advanced feature depends on them.

Research date: 2026-10-11. Calendly ships changes often; where a detail is uncertain it is flagged.

Confidence legend used throughout:

- **[V]** verified this session from the fetched page (help center article, developer docs page, or the current
  OpenAPI-derived request schemas).
- **[S]** from a search-engine summary of an official Calendly page (high confidence, wording may differ).
- **[C]** from Calendly Community posts (user generated, may be stale).
- **[K]** background knowledge or inference, not re-verified this session. Treat as a sensible default for our
  clone, not as a hard fact about Calendly.

Source note: the shell and WebFetch could not reach calendly.com (egress policy), so pages were retrieved with
Firecrawl and web search. Request body schemas for write endpoints were taken from `operations.json` inside the npm
package `@thenavidm/calendly-mcp-cli@3.0.1`, which is generated from Calendly's current OpenAPI spec
(`https://developer.calendly.com/openapi/calendly-api.yaml`); they match the developer docs pages checked.

---

## 0. Plans and feature gating (pricing page, Oct 2026) [V]

Source: https://calendly.com/pricing

| Plan | Price (billed yearly) | Notes |
| --- | --- | --- |
| Free | $0 | 1 event type, 1 calendar connection, one-on-one only, customizable booking page, browser extension |
| Standard | $10/seat/mo (save 17%) | Unlimited event types, multiple calendars (6), automations and reminders, HubSpot/Mailchimp, Stripe/PayPal |
| Teams | $16/seat/mo (save 20%) | Round robin and team scheduling, routing forms ("qualify, route and schedule leads"), centrally managed event types, Marketo/Pardot, Salesforce, SSO add-on |
| Enterprise | from $15k/yr, from 50 seats | Salesforce lookup routing, Microsoft Dynamics, SSO/SAML, domain control, audit log, Data Deletion API, dedicated support |
| "Plus" tiers | Standard Plus, Teams Plus | Add AI Notetaker (recaps, transcripts) and "Callie" (AI email scheduling assistant, beta) |

Feature-comparison highlights (pricing page "Compare features"):

- Connect calendars: Free 1, Standard/Teams/Enterprise 6.
- Meeting polls and one-off meetings: all plans (including Free).
- Multi-person meeting types (group, collective): Standard and above. Round robin: Teams and above.
- Book meetings on behalf of others, automated reminders, automated outreach, cancellation policy: Standard+.
- Routing forms (Calendly forms, HubSpot, Pardot, Marketo forms): Teams+.
- Payments (Stripe/PayPal at booking, payment links, meeting packages, invoices, coupons/terms): Standard+.
- Contacts: auto-generated profiles, notes, reminders, custom fields, lists, book from profile: all plans; email
  contacts from Calendly (Gmail sync, AI drafts, templates, bulk send): Standard+.
- Webhooks, HubSpot/Mailchimp/Zapier, GA + Meta Pixel, Gmail/Outlook for workflows: Standard+.
- Marketo sync, Salesforce record updates, route by HubSpot assignment: Teams+. Route by Salesforce assignment,
  Dynamics 365/Power Automate: Enterprise.
- Custom branding on booking page: all plans. Remove Calendly branding, embed color customization, custom
  confirmation pages (links and redirects): Standard+.
- Team analytics: Standard+. Groups with group admins, admin-managed events, org-wide Zoom: Teams+.
- Data deletion: all plans. Data Deletion API, SCIM, group provisioning, domain control: Enterprise. SAML SSO:
  Teams add-on, Enterprise included.
- Support: 24/7 email all; 24/7 chat Standard+; phone and dedicated support Enterprise.

Seats: "Seats are required for users to connect calendars and host Calendly meetings; meeting invitees do not
require a seat." Every host of a round robin or collective event needs a paid seat [V]
(https://calendly.com/help/multi-person-scheduling-options-for-your-organization).

Clone implication: we are single-tenant/self-hosted, so no plan gating is needed, but the feature list above is a
good checklist of what "every feature" means. Keep an `organization.plan` column anyway for API parity.

---

## 1. Teams and organizations

### 1.1 Organization, users and roles [V]

Source: https://calendly.com/help/user-roles-and-permissions

Five roles (the API exposes only `owner | admin | user` on organization memberships; group admin and team manager
are relationships on groups/teams):

| Role | Available on | Count | Key permissions |
| --- | --- | --- | --- |
| Owner | all plans | exactly 1 | Everything; can transfer ownership. Deleting the owner's own account disbands the org (all teams deleted, members removed but their accounts kept). |
| Admin | paid | unlimited | Everything except changing the owner. |
| Group admin | Teams, Enterprise | unlimited | Reporting and meetings of group members; create teams; create routing forms; invite users (if permitted) and add users to their groups; manage group members' personal event types; create/assign managed events for their group. |
| Team manager | paid | unlimited | Create/manage team event types on a team page; add/remove team members; assign other team managers. |
| User | paid | unlimited | Default for anyone added. Personal page (calendly.com/janedoe); edit own settings and own personal/shared event types; can be added to groups, teams, team events. |

Permission matrix details worth reproducing:

- Add users: owner, admin, group admin (to own group; may be granted invite permission). Adding a user adds a paid
  seat.
- Remove users: owner, admin only.
- Delete another user's Calendly account: owner/admin, and only if that account was created when joining the org.
- Billing (payment method, plan, seats, tax exemption, receipts): owner and admin.
- Request invitee/event data deletion: owner and admin.
- View event types: owner/admin see all; group admin sees group members' personal event types; team manager sees
  team members' personal event types; user sees own personal, team and shared types they are on.
- Reschedule events: owner/admin all; group admin group members'; team manager team's; user own.
- Assign roles: owner all (including new owner); admin all except owner; group admin assigns group admins and team
  managers within scope; team manager assigns team managers on own team.
- Create teams: owner, admin, group admin. Create groups: owner, admin.
- Configure SAML SSO and SCIM: owner, admin.
- Reports: owner/admin all users, meetings, templates, groups; group admin groups and members' meetings; team
  manager team meetings; user own meetings. Analytics dashboard: owner/admin all; group admin group-scoped; team
  manager and user: no.
- Automations (workflows): owner/admin all; group admin group/team/personal; team manager team/personal; user
  personal.

Inviting users [V] (API): `POST /organizations/{uuid}/invitations` with body `{ email }`. Invitations have status
`pending | accepted | declined`, `last_sent_at`, and `user` once accepted. Revoke with
`DELETE /organizations/{org_uuid}/invitations/{uuid}`. Remove a member with `DELETE /organization_memberships/{uuid}`.
Shared/round robin hosts must have accepted the org invitation before they can be added [V].

### 1.2 Teams and team pages [S]

Sources: https://calendly.com/help/how-to-set-up-a-team-page, https://calendly.com/help/multi-person-scheduling-options-for-your-organization [V]

- A team needs at least two active users. Created by owner/admin (and group admins) from Scheduling, "My Calendly"
  dropdown, "+ New Team".
- Team fields: name, unique page URL (slug), invitee welcome message, members, avatar ("Upload picture", shown at
  top of the team landing page), team time zone. Members get a "can manage team" checkbox (team manager); admins
  have it pre-checked and locked.
- Team landing page lists team event types; each team event type gets a custom link under the team slug.
- Organization logo (Admin center, Branding) is separate from the team avatar and shows top-left on all members'
  pages [C].
- API Team object [V]: `uri`, `name`, `organization`, `scheduling_url`. `GET /teams?user=` and `GET /teams/{uuid}`.

Shared vs team event types [V]:

| | Shared event types | Team event types |
| --- | --- | --- |
| Best for | quick, flexible collaboration | structured, team-managed scheduling |
| Who can create | anyone (unless an admin restricts it, org setting "allow creation of Shared Event Types") | owners, admins, team managers |
| Who can edit / add or remove hosts | hosts, owners, admins | owners, admins, team managers |
| Visible on a landing page | no (direct link or embed only) | yes, team page only |
| Custom URL | no (cannot change or customize the URL) | yes |

### 1.3 Groups [V/S]

- Groups (Teams and Enterprise) organize users by department, location or function, with group admins who get
  scoped reporting and management. Users can be members of multiple groups; group admins can administer groups
  without being members [V].
- API: `GET /groups?organization=`, `GET /groups/{uuid}`, `GET /group_relationships?organization=&owner=&group=`
  where `owner` is an organization membership URI or an organization invitation URI [V]. Group fields [K]: `uri`,
  `name`, `organization`, `member_count`, `created_at`, `updated_at`. Group relationship fields [K]: `uri`, `role`
  (`member | admin`), `owner` (membership or invitation URI), `organization`, `group`.
- `GET /scheduled_events?group=` and webhook subscriptions with `scope=group` exist [V].
- Enterprise: SCIM user provisioning and "automate group provisioning" from the IdP [V].

### 1.4 Event type kinds overview [V]

Calendly's four kinds: One-on-one (one host, one invitee), Group (one host, many invitees per slot), Collective
(multiple hosts, invitee books only when all are free), Round robin (one-on-one meetings rotate across hosts).
Plus advanced "multiple groups of hosts" (API `pooling_type: multi_pool`).

API encoding (event_type): `kind` is `solo | group` (group = more than one invitee per slot); `pooling_type` is
`round_robin | collective | multi_pool | null`; `kind_description` (older docs) was `One-on-One | Group | Collective
| Round Robin`; `type` is `StandardEventType | AdhocEventType` (Adhoc = one-off meeting).

### 1.5 Round robin [V]

Sources: https://calendly.com/help/round-robin-distribution-overview,
https://calendly.com/help/how-to-set-up-a-shared-round-robin-event-type,
https://calendly.com/help/how-to-manage-shared-event-types,
https://calendly.com/help/how-to-book-meetings-in-real-time

Plans: Teams, Teams Plus, Enterprise. Each round robin event has one or more "pools"; a default pool is created
with the creator as host. Each pool has: name, members, distribution method.

Distribution methods (per pool):

1. **Maximize (optimize) for availability.** A slot is offered whenever at least one host in the pool is free
   ("availability includes Calendly meetings and anything on connected calendars"). Assignment when several hosts
   are free:
   - Only available hosts are considered.
   - Highest **priority** wins (priority stars, set per host in the Hosts section).
   - Tie on priority: the host who has not had a recent meeting wins (community wording: "least recently scheduled
     person for this event type").
   - Still tied: random.
   - Good for maximizing bookings; does not even out load.
2. **Optimize for equal distribution.** Calendly counts round robin meetings per host for this event type and keeps
   nobody more than **three meetings ahead**. If a host is ahead by 3 or more, their availability is hidden until
   others catch up; then their slots reappear. Example from the article: Jim 3, Karen 0, Jim hidden; Karen books 1,
   Jim eligible; Jim books again (4 to 1), Jim hidden again. Trade-off: some slots disappear, so fewer bookings.
   Priority stars do not drive this mode.

Nuances:

- Adding or removing a host resets the meeting count to zero for everyone.
- Changing the distribution setting takes effect with the next booking; past counts do not carry over.
- Round robin event types can be booked multiple times in the same time frame as long as hosts are available
  (slot capacity = number of free hosts). Our slot engine must therefore not remove a slot just because one booking
  exists; it removes a host from that slot.
- Rescheduling preference (Hosts section dropdown): **"Reassign host(s) through round robin"** (default) or
  **"Use same hosts as original meeting"**.
- Location: set per host, or apply the same location to all hosts.
- Availability: date range options for the event, and schedule set per host or "apply the same hours to all hosts".
- Managing booked meetings: only the assigned host or an admin can make changes (collective: any host or admin).
- "Override available times" in Book meeting is not available for round robin [V].
- Manual reassignment of an already booked round robin meeting to a different host is not a documented feature;
  community threads ask for it without an official answer [S/C]. Our clone can add an explicit "Reassign host"
  action as an improvement (move calendar event, notify old and new host and invitee, keep invitee URI).
- Priority levels: Calendly uses a star control per host; the number of levels is not documented [S]. Recommended
  clone model: 5 levels (lowest, low, medium, high, highest) with default medium, which is also how Cal.com
  models it [K].
- "Routing to a specific host": done through routing forms with HubSpot or Salesforce lookup (route the known lead
  to the record owner) [V, section 2]. When the destination is a round robin event and an owner is matched, the
  booking page is restricted to that owner [K, inferred from Calendly marketing: "automatically looks up and matches
  known leads to assigned account owners"].
- Email notifications go to hosts when they are added to a shared event type; they can unsubscribe at the bottom
  of the email or in Settings, Notifications [V].

Clone data model suggestion: `event_type_host_pools(id, event_type_id, name, distribution: 'availability' |
'equal', position)`, `event_type_hosts(event_type_id, user_id, pool_id NULL for required co-hosts, priority 1..5,
is_organizer, location_override jsonb, schedule_id NULL)`, plus `round_robin_counters(event_type_id, pool_id,
user_id, count, last_assigned_at, epoch)` where `epoch` increments whenever pool membership changes (to implement
the reset). The scheduled event stores `assigned_pool_members`.

### 1.6 Collective [V]

Sources: https://calendly.com/help/shared-event-types-overview, https://calendly.com/help/multi-person-scheduling-options-for-your-organization

- Times are shown only when **all** selected hosts are free. On booking, everyone is added to the single calendar
  invite (one scheduled event, `event_memberships` lists every host).
- Plans: Standard, Teams, Enterprise (Standard Plus, Professional legacy).
- Any host or an admin can manage the booked meeting or the event type.
- "+ Add co-host" adds required hosts. For video conferencing with co-hosts, one co-host is designated the meeting
  **organizer** (whose Zoom/Meet/Teams account creates the link).
- Availability: per-host schedules or same hours for all hosts.

### 1.7 Multiple groups of hosts (collective + round robin, API `multi_pool`) [V]

Source: https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts

- Teams and Enterprise. Create from "+ Create" choosing Collective or Round robin, then add:
  - "+ Add co-host": hosts who always attend (collective part).
  - "Create rotating host pool": one or more round robin pools, each with its own name, members and distribution
    method (availability or equal distribution).
- Examples: product demo with an AE (always) plus a rotating sales engineer; panel interview with hiring manager
  (always) plus a team lead and a peer drawn from two separate pools.
- A slot is available only if every co-host is free AND at least one host in EVERY pool is free; one host is
  chosen per pool using that pool's distribution rules [K, implied].
- Rescheduling preferences: reassign through round robin, or keep original hosts.
- Location: if a co-host exists, offer one location or let invitees choose from multiple options; for video
  conferencing assign one co-host as organizer. If all hosts are in pools, location is set per host in the first
  pool.
- Rescheduling such an event from the host's Calendar page does not offer host choice; it goes straight to the
  booking page and uses round robin logic.

### 1.8 Group events (one host, many invitees) [V]

Source: https://calendly.com/help/group-event-type-overview

- All paid plans. Use cases: webinars, trainings, tours.
- **Invitee limit** per time slot: minimum 2, maximum 9,999. Optional checkbox **"Display remaining spots"** shows
  the live count of remaining seats on the booking page.
- Changing the invitee limit affects future bookings only; an already-scheduled group meeting keeps its limit.
  To change one meeting: Calendar page, select meeting, Invitees, "Edit invitee limit", Apply.
- Group events use **email confirmations, not calendar invites**: each invitee gets their own .ics file, which does
  not update for others if someone changes the event.
- Automations work, but the "Event is canceled" trigger is not supported for group events. Automation changes
  apply only to future meetings.
- Once someone has booked, the event type's language, location and duration are locked (grayed). Workaround:
  duplicate, cancel original, rebook invitees.
- Free/busy rules cannot book over a **full** group meeting.
- API: scheduled event `invitees_counter { total, active, limit }`; available times `invitees_remaining`.
- Customization by "Book meeting" (name, duration, location) is not available for group event types; single-use
  links for group types allow only contact info personalization.
- Meeting limits/caps and "show remaining spots" interplay: a slot with existing group invitees should stay
  bookable even if the host calendar shows the Calendly event as busy (our engine must special-case the event's
  own group meetings) [K].

### 1.9 Managed event types (admin-managed templates) [V]

Sources: https://calendly.com/help/managed-events-overview, https://calendly.com/help/user-roles-and-permissions

- Owners and admins (and group admins for their group) create them in **Admin center, Managed events, + Create**.
  Plans: Professional (legacy), Teams, Teams Plus, Enterprise.
- Assigned to users (or teams); each member gets **their own copy linked to the template**.
- Per-section editing permission: owners/admins **allow or disable editing for each section**. Disabled (locked)
  sections stay synced with admin updates. Enabled sections do not receive admin updates. If editing is later
  disabled again, the next admin update overrides user changes.
- **Location is always editable** (tip: leave it blank so users add their own).
- On the Professional plan there is no per-section locking: admins push updates by un-assigning and reassigning,
  which replaces the user's copy and drops their edits.
- Users see an "admin managed" icon on the event card. Some settings (for example secret) were reported as not
  lockable [C].
- API: `event_type.admin_managed: boolean`; `GET /event_types?admin_managed=true|false`.

Clone model: `managed_event_templates` (template event type row with `is_template = true`), `managed_event_assignments
(template_id, user_id | team_id)`, `managed_event_locks(template_id, section, locked boolean)`, and on each copy
`managed_template_id` + `managed_synced_at`. Sections to model: details (name, duration, description, color,
slug), location (always unlocked), availability/schedule, limits and buffers, booking form/questions, notifications
and workflows, confirmation page, payment, permissions.

### 1.10 Event type permissions and booking on behalf of others [V]

Source: https://calendly.com/help/how-to-book-meetings-in-real-time

- On Standard and higher you can choose who can view, edit or share an event (event type permissions).
- "Book meeting": host books directly for an invitee (from Scheduling or Contacts, browser extension, mobile).
  Options: invitee name/email, + Add guests, customize meeting name/duration/location for this booking only (not
  for group types), choose an available time or **"Override available times"** (not for round robin; cannot
  override busy events on another host's calendar), answer invitee questions on their behalf, time zone display
  dropdown. Reminders, notifications and workflows still run.
- Booking on behalf of teammates requires event type permissions.
- If the event uses text notifications, the invitee gets an SMS asking them to confirm before texts are sent.
- API marks such bookings with `invitee.scheduling_method` (`instant_book | api | null`) and
  `invitee.invitee_scheduled_by` (user URI).

---

## 2. Routing forms

Sources: https://calendly.com/help/how-to-create-a-routing-form [V], https://calendly.com/help/how-to-manage-routing-forms [V],
https://calendly.com/help/how-to-pre-populate-invitee-answers-in-routing-forms [V], https://calendly.com/help/calendly-routing [V],
https://calendly.com/help/calendly-analytics [V], API: get-routing-form, sample webhook data [V].

### 2.1 Who and where

- Plans: Professional, Teams, Teams Plus, Enterprise (pricing page shows Teams+).
- Only owners, admins and group admins create routing forms. All users can view and share forms from the Routing
  forms page. To edit, an owner/admin must grant edit permission (form page, bottom, "Edit permissions", add user,
  Apply).
- Location in app: Scheduling, Routing forms (also a "Routing" page). Status `draft | published`.

### 2.2 Building a form

1. New routing form, "Create a new form" (or integrate a HubSpot/Marketo/Pardot form), name it.
2. Form settings: optional **headline** and **description**, customizable **submit button text**.
3. "Add a question", choose format, complete settings, Save. API question types [V]: `name`, `text`, `email`,
   `phone`, `textarea`, `select` (dropdown), `radios`. Each question: `uuid`, `name` (label), `type`, `required`,
   `answer_choices` (for select/radios, else null). The UI may offer additional formats (for example multi-select
   checkboxes); not confirmed [S].
4. Routing logic tab, Create route, "Use form answers" (or Salesforce lookup / HubSpot lookup routes):
   - A **condition** = question + qualifier + answer. Add more qualifier/answer pairs to a condition with **or** /
     **and**; "Add another question" to combine questions in one route.
   - Qualifiers [K]: is, is not, contains, does not contain, starts with, is empty / is not empty; for choice
     questions "is any of" / "is none of". (Exact operator names not confirmed this session.)
   - **Destination** per route: **Event type** (route qualified visitors to a booking page), **Custom message**
     (headline + body, typically for disqualified visitors), **External URL** (redirect to another page).
   - Routes are evaluated in order; first match wins [K, standard behavior; our clone should expose route ordering].
5. **Fallback route**: always present; applies when no route matches; default destination is a custom message;
   editable message or destination.
6. Preview (responses are not recorded in preview), then **Publish form**.
7. Share: copy link (calendly.com/d/xxx-xxx-xxx style short link) or **Add to website** (embed the form).

### 2.3 Prefill and auto-submit [V]

- Append query params to the form link: `?a1=John%20Smith&a2=English` where `aN` is the question number (1-based
  position). Answers are case sensitive and must match option text exactly.
- `autofill=true` auto-submits the form and routes the visitor immediately based on the prefilled answers.
- After routing to an event type, the invitee's name/email (and matching answers) are carried into the booking
  form so they do not retype them [K]; the resulting invitee carries `routing_form_submission` (URI) and the
  submission carries `submitter` (invitee URI) and `submitter_type: "Invitee"` [V].
- UTM params on the form link are recorded on the submission `tracking` [V].

### 2.4 CRM-aware routing [V/S]

- Routing from **HubSpot**, **Marketo**, **Pardot** forms: import the existing marketing form; on submit the visitor
  is redirected to the correct Calendly booking page. Hidden fields can be used in routing rules [S]. Only owners
  and admins configure these integrations.
- **Salesforce lookup** (Enterprise) and **HubSpot lookup** (Teams+): check whether the lead/account already exists
  and route to the record owner; filters by fields such as deal stage or owner [S]. Pricing page: "Route by HubSpot
  assignment" (Teams+), "Route by Salesforce assignment" (Enterprise).
- Interop with LeanData and Distribution Engine routing tools [V].

### 2.5 Submissions (responses) [V]

- Form page, **Responses** tab: response date, destination result, questions and answers. Filters: result type,
  event type, date range. **Export CSV**.
- Routing form analytics (Teams+): how submissions turn into booked meetings; sources Calendly, Marketo, Pardot,
  HubSpot.
- API: `GET /routing_forms?organization=&sort=created_at:asc|desc`, `GET /routing_forms/{uuid}`,
  `GET /routing_form_submissions?form=&sort=`, `GET /routing_form_submissions/{uuid}`; webhook
  `routing_form_submission.created`. There is no write API for routing forms.
- GA integration fires events for routing form visits and submissions [S].

Clone model: `routing_forms(id, org_id, name, status, headline, description, submit_label, slug, fallback jsonb)`,
`routing_form_questions(id uuid, form_id, position, type, label, required, choices jsonb, placeholder, hidden)`,
`routing_rules(id, form_id, position, conditions jsonb {op: 'and'|'or', clauses:[{question_id, operator, values}]},
destination jsonb {type: 'event_type'|'custom_message'|'external_url', event_type_id?, headline?, body?, url?,
pass_answers?: boolean})`, `routing_form_submissions(id, form_id, answers jsonb, tracking jsonb, result jsonb,
invitee_id NULL, created_at)`.

---

## 3. One-off meetings, single-use links, share availability, customize once and share

### 3.1 One-off meetings [V]

Source: https://calendly.com/help/how-to-create-a-one-off-meeting

- All plans. "+ Create, More ways to meet, One-off Meeting". For a one-time, high-priority meeting outside regular
  event types. Can have one or more hosts, custom duration, location.
- Step 1, choose times: set time zone (invitees see their own), duration, additional hosts; pick slots on a
  calendar. You may pick slots over non-Calendly meetings and outside available hours. "+ Add times" selects all
  free times for a day. **Slots can be no more than 3 months apart.** Buffers and meeting show as one block (30 min
  buffer + 30 min meeting appears as a 1 hour block).
- Step 2, details: meeting name, location, optional description/instructions, "Optional settings".
- Share: unique link with editable suffix, "View live page", "Copy Link", or **"Add times to email"** (paste the
  offered times into an email).
- Found under **Scheduling, Single-use links**; after booking, on the Calendar page.
- **Reserve Times**: temporarily hold offered slots by writing placeholder events to the host's and co-hosts'
  calendars; auto-cleared when the invitee books (may take minutes). Manual "Clear reserved times" clears all
  placeholders at once (no partial clear). Reserved slots also block the host's regular event types (shown as busy
  type `reserved` in `user_busy_times`).
- Link expires after it is booked; cannot be reused; **one-off meetings cannot be rescheduled** (cancel and create
  new); **Automations do not apply** to one-off meetings.
- API: `POST /one_off_event_types` [V] body:
  - `name` (required, max 55), `host` (user URI, required), `co_hosts` (user URIs), `duration` (required, max 720),
    `timezone` (defaults to host's), `date_setting` (required, one of):
    - `{ type: "date_range", start_date, end_date }` (end within 365 days of start),
    - `{ type: "days_in_future", days: 0..365, only_weekdays: boolean }`,
    - `{ type: "spots", spots: [{ start_time, end_time }] }` (specific offered windows),
  - `location` (single): `custom {location}`, `google_conference`, `gotomeeting_conference`,
    `physical {location, additional_info}`, `inbound_call {phone_number, additional_info}`,
    `ask_invitee {location}`, `microsoft_teams_conference`, `outbound_call`, `webex_conference`, `zoom_conference`.
  - Result is an event type with `type: "AdhocEventType"`, `duration_options: null`, `pooling_type: null`.

### 3.2 Single-use links [V]

Source: https://calendly.com/help/how-to-create-a-single-use-link

- All plans. From any existing event type (hover, "Create single-use link"). Expires after one booking, so it
  cannot be forwarded or reused. Created one at a time.
- Optional: attach a **contact** and customize before sharing:
  - one-on-one types: meeting name, contact information, duration, location, availability;
  - group, round robin, collective: contact information only.
- "Save and copy link". Paid plans also get **Share**: send from connected Gmail/Outlook with a customizable
  message and an optional reminder if not scheduled in **1, 3 or 7 days**.
- Manage under Scheduling, Single-use links: view, share, duplicate, edit, delete.
- API:
  - `POST /scheduling_links` `{ max_event_count: "1", owner: <event type URI>, owner_type: "EventType" }` returns
    `{ booking_url, owner, owner_type }` (no customization, scope `scheduling_links:write`).
  - `POST /shares` = **"Customize Once and Share"** (one-on-one types only, scope `shares:write`); any field not
    provided is copied from the event type. Body: `event_type` (required), `name` (max 55), `duration` (1..720,
    must be in duration options), `duration_options` (max 4 unique, each 1..720), `period_type`
    (`available_moving | moving | fixed | unlimited`), `start_date`/`end_date` (required when fixed),
    `max_booking_time` (days, required when moving or available_moving), `hide_location` (only respected with a
    single custom location), `location_configurations[] { kind, location (max 255; physical/custom/ask_invitee),
    additional_info (max 255; physical/inbound_call), phone_number (required for inbound_call), position }`,
    `availability_rule { timezone, rules[] { type wday|date, wday, date, intervals[{from,to}] } }`.
    Response `resource { scheduling_links[{ booking_url, owner, owner_type }], share_override {...same fields} }`.
  - `period_type` semantics [K]: `moving` = N calendar days into the future, `available_moving` = N days counting
    only days with availability ("business days"), `fixed` = date range, `unlimited` = indefinitely. This mirrors
    the event type "date range" setting.

### 3.3 Customize once and share [V/C]

- Historical name for the per-invitee customized link (now folded into single-use link customization). One-on-one
  only. Editable at share time: event name, duration, location, date range, weekly hours, date-specific hours
  [C: community post 164]. Workflows attached to the original event type still fire [C]. Booked meetings from such
  links could not be rescheduled with full availability in the mobile app [C, known issue].

### 3.4 Share availability (email from Gmail/Outlook) and follow-ups [V]

Source: https://calendly.com/help/how-to-share-your-availability-with-gmail-or-outlook-in-calendly

- Standard+. Requires the "Gmail or Outlook for Automations" connection. From Scheduling (hover event type, "Share
  availability") or Contacts (pick contact, then event type): composer with To, editable message, optional automatic
  reminder if not scheduled in 1, 3 or 7 days (reminder text not customizable). Sent from the user's own mailbox
  (appears in Sent; replies go to their inbox).
- Calendly tracks who received availability; if they do not book within **3 days** they appear in **Recommended
  follow-ups** (send personalized follow-up, view original message, dismiss, track conversions).
- Also "Add times to email" (one-off) and the browser extension/Gmail add-on insert times or links into emails [K].

### 3.5 Meeting polls (the Doodle replacement; secondary scope) [S]

Sources: https://calendly.com/help/meeting-polls-overview, https://calendly.com/help/how-to-set-up-a-meeting-poll

- All plans. "+ Create, More ways to meet, Meeting poll". Set time zone, duration, extra hosts, then pick up to
  **40** candidate times; then meeting name, location, description; share the unique link.
- Voters need no Calendly account; votes are final once submitted; no new times can be added after publishing.
- Host reviews results (Scheduling, Meeting polls tab), picks a slot, "Book", reviews invitee list (can add people
  who did not vote); Calendly sends invites.
- Reminders/rescheduling workflows not supported. Poll closes when booked, when all proposed times pass, or when
  deleted.
- API: polls appear as event types with `booking_method: "poll"` (vs `instant`).

---

## 4. Contacts [V]

Sources: https://calendly.com/help/contacts-overview, contact webhook payloads in https://developer.calendly.com/api-docs/calendly-api/webhooks/get-sample-webhook-data, operations.json (contacts endpoints)

Features:

- All plans. Contacts are created automatically when someone books with you; can also be created manually before
  they book. Profiles update automatically each time you schedule.
- Contact profile: details (email, phone, LinkedIn, time zone, job title, company, location), **past and upcoming
  meetings** (meeting history), notes, reminders, custom fields, lists [pricing page].
- Hover card on a contact name: email, phone, LinkedIn, time zone, plus actions **Book meeting**, **Share
  availability**, **Send email**.
- **Schedule with contact**: Contacts, select contact, Schedule, "Book meeting" (name/email prefilled) or "Share
  availability".
- Email contacts from Calendly (paid; Gmail conversation sync, AI drafts, templates, bulk send).
- "Follow up on missed opportunities" (limited availability): contacts who received a link but did not book.
- Export of contacts was reported unavailable (export meetings CSV instead); import limited to select users [S].
- Contact automations (limited availability) and "Opportunities" (limited) exist in the help center navigation.

API Contact object (from `contact.created/updated` payloads) [V]:

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string | contact URI |
| `creation_source` | string | how the contact was created (for example booking vs manual) |
| `name` | string | display name |
| `emails` | `[{ email, is_primary }]` | 1..10, exactly one primary |
| `phone_numbers` | `[{ phone_number }]` | max 10 |
| `timezone` | string or null | IANA |
| `job_title`, `company`, `city`, `state` | string or null | |
| `country` | string or null | ISO 3166-1 alpha-2 when filtering |
| `linkedin` | URL or null | |
| `custom_fields` | `[{ uri, label, value }]` | `uri` is the custom field definition |
| `next_meeting_date`, `last_meeting_date`, `last_interaction_date` | ISO datetime or null | from interaction summaries; null on create |
| `first_email_date`, `last_email_date` | ISO datetime or null | email interactions |
| `created_at`, `updated_at` | ISO datetime | |

Custom field definitions: `field_type` one of `text`, `single_select` (value must be an option uuid), `number`,
`boolean`, `currency` (integer minor units; ISO currency on the definition), `date` (YYYY-MM-DD), `tags` (array of
strings). Endpoints: `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/{uuid}`, `GET /contacts/custom_field_definitions`
and `/{uuid}`. List filters: `email`, `phone_number`, `timezone` (exact, comma lists), `name`, `job_title`,
`company`, `city` (partial), `country`, `state` (exact), `sort` (`created_at|updated_at:asc|desc`), `count`
(1..100, default 20), `page_token`, `exclude=custom_fields`. PATCH of `emails`/`phone_numbers` overwrites the whole
array. `contact.deleted` payload: `{ user_uuid, contact: { uri, deleted_at } }`.

---

## 5. Analytics [V]

Source: https://calendly.com/help/calendly-analytics

- Owners and admins (group admins scoped to their groups); plans Standard and up. Users who are not admins see only
  their own data. Data retained for up to **one year**.
- Dashboard (Profile dropdown, Analytics; URL `/app/organization/reporting`) widgets: **Created events**,
  **Completed events and trends**, **Rescheduled events**, **Canceled events**, **Event distribution by duration**,
  **Popular events** (event types), **Popular times** (days of week x hours heatmap, hover/click to drill in). Each
  widget has an info icon and a three-dots menu. "Customize" chooses which widgets show.
- Two views: organization-wide **event data** and individual **user data** (per user activity: meetings created,
  completed, canceled, rescheduled per host) [K for exact columns].
- Filters: date range, user, team, group, event type. Shared event types: filter by host name.
- Export CSV: **Event Data** or **Employee (user) Data**.
- Routing form analytics (Teams+): submissions to bookings conversion, by source (Calendly, Marketo, Pardot,
  HubSpot).
- Separately, all users can download meeting reports (CSV export of meetings) scoped by role [V roles article].

Clone computation (all derivable from our own tables): created = invitees created in range; completed = active
events whose end_time < now; canceled = invitees/events with cancellation in range (split by canceler_type
host vs invitee); rescheduled = invitees with `rescheduled = true`; no-shows = invitee_no_shows; duration buckets;
popular event types; heatmap by local weekday/hour of start_time in the viewer's time zone.

---

## 6. Integrations

### 6.1 Webhooks [V]

Sources: get-webhook-subscription, create-webhook-subscription (operations.json), get-sample-webhook-data,
https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures,
https://developer.calendly.com/api-docs/overview/webhooks/webhook-errors,
https://developer.calendly.com/api-docs/overview/webhooks/webhook-timeouts,
https://developer.calendly.com/docs/api-guides/see-how-webhook-payloads-change-when-invitees-reschedule-events

Subscription create (`POST /webhook_subscriptions`): `url` (required), `events` (required, min 1), `organization`
(required), `scope` (required: `organization | user | group`), `user` (when scope user), `group` (when scope group),
`signing_key` (optional; OAuth apps get an app-level key automatically). Plans: Standard+.

Event names:

| Event | Payload |
| --- | --- |
| `invitee.created` | Invitee + embedded `scheduled_event` |
| `invitee.canceled` | same, `status: canceled`, `cancellation` set; on reschedule `rescheduled: true` and `new_invitee` set |
| `invitee_no_show.created` | Invitee payload with `no_show { uri, created_at }` |
| `invitee_no_show.deleted` | Invitee payload (no_show cleared) |
| `routing_form_submission.created` | RoutingFormSubmission |
| `event_type.created`, `event_type.updated`, `event_type.deleted` | EventType payload (listed in create/sample enums) |
| `contact.created`, `contact.updated` | `{ user_uuid, contact }` |
| `contact.deleted` | `{ user_uuid, contact { uri, deleted_at } }` |
| `meeting_recap.created`, `meeting_recap.updated`, `meeting_recap.deleted` | `{ event {uri,name,start_time,end_time,location,attendees[{host,user_email,user_name}]}, recap {uri, transcript, summary_md, action_items_md, discussion_md, share_link, created_at, updated_at} }` (Notetaker) |

Envelope:

```json
{
  "event": "invitee.created",
  "created_at": "2020-11-23T17:51:19.000000Z",
  "created_by": "https://api.calendly.com/users/AAAA",
  "payload": { "...": "..." }
}
```

Invitee payload fields: everything on the Invitee object (section 9.6) plus `scheduled_event` (uri, name, status,
start_time, end_time, event_type, location, invitees_counter, created_at, updated_at, event_memberships[{user,
user_email, user_name}], event_guests[{email, created_at, updated_at}], meeting_notes_plain, meeting_notes_html,
cancellation).

Rescheduling: one reschedule fires BOTH `invitee.canceled` (old invitee, `rescheduled: true`, `new_invitee` URI) and
`invitee.created` (new invitee on a NEW scheduled event, `old_invitee` URI). Reschedule is per invitee, not per
event.

Signing:

- Header `Calendly-Webhook-Signature: t=1492774577,v1=<hex>`.
- `v1 = HMAC_SHA256(signing_key, t + "." + raw_request_body)` hex.
- Reject if `t` older than a tolerance (docs example: 3 minutes) to prevent replays.

Delivery:

- Connection timeout 10 s, read timeout 15 s; respond 2xx quickly and process async.
- On 3xx/4xx/5xx Calendly retries with exponential backoff for **24 hours** (or until 24 hours after the booking);
  after 24 hours without a success the subscription is **disabled** (`state: disabled`) and must be recreated.
  `retry_started_at` marks the start of the failing window. Other messages keep being attempted meanwhile.
- `GET /sample_webhook_data?event=&organization=&scope=&user=&group=` returns a sample payload for testing.

Clone model: `webhook_subscriptions(id, org_id, scope, user_id, group_id, callback_url, events text[], signing_key
(encrypted), state, retry_started_at, creator_id, created_at, updated_at)` and
`webhook_deliveries(id, subscription_id, event, payload jsonb, attempt, next_attempt_at, status, response_code,
response_ms, created_at)` driven by the jobs table and /api/cron.

### 6.2 REST API v2 resources (current endpoint inventory) [V]

From https://developer.calendly.com/llms.txt and operations.json. All IDs are full URIs
(`https://api.calendly.com/<collection>/<uuid>`); collections return `{ collection, pagination }`; single GETs return
`{ resource }`.

| Area | Endpoints |
| --- | --- |
| Users | `GET /users/me`, `GET /users/{uuid}` |
| Organizations | `GET /organizations/{uuid}`; `GET/POST /organizations/{uuid}/invitations` (filters email, status, sort); `GET/DELETE /organizations/{org_uuid}/invitations/{uuid}`; `GET /organization_memberships` (filters organization, user, email, role); `GET/DELETE /organization_memberships/{uuid}`; `GET /teams?user=`, `GET /teams/{uuid}` |
| Groups | `GET /groups?organization=`, `GET /groups/{uuid}`, `GET /group_relationships`, `GET /group_relationships/{uuid}` |
| Event types | `GET /event_types` (filters user, organization, active, admin_managed, user_availability_schedule; sort name, position, created_at, updated_at; default `name:asc`); `POST /event_types`; `GET/PATCH /event_types/{uuid}`; `POST /one_off_event_types`; `GET /event_type_memberships?event_type=` (hosts); `GET /event_type_available_times` |
| Availability | `GET /user_availability_schedules?user=`, `GET /user_availability_schedules/{uuid}`, `GET /user_busy_times`, `GET/PATCH /event_type_availability_schedules?event_type=` |
| Locations | `GET /locations?user=` (user's configured meeting locations) |
| Scheduled events | `GET /scheduled_events` (filters user, organization, group, invitee_email, status, min_start_time, max_start_time; sort start_time); `GET /scheduled_events/{uuid}`; `POST /scheduled_events/{uuid}/cancellation {reason <= 10000}`; `GET /scheduled_events/{uuid}/invitees` (filters status, email; sort created_at); `GET /scheduled_events/{event_uuid}/invitees/{invitee_uuid}`; `POST /invitees` (Scheduling API) |
| No-shows | `POST /invitee_no_shows {invitee}`, `GET/DELETE /invitee_no_shows/{uuid}` |
| Links | `POST /scheduling_links`, `POST /shares` |
| Routing | `GET /routing_forms`, `GET /routing_forms/{uuid}`, `GET /routing_form_submissions?form=`, `GET /routing_form_submissions/{uuid}` |
| Webhooks | `GET/POST /webhook_subscriptions`, `GET/DELETE /webhook_subscriptions/{uuid}`, `GET /sample_webhook_data` |
| Contacts | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/{uuid}`, custom field definitions |
| Compliance | `POST /data_compliance/deletion/invitees {emails[]}`, `POST /data_compliance/deletion/events {start_time, end_time}` (Enterprise) |
| Audit | `GET /activity_log_entries` (Enterprise; filters organization, search_term with operators, actor[], namespace[], action[], min/max_occurred_at; sort action, actor.display_name, actor.uri, namespace, occurred_at) |
| Comms | `GET /outgoing_communications?organization=&min_created_at=&max_created_at=` (sent SMS and email) |
| Notetaker | `GET /meeting_recaps` (filters event, start_time, end_time, status available/processing/unavailable, attendee), `GET/PATCH/DELETE /meeting_recaps/{uuid}`, `GET /meeting_recaps/{uuid}/transcript` |
| OAuth | `GET https://auth.calendly.com/oauth/authorize`, token, introspect, revoke; single-use refresh tokens (rotation) |

Conventions [V] (https://developer.calendly.com/api-docs/overview/api/api-conventions):

- URIs as identifiers in requests and responses; resource references are URIs.
- Keyset pagination: `count` (1..100, default 20), `page_token`; response `pagination { count, next_page,
  previous_page, next_page_token, previous_page_token }`.
- Deterministic responses irrespective of requester role (explicit filters are always required, for example
  `user=` or `organization=`); permission still enforced (403).
- Errors: `{ title, message, details?: [{ parameter, message, code }] }`; 403 InsufficientScope includes
  `required_scopes[]`; 424 when an external calendar cannot be reached (busy times).
- Rate limits [V] (https://developer.calendly.com/api-docs/overview/rate-limits): paid 500 req/user/min, free
  50/min, max 8 OAuth token requests per user per minute; `POST /invitees` trial 5/day, paid non-enterprise
  10/min, 50/hour, 100/day, enterprise 500/min. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` (seconds, typically 60); 429 on exceed.
- Scopes [V] (https://developer.calendly.com/docs/authentication/scopes): `availability:read|write`,
  `event_types:read|write`, `locations:read`, `routing_forms:read`, `shares:write`, `scheduled_events:read|write`,
  `scheduling_links:write`, `groups:read`, `organizations:read|write`, `users:read`, `webhooks:read|write`,
  `activity_log:read`, `data_compliance:write`, `outgoing_communications:read`, `contacts:read|write`,
  `meeting_recaps:read|write`. A `:write` scope implies `:read` in the same domain. Personal access tokens and OAuth
  apps are both supported.

Scheduling API (`POST /invitees`) body [V]: `event_type` (URI), `start_time` (UTC), `invitee { name | first_name
(+ last_name), email, timezone, text_reminder_number (E.164) }`, `location` (must match an event type location; do
not pass for round robin events whose location is per host; kinds physical{location}, inbound_call,
outbound_call{location phone}, zoom_conference, google_conference, gotomeeting_conference,
microsoft_teams_conference, webex_conference, ask_invitee{location}, custom{location}), `questions_and_answers[]
{question (exact, case sensitive), answer, position}` (all required questions must be present), `tracking { utm_*,
salesforce_uuid }`, `event_guests[]` (max 10 emails).

### 6.3 Embeds [V]

Sources: https://developer.calendly.com/api-docs/overview/embedding/getting-started,
https://developer.calendly.com/api-docs/overview/embedding/recipes,
https://developer.calendly.com/api-docs/overview/embedding/notifying-the-parent-window,
https://calendly.com/help/how-to-customize-your-embed, https://calendly.com/help/calendly-cookie-management-and-banner

Three embed types: **Inline** (iframe in a div), **Popup widget** (floating badge button, default bottom-right),
**Popup text** (link that opens the popup). Embeddable pages: a landing page (all active personal or team event
types) or a single event type booking page; routing forms can also be embedded.

Script: `https://assets.calendly.com/assets/external/widget.js` (+ `widget.css` for popups).

HTML auto-init: `<div class="calendly-inline-widget" data-url="https://calendly.com/LINK" style="min-width:320px;
height:630px;" data-auto-load="false"></div>`; `data-resize="true"` auto-resizes height [K].

JS API:

- `Calendly.initInlineWidget({ url, parentElement, prefill: {}, utm: {}, resize? })`
- `Calendly.initPopupWidget({ url, prefill, utm })` (use in onclick to build your own button; `return false`)
- `Calendly.initBadgeWidget({ url, text, color, textColor, branding })`
- `Calendly.closePopupWidget()`, `Calendly.destroyBadgeWidget()` [K]
- `prefill`: `name` or `firstName` + `lastName`, `email`, `guests` [K], `customAnswers: { a1..a10 }` (numbered in
  question order), `date` [K].
- `utm`: `utmCampaign`, `utmSource`, `utmMedium`, `utmContent`, `utmTerm`; the embed also auto-reads `utm_*` from the
  parent page URL. UTM values max 255 chars. Salesforce `salesforce_uuid` is also tracked.

URL parameters (work on direct links and embeds):

| Param | Effect |
| --- | --- |
| `hide_event_type_details=1` | hide host photo, name, duration, location, description on an event page |
| `hide_landing_page_details=1` | same for profile/team landing page |
| `hide_gdpr_banner=1` | hide cookie banner in embeds (site must handle consent; Calendly still sets cookies) |
| `background_color`, `text_color`, `primary_color` | hex without `#` (paid); primary = buttons and links |
| `month=YYYY-MM`, `date=YYYY-MM-DD` | preselect month/date (used by available-times `scheduling_url`) |
| `name`, `email`, `first_name`, `last_name`, `a1`..`a10`, `guests` [K for guests] | prefill booking form |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `salesforce_uuid` | tracking |

Embed generator options: Hide Event Details, Hide Cookie Banner, colors, button text (popup only), widget position
via CSS (`.calendly-badge-widget { left: 20px; right: auto }` or centered).

postMessage events to the parent window (`window.addEventListener('message', ...)`, `e.data.event` starts with
`calendly`):

| Event | Payload |
| --- | --- |
| `calendly.profile_page_viewed` | `{}` |
| `calendly.event_type_viewed` | `{}` |
| `calendly.date_and_time_selected` | `{}` |
| `calendly.event_scheduled` | `{ event: { uri }, invitee: { uri } }` |
| `calendly.page_height` | `{ height: "1200px" }` (inline only) |

Clone: ship `/embed.js` exposing `window.Calendly` with the same method names so existing snippets work if the user
swaps the script URL, and post the same message names (optionally namespaced aliases).

### 6.4 Payments: Stripe and PayPal [V]

Sources: https://calendly.com/help/calendly-stripe, https://calendly.com/help/calendly-paypal

Common:

- Plans: Standard and up (Professional legacy). Connect in Automations, Integrations & apps. Each user connects
  their own account for **personal** event types (one-on-one and group); admins cannot connect on their behalf.
  **Shared/team** event types (round robin, collective, group) use the **organization owner's** connected account.
- Per event type: More options, **Payment** section: toggle "Require payment to book this meeting" (Stripe) or
  "Accept payments with PayPal", choose processor, **amount and currency**, **payment terms and cancellation policy**
  text shown before payment (API example says up to 1,024 characters), Save. Revert with "Do not collect payments
  for this event".
- Currencies (both): AUD, CAD, EUR, GBP, USD. Calendly does not calculate or collect VAT/sales tax [S].
- Payment is collected upfront during booking; transaction link appears in event details on the Calendar page.
- **Refunds are not processed by Calendly**: the account holder refunds manually in Stripe/PayPal. Cancellation
  policy enforcement is the host's responsibility.
- Disconnecting the processor makes previously paid event types bookable without payment.
- API: `event_type.is_paid`; `invitee.payment { external_id, provider stripe|paypal, amount, currency, terms,
  successful }`.

Stripe specifics:

- Methods: cards, Apple Pay, Google Pay, Link (instant bank), Affirm and Klarna (BNPL, availability varies); all on
  by default, controlled in Stripe's payment method settings for the Calendly configuration. Stripe must be in live
  mode.
- **Coupon codes** (Stripe only): per event type; code (what invitees enter), coupon name (on receipts), type
  percentage off or fixed amount off, options: first-time only, usage limits, expiration date. Code names unique
  across the account. A 100% coupon skips checkout (no Stripe transaction).
- SCA/3D Secure supported (PSD2).
- Abandoned checkouts show in Stripe as "Incomplete"/"Uncaptured" (not failed charges).

PayPal specifics: PayPal wallet, Venmo (US), cards; **no coupon codes** (workaround: secret duplicate event type with
a lower price).

Beta: meeting packages (prepaid bundles of one-on-one sessions booked over time via a unique link), payment links
(charge without a meeting), invoices.

Clone: Stripe Checkout Session or PaymentIntent created when the invitee confirms the slot; hold the slot with a
short-lived reservation (for example 10 minutes) until `checkout.session.completed`; store payments table
`(invitee_id, provider, external_id, amount_minor, currency, terms, status, coupon_id)`; coupons table.

### 6.5 Other integrations (list only) [V/S]

- Calendars: Google, Outlook/Office 365, Outlook.com, Exchange, iCloud; Outlook desktop plug-in (legacy). Up to 6
  calendars on paid plans. "What's considered unavailable?" status mapping (for example treat tentative as busy).
- Video: Zoom (user or org-wide admin connection on Teams+), Google Meet, Microsoft Teams, Webex, GoTo Meeting.
- CRM/marketing: HubSpot (Standard+; sync contacts/meetings, routing from HubSpot forms, HubSpot lookup), Salesforce
  (Teams+; create/update Leads/Contacts/Events, routing, Salesforce lookup Enterprise), Microsoft Dynamics 365
  (Enterprise), Marketo, Pardot (Teams+), Mailchimp.
- Automation: Zapier (triggers such as Invitee Created, Invitee Canceled, Routing Form Submitted [K]), Make,
  Microsoft Power Automate (Enterprise), webhooks.
- Tracking: **Google Analytics 4** (Standard+): tracks routing form visits and submissions, booking page visits,
  date/time selections and scheduled events; UTMs flow through as GA traffic source [S]. Historic event names
  (Universal Analytics era, category "Calendly"): "Event Type Viewed", "Invitee: Date & Time Selected", "Invitee:
  Meeting Scheduled" [K]. **Meta Pixel** (Standard+): enter Pixel ID in Integrations & apps; built/managed by Meta;
  fires on invitee actions (page view, scheduled) [S/K].
- Email: Gmail and Outlook connections for sending automation emails and share-availability emails from the user's
  mailbox.
- Routing tools: LeanData, Distribution Engine.
- Others: Slack, browser extensions (Chrome, Edge, Firefox), LinkedIn messaging, mobile apps (iOS/Android), Calendly
  MCP server (mcp.calendly.com) for AI clients, Notetaker (AI recaps), Callie (AI scheduling over email, beta).

---

## 7. Branding and booking page customization

Sources: https://calendly.com/help/account-settings-overview [V], https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page [V],
https://calendly.com/help/how-to-customize-your-embed [V], https://calendly.com/help/calendly-cookie-management-and-banner [V],
https://calendly.com/help/how-to-require-email-verification-for-event-types [S]

| Setting | Where | Details |
| --- | --- | --- |
| Logo | Settings, Branding (org logo in Admin center) | Shown top-left of scheduling pages. Owner/admin can "apply branding to others" (org-wide). Community: min 440x240 px, under 5 MB [C]. |
| Use Calendly branding | Settings, Branding | Default ON ("Powered by Calendly" badge). Toggle off on paid plans (owner/admin). Also affects invitee emails: profile picture replaces the Calendly logo. Team/shared event types follow the org owner's setting. |
| Profile picture | Settings, Profile, General | Avatar shown on booking pages and emails (community: 90x90 px, under 5 MB [C]). |
| Name, welcome message | Profile, General | Welcome message shown on the landing page (search summary says 265-character limit [S]). |
| Language | Profile, General | App/landing language: English, French, Spanish, German, Portuguese (Brazil) [S]; API user `locale` enum `en, fr, es, de, pt, ps`. Event types have their own `locale` (`en, fr, es, de, nl, pt, it, uk`) that sets the booking page language. |
| Date format | Profile, General | MM/DD/YYYY or DD/MM/YYYY |
| Time format | Profile, General | 12h (am/pm) or 24h; API `time_notation: 12h | 24h` (default 12h) |
| Country, time zone | Profile, General | Default time zone; invitees see times in their detected zone (event can lock time zone, covered in core docs) |
| My link | Settings, My link | Personal slug, `calendly.com/<slug>`. Changing a link breaks previously shared links [S]. Event type slugs editable per event type; shared event types cannot change URL. |
| Event color | Event type editor | `color` hex (`^#[a-f0-9]{6}$`), used on cards and scheduling page accents |
| Embed colors | Embed generator / URL params | background, text, primary (buttons/links), button text (popup); paid plans. Standalone booking page colors are NOT customizable (embed only) [C, Aug 2026 feature request]. |
| Hide details | URL params | `hide_event_type_details`, `hide_landing_page_details` |
| Confirmation page | Event type, Notifications/Confirmation | Paid: custom confirmation page with links, or redirect to external URL (optionally passing event details) [V pricing, K details] |
| Cookie banner | fixed on Calendly-hosted booking pages (cannot be hidden or changed); hideable on embeds with `hide_gdpr_banner=1` | Banner text quoted in the help article (cookies for personalization, interactions incl. clicks/cursor/screen recordings, marketing; "Decline" or "Cookie Settings"). Invitees manage via "Cookie settings" link at the bottom of the booking page (Confirm my choices / Reject all). Users manage via Settings, Privacy, Cookies, Manage cookies. Preferences are per individual. Consent is requested from all EU visitors; banner not shown when logged in [S]. |
| Email verification | Settings, Privacy, Booking (or Admin center, Security, Booking) | Per event type: send a 6-digit code to the invitee email; booking is not created unless verified. Anti-spam for public links [S]. |
| Blocked people | Settings, Privacy, Blocked people | Limited availability: block a source from a meeting within 90 days of the meeting; prevents future bookings; unblock in list [S]. |
| Secret event types | Event type | `secret: true` hides it from the landing page; booked only by direct link [V API]. |

Clone: `branding(org_id or user_id, logo_url, apply_to_org, show_powered_by, brand_colors jsonb {background, text,
primary, button_text})`. We can go beyond Calendly by letting colors apply to the hosted booking page too.

---

## 8. Account settings and security

Sources: https://calendly.com/help/account-settings-overview [V], https://calendly.com/help/how-to-update-your-login-preferences [S],
https://calendly.com/help/how-to-delete-personal-data-in-calendly [S], https://calendly.com/help/user-roles-and-permissions [V],
https://calendly.com/help/calendly-scheduling-notifications [S]

Settings map (left nav "Settings"):

- **Account**
  - Profile: **General** (picture, name, welcome message, language, date/time format, country, time zone) and
    **Login** (login email, password, login method Google/Microsoft/email, **two-factor authentication**).
  - Calendar: **Calendar** (connect calendars, conflict checking, destination calendar, "What's considered
    unavailable?" mapping), **Availability** (account-level schedule and date-specific defaults), **Advanced**
    (cross-event-type controls: **account-wide meeting limits** and **holidays**).
  - Branding (logo, apply branding to others, disable Calendly branding).
  - My link (personal URL).
  - Notifications (notification email preferences; phone numbers for SMS automations, paid).
  - Privacy: Booking (email verification), Blocked people, Cookies.
- **Features**: AI (Callie, Notetaker tabs), Contacts.
- **Admin** (owners/admins): Admin center: users, teams, groups, managed events, permissions (who can invite, who can
  create shared event types), security (data deletion, booking email verification, SSO, SCIM), branding, billing,
  activity log.

Login and identity:

- Login methods: Google, Microsoft, or Calendly email + password. Switch: "Unlink" to move to a Calendly password;
  "Switch to Google/Microsoft"; Calendly sends a **6-digit code** to the email to confirm before entering the new
  provider's credentials. Calendar connections remain; manage them separately on Calendar connections.
- Change email: Account settings, Login preferences, "Change email"; Google/Microsoft users are redirected to their
  provider; confirm via link sent to the new inbox. SSO users must change it in the IdP.
- SAML SSO (Enterprise, Teams add-on): owner/admin configure; disabling keeps config, deleting removes it; users then
  fall back to their original login method. SCIM provisioning and group provisioning (Enterprise). Domain control
  (Enterprise): oversight of accounts on the company domain.
- Two-factor authentication on the Login tab [V].

Deleting things:

- Delete own account: Profile, Delete account. Options: transfer ownership then delete; keep account but leave the
  org; delete and disband the org (owner). Owner deletion disbands the org (teams deleted, members removed, their
  accounts kept) [V/S].
- Data deletion (owner/admin, all plans): Admin center, Security, Data deletion: **by date range** (all invitee data
  for events in the range) or **by invitee emails** (up to 100, comma separated). Effects: invitee/contact name
  deleted, email and domain anonymized (for example `1e99adf8a31ad9@deleted.calendly.com`), invitee Q&A removed [S].
  Data Deletion API (Enterprise): `POST /data_compliance/deletion/invitees { emails[] }`,
  `POST /data_compliance/deletion/events { start_time, end_time }`; processing can take up to 7 days [S].
- Activity log (Enterprise): audit of who did what (actor with type, display name, alternative identifier, group,
  organization role; action; namespace; occurred_at) with search operators `|`, `+`, quotes, `-`, parentheses, `*`.

Notifications:

- Host booking notification email (from notifications@calendly.com) on every booking, in addition to the calendar
  event; cannot be turned off [S]. Invitee confirmation emails also cannot be turned off [S].
- Calendar invitations vs email confirmations: event types can send a calendar invitation (invitee added as
  attendee) or email confirmations with .ics (group events always use email confirmations) [V group article, S].
- Calendly follows Google Calendar notification settings for events it creates [S].
- Hosts added to shared event types get an email (unsubscribe link, or Settings, Notifications) [V].
- Reminders/follow-ups via Automations (workflows; email and SMS), covered in core docs.

Connected apps: Automations, **Integrations & apps** page lists connected and available integrations (connect /
disconnect). OAuth apps authorized by the user can be revoked [K].

Clone model hints: `users(locale, date_format, time_format, country, timezone, welcome_message, avatar_url, slug,
two_factor_secret)`, `user_settings_advanced(account_meeting_limits jsonb, holidays jsonb)`,
`data_deletion_requests(id, org_id, type 'date_range'|'emails', params, status, requested_by, completed_at)`,
`activity_log(id, org_id, actor_id, action, namespace, details jsonb, occurred_at)`, `blocked_sources(user_id,
email, domain, created_at)`.

---

## 9. Calendly API v2 object model (field by field)

All timestamps are UTC ISO 8601 with microseconds (for example `2020-01-02T03:04:05.678123Z`). "req" = always
present; "null" = nullable.

### 9.1 event_type [V]

Source: https://developer.calendly.com/api-docs/calendly-api/event-types/get-event-type

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string req | `https://api.calendly.com/event_types/{uuid}` |
| `name` | string null | |
| `active` | boolean req | inactive types are hidden and unbookable |
| `booking_method` | `instant` \| `poll` | poll = meeting poll |
| `slug` | string null | URL segment |
| `scheduling_url` | string req | public booking URL |
| `duration` | number req | minutes (default when multiple options) |
| `duration_options` | int[] null | max 4 unique, each 1..720; duration must be one of them; always null for adhoc |
| `kind` | `solo` \| `group` | group = multiple invitees per slot |
| `pooling_type` | `round_robin` \| `collective` \| `multi_pool` \| null | null = no multi-host pooling |
| `type` | `StandardEventType` \| `AdhocEventType` | adhoc = one-off meeting |
| `color` | string req | hex `#rrggbb` |
| `description_plain` / `description_html` | string null | |
| `internal_note` | string null | host-only note |
| `is_paid` | boolean req | payment required |
| `locale` | `en, fr, es, de, nl, pt, it, uk` | booking page language |
| `locations` | LocationConfiguration[] null | `{ kind, location?, additional_info?, phone_number? }`; kinds: `ask_invitee, custom, google_conference, gotomeeting_conference, inbound_call, microsoft_teams_conference, outbound_call, physical, webex_conference, zoom_conference` |
| `custom_questions` | EventTypeCustomQuestion[] | see below |
| `secret` | boolean req | hidden from landing page |
| `admin_managed` | boolean req | managed event copy |
| `position` | integer req | display order from 0 |
| `profile` | `{ type: User\|Team, name, owner (URI) }` | owner user or team |
| `created_at`, `updated_at` | string req | |
| `deleted_at` | string null | deleted types remain fetchable for historic events |

EventTypeCustomQuestion: `name` (question text), `type` (`string` one line, `text` multi line, `phone_number`,
`single_select` radios, `multi_select` checkboxes), `position` (after name and email), `enabled`, `required`,
`answer_choices[]`, `include_other` (adds free text "Other" to select types). Booking form also has built-in name
(single or first/last), email, guests (max 10), and SMS reminder number.

Create (`POST /event_types`) body: `owner` (req, user URI), `name` (req), `active` (default false),
`description`, `duration` (1..720), `duration_options`, `locations[]`, `color`, `locale`. Update (`PATCH`) accepts
`active, name, color, description, duration, duration_options, locale, locations`. The public API exposes NO
buffers, minimum notice, increments, limits, date range, questions write, or host configuration; those are UI-only
in Calendly. Our public API should expose them (superset).

### 9.2 Availability schedules and rules [V]

User availability schedule (`GET /user_availability_schedules?user=`, `/{uuid}`):

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string | |
| `default` | boolean | the user's default schedule |
| `name` | string | for example "Working Hours" |
| `user` | URI | |
| `timezone` | string | IANA; rules are local to it |
| `rules` | AvailabilityRule[] | |

AvailabilityRule: `type` (`wday` or `date`), `wday` (`sunday..saturday`, when type wday), `date` (`YYYY-MM-DD`,
future date, when type date), `intervals[] { from: "hh:mm", to: "hh:mm" }` (24h local). **Empty intervals = no
availability that day** (a date rule with no intervals marks a day off). A date rule overrides the weekday rule for
that date. Multiple intervals per day allowed.

Event type availability (`GET /event_type_availability_schedules?event_type=` and PATCH): body
`availability_rule { timezone (req), rules[] (overwrites ALL existing rules), user (required when an admin edits a
specific host) }`, `availability_setting: "host"` (default: every host on the event type shares an identical
schedule). Event types can use a named user schedule or custom hours; `GET /event_types?user=&user_availability_schedule=`
filters types using a given schedule.

### 9.3 user_busy_times [V]

`GET /user_busy_times?user=&start_time=&end_time=`; range max 7 days; start cannot be in the past; no keyset
pagination; ascending.

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `calendly` \| `reserved` \| `external` | reserved = one-off "Reserve Times" holds; external only from calendars with "Check for conflicts" |
| `start_time`, `end_time` | string | the meeting itself |
| `buffered_start_time`, `buffered_end_time` | string optional | expanded by the event type's before/after buffers (Calendly events only) |
| `event` | `{ uri }` optional | the Calendly scheduled event |

424 Failed Dependency when an external calendar cannot be read.

### 9.4 event_type_available_times [V]

`GET /event_type_available_times?event_type=&start_time=&end_time=`; range max 31 days; start not in the past; no
pagination.

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"available"` | |
| `invitees_remaining` | number | group types can be > 1; others 1 |
| `start_time` | string | UTC |
| `scheduling_url` | string | deep link like `.../discovery-call/2020-01-02T20:00:00Z?month=2020-01&date=2020-01-02` |

### 9.5 scheduled_event [V]

Source: https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-scheduled-event

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string req | |
| `name` | string null | event name (can differ from event type name, for example customized) |
| `status` | `active` \| `canceled` | |
| `start_time`, `end_time` | string req | UTC |
| `event_type` | URI req | |
| `location` | Location req | polymorphic, see below |
| `invitees_counter` | `{ total, active, limit }` | total includes canceled; limit = max active |
| `created_at`, `updated_at` | string | |
| `event_memberships` | `[{ user, user_email?, user_name?, buffered_start_time?, buffered_end_time? }]` | hosts; buffered times per host |
| `event_guests` | `[{ email, created_at, updated_at }]` | guests added by invitee |
| `calendar_event` | `{ kind: exchange\|google\|icloud\|outlook\|outlook_desktop, external_id }` | deprecated |
| `meeting_notes_plain` / `meeting_notes_html` | string optional | internal host notes |
| `cancellation` | `{ canceled_by, reason null, canceler_type host\|invitee, created_at }` optional | |

Location variants (note the `type` values differ from event type config `kind` values):

| `type` | Fields |
| --- | --- |
| `physical` | `location`, `additional_info?` |
| `outbound_call` | `location` (invitee phone host will call, null) |
| `inbound_call` | `location` (phone invitee calls), `additional_info?` |
| `google_conference` | `status`, `join_url` |
| `zoom` | `status`, `join_url`, `data { id, settings { global_dial_in_numbers[{number,country,type,city,country_name}] }, extra { intl_numbers_url }, password }` |
| `gotomeeting` | `status`, `join_url`, `data { uniqueMeetingId, conferenceCallInfo }` |
| `microsoft_teams_conference` | `status`, `join_url`, `data { id, audioConferencing { conferenceId, dialinUrl, tollNumber } }` |
| `webex_conference` | `status`, `join_url`, `data { id, telephony { callInNumbers[{label, callInNumber, tollType}] }, password }` |
| `custom` | `location` (host text) |
| `ask_invitee` | `location` (invitee text) |

Conference `status`: `processing` (generation pending), `initiated` (requesting from provider), `pushed` (details
available; only then join_url/data non-null), `failed` (error or canceled), null (no longer available). Conference
details are dropped 6 months after the event.

List filters: `user`, `organization`, `group`, `invitee_email`, `status`, `min_start_time`, `max_start_time`,
`sort=start_time:asc|desc`, `count`, `page_token`. Cancel: `POST /scheduled_events/{uuid}/cancellation { reason }`.

### 9.6 invitee [V]

Source: https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-event-invitee

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string req | `.../scheduled_events/{event}/invitees/{uuid}` |
| `email` | string req | |
| `name` | string req | |
| `first_name`, `last_name` | string null | only when the event type uses separate name fields |
| `status` | `active` \| `canceled` | |
| `questions_and_answers` | `[{ question, answer, position }]` | multi-select answers joined with newlines |
| `timezone` | string null | invitee display zone |
| `event` | URI req | |
| `created_at`, `updated_at` | string | |
| `tracking` | `{ utm_campaign, utm_source, utm_medium, utm_content, utm_term, salesforce_uuid }` all null | |
| `text_reminder_number` | string null | SMS reminders |
| `rescheduled` | boolean | true on the old invitee after reschedule |
| `old_invitee` | URI null | on the new invitee |
| `new_invitee` | URI null | on the old invitee |
| `cancel_url` | string req | `https://calendly.com/cancellations/{uuid}` |
| `reschedule_url` | string req | `https://calendly.com/reschedulings/{uuid}` |
| `routing_form_submission` | URI null | |
| `payment` | `{ external_id, provider stripe\|paypal, amount, currency AUD\|CAD\|EUR\|GBP\|USD, terms null, successful }` null | |
| `no_show` | `{ uri, created_at }` null | |
| `reconfirmation` | `{ created_at, confirmed_at null }` null | present when reconfirmation was requested (workflow); confirmed_at set when invitee confirms |
| `scheduling_method` | `instant_book` \| `api` \| null | instant_book = host "Book meeting" |
| `invitee_scheduled_by` | URI null | user who booked on their behalf |
| `cancellation` | Cancellation optional | |

Invitee no-show object: `{ uri, invitee, created_at }`.

### 9.7 routing_form and routing_form_submission [V]

routing_form: `uri`, `organization`, `name`, `status` (`draft | published`), `questions[] { uuid, name, type (name,
text, email, phone, textarea, select, radios), required, answer_choices (null for non-choice) }` (ordered,
non-deleted only), `created_at`, `updated_at`.

routing_form_submission: `uri`, `routing_form`, `questions_and_answers[] { question_uuid null, question, answer
null }`, `tracking { utm_*, salesforce_uuid }`, `submitter` (invitee URI or null), `submitter_type` (`Invitee` or
null), `result` (polymorphic: `{ type: "event_type", value: <event type URI> }`, `{ type: "external_url", value:
<url> }`, `{ type: "custom_message", value: { headline, body } }`), `created_at`, `updated_at`.

### 9.8 webhook_subscription [V]

| Field | Type | Notes |
| --- | --- | --- |
| `uri` | string | |
| `callback_url` | string | |
| `created_at`, `updated_at` | string | |
| `retry_started_at` | string null | start of failing-delivery window |
| `state` | `active` \| `disabled` | disabled after 24h of failures |
| `events` | enum[] | see 6.1 |
| `scope` | `user` \| `organization` \| `group` | |
| `organization` | URI | |
| `user` | URI null | |
| `group` | URI null | |
| `creator` | URI null | |

List requires `organization` and `scope` (+ `user`/`group` per scope); sort `created_at`.

### 9.9 Other objects [V unless noted]

- **user**: `uri`, `name`, `slug`, `email`, `scheduling_url`, `timezone`, `avatar_url` (null), `created_at`,
  `updated_at`, `current_organization`, `resource_type` ("User"), `locale` (`en, fr, es, de, pt, ps`),
  `time_notation` (`12h | 24h`, default 12h).
- **organization**: `uri`, `name`, `kind` (`single | multiple`), `plan` (`basic, essentials, standard, professional,
  teams, enterprise`), `stage` (`trial | free | paid`), `created_at`, `updated_at`.
- **organization_membership**: `uri`, `role` (`owner | admin | user`), `user` (embedded user summary: uri, name,
  slug, email, scheduling_url, timezone, avatar_url, created_at, updated_at), `organization`, `created_at`,
  `updated_at`.
- **organization_invitation**: `uri`, `organization`, `email`, `status` (`pending | accepted | declined`),
  `created_at`, `updated_at`, `last_sent_at`, `user` (after acceptance).
- **team**: `uri`, `name`, `organization`, `scheduling_url`.
- **event_type_membership** (host): `uri`, `event_type` (full EventType), `member` (User), `created_at`,
  `updated_at`.
- **scheduling_link**: `booking_url`, `owner` (event type URI), `owner_type` (`EventType`).
- **share**: `scheduling_links[]`, `share_override { name, duration, duration_options, period_type, start_date,
  end_date, max_booking_time, hide_location, location_configurations[], availability_rule }`.
- **contact**: see section 4.
- **activity_log_entry**: `uri`, `occurred_at`, `actor { uri, type, display_name, alternative_identifier, group {
  uri, name, role }, organization { uri, role } }`, `action`, `namespace`, `details`, `fully_qualified_name`,
  `organization` [V partially, K for details/fully_qualified_name].
- **meeting_recap** (Notetaker): `uri`, `summary_md`, `action_items_md`, `discussion_md`, `transcript` (URI),
  `share_link`, `status` (`available | processing | unavailable`), timestamps; PATCH accepts the three markdown
  fields.

---

## 10. Gaps and improvement opportunities for our clone

Things Calendly does not do (or does poorly) that we can add cheaply, without breaking parity:

1. Manual "Reassign host" for booked round robin meetings (Calendly has no documented UI for it).
2. Explicit, configurable round robin priority levels (5 levels) and a visible fairness counter per host, with a
   "reset counts" action (Calendly only resets implicitly when hosts change).
3. Booking page brand colors on the hosted page, not just embeds.
4. Routing form route ordering UI and a test console that shows which rule matched.
5. Write API for routing forms and full event type settings (buffers, notice, limits, date range, questions,
   hosts), which Calendly's API lacks.
6. Webhook delivery log with manual redelivery (Calendly only exposes `retry_started_at` and `state`).
7. Contacts import/export CSV (Calendly reports none).

Parity checklist derived from this document (advanced scope): org + roles (owner/admin/group admin/team
manager/user), invitations, teams with pages, groups, shared vs team event types, round robin (2 modes, priority,
tie-breaks, 3-ahead rule, reset on host change, reschedule preference), collective (organizer co-host), multi-pool,
group events (2..9,999, remaining spots, per-meeting limit edit, .ics per invitee), managed events (per-section
locks, location always editable), event type permissions and book-on-behalf with override availability, routing
forms (questions, and/or conditions, 3 destinations, fallback, prefill a1..aN, autofill, responses tab with filters
and CSV, permissions), one-off meetings (spots, reserve times, 3-month span), single-use links (customizations by
kind, share via email with 1/3/7 day reminder), shares API, share availability and recommended follow-ups,
meeting polls (secondary), contacts (auto-create, custom fields, history, schedule from contact), analytics
(7 widgets, filters, CSV), webhooks (all events, HMAC signing, retries 24h then disable), embeds (3 types, JS API,
URL params, postMessage events), payments (Stripe incl. coupons, PayPal, owner account for team types, manual
refunds), branding (logo, hide branding, colors), cookie banner and consent, email verification, block list,
account settings (profile, login methods, 2FA, change email, delete account variants), data deletion (date range,
emails, anonymization), activity log.

---

## Sources

Developer docs (fetched as Markdown via Firecrawl):

- https://developer.calendly.com/llms.txt
- https://developer.calendly.com/api-docs/calendly-api/event-types/get-event-type
- https://developer.calendly.com/api-docs/calendly-api/event-types/list-event-type-available-times
- https://developer.calendly.com/api-docs/calendly-api/event-types/list-event-type-memberships
- https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-scheduled-event
- https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-event-invitee
- https://developer.calendly.com/api-docs/calendly-api/availability/get-user-availability-schedule
- https://developer.calendly.com/api-docs/calendly-api/availability/list-user-busy-times
- https://developer.calendly.com/api-docs/calendly-api/routing-forms/get-routing-form
- https://developer.calendly.com/api-docs/calendly-api/users/get-current-user
- https://developer.calendly.com/api-docs/calendly-api/organizations/get-organization
- https://developer.calendly.com/api-docs/calendly-api/organizations/get-team
- https://developer.calendly.com/api-docs/calendly-api/shares/create-share
- https://developer.calendly.com/api-docs/calendly-api/webhooks/get-webhook-subscription
- https://developer.calendly.com/api-docs/calendly-api/webhooks/get-sample-webhook-data
- https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures
- https://developer.calendly.com/api-docs/overview/webhooks/webhook-errors
- https://developer.calendly.com/api-docs/overview/webhooks/webhook-timeouts
- https://developer.calendly.com/docs/api-guides/see-how-webhook-payloads-change-when-invitees-reschedule-events
- https://developer.calendly.com/api-docs/overview/embedding/getting-started
- https://developer.calendly.com/api-docs/overview/embedding/recipes
- https://developer.calendly.com/api-docs/overview/embedding/notifying-the-parent-window
- https://developer.calendly.com/api-docs/overview/api/api-conventions
- https://developer.calendly.com/api-docs/overview/rate-limits
- https://developer.calendly.com/docs/authentication/scopes
- OpenAPI-derived request schemas: npm `@thenavidm/calendly-mcp-cli@3.0.1`, `dist/tools/operations.json`
  (generated from https://developer.calendly.com/openapi/calendly-api.yaml)
- Older response models for cross-checking: npm `@speakeasy-sdks/calendly@0.0.3` (2023)

Help center and product pages (fetched):

- https://calendly.com/pricing
- https://calendly.com/help/round-robin-distribution-overview
- https://calendly.com/help/how-to-set-up-a-shared-round-robin-event-type
- https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts
- https://calendly.com/help/how-to-manage-shared-event-types
- https://calendly.com/help/shared-event-types-overview
- https://calendly.com/help/multi-person-scheduling-options-for-your-organization
- https://calendly.com/help/group-event-type-overview
- https://calendly.com/help/managed-events-overview
- https://calendly.com/help/user-roles-and-permissions
- https://calendly.com/help/how-to-create-a-routing-form
- https://calendly.com/help/how-to-manage-routing-forms
- https://calendly.com/help/how-to-pre-populate-invitee-answers-in-routing-forms
- https://calendly.com/help/calendly-routing
- https://calendly.com/help/how-to-create-a-one-off-meeting
- https://calendly.com/help/how-to-create-a-single-use-link
- https://calendly.com/help/how-to-share-your-availability-with-gmail-or-outlook-in-calendly
- https://calendly.com/help/how-to-book-meetings-in-real-time
- https://calendly.com/help/free-busy-rules-overview
- https://calendly.com/help/contacts-overview
- https://calendly.com/help/calendly-analytics
- https://calendly.com/help/calendly-stripe
- https://calendly.com/help/calendly-paypal
- https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page
- https://calendly.com/help/how-to-customize-your-embed
- https://calendly.com/help/calendly-cookie-management-and-banner
- https://calendly.com/help/account-settings-overview

Via search-engine summaries of official pages ([S]):

- https://calendly.com/help/how-to-set-up-a-team-page
- https://calendly.com/help/meeting-polls-overview and https://calendly.com/help/how-to-set-up-a-meeting-poll
- https://calendly.com/help/how-to-update-your-login-preferences
- https://calendly.com/help/how-to-delete-personal-data-in-calendly
- https://calendly.com/help/how-to-require-email-verification-for-event-types
- https://calendly.com/help/how-to-block-someone-from-booking-with-you
- https://calendly.com/help/calendly-scheduling-notifications
- https://help.calendly.com/hc/en-us/articles/360038353914 (Calendly + Meta Pixel)
- https://calendly.com/blog/analytics-integrations (Google Analytics and Meta Pixel)
- https://calendly.com/features/routing

Community ([C]):

- https://community.calendly.com/how-do-i-40/customize-events-once-and-share-how-to-164
- https://community.calendly.com/how-do-i-40/maximum-number-of-bookings-per-host-round-robin-760
- https://community.calendly.com/how-do-i-40/how-can-i-reassign-a-round-robin-meeting-to-a-different-team-member-host-4367
- https://community.calendly.com/how-do-i-40/feature-request-native-accessibility-and-color-customization-for-standalone-live-booking-links-no-embed-5988
