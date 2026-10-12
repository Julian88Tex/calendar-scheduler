// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Twilio request validation (SPEC NT-16, ARCHITECTURE section 13.4): X-Twilio-Signature is the base64 HMAC-SHA1 of
// the full request URL followed by every POST parameter name and value, sorted by name, keyed with
// TWILIO_AUTH_TOKEN; compared in constant time. Like Twilio's own helper, the URL is also tried with the default port
// added or removed (proxies and load balancers differ in what they report). Used by the workflows inbound webhook,
// which answers 403 on mismatch. Repeated parameters (arrays) contribute each value in order.
import { createHmac, timingSafeEqual } from "node:crypto";

export type TwilioParams = Record<string, string | string[] | undefined>;

/** The signature Twilio computes for a URL and its POST parameters. */
export function twilioSignature(authToken: string, url: string, params: TwilioParams): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) data += key + v;
  }
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

function urlVariants(url: string): string[] {
  const out = [url];
  // URL() hides default ports, so work on the raw string: "https://host:443/x" <-> "https://host/x".
  const m = /^(https?):\/\/([^/:?#]+)(?::(\d+))?(.*)$/i.exec(url);
  if (!m) return out;
  const [, scheme, host, port, rest] = m;
  const defaultPort = scheme!.toLowerCase() === "https" ? "443" : "80";
  if (port === undefined) out.push(`${scheme}://${host}:${defaultPort}${rest}`);
  else if (port === defaultPort) out.push(`${scheme}://${host}${rest}`);
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyTwilioSignature(p: {
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
  /** Defaults to process.env.TWILIO_AUTH_TOKEN. */
  authToken?: string;
}): boolean {
  const token = p.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!token || !p.signature || !p.url) return false;
  const signature = p.signature.trim();
  let ok = false;
  for (const variant of urlVariants(p.url)) {
    // Evaluate every variant (no early exit) to keep timing independent of which one matches.
    if (safeEqual(twilioSignature(token, variant, p.params), signature)) ok = true;
  }
  return ok;
}
