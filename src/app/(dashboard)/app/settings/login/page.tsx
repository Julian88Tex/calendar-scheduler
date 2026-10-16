// OWNER: settings-onboarding.
//
// /app/settings/login, "Login and security" (SPEC BR-10, AU-05, AU-10; docs/SCOPE.md item 14): the login email, change
// or set the password (other sessions are logged out), and the active sessions with "Log out" per session and "Log out
// of all other sessions". Sessions are listed and ended for the signed-in user only.
import type { Metadata } from "next";
import { PasswordCard } from "@/components/settings/password-card";
import { SessionsCard } from "@/components/settings/sessions-card";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { getLoginMethods, listUserSessions } from "@/lib/settings";
import { now } from "@/lib/time/now";

export const metadata: Metadata = { title: "Login and security" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginAndSecurityPage({ searchParams }: Props) {
  const [{ session, user }] = await Promise.all([requireSession(), searchParams]);
  const db = await getDb();
  const [methods, sessions] = await Promise.all([getLoginMethods(user.id, db), listUserSessions(db, user.id, session.id)]);
  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <PageHeader title="Login and security" className="mb-0" />
      <PasswordCard email={methods.email} hasPassword={methods.hasPassword} providers={methods.providers} />
      <SessionsCard key={sessions.map((s) => s.id).join(",")} sessions={sessions} timezone={user.timezone || "UTC"} nowIso={now().toISOString()} />
    </div>
  );
}
