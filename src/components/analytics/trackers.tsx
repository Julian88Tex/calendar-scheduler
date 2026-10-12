// OWNER: analytics. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PublicTrackers (SPEC AN-13, GEN-14): loads the host's GA4 and Meta Pixel on public pages only after cookie consent
// and fires the named booking events. Foundation stub: renders nothing.
"use client";

export type PublicTrackersProps = {
  hostUserId: string;
  /** From the cookie banner (src/components/public/cookie-consent.ts). */
  consent: "granted" | "denied" | "unknown";
};

export function PublicTrackers(_props: PublicTrackersProps) {
  return null;
}
