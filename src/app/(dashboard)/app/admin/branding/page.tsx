// OWNER: settings-onboarding.
//
// /app/admin/branding (organization branding, SPEC BR-16) is not built: docs/SCOPE.md skips the admin center and admin
// branding. The route answers 404 and nothing links to it.
import { notFound } from "next/navigation";

export default function AdminBrandingPage(): never {
  notFound();
}
