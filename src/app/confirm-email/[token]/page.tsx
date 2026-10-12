// OWNER: settings-onboarding.
//
// /confirm-email/[token] (login email change confirmation, SPEC AU-10) is not built: docs/SCOPE.md item 14 keeps
// "change password" and sessions in Login and security, not the email change, so no confirmation link is ever sent.
// The route answers 404.
import { notFound } from "next/navigation";

export default function ConfirmNewEmailPage(): never {
  notFound();
}
