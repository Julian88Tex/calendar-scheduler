// OWNER: foundation-ui.
//
// VisuallyHidden (ARCHITECTURE 20.2): content for screen readers only. Server and client safe.
import type * as React from "react";

export function VisuallyHidden({ children, as: Tag = "span" }: { children: React.ReactNode; as?: "span" | "div" | "h2" | "h3" | "p" }) {
  return <Tag className="sr-only">{children}</Tag>;
}
