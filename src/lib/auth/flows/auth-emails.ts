// Delivery of auth emails (verify email, reset password, login method code, welcome) through the email core
// (src/lib/email: outbox row, Resend or SMTP, email.retry on failure). Category "auth", one idempotency key per token
// or user so a retried request never sends twice. Delivery runs after the response when possible
// (runAfterResponse), so a slow provider neither delays the page nor reveals whether an account exists.
import "server-only";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/logger";
import { absoluteUrl, publicBookingUrl } from "@/lib/url";
import { resetPasswordTemplate, verifyEmailTemplate, loginMethodCodeTemplate, welcomeTemplate, type RenderedEmail } from "../emails";
import { runAfterResponse } from "./request-context";

type Recipient = { id: string; email: string; name: string; slug?: string | null };

async function deliver(
  rendered: RenderedEmail,
  p: { to: Recipient; template: string; idempotencyKey: string; organizationId?: string | null; defer?: boolean },
): Promise<void> {
  const task = async () => {
    try {
      await sendEmail({
        to: [p.to.email],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        template: p.template,
        category: "auth",
        idempotencyKey: p.idempotencyKey,
        replyTo: null,
        related: { userId: p.to.id, ...(p.organizationId ? { organizationId: p.organizationId } : {}) },
      });
    } catch (e) {
      log.error("auth.email_failed", { template: p.template, userId: p.to.id, error: e });
    }
  };
  if (p.defer === false) await task();
  else await runAfterResponse(task);
}

/** "Verify your email" with the /verify-email/{token} link. */
export async function sendVerifyEmail(to: Recipient, p: { token: string; tokenId: string; defer?: boolean }): Promise<void> {
  const url = absoluteUrl(`/verify-email/${encodeURIComponent(p.token)}`);
  await deliver(verifyEmailTemplate({ name: to.name, url, email: to.email }), {
    to,
    template: "auth.verify_email",
    idempotencyKey: `auth.verify_email:${p.tokenId}`,
    defer: p.defer,
  });
}

/** "Reset your password" with the /reset-password/{token} link. */
export async function sendResetPasswordEmail(to: Recipient, p: { token: string; tokenId: string; defer?: boolean }): Promise<void> {
  const url = absoluteUrl(`/reset-password/${encodeURIComponent(p.token)}`);
  await deliver(resetPasswordTemplate({ name: to.name, url, email: to.email }), {
    to,
    template: "auth.reset_password",
    idempotencyKey: `auth.reset_password:${p.tokenId}`,
    defer: p.defer,
  });
}

/** The 6-digit login method confirmation code (AU-10). */
export async function sendLoginMethodCodeEmail(
  to: Recipient,
  p: { code: string; codeId: string; expiresMinutes: number; defer?: boolean },
): Promise<void> {
  await deliver(loginMethodCodeTemplate({ name: to.name, code: p.code, expiresMinutes: p.expiresMinutes }), {
    to,
    template: "auth.login_method_code",
    idempotencyKey: `auth.login_method_code:${p.codeId}`,
    defer: p.defer,
  });
}

/** Welcome email after signup (once per user). */
export async function sendWelcomeEmail(to: Recipient, p: { organizationId?: string | null; defer?: boolean } = {}): Promise<void> {
  const bookingUrl = to.slug ? publicBookingUrl({ handle: to.slug }) : null;
  await deliver(welcomeTemplate({ name: to.name, url: absoluteUrl("/app/scheduling"), bookingUrl }), {
    to,
    template: "auth.welcome",
    idempotencyKey: `auth.welcome:${to.id}`,
    organizationId: p.organizationId,
    defer: p.defer,
  });
}
