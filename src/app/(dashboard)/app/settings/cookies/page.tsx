// OWNER: settings-onboarding.
//
// /app/settings/cookies (Cookie settings, SPEC BR-11) is not built: docs/SCOPE.md item 14 keeps only Profile, Branding, My Link
// and Login and security. The route answers 404 and nothing links to it.
import { notFound } from "next/navigation";

export default function NotBuiltSettingsPage(): never {
  notFound();
}
