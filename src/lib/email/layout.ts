// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Shared email layout (SPEC NT-05, ARCHITECTURE section 13.1): one responsive HTML layout for every email (600px max,
// white card on #FAFAFA, logo or avatar at the top, #0A2540 text, #006BFF pill buttons, footer with "Powered by
// {AppName}" (hideable) and a line saying why the recipient got the email) plus the matching plain text footer.
// Table based markup with inline styles so Gmail, Outlook and Apple Mail render it the same. No tracking pixels, no
// remote fonts, no scripts. Pure (no I/O); the footer strings come from the i18n `common` namespace.
import { appName } from "../brand";
import { getT } from "../i18n";
import { resolveLocale } from "../i18n/locales";
import { appUrl } from "../url";
import { escapeHtml, isAbsoluteHttpUrl, safeHref } from "./html";
import type { EmailBrand } from "./types";

/** Email palette (Calendly Classic tokens, calendly-ux-walkthrough 1.1). */
export const EMAIL_COLORS = {
  canvas: "#FAFAFA",
  card: "#FFFFFF",
  border: "#E7EDF6",
  divider: "#D4E0ED",
  text: "#0A2540",
  secondary: "#476788",
  primary: "#006BFF",
  link: "#006BFF",
  infoBg: "#E6F0FF",
  warningBg: "#FFE7BA",
  warningText: "#894800",
  successBg: "#CDF9E5",
  successText: "#0A6439",
  destructiveText: "#B03200",
} as const;

export const EMAIL_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The button color: a valid brand hex color, else Calendly blue. */
export function emailPrimaryColor(brand?: Pick<EmailBrand, "primaryColor"> | null): string {
  const c = brand?.primaryColor?.trim();
  return c && HEX.test(c) ? c : EMAIL_COLORS.primary;
}

/** A pill button (table wrapped so Outlook keeps the padding). Returns "" for a non-absolute URL. */
export function emailButtonHtml(label: string, url: string, color: string = EMAIL_COLORS.primary): string {
  const href = safeHref(url);
  if (!href) return "";
  const bg = HEX.test(color) ? color : EMAIL_COLORS.primary;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;border-collapse:separate">` +
    `<tr><td align="center" bgcolor="${bg}" style="border-radius:9999px;background:${bg}">` +
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;` +
    `font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;` +
    `text-decoration:none;border-radius:9999px;border:1px solid ${bg}">${escapeHtml(label)}</a></td></tr></table>`
  );
}

export type EmailLayoutInput = {
  /** Hidden inbox preview text. */
  preheader?: string;
  heading?: string;
  /** Trusted body markup (escape user input with escapeHtml; sanitize rich text with sanitizeRichText). */
  bodyHtml: string;
  /** Trusted extra footer markup (below the reason line). */
  footerHtml?: string;
  brand: EmailBrand;
  locale?: string;
  /** Plain text line explaining why the recipient got the email (NT-05). */
  reason?: string | null;
  /** Extra footer links ("Unsubscribe", "Notification settings"); absolute URLs only. */
  footerLinks?: { label: string; url: string }[];
};

function headerImage(brand: EmailBrand): string {
  if (brand.logoUrl && isAbsoluteHttpUrl(brand.logoUrl)) {
    return (
      `<tr><td align="center" style="padding:0 0 24px 0">` +
      `<img src="${escapeHtml(brand.logoUrl)}" alt="" height="48" style="display:block;height:48px;max-height:48px;` +
      `width:auto;max-width:240px;border:0;outline:none;text-decoration:none"></td></tr>`
    );
  }
  if (brand.avatarUrl && isAbsoluteHttpUrl(brand.avatarUrl)) {
    return (
      `<tr><td align="center" style="padding:0 0 24px 0">` +
      `<img src="${escapeHtml(brand.avatarUrl)}" alt="" width="64" height="64" style="display:block;width:64px;` +
      `height:64px;border-radius:50%;border:0;outline:none;text-decoration:none;object-fit:cover"></td></tr>`
    );
  }
  return "";
}

/** Footer lines (Powered by, reason) shared by the HTML and text versions. */
export function emailFooterLines(p: { brand: EmailBrand; locale?: string; reason?: string | null }): {
  poweredBy: string | null;
  reason: string | null;
} {
  const t = getT(p.locale ?? "en", "common");
  return {
    poweredBy: p.brand.showPoweredBy ? t("footer.poweredBy", { appName: appName() }) : null,
    reason: p.reason?.trim() || null,
  };
}

/** Wraps a body in the email layout (NT-05). */
export function renderEmailLayout(p: EmailLayoutInput): { html: string } {
  const locale = resolveLocale(p.locale);
  const primary = emailPrimaryColor(p.brand);
  const footer = emailFooterLines({ brand: p.brand, locale, reason: p.reason });
  const preheader = p.preheader?.trim()
    ? `<div data-preheader style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;` +
      `line-height:1px;color:${EMAIL_COLORS.canvas};opacity:0">${escapeHtml(p.preheader.trim())}` +
      `${"&#847;&zwnj;&nbsp;".repeat(40)}</div>`
    : "";
  const heading = p.heading?.trim()
    ? `<tr><td style="padding:0 0 16px 0"><h1 style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:22px;` +
      `line-height:30px;font-weight:700;color:${EMAIL_COLORS.text}">${escapeHtml(p.heading.trim())}</h1></td></tr>`
    : "";
  const footerParts: string[] = [];
  if (footer.poweredBy) {
    footerParts.push(
      `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${EMAIL_COLORS.secondary}">` +
        `<a href="${escapeHtml(appUrl())}" target="_blank" rel="noopener" style="color:${EMAIL_COLORS.secondary};` +
        `text-decoration:none;font-weight:600">${escapeHtml(footer.poweredBy)}</a></p>`,
    );
  }
  if (footer.reason) {
    footerParts.push(
      `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${EMAIL_COLORS.secondary}">${escapeHtml(footer.reason)}</p>`,
    );
  }
  const links = (p.footerLinks ?? []).filter((l) => safeHref(l.url));
  if (links.length) {
    footerParts.push(
      `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${EMAIL_COLORS.secondary}">` +
        links
          .map(
            (l) =>
              `<a href="${escapeHtml(safeHref(l.url))}" target="_blank" rel="noopener" style="color:${EMAIL_COLORS.secondary};` +
              `text-decoration:underline">${escapeHtml(l.label)}</a>`,
          )
          .join(" &nbsp;&middot;&nbsp; ") +
        `</p>`,
    );
  }
  if (p.footerHtml) {
    footerParts.push(
      `<div style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${EMAIL_COLORS.secondary}">${p.footerHtml}</div>`,
    );
  }

  const html =
    `<!doctype html><html lang="${escapeHtml(locale)}" xmlns="http://www.w3.org/1999/xhtml"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting">` +
    `<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    (p.heading ? `<title>${escapeHtml(p.heading)}</title>` : "") +
    `<style>` +
    `body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}` +
    `a{color:${primary}}` +
    `.k-body p{margin:0 0 16px 0}` +
    `@media only screen and (max-width:620px){.k-outer{padding:16px 8px!important}.k-card{padding:28px 20px!important}}` +
    `</style></head>` +
    `<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.canvas}">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.canvas}" ` +
    `style="background-color:${EMAIL_COLORS.canvas};border-collapse:collapse">` +
    `<tr><td class="k-outer" align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;border-collapse:separate">` +
    `<tr><td class="k-card" bgcolor="${EMAIL_COLORS.card}" style="background-color:${EMAIL_COLORS.card};` +
    `border:1px solid ${EMAIL_COLORS.border};border-radius:8px;padding:40px 40px 32px 40px;font-family:${EMAIL_FONT_STACK};` +
    `font-size:16px;line-height:24px;color:${EMAIL_COLORS.text}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">` +
    headerImage(p.brand) +
    heading +
    `<tr><td class="k-body" style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:24px;` +
    `color:${EMAIL_COLORS.text};word-break:break-word">${p.bodyHtml}</td></tr>` +
    `</table></td></tr>` +
    (footerParts.length
      ? `<tr><td align="center" style="padding:24px 16px 0 16px;font-family:${EMAIL_FONT_STACK};text-align:center">` +
        footerParts.join("") +
        `</td></tr>`
      : "") +
    `</table></td></tr></table></body></html>`;
  return { html };
}

/** The plain text footer appended to a text body (same lines as the HTML footer). */
export function renderEmailText(p: {
  heading?: string;
  bodyText: string;
  brand: EmailBrand;
  locale?: string;
  reason?: string | null;
  footerLinks?: { label: string; url: string }[];
}): string {
  const footer = emailFooterLines({ brand: p.brand, locale: resolveLocale(p.locale), reason: p.reason });
  const parts: string[] = [];
  if (p.heading?.trim()) parts.push(p.heading.trim());
  if (p.bodyText.trim()) parts.push(p.bodyText.trim());
  const tail: string[] = [];
  if (footer.poweredBy) tail.push(footer.poweredBy);
  if (footer.reason) tail.push(footer.reason);
  for (const l of p.footerLinks ?? []) if (safeHref(l.url)) tail.push(`${l.label}: ${l.url}`);
  if (tail.length) parts.push(`--\n${tail.join("\n")}`);
  return parts.join("\n\n");
}
