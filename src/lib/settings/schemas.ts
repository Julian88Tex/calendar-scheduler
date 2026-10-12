// Settings input schemas, limits and copy (SPEC BR-01 to BR-06, BR-08, BR-10, AU-05, AU-10, GEN-02; docs/SCOPE.md item
// 14: Profile, Branding, My Link, Login and security). Client and server safe: the forms validate with the same schemas
// and helpers the Server Actions use.
import { z } from "zod";
import { HANDLE_MAX_LENGTH, HANDLE_PATTERN, HANDLE_TAKEN_MESSAGE, HANDLE_UNAVAILABLE_MESSAGE, isReservedSlug } from "@/lib/slugs";
import { zId, zPassword, zTimeZone } from "@/lib/validation";

// ---------------------------------------------------------------------------------------------------------- Profile

export const NAME_MAX_LENGTH = 100;
/** BR-03: the welcome message counter stops at 265 characters. */
export const WELCOME_MESSAGE_MAX_LENGTH = 265;
export const DEFAULT_WELCOME_MESSAGE =
  "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.";

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormatSetting = (typeof TIME_FORMATS)[number];
export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY"] as const;
export type DateFormatSetting = (typeof DATE_FORMATS)[number];

/** Calendly's labels for the Time Format and Date Format dropdowns. */
export const TIME_FORMAT_OPTIONS: readonly { value: TimeFormatSetting; label: string }[] = [
  { value: "12h", label: "12h (am/pm)" },
  { value: "24h", label: "24h" },
];
export const DATE_FORMAT_OPTIONS: readonly { value: DateFormatSetting; label: string }[] = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
];

export const NAME_REQUIRED_MESSAGE = "Enter your name.";
export const NAME_TOO_LONG_MESSAGE = `Use ${NAME_MAX_LENGTH} characters or fewer.`;
export const WELCOME_TOO_LONG_MESSAGE = `Use ${WELCOME_MESSAGE_MAX_LENGTH} characters or fewer.`;

/** Line breaks as the textarea reports them ("\n"); surrounding whitespace dropped. */
export function normalizeWelcomeMessage(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export const ProfileInput = z.object({
  name: z.string().trim().min(1, NAME_REQUIRED_MESSAGE).max(NAME_MAX_LENGTH, NAME_TOO_LONG_MESSAGE),
  welcomeMessage: z
    .string()
    .max(WELCOME_MESSAGE_MAX_LENGTH * 2)
    .transform(normalizeWelcomeMessage)
    .pipe(z.string().max(WELCOME_MESSAGE_MAX_LENGTH, WELCOME_TOO_LONG_MESSAGE)),
  timezone: zTimeZone,
  timeFormat: z.enum(TIME_FORMATS, "Choose a time format"),
  dateFormat: z.enum(DATE_FORMATS, "Choose a date format"),
});
export type ProfileInputValue = z.output<typeof ProfileInput>;

/** What the Profile form edits (also what the page passes to it). */
export type ProfileFormValues = {
  name: string;
  welcomeMessage: string;
  timezone: string;
  timeFormat: TimeFormatSetting;
  dateFormat: DateFormatSetting;
};

export function asTimeFormat(value: string | null | undefined): TimeFormatSetting {
  return value === "24h" ? "24h" : "12h";
}

export function asDateFormat(value: string | null | undefined): DateFormatSetting {
  return value === "DD/MM/YYYY" ? "DD/MM/YYYY" : "MM/DD/YYYY";
}

// ------------------------------------------------------------------------------------------------- Images (BR-02, BR-05)

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** BR-02: avatars are cropped square and stored at 256 by 256 pixels (the browser resizes before the upload). */
export const AVATAR_SIZE = 256;
/** BR-05: logos are stored at most 880 pixels wide (and tall). */
export const LOGO_MAX_SIZE = 880;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const AVATAR_HINT = "JPG, PNG, GIF or WebP. Max size of 5 MB.";
export const LOGO_HINT = "JPG, PNG, GIF or WebP. Max size of 5 MB. Recommended size: at least 440 x 240 pixels.";
export const IMAGE_TOO_LARGE_MESSAGE = "Images must be smaller than 5 MB.";

export type ImageKind = "avatar" | "logo";

// ------------------------------------------------------------------------------------------------- Branding (BR-06)

export const BrandingInput = z.object({ showBranding: z.boolean() });

// ---------------------------------------------------------------------------------------------------- My Link (BR-08)

export type HandleStatus = "empty" | "invalid" | "reserved" | "taken" | "current" | "available";
export type HandleCheck = { slug: string; status: HandleStatus; message: string };

export const HANDLE_MESSAGES: Record<HandleStatus, string> = {
  empty: "Choose a URL.",
  invalid: "Use letters, numbers and hyphens only, starting and ending with a letter or number.",
  reserved: HANDLE_UNAVAILABLE_MESSAGE,
  taken: HANDLE_TAKEN_MESSAGE,
  current: "This is your current URL.",
  available: "Available",
};

/**
 * Normalizes handle input while it is typed (GEN-02): lowercase, accents stripped, spaces and underscores become
 * hyphens, other characters are removed, repeated hyphens collapse, at most 50 characters. Unlike slugify it keeps a
 * trailing hyphen so "julian-" can still become "julian-joseph"; the pattern check rejects it if it stays.
 */
export function sanitizeHandleInput(raw: string): string {
  return (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, HANDLE_MAX_LENGTH);
}

/** The checks that need no database (empty, pattern, reserved word), or null when only availability remains. */
export function localHandleCheck(slug: string): HandleCheck | null {
  if (!slug) return { slug, status: "empty", message: HANDLE_MESSAGES.empty };
  if (!HANDLE_PATTERN.test(slug)) return { slug, status: "invalid", message: HANDLE_MESSAGES.invalid };
  if (isReservedSlug(slug)) return { slug, status: "reserved", message: HANDLE_MESSAGES.reserved };
  return null;
}

export const HandleInput = z.object({ slug: z.string().max(200).transform(sanitizeHandleInput) });

// ------------------------------------------------------------------------------------- Login and security (BR-10, AU-10)

export const PASSWORD_RULES_HINT = "Use at least 8 characters, including a letter and a number.";
export const PASSWORDS_DIFFER_MESSAGE = "Passwords don't match.";
export const CURRENT_PASSWORD_REQUIRED_MESSAGE = "Enter your current password.";

export const PasswordChangeInput = z
  .object({
    currentPassword: z.string().max(256).optional().default(""),
    newPassword: zPassword,
    confirmPassword: z.string().max(256),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: PASSWORDS_DIFFER_MESSAGE });
    }
  });
export type PasswordChangeValue = z.output<typeof PasswordChangeInput>;

export const SessionInput = z.object({ sessionId: zId });

export type DeviceKind = "desktop" | "mobile" | "tablet";

/** One row of the "Active sessions" list (dates as ISO strings for the client). */
export type SessionListItem = {
  id: string;
  current: boolean;
  label: string;
  browser: string | null;
  os: string | null;
  device: DeviceKind;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
};
