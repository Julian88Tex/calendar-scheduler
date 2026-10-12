// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Integrations section (SPEC CAL-21): a plain container; the hub and every detail page render their own header.
import type * as React from "react";

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl">{children}</div>;
}
