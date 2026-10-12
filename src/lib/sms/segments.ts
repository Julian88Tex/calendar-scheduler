// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SMS segment math and phone number helpers (SPEC NT-16). Pure and client safe (the workflow editor shows the
// counter): GSM-7 bodies use 160 characters per message (153 per part when split), anything else UCS-2 with 70 (67).

// GSM 03.38 basic character set and the extension table (extension characters cost two septets).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";
const BASIC = new Set([...GSM_BASIC]);
const EXTENDED = new Set([...GSM_EXTENDED]);

/** Composed body limit of a text message (NT-16 counter, "Max 180 characters"). */
export const SMS_BODY_MAX = 180;

export type SmsEncoding = "GSM-7" | "UCS-2";

/** Encoding, segment count and length units of a body (what Twilio bills). */
export function smsSegments(body: string): { encoding: SmsEncoding; segments: number; units: number; perSegment: number } {
  const chars = [...(body ?? "")];
  let gsm = true;
  let septets = 0;
  for (const ch of chars) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = septets === 0 ? 1 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "GSM-7", segments, units: septets, perSegment: segments === 1 ? 160 : 153 };
  }
  // UCS-2 counts UTF-16 code units (emoji outside the BMP take two).
  const units = (body ?? "").length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "UCS-2", segments, units, perSegment: segments === 1 ? 70 : 67 };
}

/**
 * Normalizes a phone number to E.164 ("+1 (415) 555-0100" -> "+14155550100"); "00" international prefixes become
 * "+". Returns null when the result is not a plausible E.164 number (7 to 15 digits after "+", no leading zero).
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = String(value).trim().replace(/[\s().\-\u00a0]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (!v.startsWith("+")) return null;
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}

/** Country calling codes we never text (ARCHITECTURE 13.4): +7 Russia, +65 Singapore, +98 Iran. */
export const UNSUPPORTED_SMS_PREFIXES = ["+7", "+65", "+98"] as const;

/** True when texts to this E.164 number are not supported. */
export function isUnsupportedSmsCountry(e164: string): boolean {
  return UNSUPPORTED_SMS_PREFIXES.some((p) => e164.startsWith(p));
}

/** "+1 ***-***-0100" style masked number for logs and the UI. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length <= 4) return e164;
  return `+${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const OPT_IN = new Set(["START", "YES", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO"]);

/** Twilio's standard opt-out keywords in an inbound reply (first word, case-insensitive), else null. */
export function smsKeyword(body: string | null | undefined): "opt_out" | "opt_in" | "help" | null {
  const word = (body ?? "").trim().split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";
  if (OPT_OUT.has(word)) return "opt_out";
  if (OPT_IN.has(word)) return "opt_in";
  if (HELP.has(word)) return "help";
  return null;
}
