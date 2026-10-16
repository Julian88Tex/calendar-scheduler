// OWNER: foundation-ui.
//
// Integrations section (SPEC CAL-21): a plain container; the hub and every detail page render their own header.
import type * as React from "react";

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return <div className="w-full min-w-0">{children}</div>;
}
