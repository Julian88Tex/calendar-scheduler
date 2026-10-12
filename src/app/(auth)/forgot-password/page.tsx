// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /forgot-password (ARCHITECTURE section 3.1, SPEC AU-07): asks for the login email and sends a reset link valid for 60
// minutes. The answer never reveals whether an account exists.
import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../_components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ResetYourPasswordPage({ searchParams }: Props) {
  await searchParams;
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email address you use to log in and we'll send you a link to reset your password."
      footer={
        <p>
          Remember your password?{" "}
          <Link href="/login" className="font-semibold text-primary-text hover:underline">
            Log In
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
