// Input of the owner bootstrap (POST /api/setup/bootstrap and scripts/bootstrap-owner.ts). Client and server safe.
import { z } from "zod";
import { NAME_MAX_LENGTH, NAME_REQUIRED_MESSAGE, NAME_TOO_LONG_MESSAGE, normalizeDisplayName } from "@/lib/settings/schemas";
import { zEmail } from "@/lib/validation";

export const AVATAR_URL_MAX = 2048;
export const AVATAR_URL_MESSAGE = "Enter an https link to an image.";

/** A profile picture link: https only (the app shows no other avatar URLs), no credentials in the URL. */
const zAvatarUrl = z
  .string()
  .trim()
  .max(AVATAR_URL_MAX, AVATAR_URL_MESSAGE)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, AVATAR_URL_MESSAGE);

export const BootstrapOwnerInputSchema = z
  .object({
    email: zEmail,
    name: z
      .string()
      .max(NAME_MAX_LENGTH * 2, NAME_TOO_LONG_MESSAGE)
      .transform(normalizeDisplayName)
      .pipe(z.string().min(1, NAME_REQUIRED_MESSAGE).max(NAME_MAX_LENGTH, NAME_TOO_LONG_MESSAGE))
      .nullish(),
    avatarUrl: zAvatarUrl.nullish(),
  })
  .strict();

export type BootstrapOwnerInput = z.input<typeof BootstrapOwnerInputSchema>;
export type BootstrapOwnerParsedInput = z.output<typeof BootstrapOwnerInputSchema>;
