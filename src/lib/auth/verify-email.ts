// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email verification (SPEC AU-08): 24 hour token; the link page shows a "Verify email" button that POSTs (GEN-08).
// Foundation stub: no email is sent and no token verifies.
import "server-only";
import { AppError } from "@/lib/errors";

/** Sends (or re-sends) the verification email for a user. */
export async function sendVerificationEmail(userId: string): Promise<void> {
  void userId;
}

/** Validates a verification token without consuming it (for the GET page). */
export async function peekEmailVerificationToken(token: string): Promise<{ email: string } | null> {
  void token;
  return null;
}

/** Consumes the token and sets users.email_verified_at; returns the user id. */
export async function verifyEmailToken(token: string): Promise<{ userId: string }> {
  void token;
  throw new AppError("not_found", "This link has expired. Request a new one.");
}
