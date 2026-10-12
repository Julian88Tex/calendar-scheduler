// SSRF-safe outbound fetch (ARCHITECTURE section 18.9, SPEC GEN-08). The only way to fetch a user-supplied URL (ICS
// feeds, CalDAV including discovery redirects, webhook deliveries, any future user URL). Never call global fetch with
// a user-supplied URL.
//
// - https only (plus http://localhost when allowHttpLocalhost is set and not on Vercel); callers rewrite webcal://.
// - Every hop resolves the host with dns.lookup(host, { all: true }) and rejects the request when ANY address is
//   private (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1), link-local (169.254/16, fe80::/10), CGNAT
//   (100.64/10), unique local (fc00::/7), multicast, unspecified, reserved or documentation ranges, a cloud metadata
//   address (169.254.169.254, fd00:ec2::254, 168.63.129.16), or an IPv4-mapped / NAT64 / 6to4 IPv6 form of those.
// - The request then goes through an undici Agent whose connect.lookup returns only the validated addresses, so DNS
//   rebinding between the check and the connection is impossible (the IP is pinned at connect time; TLS still
//   verifies the certificate for the original host name).
// - redirect: "manual"; 3xx responses are followed here (relative Location resolved against the current URL), each
//   hop re-validated, at most maxRedirects (default 5; 0 returns the 3xx response itself).
// - The body is streamed and aborted beyond maxBytes (default 5 MB); the whole call is bounded by timeoutMs (15 s).
// - SAFE_FETCH_ALLOW_HOSTS (comma separated host names, ignored when VERCEL is set) lets self-hosted instances reach
//   a LAN CalDAV server; those hosts skip the private address check but are still pinned.
import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export type SafeFetchOptions = RequestInit & {
  /** Response body cap in bytes (default 5 MB). */
  maxBytes?: number;
  /** Total time budget in milliseconds, including redirects (default 15000). */
  timeoutMs?: number;
  /** Redirects to follow (default 5; 0 disables following and returns the 3xx response). */
  maxRedirects?: number;
  /** Allow http://localhost (dev only; never on Vercel). */
  allowHttpLocalhost?: boolean;
  /** Keep Authorization and Cookie headers on redirects: "same-site" (default: same registrable-ish domain), "always", "never". */
  keepAuthOnRedirect?: "same-site" | "always" | "never";
};

export type SafeFetchErrorCode = "invalid_url" | "blocked_address" | "too_many_redirects" | "too_large" | "timeout";

export class SafeFetchError extends Error {
  code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export const SAFE_FETCH_DEFAULTS = { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 5 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Address classification

type V4Range = [number, number]; // [network as uint32, prefix length]

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
};

const v4 = (cidr: string): V4Range => {
  const [ip, len] = cidr.split("/") as [string, string];
  return [ipv4ToInt(ip)!, Number(len)];
};

const BLOCKED_V4: V4Range[] = [
  v4("0.0.0.0/8"), // "this network", unspecified
  v4("10.0.0.0/8"), // private
  v4("100.64.0.0/10"), // CGNAT (also Alibaba metadata 100.100.100.200)
  v4("127.0.0.0/8"), // loopback
  v4("169.254.0.0/16"), // link-local, cloud metadata 169.254.169.254
  v4("172.16.0.0/12"), // private
  v4("192.0.0.0/24"), // IETF protocol assignments
  v4("192.0.2.0/24"), // TEST-NET-1
  v4("192.88.99.0/24"), // 6to4 relay anycast
  v4("192.168.0.0/16"), // private
  v4("198.18.0.0/15"), // benchmarking
  v4("198.51.100.0/24"), // TEST-NET-2
  v4("203.0.113.0/24"), // TEST-NET-3
  v4("224.0.0.0/4"), // multicast
  v4("240.0.0.0/4"), // reserved, broadcast
  v4("168.63.129.16/32"), // Azure wire server / metadata
];

function v4Blocked(n: number): boolean {
  return BLOCKED_V4.some(([net, len]) => (len === 0 ? true : (n >>> (32 - len)) === (net >>> (32 - len))));
}

/** Parses an IPv6 address (optionally bracketed, with an embedded dotted IPv4 tail) into 8 groups, or null. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.includes("%")) ip = ip.slice(0, ip.indexOf("%"));
  if (isIP(ip) !== 6) return null;
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = ipv4ToInt(maybeV4);
    if (n === null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    ip = `${ip.slice(0, lastColon + 1)}0:0`;
  }
  const [head, rest] = ip.includes("::") ? (ip.split("::") as [string, string]) : [ip, null];
  const parse = (s: string) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  let groups: number[];
  if (rest === null) groups = h;
  else {
    const r = parse(rest);
    groups = [...h, ...new Array(8 - h.length - r.length).fill(0), ...r];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
}

function embeddedV4(g: number[], hiIndex: number): number {
  return ((g[hiIndex]! << 16) | g[hiIndex + 1]!) >>> 0;
}

function v6Blocked(g: number[]): boolean {
  const [a, b, c, d, e, f] = g as [number, number, number, number, number, number, number, number];
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped): decide by the embedded IPv4 address.
  if (allZeroTo(5) && f === 0xffff) return v4Blocked(embeddedV4(g, 6));
  // ::ffff:0:a.b.c.d (IPv4-translated, RFC 2765)
  if (allZeroTo(4) && e === 0xffff && f === 0) return v4Blocked(embeddedV4(g, 6));
  // 64:ff9b::/96 NAT64: decide by the embedded IPv4 address; 64:ff9b:1::/48 local-use NAT64: blocked.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return v4Blocked(embeddedV4(g, 6));
  if (a === 0x64 && b === 0xff9b && c === 1) return true;
  // The rest of ::/8 (unspecified, loopback, IPv4-compatible and other reserved forms)
  if ((a & 0xff00) === 0) return true;
  // 100::/64 discard
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true;
  // 2001::/23 IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID), 2001:db8::/32 documentation
  if (a === 0x2001 && b < 0x200) return true;
  if (a === 0x2001 && b === 0xdb8) return true;
  // 2002::/16 6to4: decide by the embedded IPv4 address (bits 16 to 47).
  if (a === 0x2002) return v4Blocked(((b << 16) | c) >>> 0);
  // 3fff::/20 documentation
  if (a === 0x3fff && (b & 0xf000) === 0) return true;
  // fc00::/7 unique local (includes the AWS metadata address fd00:ec2::254)
  if ((a & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local, fec0::/10 site-local (deprecated)
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast
  if ((a & 0xff00) === 0xff00) return true;
  return false;
}

/**
 * True when outbound requests must never reach this address (private, loopback, link-local, CGNAT, unique local,
 * multicast, unspecified, reserved, documentation, metadata, and IPv4-mapped / NAT64 / 6to4 forms of them). Invalid
 * input counts as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  if (trimmed.includes("%")) return true; // scoped (zone id) addresses are link-local by definition
  const family = isIP(trimmed);
  if (family === 4) {
    const n = ipv4ToInt(trimmed);
    return n === null ? true : v4Blocked(n);
  }
  if (family === 6) {
    const g = parseIPv6(trimmed);
    return g === null ? true : v6Blocked(g);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Resolution, pinning and transport (overridable in tests)

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type Transport = (url: URL, init: RequestInit, addresses: ResolvedAddress[], signal: AbortSignal) => Promise<Response>;

const defaultResolver: Resolver = async (hostname) => {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** A net/tls `lookup` that ignores DNS and answers with the validated addresses only (connect-time pinning). */
export function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  if (!addresses.length) throw new Error("createPinnedLookup: no addresses");
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const opts = (typeof options === "object" && options !== null ? options : {}) as { all?: boolean; family?: number };
    const wanted = opts.family === 4 || opts.family === 6 ? addresses.filter((a) => a.family === opts.family) : addresses;
    const list = wanted.length ? wanted : addresses;
    if (opts.all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, list[0]!.address, list[0]!.family);
  }) as LookupFunction;
}

/**
 * One HTTP exchange with the connection pinned to `addresses` (no redirects followed). Exported for the connect-time
 * pinning test; use safeFetch() everywhere else.
 */
export const pinnedFetch: Transport = async (url, init, addresses, signal) => {
  const agent = new Agent({ connect: { lookup: createPinnedLookup(addresses), timeout: 10_000 }, keepAliveTimeout: 1 });
  try {
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string> | undefined,
      body: init.body as never,
      redirect: "manual",
      signal,
      dispatcher: agent,
    });
    // Hand back a WHATWG Response whose body stream keeps the agent alive until it is read or canceled.
    const body = res.body;
    const closeAgent = () => void agent.close().catch(() => {});
    if (!body) {
      closeAgent();
      return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers as unknown as Headers });
    }
    const reader = body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            closeAgent();
          } else controller.enqueue(value);
        } catch (e) {
          controller.error(e);
          closeAgent();
        }
      },
      cancel(reason) {
        void reader.cancel(reason).catch(() => {});
        closeAgent();
      },
    });
    return new Response(isNullBodyStatus(res.status) ? null : stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers as unknown as Headers,
    });
  } catch (e) {
    void agent.close().catch(() => {});
    throw e;
  }
};

let resolver: Resolver = defaultResolver;
let transport: Transport = pinnedFetch;

/** Test hooks: replace DNS resolution and/or the transport. Call with {} to restore the defaults. */
export function setSafeFetchTestHooks(hooks: { resolver?: Resolver; transport?: Transport }): void {
  resolver = hooks.resolver ?? defaultResolver;
  transport = hooks.transport ?? pinnedFetch;
}

const isNullBodyStatus = (status: number) => status === 101 || status === 204 || status === 205 || status === 304;

function allowHosts(): Set<string> {
  if (process.env.VERCEL) return new Set();
  return new Set(
    (process.env.SAFE_FETCH_ALLOW_HOSTS ?? "")
      .split(/[,\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const isLocalhostName = (host: string) => host === "localhost" || host.endsWith(".localhost");

function checkUrl(url: URL, opts: SafeFetchOptions): { localhostDev: boolean } {
  if (url.username || url.password) throw new SafeFetchError("invalid_url", "URLs with credentials are not allowed");
  if (url.protocol === "https:") return { localhostDev: false };
  if (url.protocol === "http:" && opts.allowHttpLocalhost && !process.env.VERCEL && isLocalhostName(url.hostname)) {
    return { localhostDev: true };
  }
  throw new SafeFetchError("invalid_url", `Only https URLs are allowed (got ${url.protocol.replace(":", "")})`);
}

/** Resolves and validates the host of one hop (exported for tests). */
export async function resolveAndValidate(url: URL, opts: SafeFetchOptions = {}): Promise<ResolvedAddress[]> {
  const { localhostDev } = checkUrl(url, opts);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new SafeFetchError("invalid_url", "Missing host");
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new SafeFetchError("invalid_url", `Could not resolve ${host}`);
    }
    if (!addresses.length) throw new SafeFetchError("invalid_url", `Could not resolve ${host}`);
  }
  const exempt = localhostDev || allowHosts().has(host);
  if (!exempt) {
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) throw new SafeFetchError("blocked_address", `${host} resolves to a blocked address`);
  }
  return addresses;
}

function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  return labels.slice(-2).join(".");
}

function headersForRedirect(headers: Headers, from: URL, to: URL, mode: SafeFetchOptions["keepAuthOnRedirect"]): Headers {
  const next = new Headers(headers);
  const keep = mode === "always" || (mode !== "never" && siteOf(from.hostname) === siteOf(to.hostname));
  if (!keep) {
    next.delete("authorization");
    next.delete("cookie");
    next.delete("proxy-authorization");
  }
  return next;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!res.body) return null;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel().catch(() => {});
    throw new SafeFetchError("too_large", `Response is larger than ${maxBytes} bytes`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SafeFetchError("too_large", `Response is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Fetches a user-supplied URL safely (see the file header). Returns a buffered Response (its `url` is the final URL
 * after redirects). Throws SafeFetchError for invalid or blocked URLs, too many redirects, oversize bodies and
 * timeouts; network errors from the server propagate as TypeError like fetch.
 */
export async function safeFetch(input: string | URL, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const timeoutMs = opts.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("invalid_url", "Invalid URL");
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let method = (opts.method ?? "GET").toUpperCase();
  let body = opts.body ?? null;
  let headers = new Headers(opts.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", "Kairos/1.0 (+safe-fetch)");

  try {
    for (let hop = 0; ; hop++) {
      const addresses = await resolveAndValidate(url, opts);
      const res = await transport(url, { method, headers, body, redirect: "manual" }, addresses, signal);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location && maxRedirects > 0) {
        await res.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects`);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SafeFetchError("invalid_url", "Invalid redirect location");
        }
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = method === "HEAD" ? "HEAD" : "GET";
          body = null;
          headers.delete("content-type");
          headers.delete("content-length");
        } else if (body && typeof (body as ReadableStream).getReader === "function") {
          throw new SafeFetchError("invalid_url", "Cannot replay a streamed body across a redirect");
        }
        headers = headersForRedirect(headers, url, next, opts.keepAuthOnRedirect);
        url = next;
        continue;
      }
      const bytes = method === "HEAD" || isNullBodyStatus(res.status) ? null : await readCapped(res, maxBytes);
      if (bytes === null) await res.body?.cancel().catch(() => {});
      const out = new Response(bytes && !isNullBodyStatus(res.status) ? bytes : null, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      Object.defineProperty(out, "url", { value: url.toString() });
      Object.defineProperty(out, "redirected", { value: hop > 0 });
      return out;
    }
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    if (timeout.aborted) throw new SafeFetchError("timeout", `Request timed out after ${timeoutMs} ms`);
    throw e;
  }
}

/** Rewrites webcal:// and webcals:// to https:// (ICS subscriptions). */
export function normalizeFeedUrl(raw: string): string {
  return raw.trim().replace(/^webcals?:\/\//i, "https://");
}
