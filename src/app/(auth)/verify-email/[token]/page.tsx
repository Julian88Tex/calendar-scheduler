// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /verify-email/[token] (ARCHITECTURE section 3.1, SPEC AU-08, GEN-08): shows the address and a "Verify email" button;
// verification happens only on that POST (mail scanners prefetch GETs). Expired or used links offer "Resend email"
// to the signed-in owner; an address that is already verified says so.
import { LinkIcon, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { ALREADY_VERIFIED_MESSAGE, inspectEmailVerificationToken, VERIFY_LINK_EXPIRED_MESSAGE } from "@/lib/auth/verify-email";
import { AuthIcon, AuthShell } from "../../_components/auth-shell";
import { ResendVerificationButton } from "./resend-button";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function VerifyYourEmailPage({ params, searchParams }: Props) {
  const [{ token: raw }] = await Promise.all([params, searchParams]);
  const token = safeDecode(raw);
  const [info, user] = await Promise.all([inspectEmailVerificationToken(token), getCurrentUser()]);

  if (!info || info.alreadyVerified) {
    const verified = Boolean(info?.alreadyVerified) || Boolean(user?.emailVerifiedAt && !info);
    return (
      <AuthShell
        icon={<AuthIcon tone={verified ? "success" : "danger"}>{verified ? <MailCheck /> : <LinkIcon />}</AuthIcon>}
        title={verified ? "Email verified" : "Link expired"}
        description={verified ? ALREADY_VERIFIED_MESSAGE : VERIFY_LINK_EXPIRED_MESSAGE}
      >
        {user && !user.emailVerifiedAt ? (
          <ResendVerificationButton />
        ) : (
          <Link href={user ? "/app/scheduling" : "/login"} className={buttonClassName({ size: "lg", fullWidth: true })}>
            {user ? "Go to Scheduling" : "Log In"}
          </Link>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={
        <AuthIcon>
          <MailCheck />
        </AuthIcon>
      }
      title="Verify your email"
      description={
        <>
          Click the button below to confirm <span className="font-semibold text-ink">{info.email}</span> is your email address.
        </>
      }
    >
      <VerifyEmailForm token={token} signedIn={Boolean(user)} />
    </AuthShell>
  );
}
