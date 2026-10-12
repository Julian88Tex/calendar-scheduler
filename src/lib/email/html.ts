// HTML helpers for email markup (ARCHITECTURE section 13.1): escaping and the plain text alternative. Pure and client
// safe (no imports).

/** HTML escaping for text inserted into email markup (element content and quoted attribute values). */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped text with line breaks kept as <br> (user-entered multi-line values such as answers and reasons). */
export function escapeHtmlMultiline(s: string): string {
  return escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
}

/** True for absolute http(s) URLs (links in emails must be absolute, NT-05). */
export function isAbsoluteHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** A safe href: absolute http(s) and mailto:/tel: links pass, anything else (javascript:, data:, relative) becomes "". */
export function safeHref(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^(mailto|tel):/i.test(trimmed)) return trimmed;
  return isAbsoluteHttpUrl(trimmed) ? trimmed : "";
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  zwnj: "",
  zwj: "",
  shy: "",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      if (code === 0xa0) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
};

/**
 * Plain text version of an email body: links become "text (url)" (or just the url when the text is the url), images
 * their alt text, block elements lines, list items "- item", table cells separated by spaces. Hidden preheaders
 * (`data-preheader`), head, style and script are dropped; whitespace is collapsed like a browser would.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<([a-z0-9]+)\b[^>]*\sdata-preheader\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // Collapse source whitespace first (newlines in markup are not line breaks).
  s = s.replace(/\s+/g, " ");
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const href = attr(`<a${attrs}>`, "href") ?? "";
    const label = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const target = href.replace(/^mailto:/i, "");
    if (!href || /^(javascript|data):/i.test(href)) return label;
    if (!label) return target;
    if (label === href || label === target) return label;
    return `${label} (${target})`;
  });
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attr(tag, "alt");
    return alt ? ` ${alt} ` : "";
  });
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n----------\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, "  ")
    .replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t: string, inner: string) => `${inner}`)
    .replace(/<\/?(p|div|h[1-6]|tr|table|tbody|thead|tfoot|ul|ol|blockquote|section|article|header|footer|center|pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
