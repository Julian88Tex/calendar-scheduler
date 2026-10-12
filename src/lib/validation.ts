// Shared zod helpers (ARCHITECTURE section 21). Client and server safe (zod only). Messages are user-facing copy.
//
//   const Input = z.object({ email: zEmail, timezone: zTimeZone, color: zHexColor, slug: zSlug });
import { z } from "zod";
import type { LocationConfig, LocationKind, MinuteRange, WeeklyHours } from "@/db/types";

/** True when Intl (and therefore luxon) accepts the zone, including "UTC" and legacy aliases ("Asia/Calcutta"). */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim() || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone, stored exactly as given (GEN-06). */
export const zTimeZone = z
  .string()
  .trim()
  .refine((v) => isValidTimeZone(v), "Choose a valid time zone");

/** Email address, trimmed (store emailNormalized = normalizeEmail(value) next to it). */
export const zEmail = z
  .string()
  .trim()
  .max(254, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

/** Lowercase trimmed email for matching and unique indexes (ARCHITECTURE 5.2). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "#RRGGBB" (case-insensitive input, normalized to lowercase). */
export const zHexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Enter a color like #006bff")
  .transform((v) => v.toLowerCase());

/** Event type slug (GEN-02), lowercased. */
export const zSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens (1 to 100 characters)");

/** Handle pattern (GEN-02), lowercased. Reserved words and availability are checked by src/lib/slugs.ts. */
export const zHandle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens (1 to 50 characters)");

/** E.164 phone number ("+14155550123"). */
export const zE164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Enter a phone number with country code, like +14155550123");

/** Minutes from local midnight, 0 to 1440. */
export const zMinutes = z.number().int().min(0).max(1440);

/** A non-empty interval of minutes from local midnight (start < end). */
export const zMinuteRange: z.ZodType<MinuteRange> = z
  .object({ start: zMinutes, end: zMinutes })
  .refine((r) => r.start < r.end, { message: "End time must be after start time", path: ["end"] });

/** Sorted, non-overlapping intervals for one day. */
export const zDayIntervals = z
  .array(zMinuteRange)
  .max(48)
  .refine(
    (list) => {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      return sorted.every((r, i) => i === 0 || r.start >= sorted[i - 1]!.end);
    },
    { message: "Times overlap" },
  );

/** Seven days of intervals, index 0 = Sunday. */
export const zWeeklyHours = z
  .tuple([zDayIntervals, zDayIntervals, zDayIntervals, zDayIntervals, zDayIntervals, zDayIntervals, zDayIntervals])
  .transform((v) => v as WeeklyHours);

export const LOCATION_KINDS: readonly LocationKind[] = [
  "physical",
  "outbound_call",
  "inbound_call",
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "custom",
  "ask_invitee",
  "webex_conference",
  "gotomeeting_conference",
];

export const zLocationKind = z.enum(LOCATION_KINDS as [LocationKind, ...LocationKind[]]);

/** One event type location (section 5.3). connectionId ownership is checked by assertLocationConnectionsOwnedBy. */
export const zLocationConfig: z.ZodType<LocationConfig> = z
  .object({
    id: z.uuid(),
    kind: zLocationKind,
    position: z.number().int().min(0).max(100),
    location: z.string().trim().max(1000).nullish(),
    additionalInfo: z.string().trim().max(2000).nullish(),
    phoneNumber: zE164.nullish(),
    displayBeforeBooking: z.boolean().optional(),
    connectionId: z.uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "physical" && !v.location?.trim()) {
      ctx.addIssue({ code: "custom", path: ["location"], message: "Enter an address or venue" });
    }
    if (v.kind === "inbound_call" && !v.phoneNumber) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter the phone number invitees should call" });
    }
  });

/** https URL (user-supplied URLs fetched server side also go through safeFetch). */
export const zUrlHttps = z
  .string()
  .trim()
  .max(2048, "URL is too long")
  .pipe(z.url({ protocol: /^https$/, message: "Enter a URL that starts with https://" }));

/** http or https URL (redirect targets, links shown to users). */
export const zUrlHttp = z
  .string()
  .trim()
  .max(2048, "URL is too long")
  .pipe(z.url({ protocol: /^https?$/, message: "Enter a URL that starts with https:// or http://" }));

/** UUID route params and ids. */
export const zId = z.uuid("Invalid id");

/** "YYYY-MM-DD". */
export const zIsoDate = z.iso.date("Enter a date like 2026-10-14");

/** ISO 8601 instant with an offset or Z, parsed to a Date. */
export const zInstant = z.iso
  .datetime({ offset: true, message: "Enter a valid date and time" })
  .transform((v) => new Date(v));

/** AU-01 password rule: at least 8 characters with at least one letter and one number. */
export const zPassword = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(256, "Password is too long")
  .refine((v) => /[A-Za-z\p{L}]/u.test(v) && /\d/.test(v), "Use at least one letter and one number");

/** Checkbox and toggle values from forms ("on", "true", "1") to booleans. */
export const zFormBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true" || v === "1");

/** Trimmed optional text: "" becomes null. */
export const zOptionalText = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
