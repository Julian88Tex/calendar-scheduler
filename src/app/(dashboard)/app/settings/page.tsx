// OWNER: settings-onboarding.
//
// /app/settings redirects to the first settings page, Profile (SPEC BR-14).
import { redirect } from "next/navigation";

export default function SettingsIndexPage(): never {
  redirect("/app/settings/profile");
}
