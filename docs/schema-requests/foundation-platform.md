# Schema request: foundation-platform

## 1. `email_outbox.headers` (jsonb, not null, default `'{}'`)

**Why**: `sendEmail` adds message headers that are not derivable from the other columns: `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (GEN-08, poll emails), plus `Auto-Submitted` and
`X-Auto-Response-Suppress`. Today they reach the provider on the first attempt and on `email.retry` jobs (carried in
the job payload; the interrupted-delivery sweep recovers them from that payload when the row has a retry job), but
they are lost when a row is re-sent by the sweep before it ever had a retry job (the function was killed during the
first attempt) or by the ADM-04 "Resend" action, and the outbox viewer cannot show them ("headers" in the ADM-04 detail
view). Storing them also keeps every retry byte-identical for the Resend idempotency key.

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
