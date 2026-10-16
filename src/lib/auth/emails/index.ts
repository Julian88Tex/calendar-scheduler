// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Auth email templates (ARCHITECTURE section 13.2, SPEC AU-01, AU-07, AU-08, AU-10): pure functions returning
// { subject, html, text } through renderEmailLayout. Copy follows Calendly's account emails: a short greeting, one
// sentence of context, one pill button, the plain link for copy and paste, and the expiry. No em or en dashes (GEN-11).
import { appName } from "@/lib/brand";
import { emailButtonHtml, escapeHtml, htmlToText, renderEmailLayout } from "@/lib/email";

export type RenderedEmail = { subject: string; html: string; text: string };

const P = 'style="margin:0 0 16px;font-size:16px;line-height:24px;color:#0a2540"';
const MUTED = 'style="margin:0 0 12px;font-size:14px;line-height:20px;color:#476788"';

function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

function greeting(name: string): string {
  const first = firstName(name);
  return first ? `<p ${P}>Hi ${escapeHtml(first)},</p>` : `<p ${P}>Hi,</p>`;
}

/** The shared table-wrapped pill button (keeps its padding in Outlook), with a little space above. */
function button(label: string, url: string): string {
  return `<div style="height:8px;line-height:8px;font-size:8px">&nbsp;</div>${emailButtonHtml(label, url)}`;
}

function plainLink(url: string): string {
  return `<p ${MUTED}>Or copy and paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#004eba;word-break:break-all">${escapeHtml(url)}</a></p>`;
}

function render(p: { subject: string; heading: string; preheader: string; bodyHtml: string; footerHtml?: string }): RenderedEmail {
  const { html } = renderEmailLayout({
    preheader: p.preheader,
    heading: p.heading,
    bodyHtml: p.bodyHtml,
    footerHtml: p.footerHtml,
    brand: { showPoweredBy: false },
  });
  const text = htmlToText(`<h1>${escapeHtml(p.heading)}</h1>${p.bodyHtml}${p.footerHtml ? `<p>${p.footerHtml}</p>` : ""}`);
  return { subject: p.subject, html, text };
}

/** AU-08: "Verify your email" with the /verify-email/{token} link (24 hours). */
export function verifyEmailTemplate(p: { name: string; url: string; email?: string; expiresHours?: number }): RenderedEmail {
  const app = appName();
  const hours = p.expiresHours ?? 24;
  const who = p.email ? ` (<strong>${escapeHtml(p.email)}</strong>)` : "";
  return render({
    subject: "Verify your email",
    heading: "Verify your email",
    preheader: `Confirm your email address to finish setting up your ${app} account.`,
    bodyHtml:
      greeting(p.name) +
      `<p ${P}>Thanks for signing up for ${escapeHtml(app)}! Please confirm that this is your email address${who} so we know it's really you.</p>` +
      button("Verify email", p.url) +
      plainLink(p.url) +
      `<p ${MUTED}>This link expires in ${hours} hours.</p>`,
    footerHtml: `If you didn't create a ${escapeHtml(app)} account, you can safely ignore this email.`,
  });
}

/** AU-07: reset link /reset-password/{token}, valid for 60 minutes, single use. */
export function resetPasswordTemplate(p: { name: string; url: string; email?: string; expiresMinutes?: number }): RenderedEmail {
  const app = appName();
  const minutes = p.expiresMinutes ?? 60;
  const account = p.email ? ` for <strong>${escapeHtml(p.email)}</strong>` : "";
  return render({
    subject: `Reset your ${app} password`,
    heading: "Reset your password",
    preheader: `Use this link to choose a new password for your ${app} account.`,
    bodyHtml:
      greeting(p.name) +
      `<p ${P}>We received a request to reset the password of your ${escapeHtml(app)} account${account}. Click the button below to choose a new one.</p>` +
      button("Reset password", p.url) +
      plainLink(p.url) +
      `<p ${MUTED}>This link expires in ${minutes} minutes and can only be used once.</p>`,
    footerHtml: "If you didn't ask to reset your password, you can safely ignore this email. Your password won't change.",
  });
}

/** AU-10: 6-digit code that confirms a login method change (sent to the current login email). */
export function loginMethodCodeTemplate(p: { name: string; code: string; expiresMinutes?: number }): RenderedEmail {
  const app = appName();
  const minutes = p.expiresMinutes ?? 10;
  const code = escapeHtml(p.code);
  return render({
    subject: `Your ${app} verification code: ${p.code}`,
    heading: "Your verification code",
    preheader: `Enter ${p.code} to confirm the change to how you log in.`,
    bodyHtml:
      greeting(p.name) +
      `<p ${P}>Enter this code in ${escapeHtml(app)} to confirm the change to how you log in:</p>` +
      `<p style="margin:24px 0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;color:#0a2540">${code}</p>` +
      `<p ${MUTED}>The code expires in ${minutes} minutes.</p>`,
    footerHtml: `If you didn't try to change your login method, someone may know your password. Change it in ${escapeHtml(app)} under Settings, Login.`,
  });
}

/** AU-01: welcome email after signup, with the scheduling page link. */
export function welcomeTemplate(p: { name: string; url: string; bookingUrl?: string | null }): RenderedEmail {
  const app = appName();
  const booking = p.bookingUrl
    ? `<p ${P}>Your scheduling page is live at <a href="${escapeHtml(p.bookingUrl)}" style="color:#004eba">${escapeHtml(p.bookingUrl.replace(/^https?:\/\//, ""))}</a>. Share it and people can book time with you without the back and forth.</p>`
    : "";
  return render({
    subject: `Welcome to ${app}`,
    heading: `Welcome to ${app}`,
    preheader: "Your account is ready. Here is how to get started.",
    bodyHtml:
      greeting(p.name) +
      `<p ${P}>Your ${escapeHtml(app)} account is ready.</p>` +
      booking +
      `<p ${P}>A few things to do next:</p>` +
      `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:24px;color:#0a2540">` +
      `<li>Connect your calendar so you are never double booked</li>` +
      `<li>Set the hours you are available for meetings</li>` +
      `<li>Share your link by email, text or on your website</li>` +
      `</ul>` +
      button("Go to Scheduling", p.url),
  });
}
