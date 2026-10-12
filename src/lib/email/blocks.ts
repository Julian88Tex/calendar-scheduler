// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email content blocks (SPEC NT-01 to NT-05): the building blocks of Calendly-style notification emails, rendered to
// HTML inside the shared layout AND to the plain text alternative from the same data, so both versions always match.
//
//   const { html, text } = composeEmail({
//     preheader: "Your 30 Minute Meeting with Jane Doe is scheduled.",
//     brand: { avatarUrl, showPoweredBy: true },
//     locale: "en",
//     reason: "You received this email because you scheduled a meeting with Jane Doe.",
//     blocks: [
//       { kind: "text", text: "Hi Sam," },
//       { kind: "text", text: "Your 30 Minute Meeting with Jane Doe at 10:00am (Eastern Time - US & Canada) on ..." },
//       { kind: "fields", items: [{ label: "Event", value: "30 Minute Meeting" }, { label: "Location", lines: [...] }] },
//       { kind: "links", text: "Need to make changes to this event?", links: [{ label: "Cancel", url }, { label: "Reschedule", url }] },
//     ],
//   });
//
// Every text value is escaped here; only `html` blocks (and `html` on a field) take trusted markup (already sanitized
// rich text such as event descriptions or workflow bodies). Pure (no I/O).
import { escapeHtml, escapeHtmlMultiline, htmlToText, safeHref } from "./html";
import { EMAIL_COLORS, EMAIL_FONT_STACK, emailButtonHtml, emailPrimaryColor, renderEmailLayout, renderEmailText } from "./layout";
import type { EmailBrand, RenderedEmail } from "./types";

/** One line of a field value: plain text, a link, or a struck-through former value ("Former time"). */
export type EmailFieldLine = string | { text: string; href?: string | null; strike?: boolean; muted?: boolean };

export type EmailField = {
  /** Bold label ("Event Type:", "Invitee", "Location"). */
  label: string;
  /** Single value (multi-line strings keep their line breaks). */
  value?: string | null;
  /** Several lines (each may be a link or struck through). */
  lines?: EmailFieldLine[];
  /** Trusted markup instead of value/lines (sanitized rich text). */
  html?: string | null;
  /** Plain text for `html` (defaults to htmlToText(html)). */
  text?: string | null;
};

export type EmailBlock =
  /** A paragraph of escaped text (line breaks kept). */
  | { kind: "text"; text: string; muted?: boolean; small?: boolean; bold?: boolean }
  /** Trusted markup (sanitized rich text); `text` is its plain version (defaults to htmlToText(html)). */
  | { kind: "html"; html: string; text?: string }
  /** A primary pill button ("View event in Kairos"). */
  | { kind: "button"; label: string; url: string }
  /** Label and value pairs, one under the other (Calendly notification details). */
  | { kind: "fields"; items: EmailField[] }
  /** "Need to make changes to this event?" followed by inline links ("Cancel", "Reschedule"). */
  | { kind: "links"; text?: string | null; links: { label: string; url: string }[] }
  /** A tinted callout (booked-over alerts, payment notes, "You were assigned this meeting."). */
  | { kind: "notice"; tone: "info" | "warning" | "success"; text: string; title?: string | null }
  /** A hairline separator. */
  | { kind: "divider" };

export type ComposeEmailInput = {
  preheader?: string;
  heading?: string;
  blocks: EmailBlock[];
  brand: EmailBrand;
  locale?: string;
  /** Why the recipient got this email (footer line, NT-05). */
  reason?: string | null;
  footerLinks?: { label: string; url: string }[];
};

const P = `margin:0 0 16px 0;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:24px;color:${EMAIL_COLORS.text}`;

function lineHtml(line: EmailFieldLine, linkColor: string): string {
  if (typeof line === "string") return escapeHtmlMultiline(line);
  let inner = escapeHtmlMultiline(line.text);
  const href = safeHref(line.href);
  if (href) inner = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="color:${linkColor};text-decoration:underline">${inner}</a>`;
  if (line.strike) inner = `<s style="text-decoration:line-through;color:${EMAIL_COLORS.secondary}">${inner}</s>`;
  else if (line.muted) inner = `<span style="color:${EMAIL_COLORS.secondary}">${inner}</span>`;
  return inner;
}

function lineText(line: EmailFieldLine): string {
  if (typeof line === "string") return line;
  const href = safeHref(line.href);
  const base = href && href !== line.text ? `${line.text} (${href.replace(/^mailto:/i, "")})` : line.text;
  return base;
}

function fieldLines(f: EmailField): EmailFieldLine[] {
  if (f.lines?.length) return f.lines;
  if (f.value !== undefined && f.value !== null && f.value !== "") return [f.value];
  return [];
}

function fieldsHtml(items: EmailField[], linkColor: string): string {
  const rows = items
    .map((f) => {
      const body = f.html ?? fieldLines(f).map((l) => lineHtml(l, linkColor)).join("<br>");
      if (!body) return "";
      return (
        `<tr><td style="padding:0 0 16px 0;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:24px;color:${EMAIL_COLORS.text}">` +
        `<div style="font-weight:700;margin:0 0 2px 0">${escapeHtml(f.label)}</div>` +
        `<div style="word-break:break-word">${body}</div></td></tr>`
      );
    })
    .join("");
  return rows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 8px 0">${rows}</table>`
    : "";
}

function fieldsText(items: EmailField[]): string {
  return items
    .map((f) => {
      const body = f.html ? (f.text ?? htmlToText(f.html)) : fieldLines(f).map(lineText).join("\n");
      return body.trim() ? `${f.label}\n${body.trim()}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

const NOTICE: Record<"info" | "warning" | "success", { bg: string; fg: string }> = {
  info: { bg: EMAIL_COLORS.infoBg, fg: EMAIL_COLORS.text },
  warning: { bg: EMAIL_COLORS.warningBg, fg: EMAIL_COLORS.warningText },
  success: { bg: EMAIL_COLORS.successBg, fg: EMAIL_COLORS.successText },
};

/** HTML of one block (inside the layout body cell). */
export function emailBlockHtml(block: EmailBlock, brand?: Pick<EmailBrand, "primaryColor"> | null): string {
  const primary = emailPrimaryColor(brand);
  switch (block.kind) {
    case "text": {
      if (!block.text.trim()) return "";
      const style =
        P +
        (block.muted ? `;color:${EMAIL_COLORS.secondary}` : "") +
        (block.small ? ";font-size:14px;line-height:20px" : "") +
        (block.bold ? ";font-weight:700" : "");
      return `<p style="${style}">${escapeHtmlMultiline(block.text)}</p>`;
    }
    case "html":
      return block.html ? `<div style="margin:0 0 16px 0">${block.html}</div>` : "";
    case "button":
      return emailButtonHtml(block.label, block.url, primary);
    case "fields":
      return fieldsHtml(block.items, primary);
    case "links": {
      const links = block.links.filter((l) => safeHref(l.url));
      if (!links.length) return "";
      const anchors = links
        .map(
          (l) =>
            `<a href="${escapeHtml(safeHref(l.url))}" target="_blank" rel="noopener" style="color:${primary};font-weight:600;` +
            `text-decoration:underline">${escapeHtml(l.label)}</a>`,
        )
        .join(`<span style="color:${EMAIL_COLORS.divider}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
      return (
        `<p style="${P};margin-top:8px">` +
        (block.text ? `${escapeHtml(block.text)}<br>` : "") +
        `${anchors}</p>`
      );
    }
    case "notice": {
      if (!block.text.trim()) return "";
      const c = NOTICE[block.tone];
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 16px 0">` +
        `<tr><td bgcolor="${c.bg}" style="background-color:${c.bg};border-radius:8px;padding:12px 16px;font-family:${EMAIL_FONT_STACK};` +
        `font-size:14px;line-height:20px;color:${c.fg}">` +
        (block.title ? `<div style="font-weight:700;margin:0 0 4px 0">${escapeHtml(block.title)}</div>` : "") +
        `${escapeHtmlMultiline(block.text)}</td></tr></table>`
      );
    }
    case "divider":
      return `<div style="border-top:1px solid ${EMAIL_COLORS.divider};height:1px;line-height:1px;font-size:1px;margin:8px 0 24px 0">&nbsp;</div>`;
  }
}

/** Plain text of one block. */
export function emailBlockText(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return block.text.trim();
    case "html":
      return (block.text ?? htmlToText(block.html)).trim();
    case "button": {
      const href = safeHref(block.url);
      return href ? `${block.label}: ${href}` : "";
    }
    case "fields":
      return fieldsText(block.items);
    case "links": {
      const links = block.links.filter((l) => safeHref(l.url));
      if (!links.length) return "";
      return [block.text?.trim() || null, ...links.map((l) => `${l.label}: ${safeHref(l.url)}`)].filter(Boolean).join("\n");
    }
    case "notice":
      return [block.title?.trim() || null, block.text.trim()].filter(Boolean).join("\n");
    case "divider":
      return "----------";
  }
}

/** Renders blocks into the layout: HTML and the matching plain text alternative. */
export function composeEmail(p: ComposeEmailInput): { html: string; text: string } {
  const bodyHtml = p.blocks.map((b) => emailBlockHtml(b, p.brand)).join("");
  const bodyText = p.blocks
    .map(emailBlockText)
    .filter((s) => s.length > 0)
    .join("\n\n");
  const { html } = renderEmailLayout({
    preheader: p.preheader,
    heading: p.heading,
    bodyHtml,
    brand: p.brand,
    locale: p.locale,
    reason: p.reason,
    footerLinks: p.footerLinks,
  });
  const text = renderEmailText({
    heading: p.heading,
    bodyText,
    brand: p.brand,
    locale: p.locale,
    reason: p.reason,
    footerLinks: p.footerLinks,
  });
  return { html, text };
}

/** composeEmail plus the subject (header-safe: no line breaks): what module template functions return. */
export function renderEmail(p: ComposeEmailInput & { subject: string }): RenderedEmail {
  const { html, text } = composeEmail(p);
  return { subject: p.subject.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim(), html, text };
}
