// OWNER: foundation-ui.
//
// Pure helpers of RichTextEditor (server and client safe, no DOM): a small allowlist HTML sanitizer for the editor
// subset (paragraphs, line breaks, bold, italic, underline, strike, lists, links, variable chips), the plain-text
// conversion, and variable chip handling. Servers sanitize again with sanitizeRichText (src/lib/html.ts); this keeps
// the editor's own output clean and predictable.

const ALLOWED = new Set(["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "a", "span", "blockquote", "h2", "h3", "h4"]);
const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s", div: "p", ins: "u" };
const VOID = new Set(["br"]);
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "textarea", "select", "option", "head", "title"]);
const BLOCKS = new Set(["p", "li", "blockquote", "h2", "h3", "h4", "ul", "ol"]);
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
const VARIABLE_KEY = /^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/;

type Token =
  | { type: "text"; value: string }
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string };

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Decodes the entities the editor and browsers emit (named basics plus numeric). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1]!.toLowerCase();
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ type: "text", value: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", value: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)(\/?)>/.exec(html.slice(lt));
    if (!m) {
      // A lone "<" is text.
      tokens.push({ type: "text", value: "<" });
      i = lt + 1;
      continue;
    }
    const [whole, slash, rawName, attrSource, selfClose] = m;
    const name = rawName!.toLowerCase();
    if (slash) tokens.push({ type: "close", name });
    else tokens.push({ type: "open", name, attrs: parseAttrs(attrSource ?? ""), selfClosing: Boolean(selfClose) || VOID.has(name) });
    i = lt + whole.length;
    if (!slash && DROP_CONTENT.has(name) && !selfClose) {
      const closeRe = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(i);
      const cm = closeRe.exec(rest);
      i = cm ? i + cm.index + cm[0].length : html.length;
      tokens.pop();
    }
  }
  return tokens;
}

export function isSafeHref(href: string): boolean {
  const t = href.trim();
  if (/[\u0000-\u001f]/.test(t)) return false;
  return SAFE_SCHEME.test(t);
}

/**
 * Normalizes a link typed by the user: adds https:// to bare domains, mailto: to emails; returns null for unsafe or
 * empty input (javascript:, data:, ...).
 */
export function normalizeLink(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return isSafeHref(t) ? t : null;
  if (/^[^\s/]+\.[^\s]{2,}/.test(t)) return `https://${t}`;
  return null;
}

/**
 * Sanitizes editor HTML to the allowlist: renames b/i/strike/div, drops scripts and their content, unwraps unknown
 * tags (keeping their text), keeps safe links (rel and target added) and variable chips
 * (<span data-variable="key" class="variable">), balances tags and trims empty trailing paragraphs.
 */
export function sanitizeEditorHtml(html: string): string {
  const out: string[] = [];
  // Open allowed tags; `emitted` is false for unwrapped ones (a without a safe href, span without data-variable).
  const stack: { name: string; emitted: boolean }[] = [];

  for (const tok of tokenize(html ?? "")) {
    if (tok.type === "text") {
      out.push(escapeText(decodeEntities(tok.value)));
      continue;
    }
    const name = RENAME[tok.name] ?? tok.name;
    if (!ALLOWED.has(name)) continue;
    if (tok.type === "open") {
      if (name === "br") {
        out.push("<br>");
        continue;
      }
      if (name === "a") {
        const href = (tok.attrs.href ?? "").trim();
        const ok = href !== "" && isSafeHref(href);
        if (ok) out.push(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`);
        stack.push({ name, emitted: ok });
        continue;
      }
      if (name === "span") {
        const key = tok.attrs["data-variable"];
        const ok = Boolean(key && VARIABLE_KEY.test(key));
        if (ok) out.push(`<span data-variable="${escapeAttr(key!)}" class="variable">`);
        stack.push({ name, emitted: ok });
        continue;
      }
      if (name === "ol" && tok.attrs.start && /^\d{1,4}$/.test(tok.attrs.start)) out.push(`<ol start="${tok.attrs.start}">`);
      else out.push(`<${name}>`);
      stack.push({ name, emitted: true });
      continue;
    }
    if (name === "br") continue;
    let index = -1;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.name === name) {
        index = k;
        break;
      }
    }
    if (index === -1) continue;
    while (stack.length > index) {
      const top = stack.pop()!;
      if (top.emitted) out.push(`</${top.name}>`);
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.emitted) out.push(`</${top.name}>`);
  }
  // Trim empty trailing paragraphs; an editor holding only whitespace or line breaks is empty.
  const result = out
    .join("")
    .replace(/(<p>(\s|&nbsp;|\u00a0|<br>)*<\/p>)+$/g, "")
    .trim();
  if (/^(\s|<br>|&nbsp;|\u00a0|<p>|<\/p>)*$/.test(result)) return "";
  return result;
}

/**
 * Plain text for SMS, ICS and text emails: paragraphs and line breaks become newlines, list items get "- " (or "1. ")
 * prefixes, variable chips keep their "{{key}}" text, entities are decoded.
 */
export function editorHtmlToText(html: string): string {
  const parts: string[] = [];
  const lists: { type: "ul" | "ol"; n: number }[] = [];
  let lastBlockEnd = true;
  const newline = () => {
    if (parts.length && !parts[parts.length - 1]!.endsWith("\n")) parts.push("\n");
  };
  for (const tok of tokenize(sanitizeEditorHtml(html))) {
    if (tok.type === "text") {
      parts.push(decodeEntities(tok.value).replace(/ /g, " "));
      lastBlockEnd = false;
      continue;
    }
    if (tok.type === "open") {
      if (tok.name === "br") {
        parts.push("\n");
      } else if (tok.name === "ul" || tok.name === "ol") {
        newline();
        lists.push({ type: tok.name, n: 0 });
      } else if (tok.name === "li") {
        newline();
        const list = lists[lists.length - 1];
        const indent = "  ".repeat(Math.max(0, lists.length - 1));
        if (list) {
          list.n += 1;
          parts.push(`${indent}${list.type === "ol" ? `${list.n}. ` : "- "}`);
        }
      } else if (BLOCKS.has(tok.name) && !lastBlockEnd) {
        newline();
      }
      continue;
    }
    if (tok.name === "ul" || tok.name === "ol") {
      lists.pop();
      newline();
    } else if (tok.name === "p" || tok.name === "blockquote" || tok.name.startsWith("h")) {
      parts.push("\n");
      lastBlockEnd = true;
    }
  }
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Converts raw "{{key}}" text in HTML (outside tags) into variable chips for the known keys. */
export function chipifyVariables(html: string, keys: readonly string[]): string {
  if (keys.length === 0) return html;
  const known = new Set(keys);
  return html
    .split(/(<[^>]*>)/g)
    .map((part, i, all) => {
      if (part.startsWith("<")) return part;
      // Do not chipify inside an existing chip (previous token opened a variable span).
      const prev = all[i - 1] ?? "";
      if (/^<span[^>]*data-variable=/i.test(prev)) return part;
      return part.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g, (m, key: string) =>
        known.has(key) ? `<span data-variable="${key}" class="variable">{{${key}}}</span>` : m,
      );
    })
    .join("");
}

/** Normalizes every chip's text to "{{key}}" (the editor shows friendly labels while editing). */
export function normalizeChipText(html: string): string {
  return html.replace(/<span data-variable="([^"]+)" class="variable">[\s\S]*?<\/span>/g, (_m, key: string) => `<span data-variable="${key}" class="variable">{{${key}}}</span>`);
}

/** The plain-text length the editor counts against maxLength. */
export function plainLength(html: string): number {
  return editorHtmlToText(html).length;
}
