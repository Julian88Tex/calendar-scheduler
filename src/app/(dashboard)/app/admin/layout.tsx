// OWNER: foundation-ui.
//
// Admin center section (SPEC ADM-01, GEN-20) is not built: docs/SCOPE.md skips the admin center (admin-compliance,
// teams-org) and admin branding, so no kept page lives under /app/admin and nothing links here (no sidebar, header or
// account menu entry, no sub-navigation). Every /app/admin route answers 404 for everyone through this layout.
import { notFound } from "next/navigation";

export default function AdminLayout(): never {
  notFound();
}
