# Meeting Polls: research and combined feature spec (Calendly Meeting Polls + Doodle Group Poll)

Research date: 2026-10-11. Scope: everything needed to build the "Doodle replacement" meeting poll feature of our
Calendly clone. The host proposes many candidate times, shares a link (or emails invites), invitees mark their
availability, the host books the winning time, which becomes a real scheduled event with calendar invites.

This is the secondary feature of the project (after core scheduling). It must still feel native to the Calendly
clone: same look, same calendar connections, same location/conferencing machinery, same scheduled event pipeline.

How to read this document:

- Part A is research (facts with inline sources). Part B is our spec (decisions). Parts C to F are data model, API,
  jobs, module boundaries and tests.
- Source tags: **[C]** Calendly, **[D]** Doodle, **[M]** Microsoft Outlook Scheduling Poll (FindTime), **[R]** Rallly
  (open source Doodle alternative), **[CD]** classic (pre-2021) Doodle.
- **(observed)** = checked against the owner's live Calendly account via the Calendly API on 2026-10-11.
- **(unverified)** = from a third-party walkthrough or product memory, not confirmed on a 2026 first-party page.
- "Clone decision" paragraphs are ours, not vendor facts.
- Related documents: [calendly-core-features.md](./calendly-core-features.md) (section 13 has the poll summary,
  section 5 the booking page, section 15 the slot engine), [calendly-advanced-features.md](./calendly-advanced-features.md)
  (section 3.1 one-off meetings and Reserve Times, section 3.5 polls),
  [calendly-account-observations.md](./calendly-account-observations.md), [owner-reference.md](./owner-reference.md).

---

## Table of contents

- Part A: Research
  - A1. Calendly Meeting Polls (facts)
  - A2. Doodle Group Poll (facts)
  - A3. Doodle Booking Page and 1:1 (how they relate)
  - A4. Other references worth borrowing from (Microsoft Scheduling Poll, Rallly, classic Doodle)
  - A5. Feature comparison matrix
  - A6. Source conflicts and ambiguities
- Part B: Clone spec (best of both)
  - B1. Concepts and glossary
  - B2. Entry points and navigation
  - B3. Host creates a poll (wizard: times, details, settings, share)
  - B4. Sharing and email invitations
  - B5. Invitee voting experience
  - B6. Host results view
  - B7. Booking the final time
  - B8. After booking: change time (reopen), cancel
  - B9. Poll states and lifecycle
  - B10. Notifications and emails
  - B11. Reminders to non-respondents
  - B12. Reserve times (calendar holds)
  - B13. Dashboard: Meeting polls list
  - B14. Editing rules after publishing
  - B15. Privacy, security and abuse protection
  - B16. Limits and validation
  - B17. Accessibility and responsive behavior
  - B18. Copy deck (UI strings)
  - B19. Ranking: which option is "best"
  - B20. Time zone handling (including DST)
- Part C: Data model proposal (src/db/schema/polls.ts)
- Part D: API surface (internal routes, Calendly API parity with booking_method "poll")
- Part E: Background jobs
- Part F: Integration points, file ownership, test plan
- Part G: Open questions and recommendations
- Part H: Source index

---

# Part A: Research

## A1. Calendly Meeting Polls (facts)

### A1.1 Availability, limits, positioning

- Available on **all plans including Free**, to all users
  ([Meeting Polls overview, updated 2026-08-24](https://calendly.com/help/meeting-polls-overview),
  [How to set up a meeting poll, updated 2026-09-17](https://calendly.com/help/how-to-set-up-a-meeting-poll)).
- "Anyone with the poll link can vote, no Calendly account needed." Up to **40 time slots** and **40 participants**
  ([overview](https://calendly.com/help/meeting-polls-overview)).
- "You can't add new time slots after publishing the poll." "Workflows and rescheduling aren't currently supported."
  ([overview](https://calendly.com/help/meeting-polls-overview)). See A6 for a conflicting 2026 source.
- Marketing positioning: ad-free, voting and booking in one place, invitees see times in their own time zone
  ([Blog: Meeting Polls, 2023-11-01](https://calendly.com/blog/meeting-polls),
  [Meeting Polls product page](https://calendly.com/scheduling/meeting-polls)).
- Created in the web app or from the Gmail, Chrome, Safari, Edge and Firefox extensions
  ([blog](https://calendly.com/blog/meeting-polls)).

### A1.2 Creating a poll (host)

Step 1, "Choose times to offer" ([set up article](https://calendly.com/help/how-to-set-up-a-meeting-poll)):

1. Scheduling page (or extension) > **+ Create** > **More ways to meet** > **Meeting poll**.
2. Set **time zone**, **meeting duration**, and any **additional hosts**. "Invitees will see the times in their own
   time zone."
3. Select up to **40 times** on the calendar. "Include overlapping times." Remove times using the
   **x/40 times selected** option or **Clear all**.
4. **Next**.

The calendar is the host's own calendar view: "select time slots from your calendar that you'd like your invitees to
vote on. You can select consecutive or overlapping potential meeting times"
([blog](https://calendly.com/blog/meeting-polls)). The time zone and duration controls sit on the left side, the
calendar grid on the right ([Guideflow tutorial, 2026-02](https://www.guideflow.com/tutorial/how-to-create-a-meeting-poll-in-calendly)) (unverified).
A "selections summary" is shown before moving on ([Trainn tutorial](https://trainn.co/tutorials/setup-calendly-meeting-poll/)) (unverified).

Step 2, "Set up meeting details":

1. **Meeting name** and **location** (location picker includes video conferencing: Zoom, Google Meet, Microsoft
   Teams, Webex; "Location details will be automatically populated into the calendar event")
   ([set up article](https://calendly.com/help/how-to-set-up-a-meeting-poll), [blog](https://calendly.com/blog/meeting-polls)).
2. Optional **description** or **instructions**.
3. **Optional settings**: **Reserve Times**, **Show votes on page**, and **invitee language**
   ([Guideflow](https://www.guideflow.com/tutorial/how-to-create-a-meeting-poll-in-calendly),
   [Trainn](https://trainn.co/tutorials/setup-calendly-meeting-poll/)) (unverified labels, consistent across two
   walkthroughs and the core research doc).
   - Reserve Times ON: "Calendly will block off the times in your calendar as busy until you book one of the meeting
     times (and then they will drop off)" ([Libs-Or mailing list, 2023-11](https://omls.oregon.gov/pipermail/libs-or/2023-November/021606.html)).
     A customer quote on the blog: "I love that it blocks or reserves times on my calendar"
     ([blog](https://calendly.com/blog/meeting-polls)). For one-off meetings the same feature writes placeholder events
     to the host's and co-hosts' calendars and those holds block regular event types (busy type `reserved` in
     `user_busy_times`) (see [calendly-advanced-features.md 3.1](./calendly-advanced-features.md)).
   - Show votes on page ON: "let everyone see what times have been chosen so far"
     ([Libs-Or](https://omls.oregon.gov/pipermail/libs-or/2023-November/021606.html)). OFF: invitees "only see
     attendees in the invite" ([overview FAQ](https://calendly.com/help/meeting-polls-overview)).
4. **Share meeting poll**.

Step 3, share: "Calendly generates a unique link for your poll. You can edit the link ending or preview the poll using
**View live page**." Then **Copy Link** ([set up article](https://calendly.com/help/how-to-set-up-a-meeting-poll)).

### A1.3 Invitee (voter) experience

- Times are shown in each invitee's local zone via automatic detection. "If they also use Calendly, the Meeting Poll
  will go an extra step and highlight times that work across both sets of calendars"
  ([blog](https://calendly.com/blog/meeting-polls)).
- Voting is binary: the invitee selects the times they prefer (no "if need be" state). Calendly booking bundle strings
  (English) for the poll page ([urlscan capture of Calendly's booking bundle](https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/)):

| Key | English string |
|---|---|
| `poll.meeting_poll_label` | "Meeting poll" |
| `poll.select_available_times` | "Select all the times you're available to meet" |
| `poll.select_date_and_time` | "To vote in this poll, select all the dates and times you prefer for the meeting" |
| `poll.preferences_subtext` | "The meeting host will see your preferences when deciding on a final time." |
| `poll.preferred_times` | "%{count} preferred time" / "%{count} preferred times" |
| `poll.single_spot_warning` | " Reminder: Voting for multiple times helps the poll host find the best meeting time for everyone." |
| `poll.share_times` | "Share your preferred times" |
| `poll.share_times_button` | "Share times" |
| `poll.edit_times` | "Edit your preferred times" |
| `poll.votes` | "%{count} Vote" / "%{count} Votes" |
| `poll.votes_tooltip_label` | "Invitee Votes Tooltip" |
| `poll.confirmation.title` | "Thanks for voting!" |
| `poll.confirmation.description` | "You'll receive a calendar invitation when the host decides a final time from submitted votes." |
| `error.poll_votes_failure` | "Unable to create all spot votes" (internally a candidate time is a "spot") |
| `signup_form.polls_call_to_action.header` / `.button_text` | "Easy polling ahead" / "Create your own poll" |
| `signup_form.polls_header` / `polls_subtitle` | "Easy scheduling ahead " / "Calendly makes finding a time for everyone easier." |
| `mutual_availability.*` | "times you're available", "conflict", "Looks like you're free this date!", "Your schedule from", "Calendly events" |

- Voters enter name and email on the "Share your preferred times" step (inferred from the strings and from the fact
  that invites go to voters' emails at booking) (unverified field list).
- "Can participants change their votes? No. Votes are final once submitted" ([overview FAQ](https://calendly.com/help/meeting-polls-overview)).
  The `edit_times` string most likely edits the selection before submitting (unverified).

### A1.4 Host: managing and viewing results

- **Scheduling > Meeting polls** tab: "view, copy, edit, or delete a poll. You can make changes while the poll is
  still in progress. Once it's scheduled, the poll will close" ([set up article](https://calendly.com/help/how-to-set-up-a-meeting-poll)).
  Direct URL `calendly.com/app/scheduling/polls/user/me` ([Community 2026-01](https://community.calendly.com/how-do-i-40/meeting-polls-5220)).
  Older path: Meetings (Scheduled Events) > **Pending** tab > poll > **See all poll results** / **Edit poll**
  ([Guideflow results](https://www.guideflow.com/tutorial/how-to-view-the-results-of-your-meeting-poll-in-calendly),
  [Guideflow edit](https://www.guideflow.com/tutorial/how-to-edit-your-meeting-poll-in-calendly)).
- Results show **Top Times**; hovering the vote count shows who voted for that time
  ([Community 2026-01](https://community.calendly.com/how-do-i-40/meeting-polls-5220)). "Calendly will surface the most
  popular times" ([blog](https://calendly.com/blog/meeting-polls)). Results list each invitee's name and the slots they
  voted for ([Guideflow results](https://www.guideflow.com/tutorial/how-to-view-the-results-of-your-meeting-poll-in-calendly)).
- Host notifications: "Hosts receive notifications as votes come in" ([blog](https://calendly.com/blog/meeting-polls)).
  Email from `notifications@calendly.com`, subject **"[Name] has voted in a poll for [Event Title]"**
  ([Community 2024-04](https://community.calendly.com/how-do-i-40/poll-link-notification-1324)).
- Edit poll (2026 walkthrough): change Time Zone and Duration, add or remove Hosts, add or remove time slot options in
  the grid, then edit name/location/settings and "Share Meeting Poll" to save
  ([Guideflow edit](https://www.guideflow.com/tutorial/how-to-edit-your-meeting-poll-in-calendly)) (unverified, see A6).
- Removing an unwanted voter: in the **Book Meeting Time** dialog's invitee list, "select remove next to any invitee"
  ([Community 2024-05](https://community.calendly.com/how-do-i-40/edit-a-meeting-poll-remove-votes-1555)).
- No duplicate poll feature ([Community 2024-05](https://community.calendly.com/how-do-i-40/edit-a-meeting-poll-remove-votes-1555)).

### A1.5 Booking the final time

([set up article](https://calendly.com/help/how-to-set-up-a-meeting-poll), [overview](https://calendly.com/help/meeting-polls-overview))

1. Scheduling > Meeting polls tab > select the poll.
2. Review results, choose a slot, click **Book** on it.
3. Pop-up: review meeting details and invitee list; **+ Add Invite(e)** to add people who did not vote (name, email).
4. **Book Meeting**. "Calendly sends calendar invitations to you and your invitees with the meeting details."

Conflict rules (overview FAQ): "You can book over buffers. Conflicts with external events will be flagged, but the
time remains visible. Conflicts booked through Calendly are not able to be booked over."

Who can book: the poll creator and any co-host ([Community 2024-02](https://community.calendly.com/how-do-i-40/meeting-poll-how-can-my-entire-team-vote-971)).

### A1.6 Closing, after booking, limitations

- A poll closes when: you book the meeting, all proposed times pass, or you delete the poll. "If deleted, the poll
  link becomes inactive and voting is disabled" ([overview](https://calendly.com/help/meeting-polls-overview)).
- After booking, the original per-time breakdown is no longer viewable; the poll row shows total vote count and a
  **View meeting** link to the booked meeting. Rescheduling a poll-booked meeting is not supported: cancel and create a
  new poll ([Community 2026-07](https://community.calendly.com/how-do-i-40/am-i-not-able-to-see-poll-results-if-the-meeting-has-been-booked-5900)).
- Workflows (reminders etc.) are not supported for polls ([overview FAQ](https://calendly.com/help/meeting-polls-overview)).
  Calendly has **no deadline, no reminders to non-voters, no if-need-be, no comments, no vote editing**.

### A1.7 Calendly API and polls

- Event Type objects carry `booking_method` with enum **`instant` | `poll`** ("Indicates if the event type is for a
  poll or an instant booking") ([APIs.io schema](https://apis.io/schemas/calendly/calendly-event-type/),
  [api-evangelist OpenAPI](https://raw.githubusercontent.com/api-evangelist/calendly/refs/heads/main/openapi/calendly-event-types-api-openapi.yml),
  [withone.ai mirror of Create Event Type](https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA)).
- Calendly's Postman example for Get Event Type shows `"type": "AdhocEventType"` together with
  `"booking_method": "poll"` and `"pooling_type": "collective"`
  ([Postman: Get Event Type](https://www.postman.com/calendlyapi/calendly-s-api-collection/request/qi9fmud/get-event-type)).
  Interpretation: each poll is backed by an ad hoc (one-off style) event type with booking_method poll.
- The public API cannot create polls and cannot list "pending" events (polls awaiting booking)
  ([Community 2024-06](https://community.calendly.com/api-webhook-help-61/pending-scheduled-events-and-creating-meeting-polls-via-api-1599)).
  `POST /event_types` creates only `kind: "solo"` instant types.
- **(observed)** The owner's account (user `julianjoseph`, zone America/Los_Angeles) has 3 event types, all
  `booking_method: "instant"`, `type: "StandardEventType"`; listing with `active=false` returns none. No polls exist in
  the account, so no live poll object could be inspected.

## A2. Doodle Group Poll (facts)

Doodle's current product (2026) is Group Poll, 1:1, Booking Page and Sign-up Sheet. Many poll options are paid
("Doodle Professional"); our clone exposes everything.

### A2.1 Creating a group poll

([How do I create a group poll?, 2026-07-14](https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll),
[Introduction to Group Poll, 2026-03-20](https://help.doodle.com/en/articles/9823082-introduction-to-group-poll))

- Dashboard > **Group Poll** tile.
- Meeting information: **Title**, **Description**, **Location**; toggle **Video Conferencing** (Google Meet when the
  default calendar is Google; Zoom, Microsoft Teams or Webex if chosen as the main tool in account settings).
- Add times in **Week view** or **Month view**:
  - Week view: pick the **duration**, check the **time zone** (top right, defaults to the organizer's zone; "The group
    poll will automatically adjust according to the time zone of your participants"), "Click anywhere on the calendar
    to create time slots."
  - Duration choices include **Custom** (5 minutes to 12 hours in one article, 5 minutes to 24 hours in another) and
    **All-day**. "Events cannot span two or more calendar dates."
  - Month view: click days, then set start time and duration per slot; "Add times" adds more slots on a date; start
    times are fully flexible (for example 10:25, 10:47), typed as "1:00 PM".
  - **Multiple durations** in one poll: change the Duration menu between clicks; Month view "Add different time(s) to
    date(s)". The organizer still picks only one final option
    ([Multiple durations, 2026-07-14](https://help.doodle.com/en/articles/9457180-how-do-i-use-multiple-durations-with-group-poll)).
  - With a connected calendar the grid shows "when you are busy and when you are free"
    ([Introduction](https://help.doodle.com/en/articles/9823082-introduction-to-group-poll)).
- **Settings** (all Doodle Professional):
  - **Set a deadline**: after it, "no new responses can be submitted ... and existing participants will not be able
    to change their votes." Extend or remove by editing the poll
    ([Deadline/limit/reminders/hidden, 2026-03-27](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden)).
  - **Limit participants** per time slot: maximum votes per option (for example 5). Can later be raised but not
    lowered; cannot be added later if not set at creation. **If-need-be answers count as "yes"** toward the limit.
  - **Send automatic reminders** to invitees who have not voted (rules in A2.6).
  - **Hide participant list** (hidden poll): "participants will not see each other's names or votes in the group poll
    or the calendar invitation." Visible to the organizer. Can be toggled at any time.
- **Create and share**. **Preview** opens the participant view ("Close preview" returns; "Edit" goes back)
  ([Preview, 2024-07](https://help.doodle.com/en/articles/9457184-how-do-i-preview-my-group-poll)).
- The organizer automatically votes **yes** on every option and can edit their own votes ("Edit" next to your name)
  ([Edit, 2026-06-09](https://help.doodle.com/en/articles/9457348-how-do-i-edit-my-group-poll)).

### A2.2 Sharing and inviting

([Invite participants, 2026-03-20](https://help.doodle.com/en/articles/9457352-how-do-i-invite-participants-to-my-group-poll),
[Invite more, 2025-05](https://help.doodle.com/en/articles/9457349-i-sent-my-group-poll-out-already-how-do-i-invite-more-participants),
[Email limits, 2026-03-23](https://help.doodle.com/en/articles/9457335-what-are-the-email-invitation-limits))

- **Share invite** / **Copy link**; share to LinkedIn, Facebook, WhatsApp, X; embed link on a website.
- **Email** invitations from Doodle (Pro): enter emails (autocomplete from connected Google/Outlook contacts), edit the
  invitation message, Send. Sender always shows as "Doodle". Up to 1,000 recipients.
- More participants can be invited any time before a final option is selected.
- Organizers cannot un-invite someone.

### A2.3 Participant experience

([Participate, 2025-04](https://help.doodle.com/en/articles/9457279-how-do-i-participate-in-a-group-poll),
[If-need-be, 2026-08-13](https://help.doodle.com/en/articles/9457343-how-does-the-if-need-be-group-poll-response-work),
[Vote if need be](https://help.doodle.com/en/articles/9457276-how-do-i-vote-if-need-be-in-a-group-poll),
[Change votes, 2025-04](https://help.doodle.com/en/articles/9457214-how-do-i-change-my-votes-in-a-group-poll))

- No account needed. Opening the link shows a confirmation window (who invited you, event name, next steps).
- Header shows who created the poll, location, description and **who else is invited** (unless hidden).
- Each option is a checkbox cell with three states: click once **Yes** (green), twice **If need be** (yellow), third
  click back to empty (**No**). If-need-be is always enabled and cannot be disabled; organizers who want yes/no only
  are told to say so in the description.
- **Continue**, then provide **name and email** (required), then **Submit vote**. "Decline" records the participant
  with NO on every option. Two-step submission: participants who never confirm are not recorded
  ([Group Poll FAQ](https://help.doodle.com/en/articles/10295132-group-poll-troubleshooting-and-faq)).
- After voting: toggle **Get updates when others vote** / **Get event updates**
  ([Notifications, 2024-06](https://help.doodle.com/en/articles/9457333-how-can-i-subscribe-unsubscribe-to-e-mail-notifications-for-a-group-poll)).
- **Changing votes**: confirmation email has **Review response** > **Change your response**, or reopen the poll link
  on the same device; logged-in users use the dashboard "Change vote". Allowed only while the poll is open; votes on
  past times cannot be modified; participation cannot be deleted (only changed to Decline).
- Participants with a connected Doodle calendar see "all of your appointments right next to the suggested times"
  ([Doodle group calendar page](https://doodle.com/en/group-calendar/)).
- Participants are notified automatically when the organizer selects the final time.

### A2.4 Organizer: results and participant management

([Invite list and responses, 2024-09](https://help.doodle.com/en/articles/9457332-how-do-i-find-my-poll-invite-list-and-poll-responses),
[Add/edit/delete participant, 2026-07-29](https://help.doodle.com/en/articles/9669118-how-do-i-add-edit-or-delete-a-participant-from-my-group-poll),
[Hidden results, 2026-03-24](https://help.doodle.com/en/articles/9457334-how-can-i-view-the-results-of-a-hidden-group-poll),
[Export, 2026-03-19](https://help.doodle.com/en/articles/9457344-how-do-i-export-a-group-poll-to-excel),
[Duplicate, 2026-03-24](https://help.doodle.com/en/articles/9457345-is-it-possible-to-use-an-existing-group-poll-as-a-template-duplicate-a-group-poll),
[Verify participation, 2024-07](https://help.doodle.com/en/articles/9457215-how-can-i-verify-that-someone-participated-in-my-group-poll))

- Results grid: organizer's row first, respondents below in order received. Per-row menu: **Copy email**, **Edit**,
  **Delete** (irreversible, participant is emailed). **Vote on behalf** (name required, email optional, participant is
  emailed and can change). Organizers cannot edit a participant's email.
- Editing options after votes exist shows **"?"** cells for existing participants on new/changed options
  ([Question marks](https://help.doodle.com/en/articles/9457341-i-edited-my-group-poll-and-it-now-shows-question-marks-all-over-the-table)).
- Organizer receives an email every time someone participates (toggle in Account Settings > Notifications).
- **Export** to Excel (open poll: More > Export; closed: dashboard menu > Export).
- **Duplicate** copies title + " (copy)", description, location, exact time slots and settings, not participants.
- Hidden poll results are visible to the logged-in organizer only.

### A2.5 Finalizing ("Book it"), reopening, deleting

([Select final option, 2026-03-23](https://help.doodle.com/en/articles/9457342-how-do-i-select-the-final-option-for-my-group-poll),
[Calendar invitation, 2026-03-19](https://help.doodle.com/en/articles/9457340-how-do-i-send-out-a-calendar-invitation-to-my-booked-group-poll),
[Edit/reopen/delete, 2026-06-09](https://help.doodle.com/en/articles/9457348-how-do-i-edit-my-group-poll),
[Group Poll FAQ](https://help.doodle.com/en/articles/10295132-group-poll-troubleshooting-and-faq))

- Click the **star** above the option, then **Book it**. Only one final option.
- With a connected calendar: a calendar invitation goes to all participants, "even the ones who did not vote for the
  final option", but not to people who never participated. Without a calendar: a confirmation email with event
  details. Non-responsive invitees are not notified; the organizer must invite them manually.
- Booking closes the poll. **Reopen** a closed poll (Upcoming Events > Reopen > Edit > Save): participants get an email
  that they can review, edit or add to their response. **Choose a different date**: Reopen > select new > Book it;
  participants get a new confirmation and an updated calendar invite.
- **Delete** (Pro): three-dot menu > Delete; irreversible.
- No multiple final options and no recurring meetings from a poll (use Sign-up Sheet / calendar recurrence).

### A2.6 Automatic reminders

([Deadline/limit/reminders/hidden](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden),
[How automatic reminders work, 2026-02-03](https://help.doodle.com/en/articles/9457379-how-do-automatic-reminders-for-group-poll-work))

- Only for invitees emailed through Doodle (so Doodle knows who has not replied).
- Anchor = the deadline if one is set, otherwise the first option. Lead = anchor minus poll creation time.
  - Lead > 5 days: reminder **48 hours before** the anchor.
  - Lead 2 to 5 days: reminder **36 hours before** the anchor.
  - Lead < 2 days: **no** reminder.

### A2.7 Limits and retention

- Up to **1,000** respondents per poll; Pro: up to **1,000** time slots; Free: **10** time slots (2025-12 article)
  or **20** (newer FAQ); Free: only 1 group poll per account
  ([Maximum size, 2025-12](https://help.doodle.com/en/articles/9457330-what-is-the-maximum-group-poll-size),
  [FAQ](https://help.doodle.com/en/articles/10295132-group-poll-troubleshooting-and-faq),
  [Create](https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll)).
- Doodle's advice: about five options is usually enough ([Maximum size](https://help.doodle.com/en/articles/9457330-what-is-the-maximum-group-poll-size)).
- Free polls are deleted when inactive: 30 days after the last option or the last access, whichever is later
  ([Retention](https://help.doodle.com/en/articles/9457337-how-long-does-doodle-keep-group-polls-until-when-will-my-group-poll-be-available)).
- Booked poll events sync to connected calendars of the organizer and of logged-in participants
  ([Which events sync](https://help.doodle.com/en/articles/9457272-which-doodle-events-will-sync-to-my-connected-calendar)).

## A3. Doodle Booking Page and 1:1 (how they relate)

- **Booking Page** is Doodle's Calendly-style event type: duration, how far in advance participants can book,
  weekly days/timeframes, **Power Settings** (booking intervals, buffer times, minimum advance notice, maximum bookings
  per day), multiple connected calendars checked for conflicts (at least one required), custom questions (name and
  email always asked; "Required" checkbox), add host / book on behalf, automatic reminders, disable/re-enable link,
  preview, reschedule
  ([Create booking page](https://help.doodle.com/en/articles/9457322-how-do-i-create-a-booking-page),
  [Intervals and buffers](https://help.doodle.com/en/articles/9457375-how-to-use-booking-intervals-and-buffer-times-with-booking-page),
  [Manage settings](https://help.doodle.com/en/articles/9457376-how-to-manage-your-booking-page-settings-from-the-doodle-dashboard),
  [Participate in booking page](https://help.doodle.com/en/articles/9716984-how-do-i-participate-in-a-booking-page),
  [Booking Page FAQ](https://help.doodle.com/en/articles/10300817-booking-page-troubleshooting-and-faq),
  [Guide to Booking Page](https://doodle.com/en/resource/how-to/guide-to-booking-page/)).
  Default booking interval "Same as event duration"; default buffer "No buffer time". Booking Page cannot place calendar
  holds; Sign-up Sheet can.
- Everything Booking Page does is already covered (and exceeded) by our core event types spec. It matters here only
  because: (a) poll creation should reuse the same calendar connections and conflict calendars, (b) the booked poll
  meeting should look like any other booked meeting, (c) Doodle's **1:1** (offer hand-picked slots to one person) is
  equivalent to Calendly's one-off meeting (core spec 2.12), and Doodle's FAQ explicitly suggests 1:1 for "complete and
  total control" over offered slots.
- **Sign-up Sheet** (multiple sessions with per-session capacity, people pick one or more) is out of scope, but our
  poll's "max votes per option" + "one choice per participant" settings let a poll double as a simple sign-up sheet
  (as classic Doodle users did).

## A4. Other references worth borrowing from

### A4.1 Microsoft Outlook Scheduling Poll (formerly FindTime) [M]

([Create a Scheduling Poll](https://support.microsoft.com/en-us/outlook/create-a-scheduling-poll-in-outlook-for-windows),
[Organizer dashboard](https://support.microsoft.com/en-us/outlook/scheduling-poll-organizer-dashboard),
[Voting](https://support.microsoft.com/en-us/outlook/scheduling-poll-voting),
[Find the best meeting time](https://support.microsoft.com/en-us/outlook/find-the-best-meeting-time-for-everyone-with-outlook-scheduling-poll))

- **Schedule when attendees reach consensus**: auto-books if all **required** attendees vote yes on an option;
  earliest wins on ties. Organizer can still book manually earlier.
- **Hold selected times on my calendar**: tentative event per option, removed when scheduled or canceled. Newer
  Outlook: organizer holds show Busy; attendee holds show Tentative, then Busy after a Yes vote, Free after a No.
  Holds titled "HOLD"; calendar filter "Poll holds".
- **Notify me about poll updates**: email on every vote with current status and a "schedule" action.
- **Require attendees to verify their identity** (sign in or email code) to prevent anonymous voting.
- **Lock poll for attendees**: attendees cannot suggest new times or edit other attendees (unlocked polls let attendees
  propose times and add required/optional attendees).
- Required vs optional attendees; organizer **Cancel poll**; default poll settings saved per organizer.

### A4.2 Rallly (open source, Next.js) [R]

([rallly.co](https://rallly.co/), [GitHub README](https://github.com/lukevella/Rallly),
[Rallly API: create a poll](https://support.rallly.co/api-reference/polls/create-a-poll))

- Poll fields: `title`, `description`, `location`, `conferencing.provider` (zoom, meet, teams, webex, custom; link
  created when the poll is finalized), `timeZone`, `status` (open...), `kind` (`date` or `time`), `requireEmail`,
  `hideParticipants`, `hideScores`, `disableComments` (new polls default to comments disabled),
  `allowTentativeVotes` ("if need be", default true), `participantCount`, `options`, `adminUrl`, `inviteUrl`.
- **Date polls**: whole days, "floating calendar days with no timezone". **Time polls**: a start without offset is wall
  clock in `timeZone`, or a **floating** time with no conversion when no zone is set. Per-option duration override.
- **Generators**: date range + weekdays + daily window + interval expand into recurring slots. Max **100** options.
- Features: no account to vote, availability grid, comments, notifications, finalize with email + calendar invite,
  inactive free polls auto-deleted.

### A4.3 Classic Doodle settings [CD]

([Ursinus KB](https://requests.ursinus.edu/TDClient/1943/requests-ursinus-edu/KB/Article/131153/Online-Appointment-Scheduling-Doodle),
[Calendar.com guide, 2019](https://www.calendar.com/blog/doodle-poll/),
[Sue Frantz, 2016](https://suefrantz.com/2016/01/28/doodle-make-a-choice/),
[MakeUseOf, 2009](https://www.makeuseof.com/tag/use-doodle-polls-to-schedule-events-and-make-choices-within-groups/))

- Settings: Yes/No/If-need-be, **Limit the number of votes per option**, **Limit participants to a single vote**
  (one option per participant), **Hidden poll**, premium: deadline, reminders, ask participants for contact info.
- Time zone support could be toggled (in-person events often turned it off). Full options appear greyed out to later
  voters, even in hidden polls. Classic polls also had a comments section (product memory, unverified).

## A5. Feature comparison matrix

| Capability | Calendly | Doodle | Others | Clone |
|---|---|---|---|---|
| Account to vote | No | No | No [M][R] | No |
| Max options | 40 | 10/20 free, 1,000 Pro | 100 [R] | 100 |
| Max participants | 40 | 1,000 | unlimited [R] | 1,000 |
| Overlapping options | Yes | Yes | Yes | Yes |
| Multiple durations | No (one duration) | Yes | Yes [R] | Yes |
| All-day / date-only options | No | All-day | Date polls [R] | Yes (date-only) |
| Host busy overlay while picking | Yes (own calendar) | Yes (connected calendar) | Yes [M] | Yes (all conflict calendars + app bookings + co-hosts) |
| Co-hosts | Yes | No | No | Yes |
| Voter sees own zone | Yes (auto) | Yes (auto) | Yes | Yes + manual zone picker |
| Fixed-zone (no conversion) mode | No | Classic toggle [CD] | Floating [R] | Yes |
| Answer types | Yes only | Yes / If need be / No | Yes/No [M], +If need be [R] | Yes / If need be / No (if-need-be toggle) |
| Voters see others' votes | Toggle "Show votes on page" | Visible unless hidden poll | hideParticipants, hideScores [R] | 4-level visibility setting |
| Max votes per option | No | Yes (Pro) | No | Yes |
| One choice per participant | No | Classic [CD] | No | Yes (max choices per participant) |
| Deadline | No | Yes (Pro) | No | Yes |
| Require name / email | Yes (unverified) | Name + email required | requireEmail [R], verify identity [M] | Name always; email on by default; optional email verification |
| Edit vote later | No | Yes (email link / same device) | Yes [M][R] | Yes (magic link + device cookie) |
| Decline all | No | Yes | No | Yes ("None of these work") |
| Comments | No | Classic only | Yes [R] | Yes (toggle) |
| Voter calendar connect | Yes (Calendly users) | Yes (Doodle users) | Outlook [M] | Yes (Google/Microsoft one-time, or app user) |
| Email invitations from app | No | Yes (Pro) | Yes [M] | Yes |
| Reminders to non-respondents | No | Yes (Pro, fixed rules) | No | Yes (smart default + custom) |
| Notify host on vote | Yes | Yes | Yes [M][R] | Yes (instant / digest / off) |
| Subscribe voter to updates | No | Yes | No | Yes |
| Calendar holds | Reserve Times | No (Sign-up Sheet only) | Holds [M] | Reserve times |
| Auto-book on consensus | No | No | Yes [M] | Yes (opt-in) |
| Host votes / vote on behalf | No | Organizer auto-yes; vote on behalf (Pro) | Yes [M] | Host availability row + vote on behalf |
| Edit / delete participant | Remove at booking | Yes (Pro) | Yes [M] | Yes |
| Add options after publishing | Conflicting sources | Yes ("?" for old voters) | Yes [M] | Yes, with notify option |
| Booking dialog adds invitees | + Add Invitee | No (manual) | No | Yes |
| Invites to non-respondents | Via + Add Invitee | No | No | Yes (invited list preselectable) |
| Change booked time | Not supported | Reopen + Book it (updated invite) | No | Reopen + rebook (same event updated) |
| Results after booking | Lost | Kept | Kept | Kept |
| Export | No | Excel (Pro) | No | CSV |
| Duplicate | No | Yes (Pro) | No | Yes |
| Workflows on booked meeting | Not supported | Reminders on booking page only | No | Basic meeting reminders (opt-in) |
| API | booking_method "poll" on event types; no create | No public API | REST [R] | Internal REST + event type serializer with booking_method "poll" |

## A6. Source conflicts and ambiguities

1. **Editing after publishing (Calendly)**: overview (2026-08) says "You can't add new time slots after publishing";
   set-up article (2026-09) says "You can make changes while the poll is still in progress"; a 2026 Guideflow walkthrough
   shows "Edit poll" adding/removing slots; a 2024 Community answer says no edits at all. Clone decision: allow edits
   (Doodle model) with safeguards (B14).
2. **Changing votes (Calendly)**: FAQ says votes are final, but the bundle has "Edit your preferred times". Clone
   decision: votes are editable until the poll closes (Doodle model).
3. **Doodle free slot limit**: 10 (2025-12 article) vs 20 (newer FAQ). Irrelevant to us (no plans).
4. **Doodle custom duration ceiling**: 12 hours (create article) vs 24 hours (multiple durations article). Clone: 5
   minutes to 24 hours, plus all-day.
5. **Doodle reminder text** is garbled in one article (the "with a deadline" header precedes the "first option" rules).
   Interpretation in A2.6 is the consistent reading.
6. **Calendly optional settings labels** (Reserve Times, Show votes on page, invitee language) come from third-party
   walkthroughs and the core research doc, not from a first-party 2026 page.
7. **Calendly vote count visibility when "Show votes on page" is off**: assumed to show nothing about other voters
   (the overview FAQ only says invitees then "only see attendees in the invite").
8. A third-party "guide" (hamsterstack.com) describes Calendly poll settings such as response deadlines and anonymous
   voting that no first-party source mentions. Treated as unreliable and not used.

---

# Part B: Clone spec (best of both)

Design principle: **Calendly's look, flow and defaults; Doodle's depth as opt-in settings.** A host who never opens
"More settings" gets an experience indistinguishable from Calendly. Every Doodle/FindTime/Rallly power feature is
available behind clearly labeled settings. No plan gating.

## B1. Concepts and glossary

| Term | Meaning |
|---|---|
| Poll | A meeting poll owned by one host user, optionally with co-hosts. Backed by an ad hoc event type with `booking_method = 'poll'` (C2). |
| Option | One candidate time ("spot" in Calendly internals): a start and end instant, or a date-only day. |
| Participant | One voter record: name, optional email, time zone, votes. Either self-registered via the link, created from an email invite (status `invited` until they respond), or added by the host ("vote on behalf"). |
| Vote | A participant's answer for one option: `yes`, `if_need_be`, or `no`. A missing vote row means "no answer" (shown as "?" when the option was added after the participant responded). |
| Respondent | A participant who has submitted at least once (including Decline). |
| Booking | The host's choice of one option, producing one scheduled event with one invitee per selected participant. |
| Hold | A placeholder event written to a host/co-host calendar for an option when "Reserve times" is on. |

## B2. Entry points and navigation

- **+ Create** menu (Scheduling page header): "More ways to meet" > **Meeting poll** (Calendly parity), next to
  One-off meeting.
- **Scheduling** page tabs: Event Types, Single-use links, **Meeting polls** (route `/app/scheduling/polls`).
- **Calendar** page (meetings): a **Pending** tab lists open/closed-unbooked polls (and pending one-offs) with "View
  poll results"; booked poll meetings appear in Upcoming like any meeting with a small "Poll" badge.
- **Home/dashboard**: optional card "Polls waiting for you" (open polls with new votes, polls past deadline not booked).
- **Contacts**: "Schedule" action on a contact offers "Create meeting poll" with the contact pre-added as an invitee.
- Routes (host): `/app/polls/new`, `/app/polls/[pollId]` (results), `/app/polls/[pollId]/edit`.
  Route (public): `/p/[slug]` (voter page). These are proposals; final routing belongs to the foundation plan.

## B3. Host creates a poll (wizard)

Three steps in one full-page wizard (Calendly layout: left settings column about 320px, right content). Wizard state
is client-side until "Share meeting poll" (persist an unsent draft in `localStorage`, wrapped in try/catch, so a refresh
does not lose picked times). The poll row is created only on the final submit.

### B3.1 Step 1: "Choose times to offer"

Left column (top to bottom):

1. **Time zone** dropdown (same component as the booking page: friendly name + current local time, searchable;
   default = host profile zone). Changing it re-renders the grid; already picked options keep their instants.
2. **Duration** select: 15, 30, 45, 60, 90, 120 minutes, **Custom** (number + min/hrs, 5 minutes to 24 hours), and
   **All day**. Default = 30 minutes (or the host's most-used event type duration). The current duration applies to
   newly added options only, so a poll can mix durations (Doodle).
3. **Hosts**: the owner (locked) + "Add host" picker of other users in the workspace (Calendly additional hosts). Each
   co-host's busy times are merged into the grid overlay if they have calendars connected.
4. Counter **"x/100 times selected"** (Calendly shows x/40) with a popover list of all picked options (date, time,
   duration, remove "x" per row) and **Clear all**.
5. **Next** (disabled until at least 1 option; a soft hint recommends 2 or more).

Right column, **week grid** (default) with a **Week | Month** toggle (Doodle):

- Header: "< Today >" navigation, week range label, day columns (week start per host settings: Sunday or Monday),
  12h/24h per host time-notation setting. Rows of 15-minute hit targets (one 30-minute row about 48px tall), all-day
  lane at the top. Initial scroll to 07:00 or the start of working hours.
- **Overlays (read-only, host-only)**:
  - Busy blocks from every connected calendar marked "check for conflicts" (title shown, grey hatched), loaded per
    visible week via the calendars module free/busy + events API.
  - Existing bookings from our own app (solid grey, labeled with event type name), including their buffers as lighter
    bands (Calendly one-off: buffer and meeting show as one block).
  - Holds from other open polls with Reserve times (dashed outline, "Reserved: {poll title}").
  - Working hours of the host's default availability schedule (white) vs off hours (light grey shading). Picking off
    hours is allowed (Calendly lets one-off/poll times ignore availability).
  - Co-host busy blocks in a second shade with a legend "Your calendar / {co-host} calendar".
- **Interactions**:
  - Click an empty slot: add an option starting at that 15-minute boundary with the current duration.
  - Click-drag vertically: add an option spanning the dragged range (snaps to 5 minutes when Alt/Option held, else 15).
  - Drag an option block to move it; drag its bottom edge to resize; click its "x" to remove; overlapping options are
    allowed and render side by side.
  - Options overlapping a busy block get an amber outline and an "Overlaps 'Team sync'" tooltip, but are allowed.
  - Past times are greyed and not clickable (now line drawn in red, like the calendar view).
  - Day header menu: **Add all free times** (fills that day with back-to-back options of the current duration inside
    working hours, skipping busy times; from Calendly one-off "+ Add times") and **Copy this day's times to...** (pick
    other days; borrowed from Rallly generators).
  - Keyboard: arrow keys move a focus cursor over 15-minute cells, Enter adds/removes, Delete removes the focused
    option.
- **Month view** (Doodle): pick dates on a month calendar, then for the selected dates set one or more start times
  (typed or picked, any minute) and a duration, "Add times"; also the only way to add **date-only** (all-day) options
  quickly for several days.
- **Mobile** (< 650px): the grid becomes a single-day column with a day strip; an "Add time" sheet (date, start, duration)
  is the primary input.

Validation in step 1: at least 1 option; at most 100; start in the future; duration 5 min to 24 h; exact duplicates
(same start and end) are rejected silently (the click toggles the existing option instead). Options crossing midnight
in the poll zone are allowed (rendered as two segments). Options more than 365 days ahead are rejected.

### B3.2 Step 2: "Meeting details"

Fields (Calendly order):

1. **Meeting name** (required, 1 to 100 chars).
2. **Location**: the shared location picker used by event types, single location: Google Meet, Microsoft Teams, Zoom,
   Jitsi Meet, custom link, in-person address, or phone as "Invitees call {number}" (a dial-in). "Host calls invitee"
   and "Ask invitee" are not offered because the poll produces one shared meeting. Conferencing links are generated at
   booking time, not at poll creation (Rallly).
3. **Description / instructions** (same rich text editor as event types, optional, 0 to 8,000 chars).
4. **Optional settings** (Calendly section, collapsed list of toggles):
   - **Show votes on page** (maps to results visibility, B3.3).
   - **Reserve times** (B12).
   - **Invitee language** (locale of the voter page and all participant emails; default = host locale).
5. **More settings** (our Doodle-depth section, collapsed by default; see the table below).
6. Buttons: **Back**, **Share meeting poll**.

### B3.3 Settings reference (defaults chosen for Calendly parity)

| Setting | Values | Default | Source | Behavior |
|---|---|---|---|---|
| Show votes on page / Results visibility | `host_only` (hidden poll), `counts_only`, `after_vote`, `everyone` | `host_only` | [C] toggle, [D] hidden poll, [R] hideParticipants/hideScores | `everyone`: names and votes visible to all voters. `after_vote`: same, but only after the viewer has submitted (reduces bandwagon voting). `counts_only`: per-option counts without names. `host_only`: voters see nothing about others; booking sends individual invites (B7.4). The Calendly toggle "Show votes on page" ON sets `everyone`, OFF sets `host_only`; the full select lives in More settings. |
| Reserve times | on/off | off | [C], [M] | Places holds on host and co-host calendars (B12). |
| Invitee language | locale list | host locale | [C] | Voter page and participant emails language. |
| Allow "If need be" | on/off | on | [D], [R] | Off = binary Yes/No (pure Calendly look). |
| Require email | on/off | on | [D], [R] | Name is always required. Off allows anonymous-ish name-only votes (no edit link email, no invites). |
| Verify email | on/off | off | [M] verify identity, [C] booking email verification | Voter must enter a 6-digit code sent to the email before the vote is saved. Implies Require email. |
| Allow comments | on/off | off | [R], [CD] | Comment thread on the poll page (B5.8). |
| Deadline | date + time in poll zone, or none | none | [D] | At the deadline voting closes (status `closed`), host can still book (B9). Must be in the future and not after the last option's start. |
| Max votes per option | integer 1 to 1,000, or none | none | [D], [CD] | Yes and If need be both count. Full options are disabled for new selections (shown "Full"), even when votes are hidden. Can be raised later; lowered only down to the current highest count. |
| Max choices per participant | integer 1 to number of options, or none | none | [CD] "single vote" | Counts Yes and If need be selections. 1 = "Participants can choose only one option" (sign-up style). |
| Time zone display | `auto` (convert to each voter's zone) or `fixed` (everyone sees the poll zone) | `auto` | [CD], [R] floating | `fixed` suits in-person events; voter page shows "Times are shown in {zone}". Instants are stored either way. |
| Notify me when people vote | `instant`, `daily_digest`, `off` | `instant` | [C], [D], [M] | Applies to the owner; co-hosts follow their own notification preferences. |
| Automatic reminders to people who haven't voted | `off`, `smart` (Doodle rules), `custom` (list of offsets) | `smart` when email invites are sent, else not applicable | [D] | B11. Only for participants invited by email from the app. |
| Book automatically when everyone agrees | on/off | off | [M] | When every invited participant (or every required participant if any are marked) has responded and at least one option has all of them at Yes, book the earliest such option automatically (B7.6). |
| Allow participants to suggest times | on/off | off | [M] (unlocked poll) | Stretch goal. Voters can propose one extra option each; host gets notified; proposed options are flagged "Suggested by {name}". |
| Link ending (slug) | `[a-z0-9-]{3,64}` | random 10-char token | [C] "edit the link ending" | Edited on the share screen (B3.4). |

### B3.4 Step 3: share screen

Modal or page "Your meeting poll is ready" (exact Calendly copy unverified) with:

- The poll link (`{origin}/p/{slug}`) with inline **edit link ending** (validates uniqueness live).
- **Copy link** (primary), **View live page** (opens the voter page in a new tab with a "Preview, your votes will not be
  saved" banner when opened by the host while signed in).
- **Email invitations** (opens B4.2).
- **Copy times as text** (paste-into-email list of all options in the host zone, plus the link; analogous to Calendly
  one-off "Add times to email").
- **Done** goes to the poll results page.

## B4. Sharing and email invitations

### B4.1 Link sharing

- Anyone with the link can vote (Calendly and Doodle). Links are unguessable (random slug unless the host edits it;
  edited slugs are public-ish, which is the host's choice).
- Open Graph tags: title "{Host name}: {Poll title}", description "Vote on times for this meeting", host avatar. No
  vote data in previews.

### B4.2 Email invitations from the app

- From the share screen or the results page: **Invite people** dialog: recipients field (paste a list, comma or newline
  separated, with autocomplete from the host's Contacts and past invitees), editable subject and message (default
  template below), checkbox "Mark as required" per recipient (used by ranking and auto-book), **Send**.
- Each recipient becomes a participant row with status `invited` and a personal link `/p/{slug}?i={inviteToken}` that
  pre-fills name and email and ties their votes to that row (so we know who has not responded).
- Sender: our configured email provider; From name "{Host name} via {AppName}", Reply-To the host's email (Doodle's
  "sender shows Doodle" problem avoided). Invites are rate limited (B15).
- Re-sending: per-row "Resend invite". Removing an invited person who has not responded is allowed (unlike Doodle);
  removing a respondent deletes their votes after confirmation.
- Default invite email:
  - Subject: "{Host name} wants to find a time: {Poll title}"
  - Body: host avatar/name, poll title, duration, location type, number of options, deadline if set, optional personal
    message, primary button **Vote on times**, secondary "View all {n} proposed times" list (first 5 in the recipient's
    detected zone is impossible to know, so list in the host zone with zone label), footer "You received this because
    {Host name} invited you. Unsubscribe from this poll."

## B5. Invitee voting experience (`/p/[slug]`)

### B5.1 Layout (Calendly look)

Same card shell as the booking page (owner-reference.md tokens: page `#fafafa`, white card, `#d4e0ed` dividers,
`#0a2540` headings, `#476788` secondary text, brand blue). Two columns on desktop (card about 1060px wide), single
column on mobile:

- **Left panel**: host avatar(s) and name(s) ("Julian Joseph and 2 others" for co-hosts), small label **"Meeting poll"**,
  poll title (bold 28px), icon rows: clock + duration ("30 min", or "Varies" with mixed durations), location row (video
  icon + "Web conferencing details provided upon confirmation." for conferencing, address for in-person), calendar icon +
  "Voting closes {date time}" when a deadline exists, description (rich text). Footer links "Cookie settings" and
  "Privacy Policy" like the booking page; optional "Powered by" ribbon per branding settings.
- **Right panel**:
  - Heading **"Select all the times you're available to meet"** ([C] string). Subtext: "The meeting host will see your
    preferences when deciding on a final time." ([C] string).
  - Legend when If need be is allowed: green check "Yes", yellow tilde "If need be", empty "No".
  - **Time zone** control (globe icon + friendly zone name + current local time, same dropdown as the booking page),
    auto-detected from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`), plus 12h/24h toggle. Hidden in
    `fixed` mode, replaced by "Times are shown in Pacific Time - US & Canada".
  - **Options list**, grouped by local date ("Tuesday, October 20, 2026"): each option is a row/card with the time range
    ("10:00am - 10:30am"), duration badge when durations differ, and the answer control (B5.2). Dates/times are computed
    in the voter's chosen zone, so an option can move to a different date than the host sees.
  - When results visibility allows: per-option vote summary ("3 Votes" [C] string, plus "(1 if need be)") with a popover
    listing names (desktop hover, mobile tap). In `everyone` mode a **Grid view** toggle shows the Doodle table
    (participants as rows, options as columns, this voter's editable row pinned at top).
  - Badges: "Full" (capacity reached, controls disabled), "Past" (option already started, read-only), "Conflict" (from
    voter calendar connect, B5.7), "Suggested by {name}" (if enabled).
  - Footer bar (sticky on mobile): "{n} preferred times" ([C] pluralized string) and primary button **Share times**
    ([C]). Secondary link **None of these work for me** (Doodle Decline).

### B5.2 Answer control

- If need be **off**: a checkbox per option (Calendly). Checked = `yes`, unchecked = `no`.
- If need be **on**: a three-state toggle per option: one click Yes (green, check icon), second click If need be
  (yellow, tilde icon), third click back to No (empty). Also a long-press/right-click menu and on desktop a small
  segmented control "Yes | If need be | No" on hover for discoverability. Doodle click-cycling is preserved for muscle
  memory.
- Max choices per participant: when the limit is reached, unselected options become disabled with tooltip "You can
  choose up to {n} times." With limit 1 the control becomes a radio list.
- Capacity: an option is selectable only while `yes + if_need_be < max` (counting other participants only); the
  voter's own existing selection on a now-full option stays editable down (they can remove it, not re-add it).
- Single selection hint: if the voter selects exactly 1 option and the poll has 3 or more options, show the Calendly
  reminder " Reminder: Voting for multiple times helps the poll host find the best meeting time for everyone."
  (do not block).

### B5.3 Details step ("Share your preferred times")

After **Share times**, the right panel switches (Calendly style, with a back arrow) to:

- Heading **"Share your preferred times"** ([C]).
- **Name** (required, 1 to 100 chars).
- **Email** (required unless Require email is off). Pre-filled and read-only for invite links and for signed-in app
  users.
- **Comment** (optional textarea, only when comments are allowed; posted to the thread as this participant).
- Checkbox **Get updates when others vote** (Doodle; only when visibility is `everyone`, `after_vote` or
  `counts_only`) and checkbox **Email me if the poll changes or a time is booked** (always on and not shown: booking
  invites always go to respondents unless the host deselects them).
- Honeypot field + timing check (B15). If Verify email is on: "Send code", then a 6-digit code field
  ("Verify your email" pattern from the booking page).
- Submit button **Share times**. On success, show the confirmation (B5.5).

Duplicate email: if the email matches an existing participant and the browser has no valid edit token for that
participant, do not overwrite. Show "You've already voted with this email. We've sent you a link to update your
response." and email a magic edit link. (Prevents anyone from overwriting someone else's votes by typing their email.)

### B5.4 Decline

**None of these work for me** asks for name/email (same form), saves `no` on every non-past option, marks the
participant `declined` (respondent). Host sees them in the grid with all No and a "Declined" chip.

### B5.5 Confirmation and editing later

- Confirmation panel: check icon, **"Thanks for voting!"** and **"You'll receive a calendar invitation when the host
  decides a final time from submitted votes."** ([C] strings), a summary of the chosen times in the voter's zone, and
  **Edit your preferred times** ([C] string) button.
- A confirmation email goes to the voter (if email given) with their selections and a **Review or change your
  response** button carrying a magic edit token.
- Edit access: the edit token is stored as an httpOnly cookie scoped to `/p/{slug}` (365 days) on submit, so the same
  device returns straight to "Edit your preferred times". Opening a magic link sets the cookie and redirects to the
  clean URL. Signed-in app users are matched by user id.
- Editing is allowed while the poll is `open` and before the deadline. Votes on past options are frozen. When the poll
  is `closed`, `booked`, `canceled` or `expired`, the page shows the read-only state (B5.9).

### B5.6 Results visible to voters

- `host_only`: voters see only their own answers. Counts, names and "Full" are still enforced; "Full" is shown (classic
  Doodle greys out full options even in hidden polls) but nobody's identity leaks.
- `counts_only`: per-option counts, no names, no grid.
- `after_vote`: nothing before the first submit; afterwards like `everyone`.
- `everyone`: counts + names + grid. Emails are never shown to voters in any mode.
- Enforced server-side: the voter API response omits other participants entirely unless the mode allows it.

### B5.7 Check my calendar (voter calendar connect)

Optional button **Check my calendar** above the options list (Calendly highlights mutual availability for Calendly
users; Doodle shows appointments for Doodle users):

- Choices: **Google**, **Microsoft**, **Paste an ICS link**; or automatic if the voter is a signed-in user of this app
  (uses their conflict calendars).
- Google: OAuth with the minimal scope that allows free/busy (`https://www.googleapis.com/auth/calendar.freebusy`),
  call FreeBusy for the poll's option range. Microsoft: Graph `getSchedule` (Calendars.ReadBasic is not enough for
  getSchedule; requires `Calendars.Read`). Requested in a popup, token kept in memory/session only, never stored, and
  discarded after the busy intervals are fetched. No app account is created.
- Result: each option gets "Busy" (red dot, "Conflicts with your calendar") or "Free" (green dot); a one-click
  **Mark all free times as Yes** pre-fills answers (voter can still adjust). Event titles are not shown for OAuth sources
  (free/busy only); for signed-in app users titles may be shown since it is their own data.
- Feature is hidden when no Google/Microsoft OAuth credentials are configured (ICS link option stays).

### B5.8 Comments

- Shown under the options (or under the grid) when enabled: list of comments (author name, "Host" badge for hosts,
  relative time, text, line breaks preserved, autolinked URLs with `rel="nofollow ugc noopener"`), newest last.
- Add comment box: name (pre-filled from the voter's participant record or required if not yet voted), text up to
  2,000 chars, **Comment**. Posting a comment without voting is allowed (creates no participant).
- Authors can delete their own comment (via edit token); hosts can delete any comment.
- Comments respect visibility: in `host_only` mode comments are visible only to hosts and to their author (it becomes
  a private message to the host). The UI says so ("Only the host can see comments").

### B5.9 Page states

| State | What voters see |
|---|---|
| Open | Normal voting. |
| Open, deadline soon (< 24 h) | Banner "Voting closes in {relative time}". |
| Closed (deadline passed or host closed voting) | "Voting for this poll has closed." Read-only list (own answers + whatever visibility allows). "The host will share the final time soon." |
| Booked | "This meeting has been scheduled." Final time in the voter's zone, location, "Add to calendar" (Google, Outlook, Apple/ICS) buttons. If visibility allows, the results stay visible read-only. |
| Canceled (deleted) | "This poll is no longer available." (Calendly: link inactive.) No details. HTTP 410. |
| Expired (all options passed, never booked) | "This poll has ended." |
| Unknown slug | Standard 404 page. |

## B6. Host results view (`/app/polls/[pollId]`)

Header: poll title, status badge (Open / Closed / Booked / Canceled / Expired), "{respondents} of {invited or
respondents} responded", deadline countdown, duration, location, hosts. Actions: **Copy link**, **Invite people**,
**Edit**, **Close voting** / **Reopen voting**, kebab menu (**Duplicate**, **Export CSV**, **Delete poll**).

Two views, toggle remembered per user (localStorage):

1. **Top times** (Calendly default): options sorted by the ranking (B19). Each row: date and time in the host's
   current zone (zone picker at the top, defaults to host profile zone), duration, availability bar (green Yes, yellow If
   need be, grey No, light "no answer"), counts "5 Yes, 1 If need be, 2 No", "Best" star badge on the top tie group,
   required-participants indicator ("All required can attend"), host calendar status (free / "Conflicts with 'Board
   prep'" amber, or "Booked: {event}" red if an app booking now occupies it), and a **Book** button. Hover/tap on counts
   lists names (Calendly hover). Past options are listed collapsed under "Past times" and are not bookable.
2. **Grid** (Doodle): rows = participants (hosts' availability row first, then respondents in submission order, then
   invited non-respondents greyed with "Invited, no response"), columns = options grouped by date. Cells: green check,
   yellow tilde, empty for No, "?" for options added after their last submit, dash for "no answer". Totals row at the
   bottom with counts and a star over the best column (Doodle's star). Sticky first column and header; horizontal scroll.
   Row menu: **Edit votes** (host edits on behalf, participant is emailed), **Copy email**, **Mark as required**,
   **Resend invite** (invited rows), **Remove** (confirm; deletes votes; participant emailed "removed by host" unless
   unchecked). Button **Add participant (vote on behalf)**: name required, email optional, votes; participant emailed if
   an email is given.

Host availability row: computed live from host and co-host conflict calendars and app bookings: "Free" / "Busy" per
option, plus an optional manual override row "Your preference" where the host can mark options Yes/If need be/No
(Doodle organizer auto-yes, editable). The host row never counts toward totals (it is shown separately) unless the host
explicitly toggles "Count my preference" (default off; Calendly does not count the host).

Side panel / sections:

- **Not responded yet**: invited participants without a response, with **Send reminder now** (bulk) and last reminder
  time.
- **Activity**: chronological feed (voted, changed vote, declined, commented, invited, reminder sent, booked, reopened).
- **Comments** thread (host can reply as "Host").
- Results remain available after booking (unlike Calendly), with the booked option highlighted and a **View meeting**
  link (Calendly).

Live updates: the results page polls `GET .../results?since=` every 15 seconds while visible (or uses
`router.refresh()` after server actions), shows a toast "Alex voted" when new activity arrives.

## B7. Booking the final time

### B7.1 Book dialog

Clicking **Book** on an option opens "Book meeting time" (Calendly pop-up), showing:

- Meeting summary: title, date and time (host zone, plus "{n} participants in other zones" hint), duration, location,
  hosts.
- **Conflict check** (live, at open): host and co-host calendars + app bookings for that window.
  - Conflict with another booking made in this app: **blocked** ("You already have '{event}' at this time") with a
    link to the Calendar page (Calendly: cannot book over Calendly-booked conflicts). Buffers of other events do not
    block (Calendly: "You can book over buffers").
  - Conflict with an external calendar event: amber warning "Conflicts with '{title}' on {calendar}", booking allowed.
  - Holds from this poll never count as conflicts; holds from other polls show as warnings.
- **Invitee list** with checkboxes:
  - All respondents who answered Yes or If need be for this option: checked.
  - Respondents who answered No or declined: checked by default too (Doodle sends the invite to all participants), with
    a quick filter "Only people who can attend".
  - Invited non-respondents: unchecked by default, section "Didn't respond" with "Include all" (Calendly lets you add
    non-voters; Doodle's gap is that it can't).
  - Participants without an email: shown disabled with "No email, can't send an invite".
  - **+ Add invitee**: name + email rows (Calendly).
  - Remove (x) per row (Calendly's way to drop unwanted voters).
- Message to invitees (optional, included in the invite email and calendar description).
- Toggle **Send meeting reminders** (24 h and 1 h before, uses the default reminder automation templates; Calendly
  does not support workflows for polls, so default off).
- Primary **Book meeting** (Calendly label), secondary Cancel.

### B7.2 What "Book meeting" does (one transaction + after() side effects)

In a DB transaction (row lock on the poll):

1. Re-validate: poll status `open` or `closed` (not booked/canceled/expired), option in the future, no blocking app
   conflict (re-checked inside the transaction against `scheduled_events` to avoid races with instant bookings).
2. Create the **scheduled event** through the bookings module service, linked to the poll's ad hoc event type: start/end
   from the option, hosts = poll owner + co-hosts (collective style), status `active`, `source = 'poll'`, `poll_id`.
3. Create one **invitee** row per selected person (name, email, time zone from the participant if known, else host
   zone, `poll_participant_id` link, no cancel/reschedule tokens beyond the standard invitee token).
4. Update the poll: `status = 'booked'`, `booked_option_id`, `booked_scheduled_event_id`, `booked_at`,
   `booked_by_user_id`. Voting is now closed.
5. Enqueue jobs (DB jobs table, executed via `after()` immediately and retried by cron):
   - Create conferencing (Meet/Teams/Zoom/Jitsi/custom) and write the event to the host's "add to" calendar (with the
     invitees as attendees only when the provider's own invites are disabled; see B7.4).
   - Send **booking confirmation** emails with ICS (METHOD:REQUEST, one UID per scheduled event) to every invitee and
     the hosts.
   - Release all **holds** for this poll (B12).
   - Send "The time has been chosen" emails to respondents who were **not** included (optional, default off; they were
     deliberately left out).
   - Fire webhooks: `invitee.created` per invitee (Calendly-compatible payload) and our `poll.booked`.
   - Cancel pending reminder jobs for the poll.

### B7.3 Visibility of other attendees in invites

- Visibility `everyone`, `after_vote` or `counts_only`: one calendar event with all invitees as attendees (normal group
  meeting invite; attendees see each other, as Calendly states).
- Visibility `host_only` (hidden poll): Doodle promises participants will not see each other "in the calendar
  invitation". We send **individual ICS invites**, one per invitee, each with its own UID and listing only the host(s)
  and that invitee as attendees. The host's own calendar gets one event listing everyone. The Book dialog shows a note
  "This is a hidden poll: invitees won't see each other."

### B7.4 Who sends calendar invites

- Default: our app sends ICS emails (works with or without a connected calendar, matches Calendly sending its own
  invitations).
- The host's calendar copy is written via the provider API without triggering provider invitations (Google
  `sendUpdates=none`; for Microsoft Graph, write the event without attendees and keep the invitee list in the
  description), so nobody gets two invites. This follows the core spec's invitation strategy; the calendars module
  owns the details.

### B7.5 Booking from email

The host's "{Name} has voted" email includes a "Top time" block with a **Book this time** button that deep-links to
the results page with the Book dialog open for that option (never books in one click from email).

### B7.6 Auto-book on consensus (opt-in)

When enabled, after each vote: if the poll has invited participants and every invited participant (or, when any are
marked required, every required participant) has responded, find options where all of them answered Yes (If need be
does not count) and the host is free; if any, book the earliest automatically with default invitee selection, and email
the host "We booked {time} because everyone agreed." Guard: only while `open`, never over app conflicts.

## B8. After booking: change the time (reopen), cancel

- **Change time** (Doodle "Reopen" + "Book it", which Calendly lacks): on a booked poll, **Reopen poll** sets status
  back to `open` while keeping the scheduled event untouched (still active at the old time) and records
  `reopened_at`. Participants get "{Host} reopened the poll for {title}, you can update your response" (optional
  checkbox, default on). When the host books again:
  - Same option as before: nothing changes, poll returns to `booked`.
  - Different option: the **same scheduled event is rescheduled** (start/end updated, conferencing kept if the provider
    allows, ICS METHOD:REQUEST with the same UID and incremented SEQUENCE, "Updated invitation" emails), invitee list
    reconciled (added people get new invites, removed people get METHOD:CANCEL).
  - Host cancels the reopened poll instead: dialog asks "Also cancel the scheduled meeting at {old time}?".
- **Cancel the booked meeting** from the Calendar page: standard host cancel flow (reason, invitee emails). The poll
  stays `booked` but shows "Meeting canceled" with a **Reopen poll** action.
- Invitee-side: invitees of a poll meeting can cancel only their own attendance (link in the confirmation email:
  "Can't make it?" marks that invitee `canceled` and notifies the host); they cannot reschedule (Calendly parity). The
  host can "Reopen poll" to find a new time.

## B9. Poll states and lifecycle

| Status | Meaning | Voting | Host can book | Public page |
|---|---|---|---|---|
| `open` | Collecting votes | Yes (until deadline) | Yes | Voting UI |
| `closed` | Voting closed (deadline passed or host clicked Close voting), not booked | No | Yes | "Voting has closed" |
| `booked` | Final time chosen, scheduled event exists | No | Rebook via Reopen | "Scheduled" with final time |
| `canceled` | Host deleted/canceled the poll | No | No | 410 "no longer available" |
| `expired` | Every option's start is in the past and never booked | No | No | "This poll has ended" |

Transitions:

| From | To | Trigger |
|---|---|---|
| (new) | `open` | Host clicks Share meeting poll |
| `open` | `closed` | Deadline reached (job), or host Close voting |
| `closed` | `open` | Host Reopen voting (must move/clear a past deadline first) |
| `open`, `closed` | `booked` | Host books, or auto-book |
| `booked` | `open` | Host Reopen poll (scheduled event kept) |
| `open`, `closed` | `expired` | Last option start passes (job at `max(start)`, plus lazy check on read) |
| `open`, `closed`, `expired` | `canceled` | Host Delete poll (soft delete) |
| `booked` | `canceled` | Host Delete poll: dialog requires choosing "Keep the scheduled meeting" or "Cancel it too" |
| `expired` | `open` | Host edits and adds future options (B14) |

Implementation: a pure state machine module (`src/lib/polls/state.ts`) with `canTransition(from, event)` and a single
server function per transition that writes `poll_activity` and enqueues side effects. Derived flags computed on read:
`isPastDeadline`, `allOptionsPast`, so a missed cron run can never let someone vote after the deadline (server checks
`deadline_at > now()` on every vote write regardless of status).

Deleting: soft delete (`canceled`, `deleted_at`), hidden from the list by default (filter "Deleted"), purge after 30 days
by a cleanup job (votes and participants hard-deleted; activity kept without PII). Confirm dialog: "Delete this poll?
The link will stop working." with checkbox "Notify the {n} people who voted" (default on).

## B10. Notifications and emails

All emails go through the shared email module (Resend / SMTP / DB outbox). Templates live in the polls module.
Participant-facing emails use the poll's invitee language. Every participant email has a per-poll unsubscribe link
(sets `unsubscribed_at`, which stops invites, reminders and update emails, but not booking invites).

| # | Email | To | When | Content |
|---|---|---|---|---|
| 1 | Poll created | Host | On create (optional, default off) | Link, admin link, copy of options |
| 2 | Invitation | Invited person | Host sends invites | B4.2 template |
| 3 | Vote received | Host (and co-hosts per preference) | Each submit or change, when Notify = instant | Subject **"{Name} has voted in a poll for {Title}"** ([C] observed subject); body: their answers, current Top times (top 3), "{x} of {y} responded", buttons **View results**, **Book this time** |
| 4 | Daily digest | Host | 08:00 host zone, when Notify = daily_digest and there was activity | New votes/comments since last digest |
| 5 | Voter confirmation | Voter | On submit | "Thanks for voting!", their selections in their zone, **Review or change your response** (magic link) |
| 6 | Someone else voted | Subscribed voters ("Get updates when others vote") | On others' submits, batched max one per 10 minutes per recipient | Counts summary (respects visibility) |
| 7 | New comment | Host + subscribed voters (if visibility shows comments) | On comment | Comment text, link |
| 8 | Reminder | Invited non-respondents | B11 schedule | "Reminder: {Host} is waiting for your availability for {Title}", deadline, button |
| 9 | Poll updated | Respondents | Host adds options and ticks "Notify participants" | "New times were added", button to update response |
| 10 | Votes edited / added on your behalf / removed | Affected participant | Host edits/adds/removes | Doodle parity |
| 11 | Voting closed | Host | Deadline reached | "{x} of {y} responded. Top time: ... **Book now**" |
| 12 | Deadline approaching | Host | 24 h before deadline (if responses < invited) | Status + "Send reminder" button |
| 13 | Poll ended without booking | Host | On expiry | Offer **Duplicate with new times** |
| 14 | Meeting booked | Invitees + hosts | Booking | Standard booking confirmation + ICS (from the bookings module templates, with "Booked from meeting poll" line) |
| 15 | Reopened | Respondents | Host reopens (optional) | Doodle parity |
| 16 | Time changed | Invitees | Rebook to another option | Updated invitation ICS |
| 17 | Poll canceled | Respondents | Host deletes with notify on | "{Host} canceled the poll {Title}" |
| 18 | Email verification code | Voter | Verify email on | 6-digit code, 10 minute expiry |
| 19 | Edit link request | Existing participant | Duplicate-email submit (B5.3) | Magic link |

In-app notifications (bell, if the notifications module provides one): vote received, comment, deadline passed,
auto-booked.

SMS: not used for polls (Calendly has none); booked meetings can use standard SMS reminders if the host enabled meeting
reminders.

## B11. Reminders to non-respondents

- Applies only to participants with status `invited` (emailed from the app), not unsubscribed, no response yet.
- Modes:
  - **Smart** (Doodle rules, default once invites are sent): anchor = deadline if set, else first future option start.
    lead = anchor minus the time invites were first sent (Doodle measures from poll creation; we use first invite send
    time, which is equal or later and more meaningful). lead > 5 days: one reminder 48 h before anchor; 2 to 5 days: 36 h
    before; < 2 days: none. Additionally (our addition) if lead > 7 days, an early nudge 3 days after the invite.
  - **Custom**: up to 3 reminders, each "N hours/days after the invite" or "N hours/days before the deadline".
  - **Off**.
- Manual **Send reminder now** (results page) to all or selected non-respondents; throttled to once per participant per
  12 hours.
- Each reminder is a row in the shared scheduled jobs table (`type = 'poll.reminder'`, payload poll id + reminder index),
  recomputed whenever the deadline, options or invite list change (delete pending jobs, insert new ones). Dispatcher
  re-checks eligibility at send time (still open, participant still non-respondent, not unsubscribed).
- Max 3 automatic reminders per participant per poll. Reminder timing precision is limited by cron frequency (GitHub
  Actions every ~10 minutes, Vercel daily, plus `after()` opportunistic runs); acceptable for reminders.

## B12. Reserve times (calendar holds)

- On: when the poll is created (and when options are added), for the owner and every co-host with a writable "add to"
  calendar, create one event per future option: title **"Reserved: {Poll title}"**, description "Placeholder for meeting
  poll {link}. Will be removed when a time is booked.", transparency **busy** (Calendly: "block off the times in your
  calendar as busy"), no attendees, private visibility, extended property `pollId`/`optionId` for cleanup.
- Our own slot engine treats open-poll options with Reserve times as busy for the owner and co-hosts (source
  `reserved`), whether or not a calendar is connected, so regular event types cannot be booked over them (Calendly
  behavior for reserved holds; `user_busy_times` type `reserved`).
- Removal: on booking (all holds removed; the real event is created separately), on cancel, on expiry, on option
  removal, on setting turned off. "Clear reserved times" button on the results page (Calendly one-off parity).
- Hold writes are async jobs with retries; failures are shown on the results page ("Couldn't reserve 3 times on
  Google Calendar. Retry").
- Holds are only created for options within the next 365 days and capped at 100 per poll (the option cap).

## B13. Dashboard: Meeting polls list (`/app/scheduling/polls`)

- Tab header: filter chips **Open** (default, includes closed-unbooked), **Booked**, **Ended** (expired), **All**,
  plus search by title and a "Hosted by" filter (me / co-hosted / all users for admins).
- Each poll row/card (Calendly list style, colored left border from the poll's event type color, default purple):
  - Title, status badge, "{duration} · {n} times" (or "Mixed durations"), date range of options ("Oct 20 to Oct 24").
  - Response summary: "{r} responses" or "{r} of {i} responded" with a mini progress bar; "New" dot if votes arrived since
    the host last viewed.
  - Deadline ("Closes Oct 18, 5:00pm") or "Booked for Tue, Oct 21, 10:00am" with **View meeting**.
  - Top time preview (when open): "Top time: Tue 10:00am (5 yes)".
  - Actions: **Copy link**, **View results** (primary click), kebab: Edit, Invite people, Close voting/Reopen voting,
    Duplicate, Export CSV, Delete.
- Empty state: illustration + "Find the best time for everyone. Propose times, share a link, and book the winner."
  with **+ New meeting poll**.
- Sorting: open polls by deadline (soonest first, no deadline last), then by created date desc; booked by meeting time.
- Pagination: 25 per page (cursor).
- The Calendar page Pending tab shows the same open/closed polls compactly.

## B14. Editing rules after publishing

Best of both: Calendly's 2026 help allows changes "while the poll is still in progress", Doodle allows adding/removing
times.

- **Always editable while open/closed**: title, description, location, invitee language, results visibility (switching
  to a more private mode is immediate; to a more public mode shows a warning "Voters chose their answers expecting their
  names to be hidden"), comments toggle, notify setting, reminders, deadline (extend/remove; setting it in the past closes
  voting), hosts (add/remove co-hosts; holds updated).
- **Options**:
  - Add options: allowed (cap 100). Existing respondents show "?" for them. Checkbox "Email the {n} people who already
    voted about the new times" (default on).
  - Remove an option with no Yes/If need be votes: allowed silently.
  - Remove an option with votes: confirm dialog listing affected voters; votes deleted.
  - Change an option's time: modeled as remove + add (votes on it are cleared, voters see "?").
  - Past options cannot be edited or removed (Doodle).
- **Max votes per option**: raise freely; lower only down to the current maximum count. Turning it on later is allowed
  only if no option already exceeds the new value (Doodle forbids adding later; we allow when consistent).
- **Max choices per participant**: lowering below what some respondent already chose is allowed but those respondents
  are flagged "Over the limit" and must fix it on next edit (their existing votes stay valid).
- **Duration / poll time zone**: poll time zone change only affects display defaults and `fixed` mode; option instants do
  not change. The "default duration" only affects new options.
- Editing never changes the link (Doodle: URL unchanged), except an explicit link-ending edit (old slug keeps
  redirecting for 90 days via a `poll_slug_redirects` row).
- Booked polls: editing details updates the scheduled event (title/description/location) through the bookings module's
  update flow; options cannot be edited unless the poll is reopened.

## B15. Privacy, security and abuse protection

- Public endpoints never return participant emails. Names/votes filtered by visibility server-side (B5.6).
- Edit tokens and invite tokens: 32 random bytes (base64url), only SHA-256 hashes stored. Edit cookie httpOnly,
  `SameSite=Lax`, `Secure`, `Path=/p/{slug}`.
- Host access: session auth + ownership/co-host check on every host route; workspace admins (if the team module has
  roles) can view.
- Rate limits (shared limiter): voting submits 10 per IP per poll per hour; comments 20 per IP per hour; invite emails
  200 per host per day; verification codes 5 per email per hour.
- Bot protection: honeypot field, minimum 2 seconds between page load and submit, optional Turnstile/reCAPTCHA if the
  app has one configured (Calendly booking page uses reCAPTCHA).
- Input limits: B16. Comments are plain text (no HTML), rendered escaped.
- Robots: `noindex, nofollow` on `/p/*`.
- Hidden poll invites are individual (B7.3). Exports (CSV) include emails and are host-only.
- Data retention: no automatic deletion of active data (self-hosted, unlike Doodle's 30-day free retention); canceled
  polls purged after 30 days (B9).
- Voter calendar connect tokens never persisted (B5.7).

## B16. Limits and validation

| Item | Limit |
|---|---|
| Options per poll | 100 (`MAX_POLL_OPTIONS`) |
| Participants per poll | 1,000 (`MAX_POLL_PARTICIPANTS`, Doodle parity) |
| Option duration | 5 min to 24 h, or all-day (date-only) |
| Options horizon | start within 365 days |
| Title | 1 to 100 chars |
| Description | up to 8,000 chars |
| Name | 1 to 100 chars |
| Email | RFC 5322 basic check, up to 254 chars, normalized lowercase for matching |
| Comment | 1 to 2,000 chars; 200 comments per poll |
| Co-hosts | up to 10 |
| Invite recipients per send | up to 200; 1,000 per poll |
| Slug | `^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$`, globally unique, reserved words blocked |
| Deadline | > now and <= last option start |
| Max votes per option | 1 to 1,000 |

## B17. Accessibility and responsive behavior

- Answer control: a `button` with `role="checkbox"` and `aria-checked` = `true` (Yes), `mixed` (If need be), `false`
  (No); label "Tuesday Oct 20, 10:00 to 10:30am: If need be". Space/Enter cycles. Never color-only: icons (check, tilde,
  empty) plus text in the legend.
- Grid: proper `table` with `th scope`, sticky headers, keyboard navigation with arrow keys; screen reader summary row.
- Week grid in creation: each 15-minute cell is a focusable gridcell; added options are listed in the "x/100 times
  selected" list which is fully keyboard operable (alternative to drag).
- Breakpoints from the booking page: large >= 1100px (two columns), medium 650 to 1099px (narrower), small < 650px
  (single column, sticky footer with count and Share times). Minimum width 320px, 16px side gutters, no horizontal page
  scroll (the grid scrolls inside its container).
- Reduced motion respected; focus rings visible; contrast AA for green/yellow states (use darker text on yellow).

## B18. Copy deck (UI strings)

[C] = Calendly verbatim (from the booking bundle or help center); others are ours or Doodle-derived.

Host:

- Create menu: "More ways to meet" > "Meeting poll" [C]
- Step 1 title: "Choose times to offer" [C]; counter "{x}/100 times selected" [C pattern]; "Clear all" [C]; "Next" [C]
- Step 2 title: "Meeting details"; fields "Meeting name" [C], "Location", "Description/Instructions"; section "Optional
  settings" [C]: "Show votes on page" [C], "Reserve times" [C], "Invitee language" [C]; "More settings"; button "Share
  meeting poll" [C]
- Share: "Copy link" [C], "View live page" [C], "Invite people", "Copy times as text", "Done"
- Results: tab "Top times" [C], "Grid", "Book" [C], "Best", "Not responded yet", "Send reminder now", "Add participant",
  "Close voting", "Reopen voting", "Reopen poll", "Duplicate", "Export CSV", "Delete poll", "View meeting" [C]
- Book dialog: title "Book meeting time" [C], "+ Add invitee" [C], "Book meeting" [C], "Only people who can attend",
  "Didn't respond", "This is a hidden poll: invitees won't see each other."
- Toasts: "Link copied", "Poll created", "{Name} voted", "Meeting booked. Invitations are on their way."

Voter:

- Label "Meeting poll" [C]
- "Select all the times you're available to meet" [C]
- "The meeting host will see your preferences when deciding on a final time." [C]
- "{count} preferred time" / "{count} preferred times" [C]
- " Reminder: Voting for multiple times helps the poll host find the best meeting time for everyone." [C]
- "Share your preferred times" [C]; button "Share times" [C]
- "Thanks for voting!" [C]; "You'll receive a calendar invitation when the host decides a final time from submitted
  votes." [C]
- "Edit your preferred times" [C]
- "{count} Vote" / "{count} Votes" [C]
- "Yes", "If need be", "No" [D]; "None of these work for me"
- "Get updates when others vote" [D]
- "Check my calendar", "Mark all free times as Yes", "Conflicts with your calendar"
- "Full", "Past", "Voting closes {when}", "Voting for this poll has closed.", "This meeting has been scheduled.",
  "This poll is no longer available.", "This poll has ended."
- "You can choose up to {n} times."
- "You've already voted with this email. We've sent you a link to update your response."
- Footer CTA on confirmation (optional, branding setting): "Easy polling ahead" [C] / "Create your own poll" [C] links to
  sign up only if public sign-ups are enabled.

## B19. Ranking: which option is "best"

Per option compute: `yes`, `maybe` (if need be), `no`, `unknown` (respondents with no vote row for this option),
`requiredOk` (true when every required participant answered Yes or If need be; true when nobody is required),
`hostFree` (no external conflict and no app booking for owner and co-hosts), `isPast`.

Sort key (descending unless noted), applied to non-past options:

1. `requiredOk` (true first)
2. `attendable = yes + maybe`
3. `yes`
4. `hostFree` (true first)
5. `no` ascending
6. `start` ascending (earliest first)

"Best" badge: all options equal to the first option on keys 1 to 5 (ties get multiple stars, Doodle style). Show no
badge when nobody has responded. Export a pure function `rankPollOptions(options, votes, participants, hostBusy, now)`
in `src/lib/polls/ranking.ts` with exhaustive unit tests; also used by auto-book (which instead requires all relevant
participants at strict Yes).

Rationale: Doodle counts if-need-be as availability (limit counting treats it as yes); Calendly surfaces "most popular";
Microsoft prefers required attendees and earliest option on ties.

## B20. Time zone handling (including DST)

- Storage: option `starts_at` / `ends_at` are `timestamptz` (UTC instants). Date-only options store `all_day_date`
  (`date`) with no zone, never converted (Rallly floating dates); they display the same calendar day for everyone and
  book as an all-day event in the poll zone for the calendar write (ICS `VALUE=DATE`).
- Poll `time_zone` (IANA) = the zone the host picked in step 1. Used for: grid rendering default, `fixed` mode display,
  deadline input interpretation, email "host zone" listings, booking default invitee zone.
- Voter display: Luxon `DateTime.fromJSDate(start, { zone: voterZone })`. Group by local date in the voter's zone;
  an option crossing local midnight shows under its start date with "(ends next day)".
- Participant `time_zone` is recorded on submit (browser-detected or picked) and used for their emails and invites.
- Creation grid and DST: building an option from a grid cell uses `DateTime.fromObject({ ...wallClock }, { zone })`.
  Non-existent local times (spring forward gap, e.g. 2026-03-08 02:00 to 03:00 America/New_York) are not offered as
  cells (rendered hatched "Doesn't exist (DST)"); ambiguous fall-back hour (2026-11-01 01:00 to 02:00) renders two rows
  labeled "1:00am (EDT)" and "1:00am (EST)". Durations are computed in absolute minutes (a 60-minute option at 01:30
  on fall-back day ends at 01:30 EST wall clock).
- "Copy this day's times to..." copies wall-clock times, so an 09:00 option copied across a DST change stays at 09:00
  local.
- Deadline stored as `timestamptz`, entered in poll zone.
- Tests: Playwright runs the voter page with `timezoneId: 'Asia/Kolkata'` and `'America/Los_Angeles'` against a poll
  created in `Europe/Berlin` around the EU/US DST gap weeks (late March, late October).

---

# Part C: Data model proposal (`src/db/schema/polls.ts`)

Drizzle/Postgres. All ids `text` (uuid v7 or the project's id helper), timestamps `timestamptz` default `now()`.
Naming follows whatever the foundation picks (snake_case columns assumed).

### C1. Enums

| Enum | Values |
|---|---|
| `poll_status` | `open`, `closed`, `booked`, `canceled`, `expired` |
| `poll_results_visibility` | `host_only`, `counts_only`, `after_vote`, `everyone` |
| `poll_time_zone_mode` | `auto`, `fixed` |
| `poll_notify_mode` | `instant`, `daily_digest`, `off` |
| `poll_reminder_mode` | `off`, `smart`, `custom` |
| `poll_vote_choice` | `yes`, `if_need_be`, `no` |
| `poll_participant_status` | `invited`, `responded`, `declined` |
| `poll_participant_source` | `link`, `invite`, `host_added` |
| `poll_hold_status` | `pending`, `active`, `removed`, `failed` |
| `poll_activity_type` | `created`, `edited`, `options_added`, `options_removed`, `invited`, `voted`, `vote_changed`, `declined`, `participant_removed`, `commented`, `comment_deleted`, `reminder_sent`, `voting_closed`, `voting_reopened`, `booked`, `reopened`, `rebooked`, `canceled`, `expired` |

### C2. Relationship to event types (Calendly API parity)

Recommended: every poll owns one row in `event_types` with `booking_method = 'poll'`, `kind_type = 'adhoc'`
(Calendly `AdhocEventType`), `secret = true` (never on profile/landing pages, never bookable through the instant booking
flow), `pooling_type = 'collective'` when co-hosts exist, carrying the shared fields: name, slug (null or internal),
duration (default duration), description, locations, locale, color, hosts (event type memberships). The poll row adds
poll-only fields and `event_type_id` (unique FK). Benefits: booked scheduled events reference an event type like every
other meeting, the location/conferencing code is reused, the public API serializer lists polls with
`booking_method: "poll"` exactly like Calendly.

Cross-module requirement for the foundation schema: `event_types.booking_method` enum (`instant`, `poll`, default
`instant`) and an ad hoc/one-off kind; the slot engine and instant booking routes must refuse event types whose
`booking_method = 'poll'`; `scheduled_events` gains nullable `poll_id` (FK `meeting_polls.id`) and `source` value
`poll`; `invitees` gains nullable `poll_participant_id`.

Alternative (if the foundation prefers isolation): polls standalone, and the booking service accepts
`{ source: 'poll', pollId }` instead of an event type. Then the API serializer synthesizes an event-type-shaped object.
Choose one in the foundation phase; the rest of this spec works with either.

### C3. Tables

`meeting_polls`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `event_type_id` | text FK event_types, unique | C2 (nullable if the alternative is chosen) |
| `owner_user_id` | text FK users | creator; co-hosts in `meeting_poll_hosts` |
| `slug` | text unique | public link ending |
| `title` | text | duplicated from event type for list queries if C2 is used, or the source of truth otherwise |
| `description_html` | text null | |
| `default_duration_minutes` | int | |
| `location` | jsonb null | same shape as event type location item |
| `locale` | text | invitee language |
| `time_zone` | text | IANA |
| `time_zone_mode` | poll_time_zone_mode | default `auto` |
| `status` | poll_status | default `open` |
| `results_visibility` | poll_results_visibility | default `host_only` |
| `allow_if_need_be` | boolean | default true |
| `require_email` | boolean | default true |
| `verify_email` | boolean | default false |
| `allow_comments` | boolean | default false |
| `allow_suggestions` | boolean | default false (stretch) |
| `max_votes_per_option` | int null | |
| `max_choices_per_participant` | int null | |
| `deadline_at` | timestamptz null | |
| `reserve_times` | boolean | default false |
| `notify_mode` | poll_notify_mode | default `instant` |
| `reminder_mode` | poll_reminder_mode | default `smart` |
| `reminder_offsets` | jsonb null | custom: `[{ kind: 'after_invite' \| 'before_deadline', minutes }]` |
| `auto_book` | boolean | default false |
| `count_host_preference` | boolean | default false |
| `host_preferences` | jsonb null | `{ [optionId]: 'yes' \| 'if_need_be' \| 'no' }` manual host row |
| `booked_option_id` | text null FK meeting_poll_options | |
| `booked_scheduled_event_id` | text null FK scheduled_events | |
| `booked_at`, `booked_by_user_id` | timestamptz null, text null | |
| `voting_closed_at` | timestamptz null | manual close or deadline |
| `reopened_at` | timestamptz null | |
| `first_invite_sent_at` | timestamptz null | smart reminders anchor |
| `host_last_viewed_at` | timestamptz null | "New" dot |
| `canceled_at`, `deleted_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(owner_user_id, status, created_at desc)`, `(status, deadline_at)` partial where status = 'open',
unique `(slug)`.

`meeting_poll_hosts`: `poll_id` FK, `user_id` FK, `role` (`owner` \| `cohost`), `created_at`; PK `(poll_id, user_id)`.
(Skip if C2 is used and event type memberships hold hosts; keep it if polls are standalone.)

`meeting_poll_options`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `poll_id` | text FK cascade | |
| `starts_at`, `ends_at` | timestamptz null | null for date-only |
| `all_day_date` | date null | date-only option |
| `duration_minutes` | int | denormalized (ends - starts) or 1440 |
| `position` | int | creation order |
| `suggested_by_participant_id` | text null | stretch |
| `deleted_at` | timestamptz null | soft removal keeps history in activity |
| `created_at` | timestamptz | needed for "?" cells (option created after participant's last submit) |

Constraints: check exactly one of (`starts_at` and `ends_at`) or `all_day_date`; `ends_at > starts_at`; unique
`(poll_id, starts_at, ends_at)` where not deleted; index `(poll_id, starts_at)`.

`meeting_poll_participants`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `poll_id` | text FK cascade | |
| `name` | text | |
| `email` | text null | as entered |
| `email_normalized` | text null | lowercase trimmed |
| `user_id` | text null FK users | voter signed in to this app |
| `time_zone` | text null | |
| `locale` | text null | |
| `status` | poll_participant_status | |
| `source` | poll_participant_source | |
| `is_required` | boolean | default false |
| `subscribed_to_updates` | boolean | default false |
| `edit_token_hash` | text | SHA-256 |
| `invite_token_hash` | text null | invited rows |
| `email_verified_at` | timestamptz null | |
| `invited_at`, `responded_at`, `last_submitted_at` | timestamptz null | `last_submitted_at` drives "?" |
| `reminder_count` | int default 0 | |
| `last_reminded_at` | timestamptz null | |
| `unsubscribed_at` | timestamptz null | |
| `created_by_user_id` | text null | host added / vote on behalf |
| `ip_hash` | text null | abuse checks only |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes: unique `(poll_id, email_normalized)` where email not null and not deleted; `(poll_id, status)`;
unique `(edit_token_hash)`; unique `(invite_token_hash)`.

`meeting_poll_votes`: `participant_id` FK cascade, `option_id` FK cascade, `poll_id` (denormalized for counting),
`choice` poll_vote_choice, `created_at`, `updated_at`; PK `(participant_id, option_id)`; index `(poll_id, option_id, choice)`.
Store `no` rows explicitly when the voter submitted (so "no" differs from "no answer").

`meeting_poll_comments`: `id`, `poll_id` FK, `participant_id` null, `author_user_id` null (host), `author_name`,
`body` text, `visibility` (`public` \| `host_only`, derived at creation from poll visibility), `created_at`,
`deleted_at`, `deleted_by`.

`meeting_poll_holds`: `id`, `poll_id`, `option_id`, `user_id`, `calendar_connection_id`, `provider_calendar_id`,
`provider_event_id` null, `status` poll_hold_status, `last_error` null, `created_at`, `removed_at`.
Unique `(option_id, user_id)` where status in (`pending`, `active`).

`meeting_poll_activity`: `id`, `poll_id`, `type` poll_activity_type, `participant_id` null, `actor_user_id` null,
`data` jsonb, `created_at`; index `(poll_id, created_at)`. Feeds the activity feed, digests and "since" polling.

`meeting_poll_email_verifications`: `id`, `poll_id`, `email_normalized`, `code_hash`, `expires_at`, `attempts`,
`consumed_at`. (Could reuse the booking page's generic verification table if the foundation creates one.)

`poll_slug_redirects`: `old_slug` PK, `poll_id`, `expires_at`.

Reminders and other timed work use the shared `scheduled_jobs` table (types in Part E), not a poll-specific table.

---

# Part D: API surface

### D1. Internal routes (server actions or route handlers; mechanism per foundation conventions)

Host (session auth, owner or co-host):

| Operation | Method/path (if REST) | Notes |
|---|---|---|
| List polls | `GET /api/polls?status=&q=&cursor=` | B13 |
| Create poll | `POST /api/polls` | body: settings + options[]; returns poll + link |
| Get poll (admin) | `GET /api/polls/{id}` | full settings, options, participants (with emails), votes, comments, holds status |
| Results delta | `GET /api/polls/{id}/activity?since=` | live updates |
| Update settings | `PATCH /api/polls/{id}` | B14 rules |
| Add options | `POST /api/polls/{id}/options` | `{ options[], notifyParticipants }` |
| Remove option | `DELETE /api/polls/{id}/options/{optionId}` | confirm flag if votes exist |
| Invite | `POST /api/polls/{id}/invites` | `{ recipients[{name?, email, required?}], subject, message }` |
| Resend invite / remind | `POST /api/polls/{id}/participants/{pid}/remind`, `POST /api/polls/{id}/remind` | throttled |
| Vote on behalf / edit | `PUT /api/polls/{id}/participants/{pid}/votes` | emails participant |
| Add participant | `POST /api/polls/{id}/participants` | |
| Remove participant | `DELETE /api/polls/{id}/participants/{pid}` | |
| Mark required | `PATCH /api/polls/{id}/participants/{pid}` | |
| Close / reopen voting | `POST /api/polls/{id}/close`, `POST /api/polls/{id}/reopen-voting` | |
| Book preview (conflicts) | `GET /api/polls/{id}/options/{optionId}/booking-preview` | conflicts, default invitee list |
| Book | `POST /api/polls/{id}/book` | `{ optionId, invitees[], message, sendReminders }` |
| Reopen booked | `POST /api/polls/{id}/reopen` | |
| Duplicate | `POST /api/polls/{id}/duplicate` | copies settings and future options; title + " (copy)" (Doodle) |
| Export | `GET /api/polls/{id}/export.csv` | rows = participants, columns = options (host zone), Yes/If need be/No/blank, plus email, status, comment count |
| Delete | `DELETE /api/polls/{id}?notify=true&cancelMeeting=false` | |
| Clear holds | `POST /api/polls/{id}/holds/clear` | |
| Busy overlay for grid | `GET /api/polls/busy?start=&end=&hostIds=` | delegates to calendars module; returns busy blocks with titles for the caller only |

Public (no auth, token cookies):

| Operation | Path | Notes |
|---|---|---|
| Get poll for voter | `GET /api/public/polls/{slug}` | filtered by visibility; includes the caller's participant if edit cookie or invite token |
| Submit / update vote | `POST /api/public/polls/{slug}/responses` | `{ name, email?, timeZone, votes[{optionId, choice}], declined?, comment?, subscribe?, inviteToken?, verificationCode? }`; sets edit cookie |
| Request verification code | `POST /api/public/polls/{slug}/verify-email` | |
| Exchange magic link | `GET /p/{slug}?t=` | sets cookie, redirects |
| Comments | `GET/POST /api/public/polls/{slug}/comments`, `DELETE .../comments/{id}` | |
| Voter calendar check | `POST /api/public/polls/{slug}/freebusy` | body: provider auth code or ICS URL; returns busy per option; nothing stored |
| Unsubscribe | `GET /p/{slug}/unsubscribe?t=` | |
| ICS of final time | `GET /api/public/polls/{slug}/event.ics` | booked only; respects hidden mode (no attendee list) |

All write endpoints are idempotent where possible (client-generated `requestId` on vote submits to absorb double
clicks).

### D2. Calendly API parity (if the project exposes a Calendly-compatible `/api/v1`)

- `GET /event_types?user=` includes poll-backed event types with `"booking_method": "poll"`, `"type": "AdhocEventType"`,
  `"secret": true`, `"active": true` while the poll is open or closed and `false` after booked/canceled/expired,
  `"pooling_type": "collective"` with co-hosts, `scheduling_url` = poll link. Filter param `booking_method` is not part of
  Calendly's documented API; supporting it as an extension is harmless.
- Calendly's public API cannot create polls or list pending polls; ours may expose `/api/v1/meeting_polls` (read-only)
  as an extension, clearly marked non-Calendly.
- Booked poll meetings appear in `GET /scheduled_events` normally (event_type points to the poll's ad hoc type), with
  invitees listed under `/scheduled_events/{uuid}/invitees`.
- Webhooks: `invitee.created` per invitee at booking (and `invitee.canceled` on removal at rebook); extension events
  `poll.created`, `poll.vote_created`, `poll.vote_updated`, `poll.booked`, `poll.canceled` if the webhooks module allows
  custom events.

---

# Part E: Background jobs (shared `scheduled_jobs` table, `/api/cron` dispatcher)

| Job type | Scheduled for | Action | Idempotency key |
|---|---|---|---|
| `poll.deadline` | `deadline_at` | If still `open`: set `closed`, activity, email host (#11) | `poll:{id}:deadline:{deadline_at}` |
| `poll.deadline_warning` | `deadline_at - 24h` | Email host (#12) if responses < invited | `poll:{id}:deadline_warning:{deadline_at}` |
| `poll.expire` | max option start | If `open`/`closed` and all options past: `expired`, remove holds, email host (#13) | `poll:{id}:expire:{max_start}` |
| `poll.reminder` | per B11 | Send reminder to eligible invitees | `poll:{id}:reminder:{index}` |
| `poll.digest` | 08:00 owner zone daily | Digest email (#4) | `poll-digest:{userId}:{date}` |
| `poll.holds.sync` | immediate | Create/remove holds to match desired set | `poll:{id}:holds:{revision}` |
| `poll.notify` | immediate | Vote/comment notifications with batching (#3, #6, #7) | per activity id |
| `poll.booking.side_effects` | immediate | Conferencing, calendar write, invites, webhooks | `poll:{id}:booking:{scheduled_event_id}:{rev}` |
| `poll.purge` | daily | Hard-delete canceled polls older than 30 days | `poll-purge:{date}` |

Jobs are rescheduled (pending rows deleted and reinserted) whenever deadline, options or invite list change. Every
handler re-reads state and no-ops when no longer applicable. Lazy guards on read/write (deadline, expiry) make cron
latency harmless for correctness.

---

# Part F: Integration points, file ownership, tests

### F1. Dependencies on other modules (interfaces this module consumes)

| Module | Needed |
|---|---|
| Auth/session | `requireUser()`, current user, workspace users for co-host picker |
| Calendars | `getBusyIntervals(userIds, range)` (with event titles for the owner), `listEvents(range)` for the grid overlay, `createEvent/updateEvent/deleteEvent` on the "add to" calendar (holds and final event), one-shot free/busy for voter OAuth (Google FreeBusy, Graph getSchedule), ICS feed fetch |
| Event types | create/update an ad hoc event type with `booking_method = 'poll'` (C2), location editor component, color |
| Bookings / scheduled events | `createScheduledEventFromPoll({ eventTypeId, start, end, hosts, invitees, source: 'poll', pollId })`, `rescheduleScheduledEvent`, `cancelScheduledEvent`, conflict check `findAppConflicts(hosts, range)` |
| Conferencing | `createConference(location, event)` at booking |
| Email | `sendEmail(template, to, data, { ics })`, outbox fallback, unsubscribe link helper |
| ICS | ical-generator wrapper used by bookings (METHOD REQUEST/CANCEL, SEQUENCE) |
| Jobs | `enqueueJob(type, runAt, payload, idempotencyKey)`, `cancelJobs(prefix)` |
| Slot engine | treat `reserved` busy source from open polls with Reserve times (polls module exposes `getReservedIntervals(userIds, range)`) |
| Contacts | autocomplete, upsert contacts for voters/invitees on booking |
| Webhooks | `emitWebhook(event, payload)` |
| UI kit | Dialog, Popover, Tabs, Select, TimeZoneSelect (shared with the booking page), Toast |

### F2. Suggested file ownership (disjoint, for parallel agents)

- `src/db/schema/polls.ts` (designed in the foundation phase from Part C)
- `src/lib/polls/` pure logic: `ranking.ts`, `state.ts`, `reminders.ts` (schedule computation), `validation.ts`
  (zod schemas, limits), `visibility.ts` (redaction), `grid.ts` (wall-clock to instant, DST cells), `csv.ts`, plus
  `*.test.ts`
- `src/server/polls/` services: `create.ts`, `vote.ts`, `book.ts`, `holds.ts`, `notifications.ts`, `jobs.ts`
  (job handlers registered with the dispatcher), `queries.ts`
- `src/app/(app)/app/scheduling/polls/` list tab; `src/app/(app)/app/polls/new/`, `[pollId]/`, `[pollId]/edit/`
- `src/app/p/[slug]/` public voter page (+ `unsubscribe/`)
- `src/app/api/polls/**`, `src/app/api/public/polls/**`
- `src/components/polls/` (WeekGrid, MonthPicker, OptionList, AnswerToggle, ResultsGrid, TopTimes, BookDialog,
  InviteDialog, CommentsThread, CheckMyCalendar)
- `src/emails/polls/` templates
- `e2e/polls/*.spec.ts`

### F3. Test plan

Unit (Vitest, pure):

- Ranking: ties, required participants, if-need-be weighting, host conflicts, past options excluded, empty poll.
- State machine: every allowed and forbidden transition.
- Reminders: smart rule boundaries (lead exactly 2 days, exactly 5 days, under 2 days, with and without deadline),
  custom offsets, max 3, recomputation after deadline change.
- Visibility redaction: each mode returns exactly the allowed fields; emails never present.
- Capacity and max choices: concurrent-ish sequences, own selection on a full option, lowering limits.
- Grid conversions: DST gap and overlap in America/New_York and Europe/Berlin, crossing midnight, date-only options,
  copy-day across DST.
- Validation: limits table B16, slug rules, deadline rules.

Integration (Vitest + PGlite):

- Create poll with options; vote by link; duplicate-email protection; edit via token; decline; comments in each
  visibility mode; host vote on behalf; remove participant; add option shows "?" (unknown) for existing respondents.
- Book: scheduled event + invitees created, poll booked, holds removed, outbox has ICS emails, hidden poll produces
  individual invites; app conflict blocks; external conflict warns.
- Reopen and rebook to a different option updates the same scheduled event (SEQUENCE incremented).
- Jobs: deadline closes poll; expiry; reminders only for invited non-respondents.

E2E (Playwright, Chromium at /opt/pw-browsers):

- Host creates a poll by clicking 3 cells in the week grid (one overlapping), sets details, shares, copies link.
- Two voters in different `timezoneId`s vote (one with If need be), one edits later via the confirmation magic link from
  the DB outbox.
- Host sees Top times with Best badge, books the best, voter page shows "This meeting has been scheduled."
- Mobile viewport (390x844): vote flow with sticky footer.
- Accessibility smoke: axe check on the voter page and results grid.

---

# Part G: Open questions and recommendations

1. **C2 choice** (poll-backed ad hoc event type vs standalone) must be settled in the foundation schema; recommended C2
   for Calendly API parity and reuse of the bookings pipeline.
2. **Defaults**: we default to Calendly behavior (votes hidden, comments off) but If need be on. If the owner prefers a
   pure Calendly voter page, flip `allow_if_need_be` default to false; it is a one-line change.
3. **Option cap**: 100 (Rallly) instead of Calendly's 40, since the owner wants Doodle depth; UI stays usable because
   the list groups by date. Raise if needed; nothing in the model depends on it.
4. **Voter Google/Microsoft free/busy**: requires the same OAuth client as host sign-in, with the extra
   `calendar.freebusy` scope (Google) and `Calendars.Read` (Microsoft) requested incrementally only on the voter popup.
   Google may require app verification for sensitive scopes in production; the ICS-link fallback keeps the feature
   usable meanwhile.
5. **Who sends invites**: app-sent ICS (recommended) vs provider-sent; must match the bookings module's strategy.
6. **Holds for co-hosts** require each co-host to have a connected writable calendar; holds are skipped silently for
   those without one (shown in the results page hold status).
7. **Sign-up sheet mode** (multiple final options, each a separate meeting) is out of scope; the max-votes-per-option +
   one-choice settings cover simple sign-ups, but booking still produces one meeting.
8. **Recurring meetings** from a poll: out of scope (Doodle and Calendly don't support it either).
9. **Exact Calendly UI copy** for the share modal, results page headers and book dialog beyond the strings in A1.3 is
   unverified; the owner could capture screenshots of a test poll in their account to tighten pixel parity (the account
   currently has no polls).

---

# Part H: Source index

Calendly (first party):

- https://calendly.com/help/how-to-set-up-a-meeting-poll (updated 2026-09-17)
- https://calendly.com/help/meeting-polls-overview (updated 2026-08-24)
- https://calendly.com/blog/meeting-polls (2023-11-01)
- https://calendly.com/scheduling/meeting-polls
- https://api.urlscan.io/responses/4d8c2c4f6c0cc7d4c86138aaf249f0fd5ee9da24103e8aa0c286753ec5406806/ (captured Calendly booking bundle, English strings incl. `poll.*`)
- https://www.postman.com/calendlyapi/calendly-s-api-collection/request/qi9fmud/get-event-type
- https://developer.calendly.com/scopes

Calendly community and third-party walkthroughs:

- https://community.calendly.com/how-do-i-40/poll-link-notification-1324 (2024-04, vote email subject)
- https://community.calendly.com/how-do-i-40/meeting-polls-5220 (2026-01, Top Times hover)
- https://community.calendly.com/how-do-i-40/am-i-not-able-to-see-poll-results-if-the-meeting-has-been-booked-5900 (2026-07)
- https://community.calendly.com/how-do-i-40/edit-a-meeting-poll-remove-votes-1555 (2024-05)
- https://community.calendly.com/how-do-i-40/is-it-possible-to-change-the-times-i-selected-in-a-meeting-poll-1275 (2024-04)
- https://community.calendly.com/how-do-i-40/meeting-poll-how-can-my-entire-team-vote-971 (2024-02)
- https://community.calendly.com/api-webhook-help-61/pending-scheduled-events-and-creating-meeting-polls-via-api-1599 (2024-06)
- https://www.guideflow.com/tutorial/how-to-create-a-meeting-poll-in-calendly (2026-02)
- https://www.guideflow.com/tutorial/how-to-view-the-results-of-your-meeting-poll-in-calendly (2026-02)
- https://www.guideflow.com/tutorial/how-to-edit-your-meeting-poll-in-calendly
- https://trainn.co/tutorials/setup-calendly-meeting-poll/
- https://omls.oregon.gov/pipermail/libs-or/2023-November/021606.html (Reserve times and Show votes behavior)
- https://apis.io/schemas/calendly/calendly-event-type/
- https://raw.githubusercontent.com/api-evangelist/calendly/refs/heads/main/openapi/calendly-event-types-api-openapi.yml
- https://www.withone.ai/knowledge/calendly/conn%5Fmod%5Fdef%3A%3AGJ1CppwO9yE%3A%3ArkpPoQD3QdyIqQds80y1jA

Doodle (first party):

- https://help.doodle.com/en/collections/9572011-group-poll
- https://help.doodle.com/en/articles/9823082-introduction-to-group-poll
- https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll
- https://help.doodle.com/en/articles/9457352-how-do-i-invite-participants-to-my-group-poll
- https://help.doodle.com/en/articles/9669118-how-do-i-add-edit-or-delete-a-participant-from-my-group-poll
- https://help.doodle.com/en/articles/9457184-how-do-i-preview-my-group-poll
- https://help.doodle.com/en/articles/9457180-how-do-i-use-multiple-durations-with-group-poll
- https://help.doodle.com/en/articles/9457349-i-sent-my-group-poll-out-already-how-do-i-invite-more-participants
- https://help.doodle.com/en/articles/9457335-what-are-the-email-invitation-limits
- https://help.doodle.com/en/articles/9457342-how-do-i-select-the-final-option-for-my-group-poll
- https://help.doodle.com/en/articles/9457340-how-do-i-send-out-a-calendar-invitation-to-my-booked-group-poll
- https://help.doodle.com/en/articles/9457348-how-do-i-edit-my-group-poll
- https://help.doodle.com/en/articles/9457341-i-edited-my-group-poll-and-it-now-shows-question-marks-all-over-the-table
- https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden
- https://help.doodle.com/en/articles/9457379-how-do-automatic-reminders-for-group-poll-work
- https://help.doodle.com/en/articles/9457334-how-can-i-view-the-results-of-a-hidden-group-poll
- https://help.doodle.com/en/articles/9457345-is-it-possible-to-use-an-existing-group-poll-as-a-template-duplicate-a-group-poll
- https://help.doodle.com/en/articles/9457344-how-do-i-export-a-group-poll-to-excel
- https://help.doodle.com/en/articles/9457343-how-does-the-if-need-be-group-poll-response-work
- https://help.doodle.com/en/articles/9457276-how-do-i-vote-if-need-be-in-a-group-poll
- https://help.doodle.com/en/articles/9457279-how-do-i-participate-in-a-group-poll
- https://help.doodle.com/en/articles/9457214-how-do-i-change-my-votes-in-a-group-poll
- https://help.doodle.com/en/articles/9457332-how-do-i-find-my-poll-invite-list-and-poll-responses
- https://help.doodle.com/en/articles/9457215-how-can-i-verify-that-someone-participated-in-my-group-poll
- https://help.doodle.com/en/articles/9457330-what-is-the-maximum-group-poll-size
- https://help.doodle.com/en/articles/9457337-how-long-does-doodle-keep-group-polls-until-when-will-my-group-poll-be-available
- https://help.doodle.com/en/articles/9457333-how-can-i-subscribe-unsubscribe-to-e-mail-notifications-for-a-group-poll
- https://help.doodle.com/en/articles/9457347-i-lost-my-admin-link-can-you-send-it-to-me-again
- https://help.doodle.com/en/articles/10295132-group-poll-troubleshooting-and-faq
- https://help.doodle.com/en/articles/9457272-which-doodle-events-will-sync-to-my-connected-calendar
- https://help.doodle.com/en/collections/9572016-participation
- https://help.doodle.com/en/articles/9457322-how-do-i-create-a-booking-page
- https://help.doodle.com/en/articles/9983223-introduction-to-booking-page
- https://help.doodle.com/en/articles/9457375-how-to-use-booking-intervals-and-buffer-times-with-booking-page
- https://help.doodle.com/en/articles/9457376-how-to-manage-your-booking-page-settings-from-the-doodle-dashboard
- https://help.doodle.com/en/articles/9716984-how-do-i-participate-in-a-booking-page
- https://help.doodle.com/en/articles/10300817-booking-page-troubleshooting-and-faq
- https://doodle.com/en/resource/how-to/guide-to-booking-page/
- https://doodle.com/en/group-calendar/
- https://doodle.com/en/poll-maker/

Classic Doodle (third party):

- https://requests.ursinus.edu/TDClient/1943/requests-ursinus-edu/KB/Article/131153/Online-Appointment-Scheduling-Doodle
- https://www.calendar.com/blog/doodle-poll/
- https://suefrantz.com/2016/01/28/doodle-make-a-choice/
- https://www.makeuseof.com/tag/use-doodle-polls-to-schedule-events-and-make-choices-within-groups/

Microsoft Scheduling Poll:

- https://support.microsoft.com/en-us/outlook/create-a-scheduling-poll-in-outlook-for-windows
- https://support.microsoft.com/en-us/outlook/scheduling-poll-organizer-dashboard
- https://support.microsoft.com/en-us/outlook/scheduling-poll-voting
- https://support.microsoft.com/en-us/outlook/find-the-best-meeting-time-for-everyone-with-outlook-scheduling-poll

Rallly:

- https://rallly.co/
- https://github.com/lukevella/Rallly
- https://support.rallly.co/api-reference/polls/create-a-poll

Owner account (observed via Calendly API, 2026-10-11): user `julianjoseph`, 3 instant event types, no polls.
