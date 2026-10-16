// OWNER: foundation-ui.
//
// /app redirects to /app/scheduling (ARCHITECTURE section 3.1).
import { redirect } from "next/navigation";

export default function AppIndexPage() {
  redirect("/app/scheduling");
}
