// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Twilio request validation (ARCHITECTURE section 13.4): HMAC-SHA1 over the full URL followed by every POST parameter
// name and value sorted by name, base64, keyed with TWILIO_AUTH_TOKEN, timing-safe compare. Used by the workflows
// inbound webhook (403 on mismatch).
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyTwilioSignature(p: {
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
  /** Defaults to process.env.TWILIO_AUTH_TOKEN. */
  authToken?: string;
}): boolean {
  const token = p.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!token || !p.signature) return false;
  const data = Object.keys(p.params)
    .sort()
    .reduce((acc, key) => acc + key + (p.params[key] ?? ""), p.url);
  const expected = Buffer.from(createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64"));
  const given = Buffer.from(p.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
