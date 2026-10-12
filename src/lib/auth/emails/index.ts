// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Auth email templates (ARCHITECTURE section 13.2): pure functions returning { subject, html, text } through
// renderEmailLayout. Foundation stub: plain copies.
import { appName } from "@/lib/brand";
import { escapeHtml, htmlToText, renderEmailLayout } from "@/lib/email";

export type RenderedEmail = { subject: string; html: string; text: string };

function simple(subject: string, heading: string, bodyHtml: string): RenderedEmail {
  const { html } = renderEmailLayout({ heading, bodyHtml, brand: { showPoweredBy: false } });
  return { subject, html, text: htmlToText(bodyHtml) };
}

export function verifyEmailTemplate(p: { name: string; url: string }): RenderedEmail {
  return simple(
    "Verify your email",
    "Verify your email",
    `<p>Hi ${escapeHtml(p.name)},</p><p><a href="${escapeHtml(p.url)}">Verify email</a></p>`,
  );
}

export function resetPasswordTemplate(p: { name: string; url: string }): RenderedEmail {
  return simple(
    "Reset your password",
    "Reset your password",
    `<p>Hi ${escapeHtml(p.name)},</p><p><a href="${escapeHtml(p.url)}">Reset password</a></p><p>This link expires in 60 minutes.</p>`,
  );
}

export function loginMethodCodeTemplate(p: { name: string; code: string }): RenderedEmail {
  return simple("Your verification code", "Your verification code", `<p>Hi ${escapeHtml(p.name)},</p><p>${escapeHtml(p.code)}</p>`);
}

export function welcomeTemplate(p: { name: string; url: string }): RenderedEmail {
  return simple(
    `Welcome to ${appName()}`,
    `Welcome to ${appName()}`,
    `<p>Hi ${escapeHtml(p.name)},</p><p><a href="${escapeHtml(p.url)}">Go to your scheduling page</a></p>`,
  );
}
