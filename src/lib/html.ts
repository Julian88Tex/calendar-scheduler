// User HTML (SPEC GEN-08: sanitized on save and on render; ARCHITECTURE section 21). Server only (sanitize-html).
//
// sanitizeRichText(): the RichTextEditor subset (paragraphs, line breaks, bold, italic, underline, strike, lists,
// links, blockquote, code, headings h2 to h4, variable chips as <span data-variable="event_name">). Links keep http,
// https, mailto and tel only and always get rel="noopener noreferrer nofollow" target="_blank".
// richTextToPlain(): text with line breaks for SMS, ICS descriptions and plain text email parts.
// autolink(): escapes plain text and turns URLs and emails into links (descriptions entered as text, invitee notes).
import "server-only";
import sanitizeHtml from "sanitize-html";

const RICH_TEXT: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "ul", "ol", "li", "a", "blockquote", "code",
    "pre", "h2", "h3", "h4", "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "title"],
    span: ["data-variable", "class"],
    ol: ["start"],
  },
  allowedClasses: { span: ["variable"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: ["style", "script", "textarea", "option", "noscript", "iframe", "object", "embed", "svg", "math"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    div: "p",
  },
  exclusiveFilter: (frame) => frame.tag === "a" && !frame.attribs.href,
};

/** Sanitizes rich text HTML from users (call on save and again before rendering stored HTML). */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, RICH_TEXT).trim();
}

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * Plain text from rich text: block elements and <br> become line breaks, list items get "- ", links keep their URL
 * in parentheses when it differs from the text, entities are decoded, runs of blank lines collapse.
 */
export function richTextToPlain(html: string | null | undefined): string {
  if (!html) return "";
  const withLinks = sanitizeHtml(html, {
    allowedTags: ["a", "br", "p", "li", "ul", "ol", "h2", "h3", "h4", "blockquote", "pre", "div"],
    allowedAttributes: { a: ["href"] },
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  });
  const text = withLinks
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, "").trim();
      const h = decodeEntities(href);
      return !l ? h : l === h || `mailto:${l}` === h || `tel:${l}` === h ? l : `${l} (${h})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|li|h2|h3|h4|blockquote|pre|div)>/gi, "\n")
    .replace(/<(p|ul|ol|h2|h3|h4|blockquote|pre|div)[^>]*>/gi, "")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const URL_OR_EMAIL = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

/** Escapes plain text and links URLs and email addresses; newlines become <br>. */
export function autolink(text: string | null | undefined): string {
  if (!text) return "";
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_OR_EMAIL)) {
    const index = m.index ?? 0;
    out += escapeHtml(text.slice(last, index));
    const [match, url, email] = m;
    const href = url ? url : `mailto:${email}`;
    out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(match)}</a>`;
    last = index + match.length;
  }
  out += escapeHtml(text.slice(last));
  return out.replace(/\r?\n/g, "<br>");
}

/** Plain text to minimal HTML paragraphs (escaped). */
export function plainToHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}
