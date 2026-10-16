// OWNER: gmail (email sending from the owner's Gmail).
//
// "Send emails from your Gmail" on Integrations > Google Calendar (owner decision: booking emails are sent from the
// owner's own Gmail through their Google connection, no Resend or SMTP account needed). Shows whether emails go out
// ("Sending emails from {address}"), the switch, the account to send from when several allowed Gmail sending, emails
// waiting for a reconnect, the last delivery failure, and the Google consent link that asks for "Send email on your
// behalf" when the permission is missing or the account must be reconnected. Rendered for the instance owner only
// (getGmailSendingView returns null for anyone else).
"use client";

import { Mail, RefreshCw } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { ProviderTile } from "@/components/calendars/shared";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { saveGmailSending } from "@/lib/email/gmail-actions";
import { gmailStateBadge, heldEmailsLabel, providerLabel, type GmailSendingView } from "@/lib/email/gmail-types";
import { GMAIL_SEND_PERMISSION_LABEL } from "@/lib/integrations/google/scopes";

export type GmailSendingCardProps = { view: GmailSendingView; appName: string };

export function GmailSendingCard({ view, appName }: GmailSendingCardProps) {
  const headingId = useId();
  const statusId = useId();
  const [enabled, setEnabled] = useState(view.enabled);
  const [connectionId, setConnectionId] = useState(view.selectedConnectionId);
  const [pending, start] = useTransition();
  const badge = gmailStateBadge(view.state);
  const address = view.candidates.find((c) => c.id === connectionId)?.address ?? view.address;
  const showSwitch = view.state === "on" || view.state === "off" || view.state === "needs_reconnect";

  const save = (next: { enabled: boolean; connectionId: string | null }, undo: () => void, success: string) =>
    start(async () => {
      const r = await saveGmailSending(next);
      if (!r.ok) {
        undo();
        toast.error(r.error.message);
        return;
      }
      toast.success(success);
    });

  return (
    <Card role="region" aria-labelledby={headingId}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ProviderTile provider="email" size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-title-md text-ink">
                Send emails from your Gmail
              </h2>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="mt-1 text-body-md text-ink-2">
              Confirmation, reschedule, cancellation and reminder emails go out from your own Gmail address, so invitees see them coming from you and
              their replies land in your inbox.
            </p>
          </div>

          {view.requested === "granted" && view.state === "on" && (
            <Banner variant="success" role="status">
              Gmail sending is on. Emails are sent from {address}.
            </Banner>
          )}
          {view.requested === "missing" && (
            <Banner variant="warning" role="status">
              Gmail sending wasn&apos;t allowed. Try again and check &ldquo;{GMAIL_SEND_PERMISSION_LABEL}&rdquo; on Google&apos;s consent screen.
            </Banner>
          )}

          <div id={statusId} aria-live="polite" className="text-body-md text-ink">
            <StatusLine view={view} enabled={enabled} address={address} appName={appName} />
          </div>

          {showSwitch && (
            <div className="flex flex-col gap-3">
              <Switch
                checked={enabled}
                disabled={!view.canEdit || pending}
                aria-describedby={statusId}
                label="Send emails from your Gmail"
                onCheckedChange={(v) => {
                  setEnabled(v);
                  save({ enabled: v, connectionId }, () => setEnabled(!v), v ? "Gmail sending turned on" : "Gmail sending turned off");
                }}
              />
              {view.envProvider === "gmail" && <p className="text-body-sm text-ink-2">Set by EMAIL_PROVIDER=gmail on this server.</p>}
              {view.candidates.length > 1 && (
                <label className="flex max-w-md flex-col gap-1.5">
                  <span className="text-label text-ink">Send from</span>
                  <NativeSelect
                    value={connectionId ?? ""}
                    disabled={!view.canEdit || pending}
                    options={view.candidates.map((c) => ({ value: c.id, label: c.status === "needs_reauth" ? `${c.address} (reconnect needed)` : c.address }))}
                    onChange={(e) => {
                      const prev = connectionId;
                      const next = e.target.value;
                      setConnectionId(next);
                      save({ enabled, connectionId: next }, () => setConnectionId(prev), "Sending account changed");
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {view.state === "needs_reconnect" && (
            <Banner
              variant="error"
              role="status"
              action={
                view.allowHref ? (
                  <Button asChild size="sm" variant="secondary" leftIcon={<RefreshCw aria-hidden="true" />}>
                    <a href={view.allowHref}>Reconnect Google</a>
                  </Button>
                ) : undefined
              }
            >
              We can&apos;t send emails from {address} until you reconnect your Google account. {view.heldCount > 0 ? `${heldEmailsLabel(view.heldCount)} ` : ""}
              Emails are sent automatically once you reconnect.
            </Banner>
          )}
          {view.state !== "needs_reconnect" && view.heldCount > 0 && (
            <Banner variant="warning" role="status">
              {heldEmailsLabel(view.heldCount)} {view.state === "on" ? "They are being sent now." : "They are sent once Gmail can send again."}
            </Banner>
          )}
          {view.lastFailure && (
            <Banner variant="warning" role="status" title="The last email couldn't be sent">
              {view.lastFailure.message}
            </Banner>
          )}

          {(view.state === "permission_needed" || view.state === "not_connected") && view.allowHref && (
            <div className="flex flex-col items-start gap-2">
              <Button asChild leftIcon={<Mail aria-hidden="true" />}>
                <a href={view.allowHref}>{view.state === "not_connected" ? "Connect Google" : "Allow Gmail sending"}</a>
              </Button>
              <p className="text-body-sm text-ink-2">
                Google asks you to allow &ldquo;{GMAIL_SEND_PERMISSION_LABEL}&rdquo;. {appName} can only send emails: it can&apos;t read, change or
                delete your mail.
              </p>
            </div>
          )}

          {(view.state === "on" || view.state === "off" || view.state === "needs_reconnect") && (
            <p className="text-body-sm text-ink-2">
              Sent emails also appear in your Gmail Sent folder. Gmail sends up to about 500 emails a day from a personal account (2,000 with Google
              Workspace). {appName} can only send emails: it can&apos;t read, change or delete your mail.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusLine({ view, enabled, address, appName }: { view: GmailSendingView; enabled: boolean; address: string | null; appName: string }) {
  switch (view.state) {
    case "on":
    case "off":
      return enabled ? (
        <p>
          Sending emails from <span className="font-semibold break-all">{address}</span>
        </p>
      ) : (
        <p>Emails are kept in the outbox and not sent. Turn this on to send them from {address}.</p>
      );
    case "needs_reconnect":
      return <p>Emails wait in the outbox until you reconnect {address}.</p>;
    case "permission_needed":
      return <p>Your Google account is connected for your calendar, but {appName} isn&apos;t allowed to send email from it yet.</p>;
    case "not_connected":
      return <p>Connect your Google account to check your calendar for conflicts and send booking emails from your Gmail.</p>;
    case "other_provider":
      return (
        <p>
          Emails are sent with {providerLabel(view.otherProvider ?? "resend")} on this server ({view.otherProvider === "smtp" ? "SMTP_HOST" : "RESEND_API_KEY"}
          {view.envProvider ? `, EMAIL_PROVIDER=${view.envProvider}` : ""}). To send them from your Gmail instead, set EMAIL_PROVIDER=gmail in the server
          environment.
        </p>
      );
    case "forced_outbox":
      return <p>EMAIL_PROVIDER=outbox is set on this server, so emails are kept in the outbox and not sent.</p>;
    case "unavailable":
    default:
      return <p>Google sign in isn&apos;t configured on this server, so emails can&apos;t be sent from Gmail. Emails are kept in the outbox.</p>;
  }
}
