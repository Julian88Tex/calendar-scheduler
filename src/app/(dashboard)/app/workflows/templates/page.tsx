// OWNER: workflows.
//
// /app/workflows/templates: The custom workflow builder is not part of this build (docs/SCOPE.md: workflows lite); email reminders are set
// up in each event type's "Notifications and workflows" section (src/components/workflows).
// There is no navigation to this route; it answers 404 so no placeholder UI is shown.
import { notFound } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function WorkflowTemplatesPage({ searchParams }: Props) {
  await searchParams;
  notFound();
}
