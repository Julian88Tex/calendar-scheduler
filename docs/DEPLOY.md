# Production deployment checklist

This is the checklist for putting Kairos into production on Vercel with a Neon database. You can follow it yourself, or
an agent with access to your Vercel, Google Cloud and GitHub accounts can run it. At the end:

- the app runs at your production address and nobody else can claim it;
- your account exists with your Calendly setup (profile, both schedules, the three event types with their venues,
  questions, buffers and reminders) and signs in with Google;
- Google Calendar is connected for conflicts, events and Meet links, and booking emails go out from your Gmail;
- a Google Apps Script runs every 5 minutes, so reminder emails go out on time.

Work through the steps in order. Plan for about 45 minutes. Every value below is set for the **Production**
environment unless a step says otherwise.

## 0. Values you will need

Generate four secrets now and keep them in a password manager. Each command prints a new random value:

```sh
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (never change it later)
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 32      # SETUP_TOKEN (at least 24 characters)
```

Also decide:

- **Your Google account email** (the Google account whose calendar you use, for example the Gmail address you sign in
  to Google Calendar with). It becomes `OWNER_EMAIL` and `ADMIN_EMAILS`, and you sign in to Kairos with it.
- **Your production address** (`APP_URL`): the Vercel address such as `https://kairos-julian.vercel.app`, or a custom
  domain you add later. No trailing slash. If you are not sure of the Vercel address yet, finish step 1 first: the
  project page shows it under **Domains**. Use that domain, not a deployment URL with a hash in it
  (`kairos-julian-abc123-you.vercel.app`): those are behind Vercel Authentication, so Google, your invitees and the
  reminder dispatcher would get a Vercel login page.

The shell commands in this guide read these variables, so set them once in your terminal:

```sh
export APP_URL="https://kairos-julian.vercel.app"   # your production address
export OWNER_EMAIL="you@gmail.com"                  # your Google account email
export CRON_SECRET="the CRON_SECRET you generated"
export SETUP_TOKEN="the SETUP_TOKEN you generated"
```

## 1. Create the Vercel project from the GitHub repository

1. Open <https://vercel.com/new>, choose **Import Git Repository** and pick the Kairos repository (grant Vercel access
   to it if GitHub asks).
2. Framework preset: **Next.js** (detected). Leave the build command as is: `npm run build` applies the database
   migrations and then builds. Leave the root directory empty. The Node.js version comes from `package.json` (22.x).
3. You can already add the variables of step 4 under **Environment Variables** on this screen, or click **Deploy** now
   and add them later: a deployment without a database only shows the setup page (nobody can sign up on it).
4. Production branch: Vercel deploys the repository's default branch to production. If the code you want lives on
   another branch, either merge it into the default branch or set **Settings > Git > Production Branch** to it.

With the Vercel CLI instead: `npx vercel@latest link` in the repository folder, then `npx vercel@latest git connect`.

## 2. Add the Neon database from the Storage tab

1. In the project, open the **Storage** tab, click **Create Database**, choose **Neon** (Serverless Postgres) and
   accept the integration.
2. Region: pick the one closest to your Vercel functions (new projects run in Washington, D.C., `iad1`, so choose
   `us-east-1`). Plan: Free is enough.
3. Connect it to the **Production** and **Preview** environments. Vercel then adds `DATABASE_URL`,
   `DATABASE_URL_UNPOOLED` and the `POSTGRES_*` variables to the project. You do not set them yourself. If Vercel
   offers to redeploy now, decline: step 5 creates your account before the app sees the database.
4. Optional, for preview deployments with their own database: turn on Neon's preview branching for Preview in the
   integration settings and add `MIGRATE_ON_PREVIEW=1` for the **Preview** environment only. Without it, previews never
   migrate the database (they may share production's).

## 3. Create the Google OAuth client

Follow [docs/GOOGLE_SETUP.md](GOOGLE_SETUP.md) steps 1 to 4 (Google Cloud project, consent screen, OAuth client). In
short:

1. Enable the **Google Calendar API** and the **Gmail API** in the Google Cloud project. With gcloud:
   `gcloud services enable calendar-json.googleapis.com gmail.googleapis.com --project YOUR_PROJECT_ID`.
2. Consent screen: user type **External**, your email as support and developer contact, authorized domain = the domain
   of `APP_URL`, and these scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
   `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.readonly` and
   `https://www.googleapis.com/auth/gmail.send` (send email on your behalf; it cannot read your mail).
3. **Publish the app** (Audience > Publish app, status **In production**). In Testing, Google expires refresh tokens
   after 7 days and the calendar would ask to reconnect every week. Unverified is fine for your own use: on the consent
   screen choose **Advanced > Go to Kairos (unsafe)**.
4. Create an OAuth client of type **Web application** with the authorized redirect URI
   `{APP_URL}/api/auth/google/callback`, exactly, for example `https://kairos-julian.vercel.app/api/auth/google/callback`
   (add `http://localhost:3000/api/auth/google/callback` too if you run Kairos locally). Copy the client ID and secret.

## 4. Set the environment variables

In **Settings > Environment Variables**, add these for **Production**:

| Variable | Value | Why |
|---|---|---|
| `SESSION_SECRET` | the generated value | signs sessions; set it so it never depends on the database |
| `ENCRYPTION_KEY` | the generated value | encrypts the stored Google tokens; never change it (all calendars would need a reconnect) |
| `CRON_SECRET` | the generated value | protects `/api/cron` (Vercel Cron and the Apps Script send it) |
| `SETUP_TOKEN` | the generated value | authorizes the one-time owner bootstrap over HTTP (step 6) |
| `OWNER_EMAIL` | your Google account email | the only email the bootstrap accepts |
| `ADMIN_EMAILS` | your Google account email | instance admin by email, in addition to the bootstrapped account |
| `SIGNUP_POLICY` | `invite_only` | nobody else can create an account |
| `APP_URL` | your production address | OAuth redirects and every link in emails |
| `GOOGLE_CLIENT_ID` | from step 3 | Google sign-in, Calendar, Meet and Gmail |
| `GOOGLE_CLIENT_SECRET` | from step 3 | same |
| `EMAIL_PROVIDER` | `gmail` | booking emails and reminders go out from your own Gmail |

Do not set `E2E_TEST_MODE`, `E2E_SECRET` or `PGLITE_DIR` in production.

With the Vercel CLI (each command reads the value from standard input; export `SESSION_SECRET`, `ENCRYPTION_KEY`,
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your shell first, like the variables of step 0):

```sh
printf %s "$SESSION_SECRET" | npx vercel@latest env add SESSION_SECRET production
printf %s "$ENCRYPTION_KEY" | npx vercel@latest env add ENCRYPTION_KEY production
printf %s "$CRON_SECRET"    | npx vercel@latest env add CRON_SECRET production
printf %s "$SETUP_TOKEN"    | npx vercel@latest env add SETUP_TOKEN production
printf %s "$OWNER_EMAIL"    | npx vercel@latest env add OWNER_EMAIL production
printf %s "$OWNER_EMAIL"    | npx vercel@latest env add ADMIN_EMAILS production
printf %s "invite_only"     | npx vercel@latest env add SIGNUP_POLICY production
printf %s "$APP_URL"        | npx vercel@latest env add APP_URL production
printf %s "$GOOGLE_CLIENT_ID"     | npx vercel@latest env add GOOGLE_CLIENT_ID production
printf %s "$GOOGLE_CLIENT_SECRET" | npx vercel@latest env add GOOGLE_CLIENT_SECRET production
printf %s "gmail"           | npx vercel@latest env add EMAIL_PROVIDER production
```

## 5. Bootstrap the owner before the app goes live (recommended)

Until an account exists, the very first signup of a fresh instance becomes its admin. The first deployment had no
database, so nobody could sign up on it. Create your account now, straight in the Neon database, before the deployment
of step 6 connects the app to it: then there is no moment at which anyone else can claim the instance.

You need a checkout of the repository on the branch Vercel deploys to production, Node.js 22, and the database's direct
connection string: in Vercel open **Storage**, then the Neon database, and copy `DATABASE_URL_UNPOOLED` (or in the Neon
console: **Connect**, with connection pooling off).

```sh
git clone https://github.com/YOU/YOUR-REPO.git kairos && cd kairos   # skip if you already have a checkout
git checkout YOUR-PRODUCTION-BRANCH && npm ci
APP_URL="$APP_URL" OWNER_EMAIL="$OWNER_EMAIL" DATABASE_URL='postgres://...the direct connection string...' \
  NODE_OPTIONS=--import=./scripts/server-only-hook.mjs \
  npx tsx scripts/bootstrap-owner.ts --email="$OWNER_EMAIL"
```

It applies the database migrations first (the build of step 6 then finds nothing left to do), then prints what it did:

```text
[bootstrap] database: Postgres from DATABASE_URL / POSTGRES_URL
{"level":"info","event":"setup.bootstrap",...,"account":"created","snapshot":"applied"}
[bootstrap] done
Created the owner account you@gmail.com (...).
- Created the account you@gmail.com: email verified, no password (sign in with Google), instance admin.
- Profile: name Julian Joseph, time zone America/Los_Angeles, 12h (am/pm) time and the welcome message "..."
- Schedules: Working hours (default), Block Off Work, all in America/Los_Angeles.
- Event types: 30 Minute Virtual (30min), 60 Minute Virtual (60min), In-Person Meal or Coffee (meal).
- Email reminders to invitees 24 hours before the event on 3 event types.
...
```

That is: your account (email verified, no password, instance admin) with the link `/julianjoseph`, time zone
America/Los_Angeles, 12h time, the welcome message, the schedules "Working hours" (default) and "Block Off Work", and
the event types "30 Minute Virtual", "60 Minute Virtual" (Google Meet) and "In-Person Meal or Coffee" (your 8 venues
plus "Somewhere else"), each with the required question "What would you like to discuss?" and an email reminder to the
invitee 24 hours before. Optional flags: `--name="..."` (default "Julian Joseph") and `--avatar-url=https://...`
(without it your Google photo is used once you sign in with Google).

Running it again prints "Skipped the Calendly setup: the Calendly setup was already applied to this account." and
changes nothing: the bootstrap never overwrites edits you make later. Exit code 1 means it refused (it prints why; the
reasons are the same as in the table of step 6), 2 means a wrong flag.

## 6. Deploy

Open **Deployments**, then on the latest deployment **... > Redeploy** (new variables only apply to new deployments),
or push a commit to the production branch. Wait for **Ready**, then check:

```sh
curl -fsS "$APP_URL/api/health"
# {"ok":true,"db":"postgres","setupRequired":false,...}
```

`"db":"postgres"` means Neon is connected and migrated. A 503 with `setupRequired` means the database variables are
missing for Production (step 2).

### Bootstrap over HTTP instead (only if you skipped step 5)

Without a checkout you can run the same bootstrap through the deployed app. Do it the moment the deployment is
**Ready** and before you share the address: until your account exists, whoever signs up first becomes the admin. The
bootstrap refuses to run when someone got there first.

```sh
curl -sS -X POST "$APP_URL/api/setup/bootstrap" \
  -H "Authorization: Bearer $SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\"}"
```

Optional fields: `"name"` and `"avatarUrl"` (an https image link), like the flags of step 5. The answers:

| Answer | Meaning |
|---|---|
| **201** with `"account":"created"` and `"snapshot":{"status":"applied",...}` | Done, with everything listed in step 5. The `changes` list says exactly what was done. |
| **200** with `"snapshot":{"status":"skipped","reason":"already_applied"}` | It ran before; nothing changed. |
| **401** | The bearer token does not match `SETUP_TOKEN` or `CRON_SECRET` on this deployment (redeploy after adding variables). |
| **403** | The email is not `OWNER_EMAIL`. |
| **409**, "another account" | Someone else's account exists. List the accounts in the Neon console (**SQL Editor**): `select id, email, created_at from users;`. If one is not yours and nothing else happened on this instance yet, reset the database (Neon SQL Editor: `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`), then right away run step 5 (it migrates the empty database and creates your account): the live app migrates an empty database on its own too, and the next signup would claim it again. |
| **409**, "never verified" | An account with your email exists, created with email and password without proving the address. If you created it, choose **Continue with Google** on `{APP_URL}/login` with that address (that verifies the address and removes the password), then bootstrap again. If you did not, someone else did: reset the database as in the row above. |
| **429** | Too many attempts (10 per 15 minutes per address, 30 per hour in all). Wait, or use step 5, which has no limit. |
| **501** | Neither `SETUP_TOKEN` nor `CRON_SECRET` is set, or both are shorter than 24 characters. |

The command line bootstrap of step 5 refuses for the same reasons (exit code 1). After the bootstrap you may delete
`SETUP_TOKEN` from Vercel. The endpoint stays harmless either way: it only ever accepts `OWNER_EMAIL`, refuses when
other accounts exist, and never overwrites your setup (it also accepts `CRON_SECRET`).

## 7. Sign in with Google and connect the calendar

1. Open `{APP_URL}/login` and click **Continue with Google** with your Google account (the `OWNER_EMAIL` address).
2. On Google's consent screen keep every box checked (calendar events, calendars, send email). Kairos links Google to
   the bootstrapped account (same verified email), adopts your Google photo when the account has none, and connects
   your primary calendar: it checks it for conflicts and adds booked meetings to it with a Google Meet link.
3. You land on **Scheduling** with your three event types (from now on `{APP_URL}` itself opens Scheduling when you
   are signed in and the login page when you are not). Check:
   - **Availability > Calendar settings** lists your Google calendar; add any other calendars that should block time.
   - Your booking page `{APP_URL}/julianjoseph` shows the welcome message and the three event types.
   - **Settings > Email outbox** lists every email Kairos sent or tried to send, newest first. The line at the top says
     how email goes out ("Sending from you@gmail.com (Gmail)"). An email marked **Waiting for Gmail** is sent by itself
     once you reconnect Google with its **Reconnect Google** link; one marked **Failed** shows the reason and can be
     sent again with **Resend**.
   - Optional: upload your logo in **Settings > Branding** (the bootstrap cannot copy it from Calendly).

## 8. Reminder dispatcher: a Google Apps Script every 5 minutes

Vercel's Hobby plan runs the built-in cron (`vercel.json`) once a day only. Reminders, calendar sync and the other
background jobs need `GET {APP_URL}/api/cron` every few minutes. A Google Apps Script time trigger does it for free
from your Google account.

1. Open <https://script.google.com>, click **New project** and name it "Kairos reminder dispatcher".
2. **Project Settings** (gear icon) > **Script Properties** > **Add script property**, twice:
   - `APP_URL` = your production address (no trailing slash)
   - `CRON_SECRET` = the same `CRON_SECRET` as on Vercel
3. Back in the **Editor**, replace the contents of `Code.gs` with:

```js
/**
 * Kairos reminder dispatcher. Calls GET {APP_URL}/api/cron with "Authorization: Bearer {CRON_SECRET}".
 * Script properties: APP_URL (for example https://kairos-julian.vercel.app) and CRON_SECRET.
 * Run installTrigger once; it then runs pingKairos every 5 minutes.
 */
function pingKairos() {
  var props = PropertiesService.getScriptProperties();
  var appUrl = (props.getProperty('APP_URL') || '').trim().replace(/\/+$/, '');
  var secret = (props.getProperty('CRON_SECRET') || '').trim();
  if (!appUrl || !secret) {
    throw new Error('Set the APP_URL and CRON_SECRET script properties (Project Settings > Script Properties).');
  }
  var response = UrlFetchApp.fetch(appUrl + '/api/cron', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    // A failed run shows in Executions and triggers Google's failure notification email.
    throw new Error('Kairos /api/cron answered HTTP ' + code + ': ' + body.slice(0, 500));
  }
  console.log(body);
}

/** Run once by hand: replaces any earlier pingKairos trigger with one every 5 minutes, then pings once. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'pingKairos') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('pingKairos').timeBased().everyMinutes(5).create();
  pingKairos();
}
```

4. Click **Save**, choose `installTrigger` in the function menu and click **Run**. Google asks for permission ("Connect
   to an external service" and "Allow this application to run when you are not present"); allow it. If Google warns
   that the app is unverified, choose **Advanced > Go to Kairos reminder dispatcher (unsafe)**: it is your own script.
5. The execution log shows a line like `{"ok":true,"mode":"authorized","ran":0,"succeeded":0,"failed":0,"remaining":0}`.
   **Triggers** (clock icon) now lists `pingKairos`, time-based, every 5 minutes. Open the trigger and set **Failure
   notification settings** to **Notify me immediately** if you want an email the moment it stops working.

Notes: each run normally takes a second or two, well within the free quotas of a personal Google account (90 minutes
of trigger runtime and 20,000 URL fetches per day; this uses about 288 fetches). Jobs are idempotent, so an occasional
failed or late run is harmless: the next run catches up. If you change `CRON_SECRET` on Vercel, update the script
property too.

Optional second trigger: the repository's GitHub Actions workflow (`.github/workflows/cron.yml`, every 10 minutes)
runs once you set the repository variable `APP_URL` and the secret `CRON_SECRET`:
`gh variable set APP_URL --body "$APP_URL"` and `gh secret set CRON_SECRET --body "$CRON_SECRET"`. On a private
repository with GitHub's free plan, each run bills at least a minute (about 4,320 minutes a month against 2,000
included), so leave it off there or change its schedule to `*/30 * * * *`; the Apps Script alone is enough.

## 9. Verify that reminders are being dispatched

1. **The trigger runs.** In Apps Script, **Executions** shows `pingKairos` as **Completed** every 5 minutes. A manual
   check from your terminal:

   ```sh
   curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"
   # {"ok":true,"mode":"authorized","ran":...,"succeeded":...,"failed":0,"remaining":...}
   curl -sS -o /dev/null -w "%{http_code}\n" "$APP_URL/api/cron"   # 401 without the header
   ```

2. **Kairos sees it.** Signed in as yourself (the instance admin), the app shows the banner "Reminders may be sent late"
   when `/api/cron` has not run for 15 minutes, or "{n} reminders are past their send time." when reminders are late.
   No banner means the dispatcher is working. In the Neon SQL Editor, the last run is:
   `select value from instance_settings where key = 'last_cron_at';` (within the last 5 minutes).
3. **A reminder actually arrives.** Book a test meeting on `{APP_URL}/julianjoseph/30min` with a second email address
   you can read, about 24 hours and 15 minutes from now (the 24 hour reminder is then due in about 15 minutes). The
   confirmation email arrives right away (from your Gmail). In the Neon SQL Editor:

   ```sql
   select status, run_at, sent_at, skip_reason, error
   from workflow_executions order by created_at desc limit 5;
   ```

   The reminder shows `scheduled` with `run_at` 24 hours before the meeting; within 5 minutes after `run_at` it turns
   `sent` (with `sent_at`) and the reminder email arrives (it is also listed in **Settings > Email outbox** as
   "Reminder: ..." with status Sent and provider Gmail). Then cancel the test meeting with the link in the email.
   `failed` with an `error` that mentions Google means the Google connection needs attention (step 7: reconnect from
   **Integrations**, keeping the send email permission checked).

## When something is off

| What you see | What to do |
|---|---|
| Every page shows the setup page | The Neon variables are missing for Production (step 2), then redeploy. |
| Google says `redirect_uri_mismatch` | Register exactly `{APP_URL}/api/auth/google/callback` (step 3.4) and make `APP_URL` match it. |
| "Sign ups are closed" when you continue with Google | Your Google email differs from the bootstrapped one. Use the `OWNER_EMAIL` account. |
| Calendar asks to reconnect after about a week | The Google app is still in Testing: publish it (step 3.3), then reconnect. |
| Emails are not sent | Open **Settings > Email outbox**: each email shows why. **Waiting for Gmail**: reconnect Google with the link (keep the send email permission checked); the emails then go out by themselves. **Failed**: read the reason, fix it, then **Resend**. **Stored**: no email provider is active; check `EMAIL_PROVIDER=gmail`, that the Gmail API is enabled (step 3.1) and that you kept the send email permission when connecting Google. |
| The "Reminders may be sent late" or "past their send time" banner stays | The Apps Script is not running or its `CRON_SECRET` differs from Vercel's (its Executions show HTTP 401). |
| All calendars need a reconnect after a redeploy | `ENCRYPTION_KEY` changed. Set the old value back, or reconnect. |
