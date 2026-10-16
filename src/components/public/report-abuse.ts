// OWNER: foundation-ui.
//
// GEN-21 "Report abuse" mailto (server and client safe): subject "Report abuse: {page URL}" and a body asking what
// happened (no form, nothing stored).

export const REPORT_ABUSE_BODY = "Please describe what happened (what you saw on this page and why it looks abusive):\n\n";

/** The mailto: address part: percent-encoded (RFC 6068) so "?", "&" or "#" in an address cannot inject headers. */
export function mailtoAddress(email: string): string {
  return encodeURIComponent(email.trim()).replace(/%40/g, "@");
}

export function reportAbuseHref(operatorEmail: string, pageUrl: string): string {
  const subject = encodeURIComponent(`Report abuse: ${pageUrl}`);
  const body = encodeURIComponent(REPORT_ABUSE_BODY);
  return `mailto:${mailtoAddress(operatorEmail)}?subject=${subject}&body=${body}`;
}
