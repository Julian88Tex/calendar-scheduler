// OWNER: foundation-ui.
//
// GEN-21 "Report abuse" mailto (server and client safe): subject "Report abuse: {page URL}" and a body asking what
// happened (no form, nothing stored).

export const REPORT_ABUSE_BODY = "Please describe what happened (what you saw on this page and why it looks abusive):\n\n";

export function reportAbuseHref(operatorEmail: string, pageUrl: string): string {
  const subject = encodeURIComponent(`Report abuse: ${pageUrl}`);
  const body = encodeURIComponent(REPORT_ABUSE_BODY);
  return `mailto:${operatorEmail}?subject=${subject}&body=${body}`;
}
