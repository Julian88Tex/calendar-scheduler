// OWNER: lifecycle-ui.
//
// 404 of /reschedulings/** (SPEC CR-02, CR-03, GEN-08): unknown or malformed invitee ids and invalid starts.
import type { Metadata } from "next";
import { ChangeNotFound } from "@/components/lifecycle/change-not-found";
import { lt } from "@/components/lifecycle/lib/t";
import { PublicPageShell } from "@/components/public/public-page-shell";

export const metadata: Metadata = { title: lt("states.notFoundTitle"), robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <PublicPageShell showFooterLinks={false}>
      <ChangeNotFound />
    </PublicPageShell>
  );
}
