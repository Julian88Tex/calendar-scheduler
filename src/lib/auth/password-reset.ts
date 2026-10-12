// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Password reset (SPEC AU-07): 60 minute single-use token consumed only by the POST (GET never consumes it), log in
// and revoke other sessions on success. Foundation stub: not configured.
import "server-only";
import { AppError } from "@/lib/errors";

export const RESET_LINK_SENT_MESSAGE = "If an account exists for {email}, we sent a link to reset your password.";
export const RESET_LINK_EXPIRED_MESSAGE = "This link has expired. Request a new one.";

/** Sends the reset email when the account exists (always answers the same way). */
export async function requestPasswordReset(email: string, ctx: { ip?: string | null } = {}): Promise<void> {
  void email;
  void ctx;
  throw new AppError("not_configured", "Password reset is not available yet.");
}

/** Validates a reset token without consuming it (for the GET page). */
export async function peekPasswordResetToken(token: string): Promise<{ email: string } | null> {
  void token;
  return null;
}

/** Consumes the token and sets the new password; returns the user id (the caller creates the session). */
export async function resetPassword(token: string, newPassword: string): Promise<{ userId: string }> {
  void token;
  void newPassword;
  throw new AppError("not_configured", "Password reset is not available yet.");
}
