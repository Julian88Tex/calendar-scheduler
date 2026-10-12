// Zod schemas of the auth forms (SPEC AU-01, AU-04, AU-07, AU-08, AU-09; ARCHITECTURE section 26 rule 4). Client and
// server safe (zod only): the pages validate with the same rules before submitting, the actions validate again.
import { z } from "zod";
import { zEmail, zPassword } from "@/lib/validation";

/** Same-site return path from ?next= (sanitized again with safeNextPath on use). */
const zNext = z.string().max(2048).optional();

/** Browser IANA zone (validated with isValidTimeZone on use; invalid values fall back to UTC). */
const zBrowserZone = z.string().max(64).optional();

export const LoginEmailInput = z.object({
  email: z.string().trim().min(1, "Enter your email address").max(254, "Email address is too long").pipe(z.email("Enter a valid email address")),
});

export const LoginInput = z.object({
  email: z.string().trim().min(1, "Enter your email address").max(254, "Email address is too long"),
  password: z.string().min(1, "Enter your password").max(256, "Password is too long"),
  next: zNext,
});

export const SignupEmailInput = z.object({ email: zEmail });

export const SignupInput = z.object({
  email: zEmail,
  name: z.string().trim().min(1, "Enter your full name").max(100, "Name is too long"),
  password: zPassword,
  timezone: zBrowserZone,
});

export const ForgotPasswordInput = z.object({ email: zEmail });

export const ResetPasswordInput = z
  .object({
    token: z.string().min(1).max(200),
    password: zPassword,
    confirmPassword: z.string().min(1, "Confirm your new password").max(256),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" });

export const VerifyEmailInput = z.object({ token: z.string().min(1).max(200) });

export const TwoFactorInput = z.object({
  method: z.enum(["totp", "recovery"]).default("totp"),
  code: z.string().trim().min(1, "Enter your code").max(32, "Enter your code"),
  next: zNext,
  loginMethod: z.enum(["password", "google", "microsoft"]).optional(),
});

/** Client-side password rule check (AU-01): the hint lines and their state. */
export function passwordChecks(password: string): { length: boolean; letterAndNumber: boolean } {
  return { length: password.length >= 8, letterAndNumber: /[A-Za-z\p{L}]/u.test(password) && /\d/.test(password) };
}
