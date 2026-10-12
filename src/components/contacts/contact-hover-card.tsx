// OWNER: contacts. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ContactHoverCard (ARCHITECTURE section 25): contact details on hover over an invitee name or email. Foundation stub:
// renders the children unchanged.
import type * as React from "react";

export type ContactHoverCardProps = { email: string; name?: string | null; children: React.ReactNode };

export function ContactHoverCard({ children }: ContactHoverCardProps) {
  return <>{children}</>;
}
