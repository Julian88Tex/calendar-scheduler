// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// GEN-21 "Report abuse" mailto (server and client safe).

export function reportAbuseHref(operatorEmail: string, pageUrl: string): string {
  const subject = encodeURIComponent(`Report abuse: ${pageUrl}`);
  const body = encodeURIComponent("Please describe what happened:\n\n");
  return `mailto:${operatorEmail}?subject=${subject}&body=${body}`;
}
