# Google OAuth app verification

This is the submission kit for Google's OAuth app verification of this deployment
(https://julendly.vercel.app, app name **Julendly**). It holds the text to paste into Google's forms, the
scope justifications with the code that uses each scope, the data handling statement, the demo video shot list and
the Search Console steps. Sections marked **Paste** are written for Google's reviewer; everything else is for you.

## Why Google shows "Google hasn't verified this app"

The warning is not about certificates: the site already uses HTTPS with Vercel's certificate. Google shows it whenever
an app that Google has not verified asks for a "sensitive" permission. Julendly asks for three of them (the two calendar
permissions and Gmail send).

Since this change, an everyday **Continue with Google** on the login page asks only for your name, email address and
profile picture (`openid`, `email`, `profile`). Those are not sensitive, so the warning no longer appears when you sign
in. Your stored Google connection is left exactly as it is: bookings, busy times, calendar sync and Gmail sending keep
working with the permission you gave when you connected.

You still see the warning, until Google approves the app, when you go through the full consent screen on purpose:
**+ Connect calendar account**, any **Reconnect** (Calendar settings, the dashboard banner, the Google Calendar
integration page that the email outbox's **Reconnect Google** link opens) and **Allow Gmail sending**. Meeting poll
voters who click **Check my calendar** > **Google Calendar**, and booking page visitors who click **Compare with my
calendar** > **Connect Google Calendar**, may see it too. Verification removes it everywhere.

What each Google flow asks for (`src/lib/auth/oauth/google.ts`, `googleAccessFor`):

| Flow | Scopes | Google prompt |
|---|---|---|
| Log in, add Google as a login method, accept an invitation | `openid email profile` | `select_account`, no offline access |
| Sign up with Google, connect a calendar, every Reconnect, Allow Gmail sending | the 6 scopes below | `consent`, offline access, `include_granted_scopes` |
| Meeting poll voter: Check my calendar | `openid email calendar.freebusy` | `select_account`, no offline access |
| Booking page visitor: Compare with my calendar | `openid email calendar.freebusy calendar.calendarlist.readonly` | `select_account`, no offline access |

## Before you submit

Open https://console.cloud.google.com/auth and select the project of the OAuth client.

1. **Branding**
   - App name: `Julendly` (it must match the name on the home page; the home page uses `NEXT_PUBLIC_APP_NAME`, default
     Julendly).
   - User support email and developer contact email: your email.
   - Application home page: `https://julendly.vercel.app/`
   - Application privacy policy link: `https://julendly.vercel.app/privacy`
   - Application terms of service link: `https://julendly.vercel.app/terms`
   - Authorized domains: `julendly.vercel.app`
   - An app logo is optional. Uploading one adds a brand review step; leave it empty unless you want the logo on the
     consent screen.
2. **Domain ownership**: verify `https://julendly.vercel.app/` in Search Console (see the last
   section) with a Google account that is an Owner or Editor of this Cloud project.
3. **Data access**: the list must contain exactly these, and nothing else:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.freebusy` (used by meeting poll voters and booking page visitors; add it
     with **Manually add scopes** if it is missing)
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (used by booking page visitors who compare their
     calendar; add it with **Manually add scopes**)
4. **Audience**: External, In production (already the case).
5. Check the home page signed out (a private window): https://julendly.vercel.app/ shows the Julendly
   logo and name, what the app is, a Sign in button, the "How it uses Google" paragraph and the Privacy Policy and
   Terms links.
6. Record and upload the demo video (below) to YouTube as **Unlisted**.
7. Open **Verification Center** and click **Prepare for verification** (or **Submit for verification**), then paste the
   texts below into the matching fields.

## Paste: app purpose

> Julendly is a personal scheduling site run by one person, its owner, for their own meetings (a self-hosted
> alternative to Calendly). People open the owner's public booking page, pick a free time and book a meeting; the
> owner also sends meeting polls where people vote on proposed times. Only the owner signs in; invitees and poll voters
> never need an account.
>
> The owner connects their own Google account so the site can: (1) read the owner's Google Calendar busy times, so
> invitees are only offered times that are actually free and the owner can see why a time is blocked; (2) add each
> booked meeting to the owner's calendar with a Google Meet link and the invitee as a guest, and update or remove it
> when the meeting is rescheduled or canceled, and notice when the owner moves or deletes that event in Google
> Calendar; (3) send the booking emails (confirmations, reminders, reschedule and cancellation notices) from the
> owner's own Gmail address. Separately, a meeting poll voter may choose "Check my calendar" to compare their own
> Google Calendar's free/busy times with the proposed times once; that token is used for a single request, revoked and
> never stored. Likewise, a visitor on a booking page may choose "Compare with my calendar" to see which of the owner's open
> times clash with their own Google Calendar: they pick which of their calendars to compare (calendar list) and the
> app reads only their free/busy times; their access token stays encrypted in their own browser for at most an hour
> and is never stored on the server.
>
> Signing in to the site only asks for openid, email and profile. The calendar and Gmail permissions are requested
> only when the owner connects or reconnects their calendar.

## Paste: scope justifications

Google's "accepted scopes" lists below come from the Google Calendar API v3 and Gmail API v1 discovery documents
(revisions 20261009 and 20261012).

### openid, email, profile (`.../auth/userinfo.email`, `.../auth/userinfo.profile`)

> Used to sign the owner in with Google. The app reads the id token's subject, email address and its verified flag to
> find the owner's account (by Google account id, or by verified email the first time), and the name and profile
> picture to fill in a new account's name and photo. These are the minimum sign-in scopes; the everyday sign-in
> requests nothing else.

Code paths:
- `src/lib/auth/oauth/google.ts`: `GOOGLE_SIGN_IN_SCOPES`, `googleProfileFromIdToken` (claims `sub`, `email`,
  `email_verified`, `name`, `picture`, `hd`).
- `src/lib/auth/oauth/flow.ts`: `handleOAuthStart`, `handleOAuthCallback` (code exchange with PKCE, id token decode).
- `src/lib/auth/flows/oauth-accounts.ts`: `resolveOAuthLogin` (match by subject in `oauth_accounts`, else verified
  email), `adoptProviderAvatar`, `signupFields`.
- `src/lib/auth/oauth/intents.ts`: `dispatchOAuthIntent` (a login never touches the calendar connection).

### https://www.googleapis.com/auth/calendar.events

> Used to write the owner's meetings to their own Google Calendar and to read the events that make the owner busy.
> When an invitee books, the app creates an event on the calendar the owner chose ("Calendar to add events to") with
> the invitee as a guest and a Google Meet link (events.insert with conferenceData), updates it on reschedule
> (events.patch), deletes it on cancellation (events.delete), and re-reads its own events (events.get) to apply
> changes the owner makes in Google Calendar (moving the event reschedules the meeting, deleting it cancels it). It
> lists events (events.list) on the calendars the owner checks for conflicts, to compute free times and to explain in
> the owner's Troubleshoot view which event (by title) blocks a time, and subscribes to change notifications
> (events.watch, channels.stop) so those changes show up quickly.
>
> Why not a narrower scope: calendar.events.owned only covers calendars the owner owns, but the destination can be a
> calendar shared with the owner with edit rights, and conflict calendars include calendars shared with the owner
> read only (for example a family calendar); calendar.app.created only covers calendars created by the app;
> calendar.events.readonly and calendar.events.freebusy cannot create the meeting event or its Meet link, and
> free/busy alone has no event titles or the app's own event ids, which the Troubleshoot view and the move and delete
> detection need. We do not request the full calendar scope: the app never changes calendar settings, sharing or
> calendars themselves.

Code paths:
- `src/lib/calendars/providers/google.ts`: `createEvent` (POST `calendars/{id}/events`, `conferenceDataVersion=1`,
  `conferenceData.createRequest` with `hangoutsMeet`), `updateEvent` (PATCH), `deleteEvent` (DELETE), `getEvent`
  (GET), `listEvents` (GET `calendars/{id}/events`, `singleEvents=true`), `watchEvents` (POST
  `calendars/{id}/events/watch`), `stopChannel` (POST `channels/stop`).
- `src/lib/calendars/linked-events.ts`: `upsertLinkedEvent`, `deleteLinkedEvent` (one event per meeting, buffer
  events when "Include buffers on this calendar" is on).
- `src/lib/calendars/busy.ts`: the busy cache that feeds the slot engine, booking pages and Troubleshoot.
- `src/lib/calendars/sync.ts`: `syncBookedEvents` (host-side moves and deletes, CAL-14).
- `src/lib/calendars/watch.ts`: `ensureWatchChannels`, `handleGooglePush`.
- `src/lib/calendars/connections.ts`: `GOOGLE_CALENDAR_SCOPES`, `hasGoogleCalendarScopes` (a grant without this scope
  is refused with "permissions" and the owner is asked to connect again).

### https://www.googleapis.com/auth/calendar.readonly

> Used for the two calendar reads that events access does not cover. (1) The calendar list (calendarList.list): the
> owner picks which of their calendars to check for conflicts and which calendar receives new meetings, on the
> Calendar settings page, and the app learns each calendar's name, color, time zone and access level (it refreshes this
> list in the background so removed calendars stop being used). (2) Free/busy (freebusy.query) for calendars that
> other people shared with the owner as "See only free/busy" (for example a work calendar shared into the owner's
> personal account): their event details cannot be read, so their busy blocks come from the free/busy API, and those
> times must still be unavailable to invitees.
>
> Why this scope: it is read only. Together with calendar.events, which already allows reading the events of every
> calendar the owner can see, it only adds read access to the calendar list, calendar properties and free/busy; it
> grants no write access of any kind.

Code paths:
- `src/lib/calendars/providers/google.ts`: `listCalendars` (GET `users/me/calendarList`,
  `minAccessRole=freeBusyReader`), `listBusy` (POST `freeBusy`, batched, for free/busy only calendars).
- `src/lib/calendars/connections.ts`: `connectGoogleAccount`, `syncCalendarList`, `applyCalendarList`.
- `src/lib/calendars/access.ts` (free/busy only calendars), `src/lib/calendars/busy.ts` (reads them with `listBusy`).
- `src/lib/calendars/connections.ts`: `GOOGLE_CALENDAR_SCOPES` (required together with calendar.events).

For you, not for pasting: Google also accepts narrower scopes for these two calls (`calendar.calendarlist.readonly`
for the calendar list, `calendar.events.freebusy` for free/busy). A reviewer may ask why the app does not use them. If
that happens, the code change is to replace `calendar.readonly` in `GOOGLE_SCOPES` (`src/lib/auth/oauth/google.ts`)
and `GOOGLE_CALENDAR_SCOPES` (`src/lib/calendars/connections.ts`) with those two, update the Data access list, deploy,
and reconnect your calendar once; ask for it as a separate task.

### https://www.googleapis.com/auth/gmail.send

> Used only to send the booking emails from the owner's own Gmail address: invitee confirmations with the calendar
> invitation, reminders before the meeting, reschedule and cancellation notices, and the owner's own new booking and
> cancellation notices. Each email is one users.messages.send call with a message the app composed. The app never
> reads, lists, searches, modifies or deletes mail.
>
> Why not a narrower scope: gmail.send is the narrowest scope that allows users.messages.send (the alternatives,
> gmail.compose, gmail.modify and mail.google.com, all add access to drafts or the mailbox). The owner can turn Gmail
> sending off in the app; emails then stay in the app's outbox.

Code paths:
- `src/lib/integrations/google/scopes.ts`: `GMAIL_SEND_SCOPE`, `hasGmailSendScope`.
- `src/lib/email/gmail-transport.ts`: POST `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` (and the
  `upload/gmail/v1/users/me/messages/send?uploadType=media` endpoint for messages above 4 MB).
- `src/lib/email/gmail-mime.ts` (builds the message), `src/lib/email/gmail-sender.ts` (`ownerGoogleConnections`,
  `pickGmailConnection`: sends only from a connection that granted gmail.send), `src/lib/email/send.ts` (the outbox).
- `src/lib/email/gmail-view.ts`: the "Send emails from your Gmail" card and its switch (Integrations > Google
  Calendar).

### https://www.googleapis.com/auth/calendar.freebusy

> Used only on a meeting poll's voting page, when a voter chooses "Check my calendar" > "Google Calendar". The app
> calls freebusy.query for the voter's primary calendar over the poll's proposed times (one request per 60 days they
> span), marks each proposed time "Free" or "Conflict" for the voter, and revokes the token immediately. No refresh
> token is requested (no offline access), nothing about the voter's calendar is stored on the server, and the result
> (free, busy or unknown per proposed time, never event details) lives in a browser cookie for 30 minutes.
>
> Why not a narrower scope: this is the narrowest scope freebusy.query accepts for the voter's own calendar ("View your
> availability in your calendars"); it shows no event titles or details.

Code paths:
- `src/lib/auth/oauth/google.ts`: `GOOGLE_FREEBUSY_SCOPES`, `googleAccessFor("poll_freebusy")`.
- `src/lib/polls/voter-oauth.ts`: `handleVoterFreeBusyCallback` (uses the token, then `revokeGoogleToken`).
- `src/lib/polls/freebusy.ts`: `googleBusy` (POST `https://www.googleapis.com/calendar/v3/freeBusy`, `items: [{ id:
  "primary" }]`), `appendCheckCookie`.
- `src/components/polls/voter/calendar-check.tsx`: the "Check my calendar" popover.

The same scope also serves the booking page's "Compare with my calendar" (next section): freebusy.query for the
calendars the visitor picks, over the month on screen.

### https://www.googleapis.com/auth/calendar.calendarlist.readonly

> Used only on a public booking page, when a visitor chooses "Compare with my calendar" > "Connect Google Calendar". The
> app reads the visitor's calendar list (calendarList.list with minAccessRole=freeBusyReader: each calendar's id, name
> and color, and whether it is primary or shown in their Google Calendar) so the visitor can pick which of their
> calendars to compare. It then calls freebusy.query (calendar.freebusy) for the picked calendars over the month on
> screen and marks the owner's open times that overlap as "Conflict". No refresh token is requested (no offline
> access). The visitor's access token is encrypted (AES-256-GCM) into an httpOnly cookie in the visitor's own browser,
> sent only to the compare endpoints, and expires with the token (at most one hour); "Disconnect" deletes it. Nothing
> about the visitor's calendars is stored on the server: the list and the busy times (start and end only, merged
> across calendars) are passed straight back to the visitor's browser.
>
> Why not a narrower scope: this is the narrowest scope that lists a user's calendars; calendar.readonly and
> calendar.events would also expose events. Without it the visitor could only compare their primary calendar.

Code paths:
- `src/lib/auth/oauth/google.ts`: `GOOGLE_COMPARE_SCOPES`, `googleAccessFor("compare_calendar")`.
- `src/lib/compare/oauth.ts`: `handleCompareCallback` (seals the token into the visitor's cookie, writes nothing).
- `src/lib/compare/session.ts`: the sealed cookie (`kairos_compare`, path `/api/public/compare`, at most 1 hour).
- `src/lib/compare/google.ts`: `listCompareCalendars` (GET `users/me/calendarList`), `compareBusy` (POST `freeBusy`).
- `src/app/api/public/compare/route.ts`, `src/app/api/public/compare/busy/route.ts`: the endpoints the page calls.
- `src/components/booking/compare-bar.tsx`: the "Compare with my calendar" panel.

## Paste: data handling and retention

> Who: the site has one account holder, the owner. Google user data comes from the owner's own Google account, plus a
> one-time free/busy read for poll voters who choose it, and a free/busy and calendar list read for booking page
> visitors who choose "Compare with my calendar".
>
> Storage and protection: the owner's Google OAuth access and refresh tokens are stored encrypted (AES-256-GCM) in the
> app's Postgres database (Neon) and are decrypted only on the server (Vercel) to call Google; they are never sent to
> a browser. Sign-in stores only the Google account id and email address to recognize the owner, and the name and
> profile picture on the owner's profile. Poll voter tokens are used for one request, revoked and never stored. A booking page visitor's compare token is
> kept only in that visitor's browser, encrypted, for at most an hour, and never stored on the server.
>
> What is kept and for how long: the owner's calendar list (names, colors, time zones, access levels) until the owner
> disconnects the calendar; a cache of the owner's events on the calendars checked for conflicts (start, end, title,
> free or busy, status), refreshed every few minutes and deleted when not refreshed for 7 days; the ids of the events
> the app created, kept with the meeting record. Emails sent through Gmail are recorded in the app's outbox; their
> bodies are deleted after 30 days and the records after 90 days. Gmail is never read.
>
> Use: Google data is used only to schedule the owner's meetings: to offer free times, write the meetings to the
> owner's calendar, and send the booking emails. Event titles are shown only to the owner; invitees see only the free
> times. It is never sold, never used for advertising, never shared with anyone else, and never used to train AI or
> machine learning models. The use of information received from Google APIs adheres to the Google API Services User
> Data Policy, including the Limited Use requirements.
>
> Deletion: disconnecting the calendar in the app deletes the stored tokens, the calendar list and the cached events,
> and revokes the token at Google. The owner can also revoke access at https://myaccount.google.com/permissions.
> Invitees can ask the owner to delete their data by replying to any booking email (privacy policy:
> https://julendly.vercel.app/privacy).

Code paths behind these statements: `src/lib/calendars/credentials.ts` (encryption, `encryptedTokenColumns`),
`src/lib/crypto.ts`, `src/lib/jobs/cleanup.ts` (`RETENTION.externalCacheDays` 7, `outboxBodyDays` 30, `outboxRowDays`
90), `src/lib/calendars/connections.ts` (`disconnectConnection`, `REVOKE_JOB`), `src/lib/polls/voter-oauth.ts`,
`src/lib/polls/constants.ts` (`FREEBUSY_COOKIE_MAX_AGE_SECONDS` = 30 minutes), `src/app/(marketing)/privacy/page.tsx`.

## Demo video script

Google wants one continuous screen recording, in English, that shows the app, the whole consent flow and every scope
in use. Record at 1080p in a desktop browser, keep the address bar visible the whole time, narrate or add captions,
and upload it to YouTube as Unlisted. About 4 to 6 minutes. Do it in a normal browser window where you are signed in
to Google, and use a private window only for the poll voter shot.

1. **Home page.** Open `https://julendly.vercel.app/` signed out. Show the app name (Julendly), the
   sentence about what the app does, the "How it uses Google" paragraph, and the Sign in button. Say: "This is the app's home page on the app's domain."
2. **Privacy policy.** Click **Privacy Policy** in that paragraph. Scroll to "Google data" (what is read, the Limited
   Use statement). Go back and show **Terms of Service** briefly.
3. **Sign in.** Click **Sign in**, then **Continue with Google**. On Google's page, zoom into the address bar to show
   `accounts.google.com` with `client_id=...apps.googleusercontent.com` and `scope=openid email profile`. Pick your
   account. Say: "Signing in asks only for name, email and profile." You land on Scheduling.
4. **Consent screen with every scope.** Open **Availability > Calendar settings**, open the options menu (three dots)
   of your Google account and click **Reconnect** (or **+ Connect calendar account** > **Google Calendar**). On Google's page, show the address bar
   again (`client_id`, the scopes `calendar.events`, `calendar.readonly`, `gmail.send`). If the "Google hasn't verified
   this app" screen appears, click **Advanced** > **Go to Julendly (unsafe)**. On the consent screen, read out each
   permission (see, edit, share and delete events; see your calendars; send email on your behalf), leave them checked
   and click **Continue**. You return to Calendar settings with the account connected.
5. **calendar.readonly in use: the calendar list.** On Calendar settings, click **Edit** on "Calendars to check for
   conflicts" to show the list of your Google calendars (including a "Free/busy only" calendar if you have one), then
   show "Calendar to add events to". Say: "This list comes from the calendar list read."
6. **calendar.events and calendar.readonly in use: busy times.** Open **Availability**, click **Troubleshoot**, pick a
   day that has an event in Google Calendar. Show a time marked with the conflicting Google Calendar event by its
   title, and, if you have one, a "Busy (calendar name)" block from a free/busy only calendar. Say: "Busy times from the
   owner's calendars block these times."
7. **calendar.events in use: a booking creates the event with a Meet link.** In a second tab, open your booking page
   (`/julianjoseph`), pick **30 Minute Virtual**, a free time, enter a test invitee (an address you control) and click
   **Schedule Event**. Then open Google Calendar (calendar.google.com) at that time and open the new event: show the
   title, the invitee as a guest and the **Join with Google Meet** link. Optionally move the event in Google Calendar
   and show the meeting rescheduled in **Meetings**.
8. **gmail.send in use: the confirmation email.** Back in the app, open **Settings > Email outbox**. Show the
   confirmation email of that booking with status Sent through Gmail, and open its preview. Optionally show the same
   message in your Gmail **Sent** folder and the invitee's inbox. Then open **Integrations > Google Calendar** and show
   the "Send emails from your Gmail" card ("Sending emails from ...", the on/off switch).
9. **calendar.freebusy in use: the poll voter check.** In the app, open a meeting poll (Scheduling > Meeting polls, or
   create one with a few proposed times) and copy its link. Open the link in a private window (not signed in to the
   app). Click **Check my calendar** > **Google Calendar**, sign in with a DIFFERENT Google account than the owner's (never julian88tex@gmail.com: the check revokes its token afterwards),
   show the address bar (`client_id`, `scope=openid email https://www.googleapis.com/auth/calendar.freebusy`) and the
   consent screen, allow it, and show the proposed times marked **Free** or **Conflict**. Say: "The voter's free/busy
   is read once; nothing is stored."
10. **calendar.calendarlist.readonly in use: the booking page compare.** In the same private window, open your
    booking page (`/julianjoseph/30min`) and click **Compare with my calendar** > **Connect Google Calendar**. Sign in
    with the same test account, show the address bar (`scope=openid email ...calendar.freebusy
    ...calendar.calendarlist.readonly`) and the consent screen, allow it, and show "Comparing with {account}", the list
    of that account's calendars with checkboxes, and a day whose times read **Conflict**. Untick a calendar to show the
    conflicts change, then click **Disconnect**. Say: "Only the calendar names and busy times are read, to mark the
    clashing times; the access stays in the visitor's browser for at most an hour and nothing is stored."
11. **Ending.** Do not click **Disconnect** on the live account: it deletes the calendar choices, stops Gmail sending
    and detaches existing bookings from their Google events, and Reconnect does not restore them.

## Verify the domain in Search Console (URL prefix, HTML tag)

1. Open https://search.google.com/search-console with a Google account that is an Owner or Editor of the Google Cloud
   project (your own account).
2. Click the property picker > **Add property** > **URL prefix**, enter `https://julendly.vercel.app/`
   and click **Continue**.
3. Under **Other verification methods**, open **HTML tag**. Search Console shows
   `<meta name="google-site-verification" content="..." />`. Copy only the `content` value.
4. In this repository, open `src/lib/site-verification.ts` and set it:
   `export const GOOGLE_SITE_VERIFICATION: string | null = "THE_CONTENT_VALUE";`
   The root layout then renders that meta tag on every page, the home page included.
5. Deploy it: commit the change on `main` with `[deploy]` in the commit message (docs/STATUS.md, "How
   releases work") and wait for the Vercel deployment to finish.
6. Check that the tag is live: open `view-source:https://julendly.vercel.app/` and search for
   `google-site-verification`, or run
   `curl -s https://julendly.vercel.app/ | grep google-site-verification`.
7. Back in Search Console, click **Verify**. Leave the tag in place afterwards: Search Console checks it again from time
   to time, and removing it unverifies the property.

The repository also contains `public/google7cae62986c9a7502.html`, which serves Search Console's **HTML file** method
at `https://julendly.vercel.app/google7cae62986c9a7502.html`. If that file came from this property's
verification page, choosing **HTML file** > **Verify** works as well; the meta tag is a second method that does not
depend on that file.

## After you submit

- Google replies by email to the developer contact address, sometimes with questions; answer from the same thread.
  Typical asks are a clearer video moment for one scope, or the narrower calendar scopes noted above.
- Until approval nothing changes for you: sign-in has no warning, and the warning on Reconnect and Allow Gmail sending
  stays until Google approves.
- If you later add or change scopes, the app has to be verified again for the new ones.
