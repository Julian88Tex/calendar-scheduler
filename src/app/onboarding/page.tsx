// OWNER: settings-onboarding.
//
// /onboarding: the onboarding wizard (SPEC AU-12) is not built (docs/SCOPE.md item 14). New accounts land on
// Scheduling, so this route sends everyone there (signed-out visitors then reach the login page).
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OnboardingPage(): never {
  redirect("/app/scheduling");
}
