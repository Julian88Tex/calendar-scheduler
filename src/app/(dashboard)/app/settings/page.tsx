// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings redirects to the first settings page (SPEC BR-14).
import { redirect } from "next/navigation";

export default function SettingsIndexPage() {
  redirect("/app/settings/profile");
}
