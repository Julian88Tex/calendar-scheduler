// OWNER: workflows.
//
// HostPhoneVerification (SPEC NT-17): the host's SMS number verification card for Settings > Notifications. Text
// reminders are not part of this build (docs/SCOPE.md: workflows lite sends email reminders only), so the card
// renders nothing; the signature is kept for the settings page contract.
export type HostPhoneVerificationProps = { userId: string };

export function HostPhoneVerification({ userId: _userId }: HostPhoneVerificationProps) {
  return null;
}
