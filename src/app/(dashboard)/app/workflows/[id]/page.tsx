// OWNER: workflows.
//
// /app/workflows/[id]: The custom workflow builder is not part of this build (docs/SCOPE.md: workflows lite); email reminders are set
// up in each event type's "Notifications and workflows" section (src/components/workflows).
// There is no navigation to this route; it answers 404 so no placeholder UI is shown.
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditWorkflowPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  notFound();
}
