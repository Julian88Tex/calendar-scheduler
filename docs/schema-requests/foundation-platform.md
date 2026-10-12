# Schema request: foundation-platform

## 1. `email_outbox.headers` (jsonb, not null, default `'{}'`)

**Why**: `sendEmail` adds message headers that are not derivable from the other columns: `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (GEN-08, poll emails), plus `Auto-Submitted` and
`X-Auto-Response-Suppress`. Today they reach the provider on the first attempt and on `email.retry` jobs (carried in
the job payload), but they are lost when a row is re-sent by the interrupted-delivery sweep or by the ADM-04 "Resend"
action, and the outbox viewer cannot show them ("headers" in the ADM-04 detail view).

**Change**:

```ts
// src/db/schema/messaging.ts, emailOutbox
headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
```

plus the generated migration (`npm run db:generate`).

**Follow-up in foundation-platform once it exists** (small, contained): write `headers` on insert in
`src/lib/email/send.ts`, read it in `outgoingFrom()` instead of the job payload, and copy it in `resendOutboxEmail()`.
Until then everything works; only the sweep and manual resends lose List-Unsubscribe.

No other schema changes are needed: the job lease uses the documented `instance_settings` keys `job_runner_lease` and
`cron_open_lease` (the latter is a new key, same value shape `{ holder, until, untilMs }`).
