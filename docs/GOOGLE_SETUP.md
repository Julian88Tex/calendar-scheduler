# Google Calendar setup

Kairos uses one Google OAuth client for everything Google: "Continue with Google" sign in, checking your Google
Calendar for conflicts, adding booked meetings to your calendar with a Google Meet link, and picking up meetings you
move or delete in Google Calendar. This guide creates that client in Google Cloud and connects it to Kairos, locally
and on Vercel. It takes about 15 minutes.

You need:

- A Google account (a personal Gmail account works; a Google Workspace account works too).
- The address your app runs on: `http://localhost:3000` locally, and your production address on Vercel, for example
  `https://kairos.example.com` or `https://your-project.vercel.app`. Below, `YOUR_APP_URL` means that production
  address, without a trailing slash.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in.
2. Click the project picker at the top of the page, then **New project**.
3. Name it (for example "Kairos"), leave the organization as is, and click **Create**.
4. Make sure the new project is selected in the project picker before you continue.

## 2. Enable the Google Calendar API

1. Open **APIs & Services > Library** (or <https://console.cloud.google.com/apis/library>).
2. Search for **Google Calendar API**, open it and click **Enable**.

Google Meet links are created through the Calendar API, so no other API is needed. If you skip this step, connected
calendars show "Error" with the message that the Google Calendar API is not enabled.

## 3. Configure the OAuth consent screen

Open **Google Auth Platform** (APIs & Services > OAuth consent screen). If Google asks you to get started, click
**Get started** and fill in the wizard; the same settings live in the Branding, Audience and Data access pages.

1. **Branding**
   - App name: the name your users see on Google's consent screen (for example "Kairos").
   - User support email: your email.
   - App home page: `YOUR_APP_URL`.
   - Authorized domains: add the domain of `YOUR_APP_URL` (for a Vercel address, the full project domain such as
     `your-project.vercel.app`).
   - Developer contact email: your email. Save.
2. **Audience**
   - User type **External** lets any Google account sign in (needed for Gmail accounts).
   - User type **Internal** is available only inside a Google Workspace organization and limits access to its members;
     it needs no verification.
3. **Data access**: click **Add or remove scopes** and add exactly these:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/calendar.events` (see, edit, share and delete events)
   - `https://www.googleapis.com/auth/calendar.readonly` (see your calendars)

   Save. The two calendar scopes are "sensitive" scopes.
4. **Test users** (Audience page, while the app is in Testing): add every Google account that will sign in or connect a
   calendar, starting with your own.
5. **Publishing status** (Audience page). Important:
   - While the app is in **Testing**, Google expires its refresh tokens after 7 days. Your calendar connection would
     then show "Action required" every week until you reconnect.
   - For your own deployment, click **Publish app** to move it to **In production**. Without Google's verification,
     the consent screen shows "Google hasn't verified this app"; choose **Advanced > Go to {app name} (unsafe)** to
     continue. Unverified apps with sensitive scopes are limited to 100 users, which is plenty for personal use.
   - If other people will use your deployment, submit the app for verification from the same page.

## 4. Create the OAuth client

1. Open **Google Auth Platform > Clients** (APIs & Services > Credentials) and click **Create client** (Create
   credentials > OAuth client ID).
2. Application type: **Web application**. Name: for example "Kairos web".
3. **Authorized JavaScript origins** (optional, harmless):
   - `http://localhost:3000`
   - `YOUR_APP_URL`
4. **Authorized redirect URIs** (required, must match exactly, no trailing slash):
   - `http://localhost:3000/api/auth/google/callback`
   - `YOUR_APP_URL/api/auth/google/callback`
5. Click **Create** and copy the **Client ID** and **Client secret**. Keep the secret private.

The same redirect URI serves sign in and calendar connections. Kairos always builds it from `APP_URL` (or the Vercel
production domain), never from a per-deployment URL.

## 5. Configure Kairos

### Locally

Add to `.env.local` in the project folder, then restart `npm run dev`:

```
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
APP_URL=http://localhost:3000
```

### On Vercel

Open your project on Vercel, then **Settings > Environment Variables**, and add for the **Production** environment:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 4 |
| `APP_URL` | `YOUR_APP_URL` (recommended; otherwise the Vercel production domain is used) |
| `ENCRYPTION_KEY` | a long random string, for example the output of `openssl rand -base64 32` |
| `CRON_SECRET` | a long random string (background jobs, see below) |

Redeploy (Deployments > the latest deployment > Redeploy) so the new variables take effect.

`ENCRYPTION_KEY` encrypts the stored Google tokens. Keep it stable: changing it later makes the stored tokens
unreadable, and every calendar has to be reconnected. Without it, the app generates a key and stores it in the
database.

### Preview deployments

Google only accepts redirect URIs registered in advance, and every Vercel preview deployment has its own address.
Either test Google features on production only, or give the Preview environment a stable address: set `APP_URL` for
Preview to your branch URL (for example `https://your-project-git-main-you.vercel.app`) and register
`https://your-project-git-main-you.vercel.app/api/auth/google/callback` as an extra redirect URI.

## 6. Connect your calendar

- **Sign in with Google**: on the login or signup page, click **Continue with Google**. Signing in also connects that
  Google account's calendar: the primary calendar is checked for conflicts and becomes the calendar new meetings are
  added to.
- **Or connect it later**: open **Availability > Calendar settings**, click **+ Connect calendar account**, then
  **Google Calendar**. You can connect several Google accounts this way.

On Google's consent screen, keep both calendar permissions checked. If you uncheck them, Kairos explains what is
missing and asks you to connect again.

Then, on **Availability > Calendar settings**:

- **Calendars to check for conflicts**: click **Edit** and check every calendar whose events should block your
  availability (for example a shared family or team calendar).
- **Calendar to add events to**: the calendar booked meetings are written to, with the invitee as a guest and a
  Google Meet link when the event type's location is Google Meet. Google sends the invitation to your invitee.
- **Sync settings** of that calendar: "Include buffers on this calendar" adds your before and after buffers as
  "Buffer: ..." busy events; "Automatically sync cancellations and reschedules" (on by default) makes deleting a
  meeting's event in Google Calendar cancel the meeting and moving it reschedule the meeting, with the usual emails to
  your invitees.

## How Kairos reads your Google Calendar

- Busy events block time; events marked **Free** do not. Invitations you declined do not block; invitations you
  accepted, tentatively accepted or have not answered do.
- **Out of office** events always block. **Working location** entries never block.
- **All-day events** marked **Busy** block the whole day in your schedule's time zone (a multi-day event blocks every
  day it covers). Google Calendar creates all-day events as **Free**, so an all-day event blocks nothing until you set
  its "Show as" to **Busy** (the same as in Calendly).
- Overlapping events are merged. Events Kairos created itself (your meetings and their buffers) are recognized and
  never counted twice.
- Busy times are read when an invitee opens your booking page (cached for 3 minutes, `CALENDAR_CACHE_TTL_SECONDS`) and
  checked again, at most 60 seconds old, right before a booking is confirmed. If Google cannot be reached, the last
  data younger than 24 hours is used; without any, your times are not offered (safer than a double booking).
- The Troubleshoot view on the Availability page shows which Google event (by title) blocked a time.

## Changes you make in Google Calendar

Kairos notices moved and deleted meeting events in two ways:

- **Push notifications**: on a public `https` address (your production URL), Kairos asks Google to notify
  `YOUR_APP_URL/api/webhooks/calendars/google` whenever a watched calendar changes, so changes show up within seconds.
  Nothing to configure. Previews protected by Vercel Authentication cannot receive them (Google is not logged in to
  Vercel); they rely on the periodic check below. If Google refuses to open notification channels for your domain
  (some projects are asked to verify domain ownership: add the domain in Google Search Console with the same Google
  account, then under Google Auth Platform > Branding > Authorized domains), Kairos keeps working with the periodic
  check and retries the channels every 6 hours.
- **Periodic check**: the background job `calendars.sync_booked_events` checks upcoming meetings (next 90 days) every
  10 minutes whenever background jobs run. On the Vercel Hobby plan, the built-in cron runs only once a day, so set up
  the external pinger described in the README ("Background jobs and cron": call `GET YOUR_APP_URL/api/cron` every 5
  minutes with `Authorization: Bearer CRON_SECRET`). The same pinger makes reminder emails go out on time.

## Troubleshooting

| What you see | Fix |
|---|---|
| Google shows `Error 400: redirect_uri_mismatch` | The redirect URI is not registered exactly. Check step 4 against `APP_URL` (scheme, domain, no trailing slash). |
| "Access blocked: this app has not completed the Google verification process" | The app is in Testing and your account is not a test user: add it (step 3.4) or publish the app (step 3.5). |
| The calendar shows "Action required" about a week after connecting | The app is still in Testing (7 day refresh tokens). Publish it (step 3.5), then click **Reconnect**. |
| The calendar shows "Error" and mentions the Google Calendar API | Enable the API (step 2). The connection recovers on its own at the next successful check. |
| "Kairos needs permission to see and edit events on your Google Calendar" | The calendar permissions were unchecked on Google's consent screen. Connect again and keep them checked. |
| "Sign in with Google is not configured on this server" or the tile says "Not configured on this server" | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing on this deployment. Add both and redeploy. |
| All calendars need a reconnect after a redeploy | `ENCRYPTION_KEY` changed. Set it back, or reconnect each calendar. |
| No Google Meet link on new meetings | The event type's location must be Google Meet, the calendar to add events to must be a Google calendar, and a Google Workspace admin may have turned Meet off for your account. |
| You want Kairos to stop using your Google account | Disconnect it on Calendar settings (this revokes the token), or remove Kairos at <https://myaccount.google.com/permissions>. |

## Security

- Google access and refresh tokens are stored encrypted (AES-256-GCM) and used only on the server.
- Kairos requests the two calendar scopes above and nothing else besides your name, email and profile picture.
- Disconnecting a calendar deletes its stored tokens and cached events and revokes the token at Google. Events already
  added to your calendar stay there.
