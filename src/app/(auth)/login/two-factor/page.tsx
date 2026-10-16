// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /login/two-factor (ARCHITECTURE section 3.1, SPEC AU-09): the second step of a login (password or OAuth) for
// accounts with two-factor authentication. Only a two_factor_pending session reaches it: without a session the visitor
// goes to /login, a fully signed-in user goes on to ?next=. "Log in with a different account" logs the pending
// session out.
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { requirePendingTwoFactorSession } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/url";
import { AuthIcon, AuthShell } from "../../_components/auth-shell";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TwoFactorAuthenticationPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  const { user } = await requirePendingTwoFactorSession(next);
  const method = sp.method === "google" || sp.method === "microsoft" ? sp.method : "password";
  return (
    <AuthShell
      icon={
        <AuthIcon>
          <ShieldCheck />
        </AuthIcon>
      }
      title="Two-factor authentication"
      description={
        <>
          Enter the code for <span className="font-semibold text-ink">{user.email}</span> to finish logging in.
        </>
      }
      footer={
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="font-semibold text-primary-text hover:underline">
            Log in with a different account
          </button>
        </form>
      }
    >
      <TwoFactorForm next={next} loginMethod={method} />
    </AuthShell>
  );
}
