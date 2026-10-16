// A small, strict RFC 5322 / RFC 2045 parser for the Gmail transport tests: it reads back the raw message the
// transport builds (independently of nodemailer), so the tests check the bytes Gmail receives. Supports folded
// headers, RFC 2047 encoded words (B and Q, UTF-8), multipart bodies (nested), and the base64, quoted-printable,
// 7bit and 8bit transfer encodings.

export type MimeHeader = { name: string; raw: string; value: string };

export type MimePart = {
  headers: MimeHeader[];
  /** Lowercase "type/subtype". */
  contentType: string;
  /** Content-Type parameters (lowercase names). */
  params: Record<string, string>;
  /** Content-Disposition value ("attachment", "inline") or null. */
  disposition: string | null;
  dispositionParams: Record<string, string>;
  /** Decoded body bytes (leaf parts). */
  body: Buffer;
  parts: MimePart[];
  /** First header value by name (decoded), or null. */
  header: (name: string) => string | null;
  /** Every value of a header (decoded). */
  headerAll: (name: string) => string[];
  /** The body as UTF-8 text. */
  text: () => string;
};

/** Decodes RFC 2047 encoded words; whitespace between two adjacent encoded words is dropped. */
export function decodeEncodedWords(value: string): string {
  const re = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  const collapsed = value.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, "$1");
  // Decode adjacent words together so multi-byte characters split across words survive.
  const chunks: { bytes: Buffer; charset: string }[] = [];
  let out = "";
  let last = 0;
  const flush = () => {
    if (!chunks.length) return;
    out += Buffer.concat(chunks.map((c) => c.bytes)).toString("utf8");
    chunks.length = 0;
  };
  for (const m of collapsed.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      flush();
      out += collapsed.slice(last, idx);
    }
    const charset = m[1]!.toLowerCase();
    if (charset !== "utf-8" && charset !== "us-ascii") throw new Error(`unexpected charset ${charset}`);
    const enc = m[2]!.toUpperCase();
    const text = m[3]!;
    const bytes =
      enc === "B"
        ? Buffer.from(text, "base64")
        : Buffer.from(
            text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16))),
            "latin1",
          );
    chunks.push({ bytes, charset });
    last = idx + m[0].length;
  }
  flush();
  out += collapsed.slice(last);
  return out;
}

function parseParams(rest: string): Record<string, string> {
  const params: Record<string, string> = {};
  const re = /;\s*([A-Za-z0-9!#$&^_.+-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g;
  for (const m of rest.matchAll(re)) params[m[1]!.toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : (m[3] ?? "");
  return params;
}

function splitValue(value: string): { main: string; params: Record<string, string> } {
  const i = value.indexOf(";");
  if (i < 0) return { main: value.trim().toLowerCase(), params: {} };
  return { main: value.slice(0, i).trim().toLowerCase(), params: parseParams(value.slice(i)) };
}

function decodeQuotedPrintable(s: string): Buffer {
  const soft = s.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const ch = soft[i]!;
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** Parses a raw message or MIME part given as a byte string (latin1, CRLF line breaks). Throws on malformed structure. */
export function parseMime(raw: string): MimePart {
  const sep = raw.indexOf("\r\n\r\n");
  const headerBlock = sep < 0 ? raw : raw.slice(0, sep);
  const bodyRaw = sep < 0 ? "" : raw.slice(sep + 4);
  const headers: MimeHeader[] = headerBlock
    .replace(/\r\n[ \t]+/g, " ")
    .split("\r\n")
    .filter(Boolean)
    .map((line) => {
      const c = line.indexOf(":");
      if (c <= 0) throw new Error(`malformed header line: ${line}`);
      const rawValue = line.slice(c + 1).trim();
      return { name: line.slice(0, c), raw: rawValue, value: decodeEncodedWords(rawValue) };
    });
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const headerAll = (name: string) => headers.filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);
  const ct = splitValue(header("content-type") ?? "text/plain; charset=us-ascii");
  const cd = header("content-disposition");
  const disp = cd ? splitValue(cd) : null;
  const part: MimePart = {
    headers,
    contentType: ct.main,
    params: ct.params,
    disposition: disp?.main ?? null,
    dispositionParams: disp?.params ?? {},
    body: Buffer.alloc(0),
    parts: [],
    header,
    headerAll,
    text: () => part.body.toString("utf8"),
  };
  if (ct.main.startsWith("multipart/")) {
    const boundary = ct.params.boundary;
    if (!boundary) throw new Error("multipart without boundary");
    const delimiter = `--${boundary}`;
    const pieces = `\r\n${bodyRaw}`.split(`\r\n${delimiter}`);
    // pieces[0] is the preamble; the last piece starts with "--" (the closing delimiter).
    const closing = pieces.findIndex((p, i) => i > 0 && p.startsWith("--"));
    if (closing < 0) throw new Error(`multipart ${boundary} has no closing delimiter`);
    for (const piece of pieces.slice(1, closing)) {
      const content = piece.replace(/^[ \t]*\r\n/, "");
      part.parts.push(parseMime(content));
    }
    return part;
  }
  const cte = (header("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (cte === "base64") part.body = Buffer.from(bodyRaw.replace(/\s+/g, ""), "base64");
  else if (cte === "quoted-printable") part.body = decodeQuotedPrintable(bodyRaw);
  else if (cte === "7bit" || cte === "8bit" || cte === "binary") part.body = Buffer.from(bodyRaw, "latin1");
  else throw new Error(`unexpected transfer encoding ${cte}`);
  return part;
}

/** Every leaf part, depth first. */
export function leafParts(part: MimePart): MimePart[] {
  return part.parts.length ? part.parts.flatMap(leafParts) : [part];
}

/** The decoded raw message of a Gmail API `{ raw }` body (base64url). */
export function decodeGmailRaw(raw: string): string {
  if (/[+/=]/.test(raw)) throw new Error("raw is not base64url without padding");
  return Buffer.from(raw, "base64url").toString("latin1");
}
