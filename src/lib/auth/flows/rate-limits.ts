// Auth rate limits (SPEC AU-14, ARCHITECTURE section 18.6). Keys are namespaced and never contain raw emails or IPs:
// emails are SHA-256 hashed (normalized first), IPs go through hashIp() (HMAC with the session secret).
//
// - Login: 10 failed attempts per email and 50 per IP per 15 minutes; the next attempt is rejected before the
//   password is checked ("Too many attempts. Try again in {minutes} minutes.").
// - Password reset and verification emails: 5 per email per hour (each purpose has its own window).
// - Signup: 20 per IP per hour. The step 1 email check has its own, looser window against enumeration scripts.
// - TOTP and recovery codes: 5 per session per 5 minutes.
import "server-only";
import { hashIp, sha256Hex } from "@/lib/crypto";
import { rateLimitKey } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validation";

export const AUTH_RATE_LIMITS = {
  loginEmail: { limit: 10, windowSeconds: 15 * 60 },
  loginIp: { limit: 50, windowSeconds: 15 * 60 },
  resetEmail: { limit: 5, windowSeconds: 60 * 60 },
  verifyEmail: { limit: 5, windowSeconds: 60 * 60 },
  signupIp: { limit: 20, windowSeconds: 60 * 60 },
  signupEmailCheckIp: { limit: 60, windowSeconds: 15 * 60 },
  twoFactorSession: { limit: 5, windowSeconds: 5 * 60 },
  loginMethodCode: { limit: 5, windowSeconds: 60 * 60 },
} as const;

const emailHash = (email: string) => sha256Hex(`email:${normalizeEmail(email)}`).slice(0, 40);

export function loginEmailKey(email: string): string {
  return rateLimitKey("login", "email", emailHash(email));
}

export async function loginIpKey(ip: string | null): Promise<string> {
  return rateLimitKey("login", "ip", await hashIp(ip));
}

export function resetEmailKey(email: string): string {
  return rateLimitKey("auth-email", "reset", emailHash(email));
}

export function verifyEmailKey(email: string): string {
  return rateLimitKey("auth-email", "verify", emailHash(email));
}

export async function signupIpKey(ip: string | null): Promise<string> {
  return rateLimitKey("signup", "ip", await hashIp(ip));
}

export async function signupEmailCheckIpKey(ip: string | null): Promise<string> {
  return rateLimitKey("signup-check", "ip", await hashIp(ip));
}

export function twoFactorSessionKey(sessionId: string): string {
  return rateLimitKey("totp", "session", sessionId);
}

export function loginMethodCodeKey(userId: string): string {
  return rateLimitKey("login-method-code", "user", userId);
}
