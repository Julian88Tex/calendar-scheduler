// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /reset-password/[token] (ARCHITECTURE section 3.1, SPEC AU-07, GEN-08): opening the link only checks the token (it is
// consumed by the form's POST), so mail scanners cannot burn it. Unknown, used or expired links show "This link has
// expired. Request a new one.".
import { KeyRound, LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { peekPasswordResetToken, RESET_LINK_EXPIRED_MESSAGE } from "@/lib/auth/password-reset";
import { AuthIcon, AuthShell } from "../../_components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChooseANewPasswordPage({ params, searchParams }: Props) {
  const [{ token: raw }] = await Promise.all([params, searchParams]);
  const token = safeDecode(raw);
  const info = await peekPasswordResetToken(token);
  if (!info) {
    return (
      <AuthShell
        icon={
          <AuthIcon tone="danger">
            <LinkIcon />
          </AuthIcon>
        }
        title="Link expired"
        description={RESET_LINK_EXPIRED_MESSAGE}
      >
        <Link href="/forgot-password" className={buttonClassName({ size: "lg", fullWidth: true })}>
          Request a new link
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      icon={
        <AuthIcon>
          <KeyRound />
        </AuthIcon>
      }
      title="Choose a new password"
      description={
        <>
          for <span className="font-semibold text-ink">{info.email}</span>
        </>
      }
    >
      <ResetPasswordForm token={token} email={info.email} />
    </AuthShell>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
